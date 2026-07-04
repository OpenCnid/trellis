import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';

const connection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null
});

export const connectionParams = { connection };
export const extractionQueue = new Queue('extraction_queue', connectionParams);
export const rlmQueue = new Queue('rlm_queue', connectionParams);
export const supervisorQueue = new Queue('supervisor_queue', connectionParams);
export const invalidationQueue = new Queue('invalidation_queue', connectionParams);
export const verificationQueue = new Queue('verification_queue', connectionParams);
