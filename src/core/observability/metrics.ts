import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

// T16 metrics. Every metric handle is created against an explicit
// Registry by createMetrics(), so tests build isolated registries and
// duplicate registration is structurally impossible. Production code
// shares one process singleton via getMetrics().
//
// Label discipline (Guardrail 6): labels are drawn from small fixed
// vocabularies only — method/route/status class, worker/queue names,
// outcome enums, operation/model. Job IDs, request IDs, document keys,
// AST hashes, entity names, and error messages belong in logs, never
// in metric labels.

export interface TrellisMetrics {
  registry: Registry;

  // API surface.
  httpRequestsTotal: Counter<'method' | 'route' | 'status_class'>;
  httpRequestDurationSeconds: Histogram<'method' | 'route'>;

  // BullMQ job lifecycle, by worker/queue.
  jobsTotal: Counter<'queue' | 'worker' | 'outcome'>;
  jobDurationSeconds: Histogram<'queue' | 'worker'>;

  // Extraction pipeline transitions.
  extractionUnresolvedEndpointsTotal: Counter<string>;
  extractionDroppedActionsTotal: Counter<string>;
  extractionSupersededTotal: Counter<'stage'>;

  // Invalidation sweep outcomes.
  invalidationCandidateHashesTotal: Counter<string>;
  invalidationRetainedSharedHashesTotal: Counter<string>;
  invalidationContestedTotal: Counter<'kind'>;
  invalidationSurvivedTotal: Counter<'kind'>;
  invalidationSweepBatchesTotal: Counter<string>;

  // Verification sweep outcomes.
  verificationBeliefsTotal: Counter<'result'>;

  // LLM spend by operation/model (never by prompt or document).
  llmCallsTotal: Counter<'operation' | 'model'>;
  llmInputTokensTotal: Counter<'operation' | 'model'>;
  llmOutputTokensTotal: Counter<'operation' | 'model'>;
  llmEmbeddingTokensTotal: Counter<'operation' | 'model'>;

  // RLM agent runs, from the TRELLIS_TELEMETRY stdout line.
  rlmRunsTotal: Counter<'exit_status'>;
  rlmInputTokensTotal: Counter<string>;
  rlmOutputTokensTotal: Counter<string>;
  rlmSubcallsTotal: Counter<string>;
  rlmToolCallsTotal: Counter<string>;
  rlmDurationSeconds: Histogram<string>;
  rlmTelemetryMalformedTotal: Counter<string>;

  // Queue depth, collected at scrape time.
  queueJobs: Gauge<'queue' | 'state'>;
  queueDepthReadFailuresTotal: Counter<'queue'>;
}

