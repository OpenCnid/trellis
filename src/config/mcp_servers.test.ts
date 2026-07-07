import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseMcpServers,
  serializeMcpServers,
  MCP_TIMEOUT_MS_DEFAULT,
  MCP_MAX_RESULT_BYTES_DEFAULT,
} from './mcp_servers';

// Guardrail 5: the RLM's external tool surface comes from this validated
// registry and nowhere else. The Python re-validation in
// src/rlm/trellis_mcp.py mirrors these bounds; if a case is added here,
// scripts/test_rlm_mcp.py should gain its twin.

const VALID = [
  {
    name: 'websearch',
    command: ['python', 'scripts/fixture_mcp_server.py'],
    tools: ['web_search'],
  },
];

describe('parseMcpServers', () => {
  it('treats unset and blank values as an empty registry', () => {
    expect(parseMcpServers(undefined)).toEqual([]);
    expect(parseMcpServers('')).toEqual([]);
    expect(parseMcpServers('   ')).toEqual([]);
  });

  it('parses a valid registry and fills the per-call bound defaults', () => {
    const servers = parseMcpServers(JSON.stringify(VALID));
    expect(servers).toEqual([
      {
        name: 'websearch',
        command: ['python', 'scripts/fixture_mcp_server.py'],
        tools: ['web_search'],
        timeoutMs: MCP_TIMEOUT_MS_DEFAULT,
        maxResultBytes: MCP_MAX_RESULT_BYTES_DEFAULT,
      },
    ]);
  });

  it('accepts explicit bounds inside the caps', () => {
    const servers = parseMcpServers(
      JSON.stringify([{ ...VALID[0], timeoutMs: 2000, maxResultBytes: 1024 }])
    );
    expect(servers[0].timeoutMs).toBe(2000);
    expect(servers[0].maxResultBytes).toBe(1024);
  });

  it('rejects malformed JSON with a readable error', () => {
    expect(() => parseMcpServers('{not json')).toThrow(/not valid JSON/);
    expect(() => parseMcpServers('{"name":"x"}')).toThrow(/Invalid TRELLIS_MCP_SERVERS/);
  });

  it('rejects missing required fields', () => {
    for (const missing of ['name', 'command', 'tools'] as const) {
      const { [missing]: _, ...entry } = VALID[0];
      expect(() => parseMcpServers(JSON.stringify([entry]))).toThrow(/Invalid TRELLIS_MCP_SERVERS/);
    }
  });

  it('rejects a non-array or empty command (argument vectors only, never shell strings)', () => {
    expect(() => parseMcpServers(JSON.stringify([{ ...VALID[0], command: 'python server.py' }])))
      .toThrow(/Invalid TRELLIS_MCP_SERVERS/);
    expect(() => parseMcpServers(JSON.stringify([{ ...VALID[0], command: [] }])))
      .toThrow(/Invalid TRELLIS_MCP_SERVERS/);
  });

  it('rejects an empty tool allowlist', () => {
    expect(() => parseMcpServers(JSON.stringify([{ ...VALID[0], tools: [] }])))
      .toThrow(/Invalid TRELLIS_MCP_SERVERS/);
  });

  it('rejects names that could smuggle prompt or shell structure', () => {
    // The name charset is the reason the generated prompt addendum can
    // never contain an unescaped brace or whitespace trick.
    for (const bad of ['Web Search', 'web{search}', 'UPPER', '1starts-with-digit', 'a'.repeat(65), '']) {
      expect(() => parseMcpServers(JSON.stringify([{ ...VALID[0], name: bad }])))
        .toThrow(/Invalid TRELLIS_MCP_SERVERS/);
      expect(() => parseMcpServers(JSON.stringify([{ ...VALID[0], tools: [bad] }])))
        .toThrow(/Invalid TRELLIS_MCP_SERVERS/);
    }
  });

  it('rejects non-positive, fractional, and beyond-cap bounds', () => {
    for (const bad of [
      { timeoutMs: 0 },
      { timeoutMs: -5 },
      { timeoutMs: 1.5 },
      { timeoutMs: 300_001 },
      { maxResultBytes: 0 },
      { maxResultBytes: 4 * 1024 * 1024 + 1 },
    ]) {
      expect(() => parseMcpServers(JSON.stringify([{ ...VALID[0], ...bad }])))
        .toThrow(/Invalid TRELLIS_MCP_SERVERS/);
    }
  });

  it('rejects duplicate server names', () => {
    expect(() => parseMcpServers(JSON.stringify([VALID[0], VALID[0]])))
      .toThrow(/unique/);
  });
});

describe('serializeMcpServers', () => {
  it('serializes an empty registry to undefined so the child env stays clean', () => {
    expect(serializeMcpServers([])).toBeUndefined();
  });

  it('round-trips the canonical default-filled shape', () => {
    const servers = parseMcpServers(JSON.stringify(VALID));
    const json = serializeMcpServers(servers)!;
    expect(parseMcpServers(json)).toEqual(servers);
  });
});

// The config module reads process.env exactly once at import, so these
// cases reset the module graph (the agent_bounds.test.ts pattern).
describe('config integration', () => {
  const KEY = 'TRELLIS_MCP_SERVERS';
  let savedValue: string | undefined;
  let saved = false;

  function setEnv(value: string | undefined): void {
    if (!saved) {
      savedValue = process.env[KEY];
      saved = true;
    }
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;
  }

  async function loadConfig() {
    vi.resetModules();
    const module = await import('./index');
    return module.config;
  }

  afterEach(() => {
    if (saved) {
      if (savedValue === undefined) delete process.env[KEY];
      else process.env[KEY] = savedValue;
      saved = false;
    }
    vi.resetModules();
  });

  it('defaults to an empty registry with no serialization to forward', async () => {
    setEnv(undefined);
    const config = await loadConfig();
    expect(config.mcp.servers).toEqual([]);
    expect(config.mcp.serversJson).toBeUndefined();
  });

  it('exposes the validated registry and its canonical serialization', async () => {
    setEnv(JSON.stringify(VALID));
    const config = await loadConfig();
    expect(config.mcp.servers).toHaveLength(1);
    expect(config.mcp.servers[0].name).toBe('websearch');
    expect(config.mcp.serversJson).toBe(JSON.stringify(config.mcp.servers));
  });

  it('fails startup on a malformed registry instead of silently dropping tools', async () => {
    setEnv('{oops');
    await expect(loadConfig()).rejects.toThrow(/not valid JSON/);
  });
});
