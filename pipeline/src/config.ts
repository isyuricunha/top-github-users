import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LocationConfig, RootConfig } from './types.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

export function repoRoot(): string {
  return REPO_ROOT;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`config field "${field}" must be an array of strings (possibly empty)`);
  }
  return value as string[];
}

export function loadConfig(): RootConfig & { locations: LocationConfig[] } {
  const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'config.json'), 'utf8')) as {
    devMode?: unknown;
    locations?: unknown;
  };
  if (!Array.isArray(raw.locations) || raw.locations.length === 0) {
    throw new Error('config.json must contain a non-empty "locations" array');
  }
  const locations = raw.locations.map((entry, index) => {
    const item = entry as Record<string, unknown>;
    for (const field of ['country', 'geoName', 'imageUrl'] as const) {
      if (typeof item[field] !== 'string' || (item[field] as string).length === 0) {
        throw new Error(`config.json locations[${index}] is missing string field "${field}"`);
      }
    }
    return {
      country: item.country as string,
      geoName: item.geoName as string,
      cities: requireStringArray(item.cities, `locations[${index}].cities`),
      imageUrl: item.imageUrl as string,
    };
  });
  const countries = new Set(locations.map((l) => l.country));
  if (countries.size !== locations.length) {
    throw new Error('config.json contains duplicate country slugs');
  }
  return { devMode: raw.devMode === 'true', locations };
}
