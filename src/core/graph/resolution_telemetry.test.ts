import { describe, expect, it } from 'vitest';
import { Registry } from 'prom-client';
import { createMetrics } from '../observability/metrics';
import { recordResolutionTelemetry } from './resolution_telemetry';
import type { ResolutionReport } from './alias_resolution';

function report(overrides: Partial<ResolutionReport> = {}): ResolutionReport {
  return {
    selected: 4,
    adjudicated: 3,
    same: 1,
    distinct: 2,
    skippedNoText: 1,
    skippedNoAnswer: 0,
    usage: { subcalls: 2, inputTokens: 100, outputTokens: 40 },
    aliases: [{ pairId: 'a|b', aName: 'globex', bName: 'globex corporation', confidence: 0.95, signal: 'token_containment' }],
    distinctPairs: [
      { pairId: 'c|d', aName: 'globex', bName: 'initech', confidence: 0.9 },
      { pairId: 'e|f', aName: 'acme', bName: 'acme labs', confidence: 0.8 },
    ],
    ...overrides,
  };
}

function fakeLog() {
  const events: Array<Record<string, unknown>> = [];
  return { events, log: { info: (obj: Record<string, unknown>) => events.push(obj) } };
}

describe('recordResolutionTelemetry', () => {
  it('counts candidates and per-verdict outcomes', async () => {
    const metrics = createMetrics(new Registry());
    const { log } = fakeLog();
    recordResolutionTelemetry(metrics, log, report(), { oracleMode: true, model: 'm' });

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_resolution_candidates_total 4');
    expect(text).toContain('trellis_resolution_pairs_total{verdict="same"} 1');
    expect(text).toContain('trellis_resolution_pairs_total{verdict="distinct"} 2');
    expect(text).toContain('trellis_resolution_pairs_total{verdict="skipped_no_text"} 1');
    expect(text).toContain('trellis_resolution_pairs_total{verdict="skipped_no_answer"} 0');
  });

  it('records LLM spend under operation=resolution, but never in oracle mode', async () => {
    const metrics = createMetrics(new Registry());
    const { log } = fakeLog();
    recordResolutionTelemetry(metrics, log, report(), { oracleMode: false, model: 'test-model' });

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_llm_calls_total{operation="resolution",model="test-model"} 2');
    expect(text).toContain('trellis_llm_input_tokens_total{operation="resolution",model="test-model"} 100');
    expect(text).toContain('trellis_llm_output_tokens_total{operation="resolution",model="test-model"} 40');

    const oracleMetrics = createMetrics(new Registry());
    recordResolutionTelemetry(oracleMetrics, log, report(), { oracleMode: true, model: 'test-model' });
    expect(await oracleMetrics.registry.metrics()).not.toContain('operation="resolution"');
  });

  it('keeps entity names in log events, never in metric labels', async () => {
    const metrics = createMetrics(new Registry());
    const { log, events } = fakeLog();
    recordResolutionTelemetry(metrics, log, report(), { oracleMode: true, model: 'm' });

    expect(await metrics.registry.metrics()).not.toContain('globex');

    const recorded = events.filter(e => e.event === 'resolution.alias_recorded');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      aName: 'globex',
      bName: 'globex corporation',
      confidence: 0.95,
      signal: 'token_containment',
    });
    const distinct = events.filter(e => e.event === 'resolution.pair_distinct');
    expect(distinct).toHaveLength(2);
    const completed = events.filter(e => e.event === 'resolution.sweep_completed');
    expect(completed).toEqual([{
      event: 'resolution.sweep_completed',
      selected: 4,
      adjudicated: 3,
      same: 1,
      distinct: 2,
      skippedNoText: 1,
      skippedNoAnswer: 0,
      subcalls: 2,
    }]);
  });
});
