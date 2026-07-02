import http from 'http';
import { z } from 'zod';

// SSE client for the /api/rlm-stream endpoint. Accumulates the RLM's
// stdout/stderr, resolves on the 'done' event, and extracts the
// FINAL_ANSWER text plus the TRELLIS_TELEMETRY payload.

export const TelemetrySchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  reported_cost_usd: z.number().nullable(),
  subcall_count: z.number(),
  tool_calls: z.number().default(0),
  execution_time_s: z.number().nullable(),
  model_usage: z.record(z.string(), z.any())
});

export type Telemetry = z.infer<typeof TelemetrySchema>;

export interface RlmRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  finalAnswer: string | null;
  telemetry: Telemetry | null;
  iterations: number | null;
  durationMs: number;
}

// The installed rlms version never fires on_iteration_complete, so the
// iteration count comes from the summary banner rlms prints to stdout.
export function extractIterations(stdout: string): number | null {
  const matches = [...stdout.matchAll(/Iterations\s+([\d,]+)/g)];
  if (matches.length === 0) return null;
  return parseInt(matches[matches.length - 1][1].replace(/,/g, ''), 10);
}

export function extractFinalAnswer(stdout: string): string | null {
  const marker = 'FINAL_ANSWER:';
  const idx = stdout.lastIndexOf(marker);
  if (idx === -1) return null;
  // Everything after the marker until the next telemetry line or end.
  const tail = stdout.slice(idx + marker.length);
  const cut = tail.indexOf('TRELLIS_TELEMETRY:');
  return (cut === -1 ? tail : tail.slice(0, cut)).trim();
}

export function extractTelemetry(stdout: string): Telemetry | null {
  const marker = 'TRELLIS_TELEMETRY:';
  const idx = stdout.lastIndexOf(marker);
  if (idx === -1) return null;
  const line = stdout.slice(idx + marker.length).split('\n')[0].trim();
  try {
    return TelemetrySchema.parse(JSON.parse(line));
  } catch {
    return null;
  }
}

export function runRlmQuery(
  query: string,
  { port = 3000, timeoutMs = 20 * 60 * 1000, echo = false }: { port?: number; timeoutMs?: number; echo?: boolean } = {}
): Promise<RlmRunResult> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let buffer = '';

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode,
        finalAnswer: extractFinalAnswer(stdout),
        telemetry: extractTelemetry(stdout),
        iterations: extractIterations(stdout),
        durationMs: Date.now() - startedAt
      });
    };

    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: `/api/rlm-stream?query=${encodeURIComponent(query)}`,
        method: 'GET',
        headers: { Accept: 'text/event-stream' }
      },
      res => {
        if (res.statusCode !== 200) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`rlm-stream returned HTTP ${res.statusCode}`));
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // keep incomplete line for next chunk
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.substring(6));
              if (event.type === 'stdout') {
                stdout += event.content;
                if (echo) process.stdout.write(event.content);
              } else if (event.type === 'stderr') {
                stderr += event.content;
                if (echo) process.stderr.write(event.content);
              } else if (event.type === 'done') {
                finish(event.code ?? 0);
              }
            } catch {
              // Ignore malformed SSE frames
            }
          }
        });
        res.on('end', () => finish(-1));
        res.on('error', err => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
      }
    );

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error(`RLM query timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    req.on('error', err => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
    req.end();
  });
}
