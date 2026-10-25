import { describe, expect, it, vi } from 'vitest';
import { GraphQLClient, ApiError } from '../src/graphql.ts';
import {
  CONTRIBUTION_BATCH,
  MAX_USERS,
  buildSearchQuery,
  collectLocation,
  normalizeLocationTerm,
} from '../src/collector.ts';
import type { LocationConfig } from '../src/types.ts';

const brazil: Pick<LocationConfig, 'country' | 'cities'> = {
  country: 'Brazil',
  cities: ['sao paulo', 'rio de janeiro'],
};

interface MockUser {
  id: string;
  login: string;
  followers: number;
}

function lightUser({ id, login, followers }: MockUser) {
  return {
    __typename: 'User',
    id,
    login,
    avatarUrl: `https://avatars.githubusercontent.com/u/1?v=4`,
    name: null,
    location: 'Sao Paulo',
    company: null,
    twitterUsername: null,
    followers: { totalCount: followers },
  };
}

function contributionNode(login: string, total: number, restricted: number) {
  return {
    __typename: 'User',
    login,
    contributionsCollection: {
      contributionCalendar: { totalContributions: total },
      restrictedContributionsCount: restricted,
    },
  };
}

function searchPage(users: MockUser[], hasNextPage: boolean, endCursor: string | null) {
  return {
    data: {
      search: {
        userCount: 10_000,
        edges: users.map((user) => ({ node: lightUser(user) })),
        pageInfo: { hasNextPage, endCursor },
      },
    },
  };
}

function contributionsPage(nodes: unknown[]) {
  return { data: { nodes } };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

interface Queues {
  search: unknown[];
  contributions: unknown[];
  calls: Array<{ type: string; variables: Record<string, unknown> }>;
}

function makeFetch(queues: Queues) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    const type = body.query.includes('SearchUsers') ? 'search' : 'contributions';
    queues.calls.push({ type, variables: body.variables });
    const next = queues[type].shift();
    if (next === undefined) throw new Error(`unexpected ${type} query`);
    return jsonResponse(next);
  });
}

describe('normalizeLocationTerm', () => {
  it('lowercases and underscores spaces', () => {
    expect(normalizeLocationTerm('  Rio  de Janeiro  ')).toBe('rio_de_janeiro');
  });
});

describe('buildSearchQuery', () => {
  it('unions the country and its cities and sorts by followers', () => {
    expect(buildSearchQuery(['Brazil', 'sao paulo', 'rio de janeiro'])).toBe(
      'location:brazil location:sao_paulo location:rio_de_janeiro sort:followers-desc',
    );
  });
});

