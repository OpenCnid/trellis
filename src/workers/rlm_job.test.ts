import { describe, expect, it } from 'vitest';
import { parseRlmJobData, buildAgentArgs, RlmStubSchema } from './rlm_job';

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
