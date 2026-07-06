import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { buildLogger } from './logger';

function memorySink(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      // pino writes one line per log call; split defensively anyway.
      for (const line of chunk.toString().split('\n')) {
        if (line.trim().length > 0) lines.push(line);
      }
      callback();
    },
  });
  return { lines, stream };
}

describe('buildLogger', () => {
  it('emits one parseable JSON object per line with string level and event field', () => {
    const sink = memorySink();
    const log = buildLogger({ level: 'info', base: { service: 'api' }, destination: sink.stream });

    log.info({ event: 'ingest.accepted', docKey: 'k', version: 2 });
    log.warn({ event: 'extraction.action_dropped' });

    expect(sink.lines).toHaveLength(2);
    const first = JSON.parse(sink.lines[0]);
    expect(first).toMatchObject({
      level: 'info',
      service: 'api',
      event: 'ingest.accepted',
      docKey: 'k',
      version: 2,
    });
    expect(typeof first.time).toBe('string');
    expect(JSON.parse(sink.lines[1])).toMatchObject({ level: 'warn', event: 'extraction.action_dropped' });
  });

  it('filters below the configured level', () => {
    const sink = memorySink();
    const log = buildLogger({ level: 'warn', destination: sink.stream });

    log.debug({ event: 'noise' });
    log.info({ event: 'noise' });
    log.warn({ event: 'kept' });
    log.error({ event: 'kept' });

    expect(sink.lines.map(line => JSON.parse(line).level)).toEqual(['warn', 'error']);
  });

  it('binds child correlation fields onto every line', () => {
    const sink = memorySink();
    const log = buildLogger({ level: 'info', base: { service: 'workers' }, destination: sink.stream })
      .child({ worker: 'extraction', queue: 'extraction_queue' })
      .child({ jobId: '42', attempt: 2 });

    log.info({ event: 'extraction.merged', astNodeId: 'abc' });

    expect(JSON.parse(sink.lines[0])).toMatchObject({
      service: 'workers',
      worker: 'extraction',
      queue: 'extraction_queue',
      jobId: '42',
      attempt: 2,
      astNodeId: 'abc',
      event: 'extraction.merged',
    });
  });

  it('serializes errors with type, message, and stack', () => {
    const sink = memorySink();
    const log = buildLogger({ level: 'info', destination: sink.stream });

    log.error({ event: 'ingest.failed', err: new RangeError('boom') });

    const entry = JSON.parse(sink.lines[0]);
    expect(entry.err.type).toBe('RangeError');
    expect(entry.err.message).toBe('boom');
    expect(entry.err.stack).toContain('RangeError: boom');
  });
});
