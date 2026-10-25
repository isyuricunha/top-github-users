import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { appendHistory, canonicalJson, currentUserSort, readHistory, writeSnapshot } from '../src/writers.ts';
import type { CountrySnapshot, RankedUser } from '../src/types.ts';

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
