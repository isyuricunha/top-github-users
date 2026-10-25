import { describe, expect, it } from 'vitest';
import { checkpointAfterBatch } from '../src/checkpoint.ts';

describe('checkpointAfterBatch', () => {
  it('advances past the full batch when every collection succeeds', () => {
    expect(checkpointAfterBatch(12, 6, null, 138)).toBe(18);
  });

  it('keeps the first failed country at the next checkpoint', () => {
    expect(checkpointAfterBatch(12, 6, 3, 138)).toBe(15);
  });

  it('retries the first country when the batch starts with a failure', () => {
    expect(checkpointAfterBatch(12, 6, 0, 138)).toBe(12);
  });

  it('wraps the checkpoint at the end of the location list', () => {
    expect(checkpointAfterBatch(136, 6, 2, 138)).toBe(0);
  });
});
