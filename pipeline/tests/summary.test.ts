import { describe, expect, it } from 'vitest';
import { partialCollectionWarning } from '../src/summary.ts';

describe('partialCollectionWarning', () => {
  it('formats a GitHub Actions warning for a partially failed batch', () => {
    expect(partialCollectionWarning(2, 6)).toBe(
      '::warning title=Partial collection::2 of 6 country collections failed. See per-country logs.',
    );
  });
});
