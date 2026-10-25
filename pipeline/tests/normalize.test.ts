import { describe, expect, it } from 'vitest';
import { cleanString, normalizeUser } from '../src/normalize.ts';
import { slugify } from '../src/slug.ts';

describe('slugify', () => {
  it('trims whitespace and normalizes internal spaces', () => {
    expect(slugify(' Mozambique ')).toBe('mozambique');
    expect(slugify('Bosnia and Herzegovina')).toBe('bosnia_and_herzegovina');
  });
});

describe('cleanString', () => {
  it('maps absent and placeholder values to null', () => {
    expect(cleanString('undefined value')).toBeNull();
    expect(cleanString('undefined')).toBeNull();
    expect(cleanString('')).toBeNull();
    expect(cleanString('   ')).toBeNull();
    expect(cleanString(null)).toBeNull();
    expect(cleanString(undefined)).toBeNull();
  });

  it('keeps real values trimmed', () => {
    expect(cleanString('  @openafg ')).toBe('@openafg');
    expect(cleanString('Undefined Objects Co')).toBe('Undefined Objects Co');
  });
});

describe('normalizeUser', () => {
  it('builds the contract user and derives totals', () => {
    const result = normalizeUser({
      login: 'someone',
      name: 'undefined value',
      avatarUrl: 'https://avatars.githubusercontent.com/u/9?v=4',
      location: 'Kabul, Afghanistan',
      company: '',
      twitterUsername: 'undefined',
      followers: '3396',
      publicContributions: 159,
      privateContributions: 6239,
    });
    expect(result).toEqual({
      login: 'someone',
      name: null,
      avatarUrl: 'https://avatars.githubusercontent.com/u/9?v=4',
      location: 'Kabul, Afghanistan',
      company: null,
      twitterUsername: null,
      followers: 3396,
      totalContributions: 6398,
      privateContributions: 6239,
      publicContributions: 159,
    });
  });

  it('rejects records without login or avatar', () => {
    expect(() => normalizeUser({ login: 'undefined value' })).toThrow('no login');
    expect(() =>
      normalizeUser({ login: 'someone', avatarUrl: 'undefined value' }),
    ).toThrow('no avatarUrl');
  });
});
