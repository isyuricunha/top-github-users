import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, repoRoot } from './config.ts';
import { normalizeUser } from './normalize.ts';
import { slugify } from './slug.ts';
import { appendHistory, readMeta, snapshotPath, writeMeta, writeSnapshot } from './writers.ts';
import type { CountrySnapshot } from './types.ts';

const LEGACY_COLLECTED_AT_FALLBACK = '2026-01-28T01:15:41Z';

const MARKDOWN_DATE = /on `(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}) (AM|PM) UTC`/;

/**
 * The legacy markdown header states the collection time of each country
 * ("on `2025/11/8 2:20 AM UTC`"). Git history cannot provide it anymore
 * because the repository history was squashed to a single snapshot commit.
 */
function collectedAtFromMarkdown(country: string): string {
  const path = resolve(repoRoot(), 'markdown', 'followers', `${slugify(country)}.md`);
  if (!existsSync(path)) return LEGACY_COLLECTED_AT_FALLBACK;
  const match = MARKDOWN_DATE.exec(readFileSync(path, 'utf8'));
  if (match === null) return LEGACY_COLLECTED_AT_FALLBACK;
  const [, year, month, day, rawHour, minute, meridiem] = match;
  let hour = Number(rawHour) % 12;
  if (meridiem === 'PM') hour += 12;
  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute)),
  ).toISOString();
}

/**
 * One-shot migration of the frozen legacy cache/ files into the v2 contract.
 * The legacy cache stores public and private contributions; the calendar
 * total (the legacy "total contributions" ranking metric) is their sum.
 */
export function migrateAll(): void {
  const config = loadConfig();
  const meta = readMeta();
  let migrated = 0;
  for (const location of config.locations) {
    const legacyPath = resolve(repoRoot(), 'cache', `${slugify(location.country)}.json`);
    if (!existsSync(legacyPath)) {
      throw new Error(`legacy cache file missing for ${location.country}`);
    }
    const legacyUsers = JSON.parse(readFileSync(legacyPath, 'utf8')) as Array<
      Record<string, unknown>
    >;
    if (!Array.isArray(legacyUsers)) {
      throw new Error(`legacy cache for ${location.country} is not a user list`);
    }
    const users = legacyUsers.map((user) => normalizeUser(user));
    const collectedAt = collectedAtFromMarkdown(location.country);
    const snapshot: CountrySnapshot = {
      country: location.country,
      geoName: location.geoName,
      cities: [...location.cities],
      collectedAt,
      minimumFollowers: users.length > 0 ? Math.min(...users.map((u) => u.followers)) : 0,
      users,
    };
    writeSnapshot(snapshot);
    if (users.length > 0) {
      const byFollowers = [...users].sort((a, b) => b.followers - a.followers);
      const byTotal = [...users].sort((a, b) => b.totalContributions - a.totalContributions);
      const byPublic = [...users].sort((a, b) => b.publicContributions - a.publicContributions);
      appendHistory(location.country, {
        date: collectedAt.slice(0, 10),
        collectedAt,
        users: users.length,
        minimumFollowers: snapshot.minimumFollowers,
        leaders: {
          followers: { login: byFollowers[0].login, value: byFollowers[0].followers },
          totalContributions: { login: byTotal[0].login, value: byTotal[0].totalContributions },
          publicContributions: { login: byPublic[0].login, value: byPublic[0].publicContributions },
        },
      });
    }
    meta.countries[location.country] = { lastCollectedAt: collectedAt };
    migrated += 1;
  }
  meta.lastRunAt = new Date().toISOString();
  writeMeta(meta);
  console.log(`migrated ${migrated} countries into data/current and data/history`);
}

export function migrateIfNeeded(): void {
  if (existsSync(snapshotPath(loadConfig().locations[0].country))) return;
  migrateAll();
}
