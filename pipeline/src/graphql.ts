/**
 * Minimal dependency-free GitHub GraphQL client with the rate limit
 * behavior documented by GitHub:
 * - primary limits: honor x-ratelimit-remaining and x-ratelimit-reset
 * - secondary limits: honor retry-after (at least 60s when absent)
 * - 5xx and network errors: exponential backoff
 * The caller stays sequential, which also satisfies the documented
 * "no concurrency" guidance for staying under secondary limits.
 */

export interface ClientOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleeper?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const ENDPOINT = 'https://api.github.com/graphql';

export class GraphQLClient {
  private readonly token: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;

  constructor(token: string, options: ClientOptions = {}) {
    this.token = token;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 2000;
    this.sleep = options.sleeper ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.doFetch = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      let response: Response;
      try {
        response = await this.doFetch(ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
            'user-agent': 'top-github-users-pipeline/1.0',
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch (error) {
        if (attempt >= this.maxAttempts) {
          throw new ApiError(`network error: ${String(error)}`, 0, null);
        }
        await this.sleep(this.baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      if (response.ok) {
        const body = (await response.json()) as {
          data: T | null;
          errors?: Array<{ message: string }>;
        };
        if (body.errors && body.errors.length > 0) {
          const message = body.errors.map((e) => e.message).join('; ');
          if (body.data === null) {
            throw new ApiError(`GraphQL errors: ${message}`, 200, null);
          }
          console.warn(`partial GraphQL errors: ${message}`);
        }
        if (body.data === null) {
          throw new ApiError('GraphQL response has no data', 200, null);
        }
        return body.data;
      }
      const remaining = response.headers.get('x-ratelimit-remaining');
      const resetAt = response.headers.get('x-ratelimit-reset');
      const retryAfter = response.headers.get('retry-after');
      const secondary = response.status === 403 || response.status === 429;
      if (attempt >= this.maxAttempts) {
        throw new ApiError(
          `GitHub API ${response.status} after ${attempt} attempts`,
          response.status,
          retryAfter ? Number(retryAfter) : null,
        );
      }
      let waitMs: number;
      if (secondary && retryAfter !== null) {
        waitMs = (Number(retryAfter) + 1) * 1000;
      } else if (secondary && remaining === '0' && resetAt !== null) {
        waitMs = Math.max(Number(resetAt) * 1000 - this.now() + 1000, 1000);
      } else if (secondary) {
        waitMs = 60_000;
      } else {
        waitMs = this.baseDelayMs * 2 ** (attempt - 1);
      }
      console.warn(
        `GitHub API ${response.status}, attempt ${attempt}/${this.maxAttempts}, waiting ${waitMs}ms`,
      );
      await this.sleep(waitMs);
    }
  }
}
