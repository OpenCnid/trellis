import { Queue, Worker, QueueEvents } from 'bullmq';
import { z } from 'zod';
import { RedisMemoryServer } from 'redis-memory-server';
import IORedis from 'ioredis';

// --- SCHEMAS ---
const EntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  sourceNodeIds: z.array(z.string())
});

const ActionSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  verb: z.string(),
  objectId: z.string(),
  sourceNodeIds: z.array(z.string())
});

const GraphSchema = z.object({
  entities: z.array(EntitySchema),
  actions: z.array(ActionSchema)
});

type Graph = z.infer<typeof GraphSchema>;

// --- MOCK LLM ---
async function simulateLLMExtraction(nodeId: string): Promise<string> {
  // Simulate network delay
  await new Promise(res => setTimeout(res, Math.random() * 50 + 10));

  const rand = Math.random();
  
  if (rand < 0.20) {
    // 20% 503 Error
    throw new Error("503 Rate Limit Exceeded");
  } else if (rand < 0.30) {
    // 10% Invalid Schema (no sourceNodeIds)
    const badGraph = {
      entities: [
        { id: "1", name: "Alpha", type: "Org" } // Missing sourceNodeIds
      ],
      actions: []
    };
    return JSON.stringify(badGraph);
  } else {
    // 70% Valid Schema
    const goodGraph: Graph = {
      entities: [
        { id: "1", name: "Alpha", type: "Org", sourceNodeIds: [nodeId] }
      ],
      actions: []
    };
    return JSON.stringify(goodGraph);
  }
}

// --- GLOBALS ---
const queueName = 'extraction-queue';
const successfulInserts: string[] = [];

async function runChaosPoC() {
  console.log("Starting Redis Memory Server...");
  const redisServer = new RedisMemoryServer();
  const host = await redisServer.getHost();
  const port = await redisServer.getPort();
  console.log(`Redis running at ${host}:${port}`);

  const connection = new IORedis({ host, port, maxRetriesPerRequest: null });

  const extractionQueue = new Queue(queueName, { connection });
  const queueEvents = new QueueEvents(queueName, { connection });

  console.log("Setting up BullMQ Chaos Testing...");

  // --- WORKER ---
  const worker = new Worker(queueName, async job => {
    const { nodeId } = job.data;
    
    // 1. Call Mock LLM
    const rawResult = await simulateLLMExtraction(nodeId);
    
    // 2. Parse string to JSON
    const jsonResult = JSON.parse(rawResult);

    // 3. Strict Zod Parse
    // If this fails, it natively throws an error which fails the BullMQ job
    const validGraph = GraphSchema.parse(jsonResult);
    
    // 4. Success - push to "DB"
    successfulInserts.push(nodeId);

  }, { 
    connection,
    concurrency: 5
  });

  worker.on('failed', (job, err) => {
    console.log(`[Queue] Job ${job?.id} (${job?.data.nodeId}) FAILED: ${err.message.substring(0, 40)}...`);
  });

  // --- EXECUTION (THE FLOOD) ---
  console.log("\nFlooding the queue with 500 jobs...");
  const jobs = [];
  for (let i = 1; i <= 500; i++) {
    jobs.push({
      name: 'extract',
      data: { nodeId: `hash_${i}` },
      opts: {
        attempts: 10,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      }
    });
  }

  // Clear existing jobs in queue just in case
  await extractionQueue.obliterate({ force: true });
  await extractionQueue.addBulk(jobs);
  
  console.log("500 Jobs added. Waiting for queue to drain...");
  
  // Wait for the queue to drain completely
  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(async () => {
      const waiting = await extractionQueue.getWaitingCount();
      const active = await extractionQueue.getActiveCount();
      const delayed = await extractionQueue.getDelayedCount();
      const failed = await extractionQueue.getFailedCount();
      const completed = await extractionQueue.getCompletedCount();
      
      console.log(`[Status] Completed: ${completed}, Active: ${active}, Waiting: ${waiting}, Delayed: ${delayed}, Failed: ${failed}`);
      
      if (waiting === 0 && active === 0 && delayed === 0) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 2000);
  });

  // Allow a tiny grace period for any last event handlers to fire
  await new Promise(r => setTimeout(r, 1000));

  // --- VALIDATION ---
  console.log("\n--- Validation Check ---");
  console.log(`Process did not crash: PASS`);
  console.log(`Queue drained completely: PASS`);
  console.log(`Final DB size exactly 500: ${successfulInserts.length === 500 ? 'PASS' : 'FAIL (' + successfulInserts.length + ')'}`);
  
  const uniqueInserts = new Set(successfulInserts);
  console.log(`Zero duplicate extractions (all unique): ${uniqueInserts.size === successfulInserts.length ? 'PASS' : 'FAIL (' + uniqueInserts.size + ' unique)'}`);

  await worker.close();
  await queueEvents.close();
  await extractionQueue.close();
  connection.disconnect();
  await redisServer.stop();
  process.exit(0);
}

runChaosPoC().catch(console.error);
