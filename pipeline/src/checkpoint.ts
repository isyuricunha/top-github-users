export function checkpointAfterBatch(
  start: number,
  attemptedCount: number,
  firstFailureIndex: number | null,
  locationCount: number,
): number {
  return (start + (firstFailureIndex ?? attemptedCount)) % locationCount;
}
