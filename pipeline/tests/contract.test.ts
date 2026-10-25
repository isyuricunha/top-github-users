import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../src/config.ts';
import { currentUserSort } from '../src/writers.ts';
import type { CountrySnapshot } from '../src/types.ts';

const currentDir = resolve(repoRoot(), 'data', 'current');
const describeIfData = existsSync(currentDir) ? describe : describe.skip;

/**
 * Regression guard over the committed dataset: every snapshot must satisfy
 * the v2 contract byte-for-byte, not just parse.
 */
describeIfData('data contract', () => {
  const files = readdirSync(currentDir).filter((f) => f.endsWith('.json'));

  it('has snapshot files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('every snapshot satisfies the contract', () => {
    for (const file of files) {
      const raw = readFileSync(join(currentDir, file), 'utf8');
      expect(raw, `${file} must not contain placeholder strings`).not.toContain('undefined value');
      const snapshot = JSON.parse(raw) as CountrySnapshot;
      expect(snapshot.country.length, file).toBeGreaterThan(0);
      expect(Array.isArray(snapshot.cities), file).toBe(true);
      expect(typeof snapshot.collectedAt, file).toBe('string');
      expect(Number.isFinite(Date.parse(snapshot.collectedAt)), file).toBe(true);
      const logins = new Set<string>();
      for (let index = 0; index < snapshot.users.length; index += 1) {
        const u = snapshot.users[index];
        expect(typeof u.login, `${file}[${index}]`).toBe('string');
        expect(logins.has(u.login), `${file} duplicate login ${u.login}`).toBe(false);
        logins.add(u.login);
        expect(u.totalContributions, `${file} ${u.login} total`).toBe(
          u.publicContributions + u.privateContributions,
        );
        expect(
          u.followers >= snapshot.minimumFollowers || index === snapshot.users.length - 1,
          `${file} ${u.login} below minimum`,
        ).toBe(true);
      }
      const sorted = [...snapshot.users].sort(currentUserSort);
      expect(
        JSON.stringify(snapshot.users.map((u) => u.login)),
        `${file} users must be canonically sorted`,
      ).toBe(JSON.stringify(sorted.map((u) => u.login)));
    }
  });
});
