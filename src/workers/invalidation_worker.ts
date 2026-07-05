import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver, pgPool } from '../config/db.js';
import { sweepOrphanedProvenance } from '../core/graph/invalidation.js';
import { findGloballyOrphanedAstNodeIds } from '../core/ast/registry.js';
import { withWorkerRetryPolicy } from '../core/async/retry.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';

// Phase 4 Milestone 3: consumes the orphan set produced by a versioned
// re-ingest (/ingest with a doc_key) and quarantines every semantic
// fact whose provenance points at bytes that no longer exist in the
// document's current version.

export interface InvalidationJobData {
  docKey: string;
  oldVersion: number;
  newVersion: number;
  orphanedHashes: string[];
  // Block hashes this version queued for extraction. A fact already
  // carrying one of these has been re-derived from live bytes by a
  // racing extraction job and must not be quarantined. Optional so
  // sweep jobs enqueued before this field existed still process.
  freshHashes?: string[];
}

async function processJob(job: Job<InvalidationJobData>) {
  const { docKey, oldVersion, newVersion, orphanedHashes, freshHashes } = job.data;
  console.log(
    `[Sweep ${job.id}] ${docKey} v${oldVersion}→v${newVersion}: sweeping ${orphanedHashes.length} orphaned hash(es)...`
  );

  // A Merkle diff is document-local, but content hashes are global. Recheck
  // at worker execution time so queue lag cannot quarantine a hash that is
  // still present in another document's latest version.
  const globallyOrphaned = await findGloballyOrphanedAstNodeIds(pgPool, orphanedHashes);
  const globallyOrphanedSet = new Set(globallyOrphaned);
  const retainedByOtherDocuments = orphanedHashes.filter(hash => !globallyOrphanedSet.has(hash));
  if (retainedByOtherDocuments.length > 0) {
    console.warn(JSON.stringify({
      event: 'invalidation.shared_sources_retained',
      jobId: job.id,
      docKey,
      oldVersion,
      newVersion,
      candidateCount: orphanedHashes.length,
      retainedCount: retainedByOtherDocuments.length,
      retainedHashes: retainedByOtherDocuments.slice(0, 20),
      retainedHashesTruncated: retainedByOtherDocuments.length > 20,
    }));
  }

  const result = await sweepOrphanedProvenance(
    neo4jDriver,
    globallyOrphaned,
    freshHashes ?? []
  );

  console.log(
    `[Sweep ${job.id}] ${docKey} v${newVersion}: contested ${result.contestedNodes} node(s) and ` +
    `${result.contestedRelationships} relationship(s) across ${result.batches} batch(es)` +
    `${result.survivedNodes + result.survivedRelationships > 0
      ? `; ${result.survivedNodes} node(s) and ${result.survivedRelationships} relationship(s) kept fresh provenance and escaped quarantine`
      : ''}.`
  );
  return result;
}

export const invalidationWorker = new Worker<InvalidationJobData>(
  'invalidation_queue',
  job => withWorkerRetryPolicy(
    {
      worker: 'invalidation',
      jobId: job.id,
      attempt: job.attemptsMade + 1,
    },
    () => processJob(job)
  ),
  connectionParams
);

invalidationWorker.on('completed', job => {
  console.log(`[Sweep ${job.id}] Finished.`);
});

invalidationWorker.on('failed', (job, err) => {
  console.log(`[Sweep ${job?.id}] Failed: ${err.message}`);
});

console.log('Invalidation Worker started and listening for jobs...');

installShutdownSignalHandlers();
shutdownCoordinator.register(
  'worker.invalidation',
  80,
  () => invalidationWorker.close()
);
