import { afterEach, describe, expect, it, vi } from 'vitest';

// Session 14: Tier-3 workspace bounds are validated configuration with
// hard maxima (the mcp_servers.ts discipline). The config module reads
// process.env exactly once at import, so each case resets the module
// graph and imports it fresh (the agent_bounds.test.ts pattern). The
// Python half (src/rlm/trellis_workspace.py) re-validates with the same
// defaults and caps; the cross-language pin lives in test:rlm-workspace.

const WORKSPACE_KEYS = [
  'TRELLIS_WORKSPACE_MAX_SEGMENTS',
  'TRELLIS_WORKSPACE_MAX_BYTES',
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(overrides: Partial<Record<(typeof WORKSPACE_KEYS)[number], string>>): void {
  for (const key of WORKSPACE_KEYS) {
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

describe('workspace bounds configuration', () => {
  it('defaults to 128 segments and 4 MiB', async () => {
    setEnv({});
    const config = await loadConfig();
    expect(config.workspace).toEqual({
      maxSegments: 128,
      maxBytes: 4 * 1024 * 1024,
    });
  });

  it('accepts explicit values inside the hard caps', async () => {
    setEnv({
      TRELLIS_WORKSPACE_MAX_SEGMENTS: '1024',
      TRELLIS_WORKSPACE_MAX_BYTES: String(32 * 1024 * 1024),
    });
    const config = await loadConfig();
    expect(config.workspace.maxSegments).toBe(1024);
    expect(config.workspace.maxBytes).toBe(32 * 1024 * 1024);
  });

  it('rejects zero, negative, fractional, and beyond-cap bounds', async () => {
    for (const bad of [
      { TRELLIS_WORKSPACE_MAX_SEGMENTS: '0' },
      { TRELLIS_WORKSPACE_MAX_SEGMENTS: '1025' },
      { TRELLIS_WORKSPACE_MAX_SEGMENTS: '2.5' },
      { TRELLIS_WORKSPACE_MAX_BYTES: '-1' },
      { TRELLIS_WORKSPACE_MAX_BYTES: String(32 * 1024 * 1024 + 1) },
      { TRELLIS_WORKSPACE_MAX_BYTES: 'huge' },
    ] as const) {
      setEnv(bad);
      await expect(loadConfig()).rejects.toThrow(/Invalid environment configuration/);
    }
  });
});
