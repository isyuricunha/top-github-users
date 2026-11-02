import { loadConfig } from './config.ts';
import { GraphQLClient } from './graphql.ts';
import { collectLocation } from './collector.ts';
import { historyEntryFromSnapshot, partialCollectionWarning } from './summary.ts';
import { appendHistory, readMeta, writeMeta, writeSnapshot } from './writers.ts';
import { planBatch } from './checkpoint.ts';
import { slugify } from './slug.ts';
import type { CountrySnapshot, LocationConfig, RankedUser } from './types.ts';

const MAX_COUNTRIES_PER_RUN = 6;
const MAX_REQUEUE = 200;

function usage(): never {
  console.error('usage: node src/cli.ts collect [--country <slug>] [--countries <n>] [--dry-run]');
  process.exit(2);
}

function flagValue(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value === undefined) {
    console.error(`missing value for ${name}`);
    usage();
  }
  return value;
}

function buildSnapshot(
  location: LocationConfig,
  users: RankedUser[],
  collectedAt: string,
): CountrySnapshot {
  return {
    country: location.country,
    geoName: location.geoName,
    cities: [...location.cities],
    collectedAt,
    minimumFollowers: users.length > 0 ? Math.min(...users.map((u) => u.followers)) : 0,
    users,
  };
}

async function collectOne(
  location: LocationConfig,
  client: GraphQLClient,
  dryRun: boolean,
): Promise<void> {
  const result = await collectLocation(location, client);
  if (result.users.length === 0) {
    throw new Error('search returned zero users; refusing to overwrite the snapshot');
  }
  console.log(
    `collected ${slugify(location.country)}: ${result.users.length} users ` +
      `(search total ${result.userCount}, ${result.searchPages} search pages, ` +
      `${result.contributionBatches} contribution batches` +
      `${result.truncated ? ', capped at the configured limit' : ''})`,
  );
  if (dryRun) return;
  const snapshot = buildSnapshot(location, result.users, new Date().toISOString());
  writeSnapshot(snapshot);
  appendHistory(location.country, historyEntryFromSnapshot(snapshot));
}

async function runCollect(args: string[]): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is required for collect');
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run');
  const countryArg = flagValue(args, '--country');
  const countArg = Number(flagValue(args, '--countries', '6'));
  if (!Number.isInteger(countArg) || countArg < 0) {
    console.error('--countries must be a non-negative integer');
    usage();
  }
  const config = loadConfig();
  if (countryArg === undefined && countArg > MAX_COUNTRIES_PER_RUN) {
    console.error(`--countries cannot exceed ${MAX_COUNTRIES_PER_RUN} per run`);
    usage();
  }
  const client = new GraphQLClient(token);

  if (countryArg !== undefined) {
    const location = config.locations.find((l) => slugify(l.country) === countryArg);
    if (location === undefined) {
      console.error(`unknown country slug: ${countryArg}`);
      process.exit(1);
    }
    await collectOne(location, client, dryRun);
    if (!dryRun) {
      const meta = readMeta();
      meta.countries[location.country] = { lastCollectedAt: new Date().toISOString() };
      meta.lastRunAt = new Date().toISOString();
      meta.requeue = (meta.requeue ?? []).filter((entry) => entry !== location.country);
      writeMeta(meta);
    }
    return;
  }

  const meta = readMeta();
  const batch = planBatch(meta.requeue ?? [], meta.checkpoint, countArg, config.locations, countArg > 0 ? 1 : 0);
  const attempted = [...batch.retries, ...batch.fresh];
  let failures = 0;
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const location of attempted) {
    try {
      await collectOne(location, client, dryRun);
      succeeded.push(location.country);
    } catch (error) {
      failures += 1;
      failed.push(location.country);
      console.error(`failed ${slugify(location.country)}: ${String(error)}`);
    }
  }
  if (!dryRun) {
    const now = new Date().toISOString();
    const requeue = new Set(meta.requeue ?? []);
    for (const country of succeeded) {
      requeue.delete(country);
      meta.countries[country] = { lastCollectedAt: now };
    }
    for (const country of failed) requeue.add(country);
    // prune slugs whose config entry was removed so the requeue stays resolvable
    const validCountries = new Set(config.locations.map((location) => location.country));
    meta.requeue = [...requeue].filter((country) => validCountries.has(country)).slice(0, MAX_REQUEUE);
    meta.checkpoint = batch.nextCheckpoint;
    meta.lastRunAt = now;
    writeMeta(meta);
  }
  if (failures > 0) {
    console.warn(
      `${failures} of ${attempted.length} country collections failed; failed countries are requeued for retry and the rotation advances by ${batch.fresh.length}`,
    );
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log(partialCollectionWarning(failures, countArg));
    }
  }
  if (failures === countArg && countArg > 0) {
    console.error('all countries in this batch failed');
    process.exit(1);
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === undefined) usage();

if (command === 'collect') {
  await runCollect(rest);
} else {
  usage();
}
