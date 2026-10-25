import type { RankedUser } from './types.ts';

const NULLISH = new Set(['', 'undefined value', 'undefined', 'null']);

/**
 * Profile strings from the API are normalized so absent values are null,
 * never placeholder strings such as "undefined value".
 */
export function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return NULLISH.has(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Normalize a flat user record into the current data contract. Total
 * contributions are the sum of public and private contributions.
 */
export function normalizeUser(raw: Record<string, unknown>): RankedUser {
  const login = cleanString(raw.login);
  if (login === null) {
    throw new Error('user record has no login');
  }
  const avatarUrl = cleanString(raw.avatarUrl);
  if (avatarUrl === null) {
    throw new Error(`user ${login} has no avatarUrl`);
  }
  const publicContributions = Number(raw.publicContributions ?? 0);
  const privateContributions = Number(raw.privateContributions ?? 0);
  return {
    login,
    name: cleanString(raw.name),
    avatarUrl,
    location: cleanString(raw.location),
    company: cleanString(raw.company),
    twitterUsername: cleanString(raw.twitterUsername),
    followers: Number(raw.followers ?? 0),
    totalContributions: publicContributions + privateContributions,
    privateContributions,
    publicContributions,
  };
}
