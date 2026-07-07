import { describe, expect, it } from 'vitest';
import { parseRlmJobData, buildAgentArgs, buildAgentEnv, RlmStubSchema } from './rlm_job';

describe('parseRlmJobData', () => {
  it('accepts the exact pre-Session-9 payload shape', () => {
    // Pinned: `{query, jobId}` is what /api/rlm-stream enqueued before
    // Session 9 and may still sit in Redis at deploy time.
    const parsed = parseRlmJobData({ query: 'what is 2 + 2?', jobId: 'job-1' });
    expect(parsed).toEqual({ query: 'what is 2 + 2?', jobId: 'job-1' });
    expect(parsed.goalId).toBeUndefined();
    expect(parsed.taskId).toBeUndefined();
    expect(parsed.maxIterations).toBeUndefined();
    expect(parsed.stub).toBeUndefined();
  });

  it('threads goal correlation and the per-task iteration ceiling', () => {
    const parsed = parseRlmJobData({
      query: 'q',
      jobId: 'j',
      goalId: 'g-1',
      taskId: 't-1',
      maxIterations: 3,
    });
    expect(parsed.goalId).toBe('g-1');
    expect(parsed.taskId).toBe('t-1');
    expect(parsed.maxIterations).toBe(3);
  });

  it('rejects a payload missing query or jobId', () => {
    expect(() => parseRlmJobData({ jobId: 'j' })).toThrow(/Invalid rlm_queue job data/);
    expect(() => parseRlmJobData({ query: 'q' })).toThrow(/Invalid rlm_queue job data/);
    expect(() => parseRlmJobData({ query: '', jobId: 'j' })).toThrow(/Invalid rlm_queue job data/);
  });

  it('rejects non-positive or absurd iteration ceilings', () => {
    expect(() => parseRlmJobData({ query: 'q', jobId: 'j', maxIterations: 0 })).toThrow();
    expect(() => parseRlmJobData({ query: 'q', jobId: 'j', maxIterations: 500 })).toThrow();
    expect(() => parseRlmJobData({ query: 'q', jobId: 'j', maxIterations: 2.5 })).toThrow();
  });

  it('validates stub payloads at the queue boundary', () => {
    const parsed = parseRlmJobData({
      query: 'q',
      jobId: 'j',
      stub: { stdout: 'FINAL_ANSWER: 4\n' },
    });
    expect(parsed.stub).toEqual({ stdout: 'FINAL_ANSWER: 4\n', exitCode: 0, delayMs: 0 });

    expect(() => parseRlmJobData({ query: 'q', jobId: 'j', stub: { stdout: 'x', delayMs: 120_000 } }))
      .toThrow(/Invalid rlm_queue job data/);
    expect(() => parseRlmJobData({ query: 'q', jobId: 'j', stub: { stdout: 'x', exitCode: 1000 } }))
      .toThrow(/Invalid rlm_queue job data/);
  });

  it('keeps stubs data-only — no script or executable fields survive parsing', () => {
    const result = RlmStubSchema.safeParse({ stdout: 'x', script: 'evil.py', command: 'rm' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual(['delayMs', 'exitCode', 'stdout']);
    }
  });

  it('carries nothing MCP-shaped — a payload cannot name servers, commands, or tools', () => {
    // Guardrail 5 (Session 10): the external tool surface comes from the
    // operator's validated config only. Any MCP-looking fields riding a
    // queue payload are stripped at the boundary.
    const parsed = parseRlmJobData({
      query: 'q',
      jobId: 'j',
      mcpServers: [{ name: 'evil', command: ['rm'], tools: ['everything'] }],
      TRELLIS_MCP_SERVERS: '[]',
      tools: ['web_search'],
      server: 'evil',
    });
    expect(Object.keys(parsed).sort()).toEqual(['jobId', 'query']);
  });
});

describe('buildAgentEnv', () => {
  const CFG = {
    neo4j: { uri: 'bolt://db:7687', user: 'neo4j', password: 'pw' },
    pgDsn: 'dbname=trellis',
  };

  it('forwards the validated connection values and Python runtime flags', () => {
    const env = buildAgentEnv({ PATH: '/bin' }, { ...CFG, pythonPath: '/site-packages' });
    expect(env).toEqual({
      PATH: '/bin',
      PYTHONPATH: '/site-packages',
      NEO4J_URI: 'bolt://db:7687',
      NEO4J_USER: 'neo4j',
      NEO4J_PASSWORD: 'pw',
      PG_DSN: 'dbname=trellis',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    });
  });

  it('forwards the canonical MCP registry JSON when servers are configured', () => {
    const json = JSON.stringify([{ name: 's', command: ['x'], tools: ['t'], timeoutMs: 1, maxResultBytes: 1 }]);
    const env = buildAgentEnv({}, { ...CFG, mcpServersJson: json });
    expect(env.TRELLIS_MCP_SERVERS).toBe(json);
  });

  it('strips a raw inherited registry when no servers are configured', () => {
    // The child only ever sees the canonical validated serialization —
    // never a raw un-validated env passthrough.
    const env = buildAgentEnv({ TRELLIS_MCP_SERVERS: '[]' }, CFG);
    expect('TRELLIS_MCP_SERVERS' in env).toBe(false);
  });
});

describe('buildAgentArgs', () => {
  it('builds the pre-Session-9 argument vector when no ceiling is set', () => {
    const args = buildAgentArgs('/x/trellis_agent.py', { query: 'the query', jobId: 'j' });
    expect(args).toEqual(['/x/trellis_agent.py', '--query', 'the query']);
  });

  it('forwards the per-task iteration ceiling as --max-iterations', () => {
    const args = buildAgentArgs('/x/trellis_agent.py', {
      query: 'q',
      jobId: 'j',
      maxIterations: 4,
    });
    expect(args).toEqual(['/x/trellis_agent.py', '--query', 'q', '--max-iterations', '4']);
  });
});
