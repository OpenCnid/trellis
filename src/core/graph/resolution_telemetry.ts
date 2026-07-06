import type { TrellisMetrics } from '../observability/metrics.js';
import type { ResolutionReport } from './alias_resolution.js';

// Maps one resolution job's report onto the T16 metrics and log events.
// Extracted from the worker (the conflict_resolution.ts pattern) so the
// emission contract is offline-testable with injected fakes — the worker
// module itself opens Redis on import.

/** The subset of the pino logger the telemetry emission needs. */
export interface ResolutionTelemetryLog {
  info(obj: Record<string, unknown>): void;
}

export interface ResolutionTelemetryOptions {
  /** True when the job ran with the zero-cost oracle adjudicator. */
  oracleMode: boolean;
  /** Model label for LLM spend metrics; ignored in oracle mode. */
  model: string;
}

export function recordResolutionTelemetry(
  metrics: TrellisMetrics,
  log: ResolutionTelemetryLog,
  report: ResolutionReport,
  options: ResolutionTelemetryOptions
): void {
  metrics.resolutionCandidatesTotal.inc(report.selected);
  metrics.resolutionPairsTotal.inc({ verdict: 'same' }, report.same);
  metrics.resolutionPairsTotal.inc({ verdict: 'distinct' }, report.distinct);
  metrics.resolutionPairsTotal.inc({ verdict: 'skipped_no_text' }, report.skippedNoText);
  metrics.resolutionPairsTotal.inc({ verdict: 'skipped_no_answer' }, report.skippedNoAnswer);
  if (!options.oracleMode && report.usage.subcalls > 0) {
    const labels = { operation: 'resolution', model: options.model };
    metrics.llmCallsTotal.inc(labels, report.usage.subcalls);
    if (report.usage.inputTokens > 0) metrics.llmInputTokensTotal.inc(labels, report.usage.inputTokens);
    if (report.usage.outputTokens > 0) metrics.llmOutputTokensTotal.inc(labels, report.usage.outputTokens);
  }

  // Entity names belong in logs, never in metric labels (Guardrail 7).
  for (const alias of report.aliases) {
    log.info({
      event: 'resolution.alias_recorded',
      pairId: alias.pairId,
      aName: alias.aName,
      bName: alias.bName,
      confidence: alias.confidence,
      signal: alias.signal,
    });
  }
  for (const pair of report.distinctPairs) {
    log.info({
      event: 'resolution.pair_distinct',
      pairId: pair.pairId,
      aName: pair.aName,
      bName: pair.bName,
      confidence: pair.confidence,
    });
  }
  log.info({
    event: 'resolution.sweep_completed',
    selected: report.selected,
    adjudicated: report.adjudicated,
    same: report.same,
    distinct: report.distinct,
    skippedNoText: report.skippedNoText,
    skippedNoAnswer: report.skippedNoAnswer,
    subcalls: report.usage.subcalls,
  });
}