export function createMetrics(registry: Registry): TrellisMetrics {
  return {
    registry,

    httpRequestsTotal: new Counter({
      name: 'trellis_http_requests_total',
      help: 'API requests by method, normalized route, and status class.',
      labelNames: ['method', 'route', 'status_class'],
      registers: [registry],
    }),
    httpRequestDurationSeconds: new Histogram({
      name: 'trellis_http_request_duration_seconds',
      help: 'API request duration by method and normalized route.',
      labelNames: ['method', 'route'],
      buckets: [0.005, 0.025, 0.1, 0.25, 1, 2.5, 10, 30],
      registers: [registry],
    }),

    jobsTotal: new Counter({
      name: 'trellis_jobs_total',
      help:
        'BullMQ job outcomes: started, completed, failed_retryable, '
        + 'failed_exhausted, failed_unrecoverable.',
      labelNames: ['queue', 'worker', 'outcome'],
      registers: [registry],
    }),
    jobDurationSeconds: new Histogram({
      name: 'trellis_job_duration_seconds',
      help: 'Completed BullMQ job processing duration.',
      labelNames: ['queue', 'worker'],
      buckets: [0.1, 0.5, 1, 5, 15, 60, 300],
      registers: [registry],
    }),

    extractionUnresolvedEndpointsTotal: new Counter({
      name: 'trellis_extraction_unresolved_endpoints_total',
      help: 'Extracted actions whose subject/object matched no extracted entity.',
      registers: [registry],
    }),
    extractionDroppedActionsTotal: new Counter({
      name: 'trellis_extraction_dropped_actions_total',
      help: 'Actions the merge Cypher dropped because no Entity matched by name.',
      registers: [registry],
    }),
    extractionSupersededTotal: new Counter({
      name: 'trellis_extraction_superseded_total',
      help:
        'Extraction jobs whose source bytes died: skipped before_start, '
        + 'skipped before_merge, or compensated post_merge.',
      labelNames: ['stage'],
      registers: [registry],
    }),

    invalidationCandidateHashesTotal: new Counter({
      name: 'trellis_invalidation_candidate_hashes_total',
      help: 'Per-document orphan candidate hashes received by sweep jobs.',
      registers: [registry],
    }),
    invalidationRetainedSharedHashesTotal: new Counter({
      name: 'trellis_invalidation_retained_shared_hashes_total',
      help: 'Candidate hashes retained because another live document still contains them.',
      registers: [registry],
    }),
    invalidationContestedTotal: new Counter({
      name: 'trellis_invalidation_contested_total',
      help: 'Semantic nodes/relationships quarantined by sweeps.',
      labelNames: ['kind'],
      registers: [registry],
    }),
    invalidationSurvivedTotal: new Counter({
      name: 'trellis_invalidation_survived_total',
      help: 'Nodes/relationships that kept fresh provenance and escaped quarantine.',
      labelNames: ['kind'],
      registers: [registry],
    }),
    invalidationSweepBatchesTotal: new Counter({
      name: 'trellis_invalidation_sweep_batches_total',
      help: 'Cypher batches executed by invalidation sweeps.',
      registers: [registry],
    }),

    verificationBeliefsTotal: new Counter({
      name: 'trellis_verification_beliefs_total',
      help:
        'Verification sweep results: classified, agreed, disputed, '
        + 'skipped_no_text, skipped_no_answer.',
      labelNames: ['result'],
      registers: [registry],
    }),

    llmCallsTotal: new Counter({
      name: 'trellis_llm_calls_total',
      help: 'LLM API calls by operation and model.',
      labelNames: ['operation', 'model'],
      registers: [registry],
    }),
    llmInputTokensTotal: new Counter({
      name: 'trellis_llm_input_tokens_total',
      help: 'LLM input (prompt) tokens by operation and model.',
      labelNames: ['operation', 'model'],
      registers: [registry],
    }),
    llmOutputTokensTotal: new Counter({
      name: 'trellis_llm_output_tokens_total',
      help: 'LLM output (completion) tokens by operation and model.',
      labelNames: ['operation', 'model'],
      registers: [registry],
    }),
    llmEmbeddingTokensTotal: new Counter({
      name: 'trellis_llm_embedding_tokens_total',
      help: 'Embedding input tokens by operation and model.',
      labelNames: ['operation', 'model'],
      registers: [registry],
    }),

    rlmRunsTotal: new Counter({
      name: 'trellis_rlm_runs_total',
      help: 'RLM agent process runs by exit status.',
      labelNames: ['exit_status'],
      registers: [registry],
    }),
    rlmInputTokensTotal: new Counter({
      name: 'trellis_rlm_input_tokens_total',
      help: 'RLM agent input tokens, from the TRELLIS_TELEMETRY line.',
      registers: [registry],
    }),
    rlmOutputTokensTotal: new Counter({
      name: 'trellis_rlm_output_tokens_total',
      help: 'RLM agent output tokens, from the TRELLIS_TELEMETRY line.',
      registers: [registry],
    }),
    rlmSubcallsTotal: new Counter({
      name: 'trellis_rlm_subcalls_total',
      help: 'RLM in-REPL sub-LLM invocations.',
      registers: [registry],
    }),
    rlmToolCallsTotal: new Counter({
      name: 'trellis_rlm_tool_calls_total',
      help: 'RLM database tool calls.',
      registers: [registry],
    }),
    rlmDurationSeconds: new Histogram({
      name: 'trellis_rlm_duration_seconds',
      help: 'RLM agent execution time reported by telemetry.',
      buckets: [1, 5, 15, 30, 60, 120, 300, 600],
      registers: [registry],
    }),
    rlmTelemetryMalformedTotal: new Counter({
      name: 'trellis_rlm_telemetry_malformed_total',
      help: 'TRELLIS_TELEMETRY lines that failed to parse.',
      registers: [registry],
    }),

    queueJobs: new Gauge({
      name: 'trellis_queue_jobs',
      help: 'BullMQ job counts by queue and state (waiting/active/delayed/failed).',
      labelNames: ['queue', 'state'],
      registers: [registry],
    }),
    queueDepthReadFailuresTotal: new Counter({
      name: 'trellis_queue_depth_read_failures_total',
      help: 'Failed queue-depth reads during metrics collection.',
      labelNames: ['queue'],
      registers: [registry],
    }),
  };
}

let processMetrics: TrellisMetrics | undefined;

/**
 * Process-wide metrics singleton on a dedicated registry with the
 * prom-client default Node.js process metrics attached once.
 */
export function getMetrics(): TrellisMetrics {
  if (!processMetrics) {
    const registry = new Registry();
    collectDefaultMetrics({ register: registry });
    processMetrics = createMetrics(registry);
  }
  return processMetrics;
}
