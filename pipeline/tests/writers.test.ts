import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendHistory,
  canonicalJson,
  currentUserSort,
  readHistory,
  readMeta,
  writeMeta,
  writeSnapshot,
} from '../src/writers.ts';
import type { CountrySnapshot, PipelineMeta, RankedUser } from '../src/types.ts';

let root: string;

function user(login: string, followers: number): RankedUser {
  return {
    login,
    name: null,
    avatarUrl: `https://avatars.githubusercontent.com/u/1?v=4`,
    location: null,
    company: null,
    twitterUsername: null,
    followers,
    totalContributions: followers * 2,
    privateContributions: followers,
    publicContributions: followers,
  };
}

function snapshot(users: RankedUser[]): CountrySnapshot {
  return {
    country: 'test country',
    geoName: 'Test Country',
    cities: ['city a'],
    collectedAt: '2026-10-25T00:00:00.000Z',
    minimumFollowers: 2,
    users,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tgu-writers-'));
});

describe('canonicalJson', () => {
  it('is deterministic for identically built objects and newline terminated', () => {
    const first = canonicalJson({ b: 1, a: [1, 2] });
    expect(first).toBe(canonicalJson({ b: 1, a: [1, 2] }));
    expect(first.endsWith('\n')).toBe(true);
    expect(first).toContain('\n  "b": 1');
  });
});

describe('currentUserSort', () => {
  it('orders by followers desc with login as tiebreak', () => {
    const sorted = [user('zeta', 10), user('alpha', 30), user('beta', 10)].sort(currentUserSort);
    expect(sorted.map((u) => u.login)).toEqual(['alpha', 'beta', 'zeta']);
  });
});

describe('writeSnapshot', () => {
  it('writes canonically sorted users and is byte-stable', () => {
    writeSnapshot(snapshot([user('zeta', 10), user('alpha', 30)]), root);
    const first = readFileSync(snapshotPathFor('test_country'), 'utf8');
    writeSnapshot(snapshot([user('alpha', 30), user('zeta', 10)]), root);
    const second = readFileSync(snapshotPathFor('test_country'), 'utf8');
    expect(first).toBe(second);
    expect(first).toContain('"login": "alpha"');
    const parsed = JSON.parse(first) as CountrySnapshot;
    expect(parsed.users.map((u) => u.login)).toEqual(['alpha', 'zeta']);
  });

  function snapshotPathFor(slug: string): string {
    return join(root, 'data', 'current', `${slug}.json`);
  }
});

describe('appendHistory', () => {
  it('appends one line per date and replaces same-date entries', () => {
    const entry = {
      date: '2026-10-25',
      collectedAt: '2026-10-25T00:00:00.000Z',
      users: 10,
      minimumFollowers: 2,
      leaders: { followers: null, totalContributions: null, publicContributions: null },
    };
    appendHistory('test country', entry, root);
    appendHistory('test country', { ...entry, users: 11 }, root);
    expect(readHistory('test country', root)).toHaveLength(1);
    expect(readHistory('test country', root)[0].users).toBe(11);
    const next = { ...entry, date: '2026-10-26' };
    appendHistory('test country', next, root);
    expect(readHistory('test country', root)).toHaveLength(2);
    const raw = readFileSync(join(root, 'data', 'history', 'test_country.jsonl'), 'utf8');
    expect(raw.split('\n')).toHaveLength(3);
  });
});

describe('meta requeue handling', () => {
  beforeEach(() => {
    mkdirSync(join(root, 'data'), { recursive: true });
  });

  it('defaults a legacy meta.json without requeue to an empty retry queue', () => {
    const legacy = { checkpoint: 7, lastRunAt: '2026-11-02T02:51:36.370Z', countries: {} };
    writeFileSync(join(root, 'data', 'meta.json'), JSON.stringify(legacy), 'utf8');
    expect(readMeta(root).requeue).toEqual([]);
    expect(readMeta(root).checkpoint).toBe(7);
  });

  it('persists the requeue through a canonical write', () => {
    const meta: PipelineMeta = {
      checkpoint: 13,
      lastRunAt: null,
      countries: {},
      requeue: ['australia', 'belarus'],
    };
    writeMeta(meta, root);
    const parsed = JSON.parse(readFileSync(join(root, 'data', 'meta.json'), 'utf8')) as PipelineMeta;
    expect(parsed.requeue).toEqual(['australia', 'belarus']);
    expect(readMeta(root).requeue).toEqual(['australia', 'belarus']);
  });

  it('filters non-string entries out of the requeue on read', () => {
    const dirty = { checkpoint: 0, lastRunAt: null, countries: {}, requeue: ['australia', 42, null] };
    writeFileSync(join(root, 'data', 'meta.json'), JSON.stringify(dirty), 'utf8');
    expect(readMeta(root).requeue).toEqual(['australia']);
  });
});
