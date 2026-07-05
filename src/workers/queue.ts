import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';

const connection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null
});

// Workers construct with the bare connection.
export const connectionParams = { connection };

// Bounded retries make "throw to reject the payload" a recovery path, not a
// permanent failure: structural LLM-response errors (src/core/llm/boundary.ts)
// and transient upstream 5xx both get fresh attempts. This is the minimal
// slice of T14 that the response-validation boundary depends on; the rest of
// T14 (removeOnComplete/removeOnAge, retryable-vs-permanent error
// classification, graceful shutdown) remains open.
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
};

const queueOptions = { connection, defaultJobOptions };
export const extractionQueue = new Queue('extraction_queue', queueOptions);
// RLM jobs are excluded: they stream to an interactive SSE client that
// re-dispatches at its own layer (the benchmark runner's dispatch_attempts);
// an automatic background re-run would spend LLM budget with no listener.
export const rlmQueue = new Queue('rlm_queue', connectionParams);
export const supervisorQueue = new Queue('supervisor_queue', queueOptions);
export const invalidationQueue = new Queue('invalidation_queue', queueOptions);
export const verificationQueue = new Queue('verification_queue', queueOptions);
