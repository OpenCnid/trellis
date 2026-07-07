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

  it('forwards exactly the resolved credential variables (Session 12)', () => {
    const env = buildAgentEnv(
      { PATH: '/bin' },
      { ...CFG, mcpCredentialEnv: { MCP_REMOTE_TOKEN: 'secret-value' } }
    );
    expect(env.MCP_REMOTE_TOKEN).toBe('secret-value');
  });

  it('resolved credentials win over a stale inherited value of the same name', () => {
    const env = buildAgentEnv(
      { MCP_REMOTE_TOKEN: 'stale' },
      { ...CFG, mcpCredentialEnv: { MCP_REMOTE_TOKEN: 'fresh' } }
    );
    expect(env.MCP_REMOTE_TOKEN).toBe('fresh');
  });

  it('adds nothing when the registry names no credentials', () => {
    const env = buildAgentEnv({ PATH: '/bin' }, { ...CFG, mcpCredentialEnv: {} });
    expect(Object.keys(env)).not.toContain('MCP_REMOTE_TOKEN');
  });

  it('forwards the validated workspace bounds (Session 14)', () => {
    const env = buildAgentEnv({}, { ...CFG, workspace: { maxSegments: 64, maxBytes: 1_048_576 } });
    expect(env.TRELLIS_WORKSPACE_MAX_SEGMENTS).toBe('64');
    expect(env.TRELLIS_WORKSPACE_MAX_BYTES).toBe('1048576');
  });

  it('forwards the canonical module selection and never a raw inherited one (Session 15)', () => {
    const env = buildAgentEnv(
      { TRELLIS_MODULES: '["evil-module"]' },
      { ...CFG, modulesJson: '["spatial-flywheel"]' }
    );
    expect(env.TRELLIS_MODULES).toBe('["spatial-flywheel"]');

    const stripped = buildAgentEnv({ TRELLIS_MODULES: '["evil-module"]' }, CFG);
    expect('TRELLIS_MODULES' in stripped).toBe(false);
  });

  it('strips raw inherited workspace bounds when none are configured', () => {
    // Same discipline as TRELLIS_MCP_SERVERS: the child only ever sees
    // bounds that crossed the Zod validator, never a raw passthrough.
    const env = buildAgentEnv(
      { TRELLIS_WORKSPACE_MAX_SEGMENTS: '99999', TRELLIS_WORKSPACE_MAX_BYTES: 'huge' },
      CFG
    );
    expect('TRELLIS_WORKSPACE_MAX_SEGMENTS' in env).toBe(false);
    expect('TRELLIS_WORKSPACE_MAX_BYTES' in env).toBe(false);
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

  it('forwards --goal-id when the job carries goal correlation (Session 14)', () => {
    const args = buildAgentArgs('/x/trellis_agent.py', {
      query: 'q',
      jobId: 'j',
      goalId: 'g-1',
      taskId: 't-1',
      maxIterations: 4,
    });
    expect(args).toEqual([
      '/x/trellis_agent.py', '--query', 'q', '--max-iterations', '4', '--goal-id', 'g-1',
    ]);
  });

  it('omits --goal-id for goal-less jobs (pre-Session-14 argument vector pinned)', () => {
    const args = buildAgentArgs('/x/trellis_agent.py', { query: 'q', jobId: 'j' });
    expect(args).toEqual(['/x/trellis_agent.py', '--query', 'q']);
  });
});
