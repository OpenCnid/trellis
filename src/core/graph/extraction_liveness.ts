export type LivenessFencedMergeResult<T> =
  | { status: 'skipped' }
  | { status: 'merged'; value: T }
  | { status: 'compensated'; value: T };

/**
 * Fences a cross-store semantic merge with PostgreSQL liveness checks.
 *
 * PostgreSQL and Neo4j cannot share a transaction. The pre-check narrows the
 * check/write window; the post-check closes the final-state race by applying a
 * compensating quarantine when a re-ingest committed while Neo4j was writing.
 * A pre-dead source is also quarantined in case a previous BullMQ attempt
 * merged successfully but failed before its post-check.
 */
export async function mergeWithAstLivenessFence<T>(
  isLive: () => Promise<boolean>,
  merge: () => Promise<T>,
  quarantine: () => Promise<void>
): Promise<LivenessFencedMergeResult<T>> {
  if (!(await isLive())) {
    await quarantine();
    return { status: 'skipped' };
  }

  const value = await merge();
  if (await isLive()) {
    return { status: 'merged', value };
  }

  await quarantine();
  return { status: 'compensated', value };
}
