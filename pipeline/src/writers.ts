import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { repoRoot } from './config.ts';
import { slugify } from './slug.ts';
import type { CountrySnapshot, HistoryEntry, PipelineMeta, RankedUser } from './types.ts';

/**
 * Deterministic canonical writer: stable key order, 2-space indent and a
 * trailing newline so daily changes touch only the lines that actually
 * changed. Single-line JSON would defeat git delta compression and rebuild
 * the multi-gigabyte history this project just lost.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function currentUserSort(a: RankedUser, b: RankedUser): number {
  if (b.followers !== a.followers) return b.followers - a.followers;
  return a.login.localeCompare(b.login);
}

export function snapshotPath(country: string, root: string = repoRoot()): string {
  return resolve(root, 'data', 'current', `${slugify(country)}.json`);
}

export function historyPath(country: string, root: string = repoRoot()): string {
  return resolve(root, 'data', 'history', `${slugify(country)}.jsonl`);
}

export function writeSnapshot(snapshot: CountrySnapshot, root: string = repoRoot()): void {
  const ordered: CountrySnapshot = {
    ...snapshot,
    users: [...snapshot.users].sort(currentUserSort),
  };
  const path = snapshotPath(snapshot.country, root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalJson(ordered), 'utf8');
}

export function readHistory(country: string, root: string = repoRoot()): HistoryEntry[] {
  try {
    const raw = readFileSync(historyPath(country, root), 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as HistoryEntry);
  } catch {
    return [];
  }
}

/**
 * One summary line per UTC date. Re-running on the same date replaces the
 * line instead of duplicating it, so the append-only file stays idempotent.
 */
export function appendHistory(
  country: string,
  entry: HistoryEntry,
  root: string = repoRoot(),
): void {
  const entries = readHistory(country, root);
  const last = entries.at(-1);
  if (last && last.date === entry.date) {
    entries[entries.length - 1] = entry;
  } else {
    entries.push(entry);
  }
  const path = historyPath(country, root);
  mkdirSync(dirname(path), { recursive: true });
  const body = entries.map((e) => JSON.stringify(e)).join('\n');
  writeFileSync(path, `${body}\n`, 'utf8');
}

const metaPath = (root: string) => resolve(root, 'data', 'meta.json');

export function readMeta(root: string = repoRoot()): PipelineMeta {
  try {
    return JSON.parse(readFileSync(metaPath(root), 'utf8')) as PipelineMeta;
  } catch {
    return { checkpoint: 0, lastRunAt: null, countries: {} };
  }
}

export function writeMeta(meta: PipelineMeta, root: string = repoRoot()): void {
  const path = metaPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalJson(meta), 'utf8');
}
