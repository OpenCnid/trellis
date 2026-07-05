import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { spawn } from 'child_process';
import path from 'path';
import IORedis from 'ioredis';
import { config, pgDsn } from '../config/index.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';

const redisPublisher = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
});

export const rlmWorker = new Worker('rlm_queue', async (job: Job) => {
  const { query, jobId } = job.data;
  
  if (!query || !jobId) {
    throw new Error('Missing query or jobId in job data');
  }

  const pythonScript = path.resolve('src/rlm/trellis_agent.py');
  
  return new Promise((resolve, reject) => {
    // Forward the validated config to the Python half so both sides of
    // the system derive their connection targets from the same values.
    const pythonProcess = spawn(config.python.executable, [pythonScript, '--query', query], {
      env: {
        ...process.env,
        ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
        NEO4J_URI: config.neo4j.uri,
        NEO4J_USER: config.neo4j.user,
        NEO4J_PASSWORD: config.neo4j.password,
        PG_DSN: pgDsn(),
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      }
    });

    let stderrTail = '';

    pythonProcess.on('error', (err) => {
      const message = `Failed to spawn '${config.python.executable}': ${err.message}. ` +
        `Set PYTHON_EXECUTABLE to your interpreter path.`;
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'stderr', content: message }));
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'done', code: -1 }));
      reject(new Error(message));
    });

    pythonProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      // Publish chunk to a Redis channel unique to this job
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'stdout', content: chunk }));
    });

    pythonProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderrTail = (stderrTail + chunk).slice(-2000);
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'stderr', content: chunk }));
    });

    pythonProcess.on('close', (code) => {
      // Signal completion
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'done', code }));
      if (code === 0) {
        resolve(`Job ${jobId} completed successfully`);
      } else {
        const hint = /ModuleNotFoundError.*rlms/s.test(stderrTail)
          ? " The 'rlms' package was not found — install it for this interpreter or point PYTHONPATH at its site-packages."
          : '';
        reject(new Error(`Python process exited with code ${code}.${hint} stderr: ${stderrTail.trim()}`));
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

installShutdownSignalHandlers();
shutdownCoordinator.register('worker.rlm', 80, () => rlmWorker.close());
shutdownCoordinator.register('redis.rlm_publisher', 60, async () => {
  await redisPublisher.quit();
});
