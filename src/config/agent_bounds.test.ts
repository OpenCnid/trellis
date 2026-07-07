import { afterEach, describe, expect, it, vi } from 'vitest';

// Guardrail 5: agentic bounds come from validated config with small
// defaults. The config module reads process.env exactly once at import,
// so each case resets the module graph and imports it fresh.

const AGENT_KEYS = [
  'AGENT_MAX_ITERATIONS_PER_GOAL',
  'AGENT_MAX_TASKS_PER_GOAL',
  'AGENT_MAX_CONCURRENT_TASKS',
  'AGENT_TASK_MAX_ITERATIONS',
  'AGENT_MAX_CONCURRENT_GOALS',
  'AGENT_QUEUE_MAX_DEPTH',
  'AGENT_ORACLE_ENABLED',
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(overrides: Partial<Record<(typeof AGENT_KEYS)[number], string>>): void {
  for (const key of AGENT_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function loadConfig() {
  vi.resetModules();
  const module = await import('./index');
  return module.config;
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  vi.resetModules();
});

describe('agent bounds configuration', () => {
  it('defaults to small single-digit bounds with the oracle disabled', async () => {
    setEnv({});
    const config = await loadConfig();
    expect(config.agent).toEqual({
      maxIterationsPerGoal: 4,
      maxTasksPerGoal: 8,
      maxConcurrentTasks: 2,
      taskMaxIterations: 5,
      maxConcurrentGoals: 2,
      maxQueueDepth: 8,
      oracleEnabled: false,
    });
  });

  it('accepts explicit values inside the caps', async () => {
    setEnv({
      AGENT_MAX_ITERATIONS_PER_GOAL: '6',
      AGENT_MAX_TASKS_PER_GOAL: '9',
      AGENT_MAX_CONCURRENT_TASKS: '3',
      AGENT_TASK_MAX_ITERATIONS: '2',
      AGENT_ORACLE_ENABLED: 'true',
    });
    const config = await loadConfig();
    expect(config.agent.maxIterationsPerGoal).toBe(6);
    expect(config.agent.maxTasksPerGoal).toBe(9);
    expect(config.agent.maxConcurrentTasks).toBe(3);
    expect(config.agent.taskMaxIterations).toBe(2);
    expect(config.agent.oracleEnabled).toBe(true);
  });

  it('rejects zero, negative, fractional, and beyond-cap bounds', async () => {
    for (const bad of [
      { AGENT_MAX_ITERATIONS_PER_GOAL: '0' },
      { AGENT_MAX_TASKS_PER_GOAL: '-1' },
      { AGENT_MAX_CONCURRENT_TASKS: '1.5' },
      { AGENT_TASK_MAX_ITERATIONS: '10' }, // single-digit cap
      { AGENT_MAX_ITERATIONS_PER_GOAL: '25' },
    ] as const) {
      setEnv(bad);
      await expect(loadConfig()).rejects.toThrow(/Invalid environment configuration/);
    }
  });

  it('rejects a non-boolean oracle switch instead of coercing it', async () => {
    setEnv({ AGENT_ORACLE_ENABLED: 'yes' });
    await expect(loadConfig()).rejects.toThrow(/Invalid environment configuration/);
  });
});
