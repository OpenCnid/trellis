import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { spawn } from 'child_process';
import path from 'path';
import IORedis from 'ioredis';

const redisPublisher = new IORedis({
  host: '127.0.0.1',
  port: 6379,
});

export const rlmWorker = new Worker('rlm_queue', async (job: Job) => {
  const { query, jobId } = job.data;
  
  if (!query || !jobId) {
    throw new Error('Missing query or jobId in job data');
  }

  const pythonScript = path.resolve('src/rlm/trellis_agent.py');
  
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', [pythonScript, '--query', query], {
      env: {
        ...process.env,
        PYTHONPATH: 'C:\\Users\\Darian\\AppData\\Roaming\\Python\\Python313\\site-packages',
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      }
    });

    pythonProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      // Publish chunk to a Redis channel unique to this job
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'stdout', content: chunk }));
    });

    pythonProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'stderr', content: chunk }));
    });

    pythonProcess.on('close', (code) => {
      // Signal completion
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'done', code }));
      if (code === 0) {
        resolve(`Job ${jobId} completed successfully`);
      } else {
        reject(new Error(`Python process exited with code ${code}`));
      }
    });
  });
}, connectionParams);

rlmWorker.on('completed', job => {
  console.log(`RLM Job ${job.id} has completed!`);
});

rlmWorker.on('failed', (job, err) => {
  console.log(`RLM Job ${job?.id} has failed with ${err.message}`);
});
