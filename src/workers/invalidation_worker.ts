import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver } from '../config/db.js';
import { sweepOrphanedProvenance } from '../core/graph/invalidation.js';

// Phase 4 Milestone 3: consumes the orphan set produced by a versioned
// re-ingest (/ingest with a doc_key) and quarantines every semantic
// fact whose provenance points at bytes that no longer exist in the
// document's current version.

export interface InvalidationJobData {
  docKey: string;
  oldVersion: number;
  newVersion: number;
  orphanedHashes: string[];
}

async function processJob(job: Job<InvalidationJobData>) {
  const { docKey, oldVersion, newVersion, orphanedHashes } = job.data;
  console.log(
    `[Sweep ${job.id}] ${docKey} v${oldVersion}→v${newVersion}: sweeping ${orphanedHashes.length} orphaned hash(es)...`
  );

  const result = await sweepOrphanedProvenance(neo4jDriver, orphanedHashes);

  console.log(
    `[Sweep ${job.id}] ${docKey} v${newVersion}: contested ${result.contestedNodes} node(s) and ` +
    `${result.contestedRelationships} relationship(s) across ${result.batches} batch(es).`
  );
  return result;
}

export const invalidationWorker = new Worker<InvalidationJobData>(
  'invalidation_queue',
  processJob,
  connectionParams
);

invalidationWorker.on('completed', job => {
  console.log(`[Sweep ${job.id}] Finished.`);
});

invalidationWorker.on('failed', (job, err) => {
  console.log(`[Sweep ${job?.id}] Failed: ${err.message}`);
});

console.log('Invalidation Worker started and listening for jobs...');
