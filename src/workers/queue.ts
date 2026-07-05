import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';
import {
  buildInteractiveJobOptions,
  buildRetryingJobOptions,
} from './job_options.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';

const connection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null
});

// Workers construct with the bare connection.
export const connectionParams = { connection };

const defaultJobOptions = buildRetryingJobOptions(config.queueRetention);

const queueOptions = { connection, defaultJobOptions };
export const extractionQueue = new Queue('extraction_queue', queueOptions);
// RLM jobs are excluded: they stream to an interactive SSE client that
// re-dispatches at its own layer (the benchmark runner's dispatch_attempts);
// an automatic background re-run would spend LLM budget with no listener.
export const rlmQueue = new Queue('rlm_queue', {
  connection,
  defaultJobOptions: buildInteractiveJobOptions(config.queueRetention),
});
export const supervisorQueue = new Queue('supervisor_queue', queueOptions);
export const invalidationQueue = new Queue('invalidation_queue', queueOptions);
export const verificationQueue = new Queue('verification_queue', queueOptions);

installShutdownSignalHandlers();
shutdownCoordinator.register('bullmq.queues', 40, async () => {
  await Promise.all([
    extractionQueue.close(),
    rlmQueue.close(),
    supervisorQueue.close(),
    invalidationQueue.close(),
    verificationQueue.close(),
  ]);
  await connection.quit();
});
