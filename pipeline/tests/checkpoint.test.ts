import { describe, expect, it } from 'vitest';
import { planBatch } from '../src/checkpoint.ts';
import type { LocationConfig } from '../src/types.ts';

function loc(country: string): LocationConfig {
  return { country, geoName: country, cities: [], imageUrl: '' };
}

const countries = [
  'australia',
  'austria',
  'azerbaijan',
  'bahrain',
  'bangladesh',
  'belarus',
  'belgium',
  'bolivia',
  'botswana',
  'brazil',
  'bulgaria',
  'burkina_faso',
  'burundi',
].map(loc);

describe('planBatch', () => {
  it('advances past the full batch when nothing is requeued', () => {
    const batch = planBatch([], 6, 6, countries);
    expect(batch.retries).toEqual([]);
    expect(batch.fresh.map((l) => l.country)).toEqual([
      'belgium',
      'bolivia',
      'botswana',
      'brazil',
      'bulgaria',
      'burkina_faso',
    ]);
    expect(batch.nextCheckpoint).toBe(12);
  });

  it('retries a requeued country and advances the rotation by the fresh count', () => {
    const batch = planBatch(['australia'], 7, 6, countries);
    expect(batch.retries.map((l) => l.country)).toEqual(['australia']);
    expect(batch.fresh).toHaveLength(5);
    expect(batch.nextCheckpoint).toBe(12);
  });

  it('moves the cursor past a requeued country that sits at the checkpoint', () => {
    // The historical freeze: australia sat at index 7, failed on every run,
    // and the old logic returned the same checkpoint forever. The plan never
    // returns a frozen cursor: the country is retried and the rotation moves.
    const batch = planBatch(['australia'], 7, 6, countries);
    expect(batch.nextCheckpoint).not.toBe(7);
    expect(batch.fresh.map((l) => l.country)).not.toContain('australia');
  });

  it('never collects the same country twice in one run', () => {
    // belarus is requeued and also lands inside the fresh window.
    const batch = planBatch(['belarus'], 12, 6, countries);
    const slugs = [...batch.retries, ...batch.fresh].map((l) => l.country);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain('belarus');
    expect(batch.fresh.map((l) => l.country)).not.toContain('belarus');
  });

  it('wraps the checkpoint at the end of the location list', () => {
    const batch = planBatch([], 12, 6, countries);
    expect(batch.fresh.map((l) => l.country)).toEqual([
      'burundi',
      'australia',
      'austria',
      'azerbaijan',
      'bahrain',
      'bangladesh',
    ]);
    expect(batch.nextCheckpoint).toBe(5);
  });

  it('drops requeue entries whose config location was removed', () => {
    const batch = planBatch(['ghost_country'], 0, 6, countries);
    expect(batch.retries).toEqual([]);
    expect(batch.fresh).toHaveLength(6);
  });

  it('bounds retries so they cannot starve the rotation', () => {
    const batch = planBatch(['australia', 'austria', 'azerbaijan'], 0, 6, countries, 2);
    expect(batch.retries.map((l) => l.country)).toEqual(['australia', 'austria']);
    expect(batch.fresh).toHaveLength(4);
    expect(batch.nextCheckpoint).toBe(6);
  });

  it('dedupes duplicate slugs in the requeue input', () => {
    const batch = planBatch(['australia', 'australia'], 0, 6, countries, 2);
    expect(batch.retries.map((l) => l.country)).toEqual(['australia']);
    expect(batch.fresh).toHaveLength(5);
    expect(batch.nextCheckpoint).toBe(6);
  });

  it('collects nothing and does not advance when the budget is zero', () => {
    const batch = planBatch(['australia'], 5, 0, countries, 0);
    expect(batch.retries).toEqual([]);
    expect(batch.fresh).toEqual([]);
    expect(batch.nextCheckpoint).toBe(5);
  });

  it('ignores the requeue entirely when maxRetries is zero', () => {
    const batch = planBatch(['australia'], 0, 6, countries, 0);
    expect(batch.retries).toEqual([]);
    expect(batch.fresh.map((l) => l.country)).toEqual([
      'australia',
      'austria',
      'azerbaijan',
      'bahrain',
      'bangladesh',
      'belarus',
    ]);
    expect(batch.nextCheckpoint).toBe(6);
  });

  it('normalizes an out-of-range checkpoint by the location count', () => {
    const short = countries.slice(0, 10);
    const batch = planBatch([], 137, 6, short);
    expect(batch.fresh.map((l) => l.country)).toEqual([
      'bolivia',
      'botswana',
      'brazil',
      'australia',
      'austria',
      'azerbaijan',
    ]);
    expect(batch.nextCheckpoint).toBe(3);
  });
});