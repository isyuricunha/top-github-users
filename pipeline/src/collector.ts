import type { LocationConfig, RankedUser } from './types.ts';
import { normalizeUser } from './normalize.ts';
import { GraphQLClient } from './graphql.ts';

/**
 * This project uses lowercase country names with whitespace replaced by underscores for search and file paths.
 */
export function normalizeLocationTerm(place: string): string {
  return place.trim().toLowerCase().replace(/\s+/g, '_');
}

export function buildSearchQuery(locations: string[]): string {
  const terms = locations.map((place) => `location:${normalizeLocationTerm(place)}`);
  return [...terms, 'sort:followers-desc'].join(' ');
}

export const MAX_USERS = 500;
export const CONTRIBUTION_BATCH = 10;

const LIGHT_SEARCH_QUERY = `
  query SearchUsers($query: String!, $first: Int!, $after: String) {
    search(type: USER, query: $query, first: $first, after: $after) {
      userCount
      edges {
        node {
          __typename
          ... on User {
            id
            login
            avatarUrl(size: 96)
            name
            location
            company
            twitterUsername
            followers { totalCount }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CONTRIBUTIONS_QUERY = `
  query UserContributions($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on User {
        login
        contributionsCollection {
          contributionCalendar { totalContributions }
          restrictedContributionsCount
        }
      }
    }
  }
`;

interface LightUser {
  __typename: 'User';
  id: string;
  login: string;
  avatarUrl: string;
  name: string | null;
  location: string | null;
  company: string | null;
  twitterUsername: string | null;
  followers: { totalCount: number };
}

interface LightSearchResponse {
  search: {
    userCount: number;
    edges: Array<{ node: LightUser | { __typename: string } | null } | null>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface ContributionsResponse {
  nodes: Array<{
    __typename: string;
    login?: string;
    contributionsCollection?: {
      contributionCalendar: { totalContributions: number };
      restrictedContributionsCount: number;
    };
  } | null>;
}

export interface CollectResult {
  users: RankedUser[];
  userCount: number;
  searchPages: number;
  contributionBatches: number;
  truncated: boolean;
}

export interface CollectOptions {
  first?: number;
  userLimit?: number;
  batchSize?: number;
  delayMs?: number;
  sleeper?: (ms: number) => Promise<void>;
}

function isUserNode(node: unknown): node is LightUser {
  const candidate = node as { __typename?: string } | null;
  return candidate !== null && candidate.__typename === 'User';
}

interface RawSearch {
  users: LightUser[];
  userCount: number;
  searchPages: number;
  truncated: boolean;
}

/**
 * Phase 1: light search over the country and its cities, ordered by
 * followers, up to the user limit. No heavy fields, so 100 users per page
 * stay inside the documented per-query resource limits.
 */
async function searchLocation(
  location: Pick<LocationConfig, 'country' | 'cities'>,
  client: GraphQLClient,
  options: CollectOptions,
): Promise<RawSearch> {
  const first = options.first ?? 100;
  const userLimit = options.userLimit ?? MAX_USERS;
  const delayMs = options.delayMs ?? 1200;
  const sleep = options.sleeper ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const query = buildSearchQuery([location.country, ...location.cities]);
  const users: LightUser[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  let hasNextPage = true;
  let userCount = 0;
  while (hasNextPage && users.length < userLimit) {
    if (pages > 0 && delayMs > 0) await sleep(delayMs);
    const data: LightSearchResponse = await client.query(LIGHT_SEARCH_QUERY, {
      query,
      first: Math.min(first, userLimit - users.length),
      after: cursor,
    });
    pages += 1;
    userCount = data.search.userCount;
    for (const edge of data.search.edges) {
      const node = edge?.node;
      if (!isUserNode(node) || seen.has(node.login)) continue;
      seen.add(node.login);
      users.push(node);
    }
    hasNextPage = data.search.pageInfo.hasNextPage;
    cursor = data.search.pageInfo.endCursor;
  }
  return {
    users,
    userCount,
    searchPages: pages,
    truncated: hasNextPage || users.length < Math.min(userCount, userLimit),
  };
}

export interface Contributions {
  total: number;
  restricted: number;
}

/**
 * Phase 2: contribution counts via nodes() in small batches. The
 * contributionsCollection object is expensive server-side, and the
 * documented per-query resource limits reject batches larger than
 * roughly a dozen users.
 */
export async function fetchContributions(
  users: LightUser[],
  client: GraphQLClient,
  options: CollectOptions = {},
): Promise<Map<string, Contributions>> {
  const batchSize = options.batchSize ?? CONTRIBUTION_BATCH;
  const delayMs = options.delayMs ?? 1200;
  const sleep = options.sleeper ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const result = new Map<string, Contributions>();
  let batches = 0;
  for (let index = 0; index < users.length; index += batchSize) {
    if (batches > 0 && delayMs > 0) await sleep(delayMs);
    const slice = users.slice(index, index + batchSize);
    const data: ContributionsResponse = await client.query(CONTRIBUTIONS_QUERY, {
      ids: slice.map((user) => user.id),
    });
    batches += 1;
    for (const node of data.nodes) {
      if (node?.login && node.contributionsCollection) {
        result.set(node.login, {
          total: node.contributionsCollection.contributionCalendar.totalContributions,
          restricted: node.contributionsCollection.restrictedContributionsCount,
        });
      }
    }
  }
  return result;
}

/**
 * Collect the tracked user set of one location. Followers and profile
 * fields come from the light search; contribution counts from batched
 * nodes() lookups. Users whose contributions could not be fetched are
 * excluded so the contribution rankings never mix stale or zeroed values.
 */
export async function collectLocation(
  location: Pick<LocationConfig, 'country' | 'cities'>,
  client: GraphQLClient,
  options: CollectOptions = {},
): Promise<CollectResult> {
  const search = await searchLocation(location, client, options);
  const contributions = await fetchContributions(search.users, client, options);
  const users: RankedUser[] = [];
  for (const user of search.users) {
    const contribution = contributions.get(user.login);
    if (contribution === undefined) continue;
    users.push(
      normalizeUser({
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
        location: user.location,
        company: user.company,
        twitterUsername: user.twitterUsername,
        followers: user.followers.totalCount,
        publicContributions: contribution.total - contribution.restricted,
        privateContributions: contribution.restricted,
      }),
    );
  }
  return {
    users,
    userCount: search.userCount,
    searchPages: search.searchPages,
    contributionBatches: Math.ceil(search.users.length / (options.batchSize ?? CONTRIBUTION_BATCH)),
    truncated: search.truncated,
  };
}
