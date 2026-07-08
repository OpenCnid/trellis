import { afterEach, describe, expect, it, vi } from 'vitest';

// Session 16, Guardrail 6: parked workspace snapshots are age- and
// volume-bounded by validated config. The config module reads
// process.env exactly once at import, so each case resets the module
// graph and imports it fresh (the agent_bounds.test.ts pattern).

const SCRATCH_KEYS = ['SCRATCH_TTL_SECONDS', 'SCRATCH_MAX_BYTES_PER_GOAL'] as const;

const saved = new Map<string, string | undefined>();

function setEnv(overrides: Partial<Record<(typeof SCRATCH_KEYS)[number], string>>): void {
  for (const key of SCRATCH_KEYS) {
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

describe('scratch parking configuration', () => {
  it('defaults to one hour TTL and 8 MiB per goal', async () => {
    setEnv({});
    const config = await loadConfig();
    expect(config.scratch).toEqual({
      ttlSeconds: 3600,
      maxBytesPerGoal: 8 * 1024 * 1024,
    });
  });

  it('accepts explicit values inside the caps', async () => {
    setEnv({ SCRATCH_TTL_SECONDS: '86400', SCRATCH_MAX_BYTES_PER_GOAL: String(64 * 1024 * 1024) });
    const config = await loadConfig();
    expect(config.scratch.ttlSeconds).toBe(86400);
    expect(config.scratch.maxBytesPerGoal).toBe(64 * 1024 * 1024);
  });

  it('rejects zero, negative, fractional, and beyond-cap values', async () => {
    for (const bad of [
      { SCRATCH_TTL_SECONDS: '0' },
      { SCRATCH_TTL_SECONDS: '86401' }, // 24 h hard cap — TTL is a feature
      { SCRATCH_TTL_SECONDS: '2.5' },
      { SCRATCH_MAX_BYTES_PER_GOAL: '-1' },
      { SCRATCH_MAX_BYTES_PER_GOAL: String(64 * 1024 * 1024 + 1) },
      { SCRATCH_MAX_BYTES_PER_GOAL: 'huge' },
    ] as const) {
      setEnv(bad);
      await expect(loadConfig()).rejects.toThrow(/Invalid environment configuration/);
    }
  });
});
