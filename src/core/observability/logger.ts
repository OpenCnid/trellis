import pino from 'pino';
import { config } from '../../config/index.js';

// T16 structured logging. Production logs are one JSON object per line
// on stdout with string levels, ISO timestamps, and an `err` serializer
// that keeps type/message/stack without dumping arbitrary error payloads.
//
// Correlation convention: every operational line carries an `event`
// field (dot-namespaced, stable — tests and operators grep for these),
// plus whichever of the stable correlation fields apply: service,
// worker, queue, jobId, attempt, requestId, docKey, version, astNodeId.
// Bind context with child loggers instead of interpolating prefixes.
//
// Never log request bodies, source document text, API keys, passwords,
// DSNs, embeddings, raw LLM prompts/responses, or SSE query content.

export type Logger = pino.Logger;

export interface LoggerOptions {
  level: string;
  /** Static fields bound to every line (e.g. { service: 'api' }). */
  base?: Record<string, unknown>;
  /** Injectable sink for tests; defaults to stdout. */
  destination?: pino.DestinationStream;
}

/**
 * Pure logger factory: no config read, no global state. Tests pass an
 * in-memory destination and assert on the emitted JSON lines.
 */
export function buildLogger(options: LoggerOptions): Logger {
  const instance = pino(
    {
      level: options.level,
      base: options.base ?? {},
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: label => ({ level: label }),
      },
      serializers: {
        err: pino.stdSerializers.err,
      },
    },
    options.destination
  );
  return instance;
}

let root: Logger | undefined;

/**
 * Process-root logger: level from the validated LOG_LEVEL configuration,
 * `service` from TRELLIS_SERVICE. Created lazily so importing this module
 * has no side effects beyond reading config.
 */
export function rootLogger(): Logger {
  if (!root) {
    root = buildLogger({
      level: config.log.level,
      base: { service: config.service },
    });
  }
  return root;
}

/** Child of the process-root logger with static correlation bindings. */
export function loggerFor(bindings: Record<string, unknown>): Logger {
  return rootLogger().child(bindings);
}
