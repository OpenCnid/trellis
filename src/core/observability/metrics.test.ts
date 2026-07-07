import { describe, expect, it } from 'vitest';
import { Registry } from 'prom-client';
import { createMetrics } from './metrics';

describe('createMetrics', () => {
  it('exposes Prometheus text with the trellis metric names', async () => {
    const metrics = createMetrics(new Registry());
    metrics.httpRequestsTotal.inc({ method: 'POST', route: '/ingest', status_class: '2xx' });
    metrics.jobsTotal.inc({ queue: 'extraction_queue', worker: 'extraction', outcome: 'completed' });
    metrics.llmInputTokensTotal.inc({ operation: 'extraction', model: 'm' }, 120);

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_http_requests_total{method="POST",route="/ingest",status_class="2xx"} 1');
    expect(text).toContain('trellis_jobs_total{queue="extraction_queue",worker="extraction",outcome="completed"} 1');
    expect(text).toContain('trellis_llm_input_tokens_total{operation="extraction",model="m"} 120');
    expect(metrics.registry.contentType).toContain('text/plain');
  });

  it('pins the agent-loop counter names and bounded labels (Session 9)', async () => {
    const metrics = createMetrics(new Registry());
    metrics.agentGoalsTotal.inc({ outcome: 'completed' });
    metrics.agentGoalsTotal.inc({ outcome: 'failed' });
    metrics.agentDecisionsTotal.inc({ action: 'dispatch' }, 2);
    metrics.agentTasksTotal.inc({ outcome: 'protocol_violation' });
    metrics.llmInputTokensTotal.inc({ operation: 'orchestration', model: 'm' }, 40);

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_agent_goals_total{outcome="completed"} 1');
    expect(text).toContain('trellis_agent_goals_total{outcome="failed"} 1');
    expect(text).toContain('trellis_agent_decisions_total{action="dispatch"} 2');
    expect(text).toContain('trellis_agent_tasks_total{outcome="protocol_violation"} 1');
    expect(text).toContain('trellis_llm_input_tokens_total{operation="orchestration",model="m"} 40');
  });

  it('pins the label-free MCP call counter name (Session 10)', async () => {
    // Deliberately unlabeled: tool names, servers, commands, queries,
    // and results never become metric label values (Guardrail 11).
    const metrics = createMetrics(new Registry());
    metrics.rlmMcpCallsTotal.inc(4);

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_rlm_mcp_calls_total 4');
  });

  it('pins the A2A counter names and bounded labels (Session 11)', async () => {
    // The method label is drawn from the fixed protocol vocabulary plus
    // 'invalid'; outcomes reuse the agent goal vocabulary. Goal text,
    // messages, and artifacts never become label values (Guardrail 11).
    const metrics = createMetrics(new Registry());
    metrics.a2aRequestsTotal.inc({ method: 'SendMessage' });
    metrics.a2aRequestsTotal.inc({ method: 'invalid' }, 2);
    metrics.a2aTasksTotal.inc({ outcome: 'completed' });
    metrics.a2aTasksTotal.inc({ outcome: 'failed' });

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_a2a_requests_total{method="SendMessage"} 1');
    expect(text).toContain('trellis_a2a_requests_total{method="invalid"} 2');
    expect(text).toContain('trellis_a2a_tasks_total{outcome="completed"} 1');
    expect(text).toContain('trellis_a2a_tasks_total{outcome="failed"} 1');
  });

  it('creates independent registries without duplicate-registration failures', async () => {
    const a = createMetrics(new Registry());
    const b = createMetrics(new Registry());
    a.extractionDroppedActionsTotal.inc(3);

    expect(await a.registry.metrics()).toContain('trellis_extraction_dropped_actions_total 3');
    expect(await b.registry.metrics()).toContain('trellis_extraction_dropped_actions_total 0');
  });
});