describe('collectLocation', () => {
  it('merges the light search with batched contributions', async () => {
    const queues: Queues = {
      search: [searchPage([{ id: 'a1', login: 'alpha', followers: 900 }, { id: 'b2', login: 'beta', followers: 800 }], false, null)],
      contributions: [
        contributionsPage([contributionNode('alpha', 1000, 700), contributionNode('beta', 500, 100)]),
      ],
      calls: [],
    };
    const client = new GraphQLClient('t', { fetchImpl: makeFetch(queues), sleeper: async () => {} });
    const result = await collectLocation(brazil, client, { delayMs: 0 });
    expect(result.users).toHaveLength(2);
    expect(result.users[0]).toMatchObject({
      login: 'alpha',
      followers: 900,
      totalContributions: 1000,
      privateContributions: 700,
      publicContributions: 300,
    });
    expect(result.searchPages).toBe(1);
    expect(result.contributionBatches).toBe(1);
    const contributionCall = queues.calls.find((c) => c.type === 'contributions');
    expect(contributionCall?.variables.ids).toEqual(['a1', 'b2']);
  });

  it('drops users whose contributions are missing', async () => {
    const queues: Queues = {
      search: [
        searchPage([{ id: 'a1', login: 'alpha', followers: 900 }, { id: 'b2', login: 'beta', followers: 800 }], false, null),
      ],
      contributions: [contributionsPage([contributionNode('alpha', 100, 0), null])],
      calls: [],
    };
    const client = new GraphQLClient('t', { fetchImpl: makeFetch(queues), sleeper: async () => {} });
    const result = await collectLocation(brazil, client, { delayMs: 0 });
    expect(result.users.map((u) => u.login)).toEqual(['alpha']);
  });

  it('stops the search at the user limit and reports truncation', async () => {
    const queues: Queues = {
      search: [
        searchPage([{ id: 'a1', login: 'alpha', followers: 9 }], true, 'c1'),
        searchPage([{ id: 'b2', login: 'beta', followers: 8 }], true, 'c2'),
      ],
      contributions: [contributionsPage([contributionNode('alpha', 1, 0), contributionNode('beta', 1, 0)])],
      calls: [],
    };
    const client = new GraphQLClient('t', { fetchImpl: makeFetch(queues), sleeper: async () => {} });
    const result = await collectLocation(brazil, client, { delayMs: 0, userLimit: 2 });
    expect(result.users).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(queues.calls.filter((c) => c.type === 'search')).toHaveLength(2);
  });

  it('batches contributions in groups of the configured size', async () => {
    const users = Array.from({ length: 25 }, (_, i) => ({
      id: `i${i}`,
      login: `u${i}`,
      followers: 100 - i,
    }));
    const queues: Queues = {
      search: [searchPage(users, false, null)],
      contributions: [
        contributionsPage(users.slice(0, 10).map((u) => contributionNode(u.login, 5, 1))),
        contributionsPage(users.slice(10, 20).map((u) => contributionNode(u.login, 5, 1))),
        contributionsPage(users.slice(20, 25).map((u) => contributionNode(u.login, 5, 1))),
      ],
      calls: [],
    };
    const client = new GraphQLClient('t', { fetchImpl: makeFetch(queues), sleeper: async () => {} });
    const result = await collectLocation(brazil, client, { delayMs: 0 });
    expect(result.users).toHaveLength(25);
    expect(result.contributionBatches).toBe(3);
    const idCalls = queues.calls.filter((c) => c.type === 'contributions');
    expect(idCalls[2]?.variables.ids).toHaveLength(5);
  });

  it('keeps the documented defaults', () => {
    expect(MAX_USERS).toBe(500);
    expect(CONTRIBUTION_BATCH).toBe(10);
  });
});

describe('GraphQLClient retries', () => {
  it('waits for retry-after on a secondary limit and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ message: 'secondary rate limit' }, 403, { 'retry-after': '1' }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { search: null } }));
    const sleeper = vi.fn(async () => {});
    const client = new GraphQLClient('t', { fetchImpl, sleeper, maxAttempts: 3 });
    await expect(client.query('query { viewer { login } }', {})).resolves.toEqual({
      search: null,
    });
    expect(sleeper).toHaveBeenCalledWith(2000);
  });

  it('honors the primary rate limit reset window', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 2;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { message: 'rate limit' },
          403,
          { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { viewer: { login: 'x' } } }));
    const sleeper = vi.fn(async (_ms: number) => {});
    const client = new GraphQLClient('t', { fetchImpl, sleeper, maxAttempts: 3 });
    await client.query('query { viewer { login } }', {});
    expect(sleeper.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(1000);
  });

  it('gives up after max attempts', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: 'nope' }, 403, { 'retry-after': '0' }),
    );
    const client = new GraphQLClient('t', { fetchImpl, sleeper: async () => {}, maxAttempts: 2 });
    await expect(client.query('query { viewer { login } }', {})).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects GraphQL responses with errors and no data', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: null, errors: [{ message: 'bad query' }] }),
    );
    const client = new GraphQLClient('t', { fetchImpl, sleeper: async () => {} });
    await expect(client.query('query { nope }', {})).rejects.toThrow('bad query');
  });
});
