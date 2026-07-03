import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({
  host: '127.0.0.1',
  port: 6379,
  maxRetriesPerRequest: null
});

export const connectionParams = { connection };
export const extractionQueue = new Queue('extraction_queue', connectionParams);
export const rlmQueue = new Queue('rlm_queue', connectionParams);
export const supervisorQueue = new Queue('supervisor_queue', connectionParams);
export const invalidationQueue = new Queue('invalidation_queue', connectionParams);
