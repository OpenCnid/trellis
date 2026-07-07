import { afterEach, describe, expect, it, vi } from 'vitest';

// Session 11, Guardrail 7: the A2A surface is off by default and
// configured only through validated env. The config module reads
// process.env exactly once at import, so each case resets the module
// graph and imports it fresh (the agent_bounds.test.ts pattern).

const A2A_KEYS = [
  'TRELLIS_A2A_ENABLED',
  'A2A_AGENT_NAME',
  'A2A_AGENT_DESCRIPTION',
  'A2A_AGENT_URL',
  'A2A_TASK_TTL_SECONDS',
  'PORT',
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(overrides: Partial<Record<(typeof A2A_KEYS)[number], string>>): void {
  for (const key of A2A_KEYS) {
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

describe('A2A configuration', () => {
  it('is disabled by default with local-run card defaults', async () => {
    setEnv({});
    const config = await loadConfig();
    expect(config.a2a.enabled).toBe(false);
    expect(config.a2a.agentName).toBe('Trellis Engine');
    expect(config.a2a.agentDescription).toContain('provenance');
    expect(config.a2a.agentUrl).toBe('http://127.0.0.1:3000/a2a/v1');
    expect(config.a2a.taskTtlSeconds).toBe(3600);
  });

  it('derives the default interface URL from the configured port', async () => {
    setEnv({ PORT: '3456' });
    const config = await loadConfig();
    expect(config.a2a.agentUrl).toBe('http://127.0.0.1:3456/a2a/v1');
  });

  it('accepts explicit operator values', async () => {
    setEnv({
      TRELLIS_A2A_ENABLED: 'true',
      A2A_AGENT_NAME: 'Trellis Staging',
      A2A_AGENT_DESCRIPTION: 'Staging goal executor.',
      A2A_AGENT_URL: 'https://trellis.example.com/a2a/v1',
      A2A_TASK_TTL_SECONDS: '600',
    });
    const config = await loadConfig();
    expect(config.a2a).toEqual({
      enabled: true,
      agentName: 'Trellis Staging',
      agentDescription: 'Staging goal executor.',
      agentUrl: 'https://trellis.example.com/a2a/v1',
      taskTtlSeconds: 600,
    });
  });

  it('rejects a non-boolean enable switch instead of coercing it', async () => {
    setEnv({ TRELLIS_A2A_ENABLED: 'yes' });
    await expect(loadConfig()).rejects.toThrow(/Invalid environment configuration/);
  });

  it('rejects a malformed advertised URL', async () => {
    setEnv({ A2A_AGENT_URL: 'not-a-url' });
    await expect(loadConfig()).rejects.toThrow(/Invalid environment configuration/);
  });

  it('rejects zero, negative, fractional, and beyond-cap task TTLs', async () => {
    for (const bad of ['0', '-5', '1.5', '90000']) {
      setEnv({ A2A_TASK_TTL_SECONDS: bad });
      await expect(loadConfig()).rejects.toThrow(/Invalid environment configuration/);
    }
  });

  it('rejects empty card fields', async () => {
    setEnv({ A2A_AGENT_NAME: '' });
    await expect(loadConfig()).rejects.toThrow(/Invalid environment configuration/);
  });
});
