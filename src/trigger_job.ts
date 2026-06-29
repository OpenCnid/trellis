import { extractionQueue } from './workers/queue.js';

async function trigger() {
  const job = await extractionQueue.add('extract', {
    astNodeId: 'test_hash_123',
    text: 'Google acquired DeepMind for $500 million.'
  });
  console.log(`Added test job with ID: ${job.id}`);
  process.exit(0);
}

trigger().catch(console.error);
