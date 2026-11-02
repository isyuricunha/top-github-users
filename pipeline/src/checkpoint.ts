import type { LocationConfig } from './types.ts';

export interface RotationBatch {
  /** Previously failed countries owed a retry this run. Bounded so they can never starve the rotation. */
  retries: LocationConfig[];
  /** Next rotation countries. The cursor advances by exactly this many. */
  fresh: LocationConfig[];
  /** Cursor position after this batch, so a single failing country can no longer freeze the round-robin. */
  nextCheckpoint: number;
}

/**
 * Compose one round-robin batch from a rotation cursor and a retry queue.
 *
 * Retries (countries that failed a previous run) are collected first, capped
 * to `maxRetries` so a flaky country is retried every cycle without being able
 * to hold the whole batch hostage. The fresh countries advance the cursor by
 * their own count, which decouples forward progress from any individual
 * collection's transient failure: a 5xx on the first country no longer pins
 * the checkpoint in place. A requeued country that would also land in the
 * fresh window is collected as a retry only, never twice in the same run.
 */
export function planBatch(
  requeue: string[],
  checkpoint: number,
  count: number,
  locations: LocationConfig[],
  maxRetries = 1,
): RotationBatch {
  const n = locations.length;
  const byCountry = new Map<string, LocationConfig>();
  for (const location of locations) byCountry.set(location.country, location);

  const retries: LocationConfig[] = [];
  const retrySlugs = new Set<string>();
  for (const slug of requeue) {
    if (retries.length >= maxRetries) break;
    if (retrySlugs.has(slug)) continue; // dedupe the input; a country retries at most once per run
    const location = byCountry.get(slug);
    if (location === undefined) continue; // config entry removed; drop the stale slug
    retries.push(location);
    retrySlugs.add(slug);
  }

  const needed = Math.max(0, count - retries.length);
  const fresh: LocationConfig[] = [];
  let cursor = checkpoint % n;
  let guard = 0;
  while (fresh.length < needed && guard < n) {
    const location = locations[cursor];
    cursor = (cursor + 1) % n;
    guard += 1;
    if (retrySlugs.has(location.country)) continue; // already collected as a retry this run
    fresh.push(location);
  }

  return { retries, fresh, nextCheckpoint: cursor };
}
