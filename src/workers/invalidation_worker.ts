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
import { loggerFor } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';
import { instrumentWorker } from '../core/observability/worker_metrics.js';

// Phase 4 Milestone 3: consumes the orphan set produced by a versioned
// re-ingest (/ingest with a doc_key) and quarantines every semantic
// fact whose provenance points at bytes that no longer exist in the
// document's current version.

const log = loggerFor({ worker: 'invalidation', queue: 'invalidation_queue' });
const metrics = getMetrics();

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
  // Ingest request correlation (optional; see persist.ts IngestJobContext).
  requestId?: string;
}

async function processJob(job: Job<InvalidationJobData>) {
  const { docKey, oldVersion, newVersion, orphanedHashes, freshHashes, requestId } = job.data;
  const jobLog = log.child({
    jobId: job.id,
    attempt: job.attemptsMade + 1,
    docKey,
    version: newVersion,
    ...(requestId && { requestId }),
  });
  metrics.invalidationCandidateHashesTotal.inc(orphanedHashes.length);
  jobLog.info({
    event: 'invalidation.sweep_started',
    oldVersion,
    candidateCount: orphanedHashes.length,
  });

  // A Merkle diff is document-local, but content hashes are global. Recheck
  // at worker execution time so queue lag cannot quarantine a hash that is
  // still present in another document's latest version.
  const globallyOrphaned = await findGloballyOrphanedAstNodeIds(pgPool, orphanedHashes);
  const globallyOrphanedSet = new Set(globallyOrphaned);
  const retainedByOtherDocuments = orphanedHashes.filter(hash => !globallyOrphanedSet.has(hash));
  if (retainedByOtherDocuments.length > 0) {
    metrics.invalidationRetainedSharedHashesTotal.inc(retainedByOtherDocuments.length);
    jobLog.warn({
      event: 'invalidation.shared_sources_retained',
      oldVersion,
      newVersion,
      candidateCount: orphanedHashes.length,
      retainedCount: retainedByOtherDocuments.length,
      retainedHashes: retainedByOtherDocuments.slice(0, 20),
      retainedHashesTruncated: retainedByOtherDocuments.length > 20,
    });
  }

  const result = await sweepOrphanedProvenance(
    neo4jDriver,
    globallyOrphaned,
    freshHashes ?? []
  );

  metrics.invalidationContestedTotal.inc({ kind: 'node' }, result.contestedNodes);
  metrics.invalidationContestedTotal.inc({ kind: 'relationship' }, result.contestedRelationships);
  metrics.invalidationSurvivedTotal.inc({ kind: 'node' }, result.survivedNodes);
  metrics.invalidationSurvivedTotal.inc({ kind: 'relationship' }, result.survivedRelationships);
  metrics.invalidationSweepBatchesTotal.inc(result.batches);
  jobLog.info({
    event: 'invalidation.sweep_completed',
    contestedNodes: result.contestedNodes,
    contestedRelationships: result.contestedRelationships,
    survivedNodes: result.survivedNodes,
    survivedRelationships: result.survivedRelationships,
    batches: result.batches,
  });
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
instrumentWorker(invalidationWorker, { worker: 'invalidation', queue: 'invalidation_queue' }, metrics);

invalidationWorker.on('completed', job => {
  log.info({ event: 'invalidation.job_completed', jobId: job.id });
});

invalidationWorker.on('failed', (job, err) => {
  log.warn({ event: 'invalidation.job_failed', jobId: job?.id, err });
});

log.info({ event: 'invalidation.worker_started' });

installShutdownSignalHandlers();
shutdownCoordinator.register(
  'worker.invalidation',
  80,
  () => invalidationWorker.close()
);
