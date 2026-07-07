import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPrivateMcpHost,
  parseMcpServers,
  resolveMcpCredentialEnv,
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

const VALID_HTTP = {
  transport: 'http',
  name: 'remote',
  url: 'https://tools.example.com/mcp',
  tools: ['web_search'],
};

describe('parseMcpServers', () => {
  it('treats unset and blank values as an empty registry', () => {
    expect(parseMcpServers(undefined)).toEqual([]);
    expect(parseMcpServers('')).toEqual([]);
    expect(parseMcpServers('   ')).toEqual([]);
  });

  it('parses a pre-Session-12 registry unchanged, defaulting transport to stdio', () => {
    const servers = parseMcpServers(JSON.stringify(VALID));
    expect(servers).toEqual([
      {
        transport: 'stdio',
        name: 'websearch',
        command: ['python', 'scripts/fixture_mcp_server.py'],
        tools: ['web_search'],
        timeoutMs: MCP_TIMEOUT_MS_DEFAULT,
        maxResultBytes: MCP_MAX_RESULT_BYTES_DEFAULT,
      },
    ]);
    // An explicit transport parses to the identical shape.
    expect(parseMcpServers(JSON.stringify([{ transport: 'stdio', ...VALID[0] }]))).toEqual(servers);
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

  it('rejects duplicate names across transports', () => {
    expect(() =>
      parseMcpServers(JSON.stringify([VALID[0], { ...VALID_HTTP, name: 'websearch' }]))
    ).toThrow(/unique/);
  });

  it('rejects unknown transports', () => {
    expect(() => parseMcpServers(JSON.stringify([{ ...VALID[0], transport: 'sse' }])))
      .toThrow(/Invalid TRELLIS_MCP_SERVERS/);
  });

  // --- Session 12: the http transport variant ---------------------------

  it('parses an http server with default bounds and no auth', () => {
    const servers = parseMcpServers(JSON.stringify([VALID_HTTP]));
    expect(servers).toEqual([
      {
        transport: 'http',
        name: 'remote',
        url: 'https://tools.example.com/mcp',
        tools: ['web_search'],
        timeoutMs: MCP_TIMEOUT_MS_DEFAULT,
        maxResultBytes: MCP_MAX_RESULT_BYTES_DEFAULT,
      },
    ]);
  });

  it('requires a url (and no command) on http servers', () => {
    const { url: _, ...noUrl } = VALID_HTTP;
    expect(() => parseMcpServers(JSON.stringify([noUrl]))).toThrow(/Invalid TRELLIS_MCP_SERVERS/);
    expect(() => parseMcpServers(JSON.stringify([{ ...noUrl, command: ['python'] }])))
      .toThrow(/Invalid TRELLIS_MCP_SERVERS/);
  });

  it('rejects non-http(s) schemes and malformed URLs', () => {
    for (const bad of ['ftp://tools.example.com/mcp', 'file:///etc/passwd', 'not a url', '']) {
      expect(() => parseMcpServers(JSON.stringify([{ ...VALID_HTTP, url: bad }])))
        .toThrow(/Invalid TRELLIS_MCP_SERVERS/);
    }
  });

  it('allows plain http only for loopback, RFC1918, and dot-free hosts', () => {
    for (const ok of [
      'http://127.0.0.1:8765/mcp',
      'http://localhost:8765/mcp',
      'http://10.2.3.4/mcp',
      'http://192.168.1.10:9000/mcp',
      'http://172.16.0.1/mcp',
      'http://mcp-fixture:9500/mcp',
    ]) {
      expect(parseMcpServers(JSON.stringify([{ ...VALID_HTTP, url: ok }]))[0]).toMatchObject({
        transport: 'http',
        url: ok,
      });
    }
    for (const bad of [
      'http://tools.example.com/mcp',
      'http://8.8.8.8/mcp',
      'http://172.32.0.1/mcp', // just outside 172.16/12
    ]) {
      expect(() => parseMcpServers(JSON.stringify([{ ...VALID_HTTP, url: bad }])))
        .toThrow(/plain http/);
    }
  });

  it('parses bearer and header auth carrying only the env var NAME', () => {
    const bearer = parseMcpServers(
      JSON.stringify([{ ...VALID_HTTP, auth: { kind: 'bearer', valueEnv: 'MCP_REMOTE_TOKEN' } }])
    );
    expect(bearer[0]).toMatchObject({ auth: { kind: 'bearer', valueEnv: 'MCP_REMOTE_TOKEN' } });
    const header = parseMcpServers(
      JSON.stringify([
        { ...VALID_HTTP, auth: { kind: 'header', header: 'x-api-key', valueEnv: 'MCP_REMOTE_TOKEN' } },
      ])
    );
    expect(header[0]).toMatchObject({
      auth: { kind: 'header', header: 'x-api-key', valueEnv: 'MCP_REMOTE_TOKEN' },
    });
  });

  it('rejects inconsistent or unsafe auth shapes', () => {
    for (const bad of [
      { kind: 'header', valueEnv: 'TOKEN' }, // header kind without a header name
      { kind: 'bearer', header: 'x-api-key', valueEnv: 'TOKEN' }, // bearer with a header name
      { kind: 'bearer', valueEnv: 'lowercase' }, // not an env var name
      { kind: 'bearer', valueEnv: '1TOKEN' },
      { kind: 'basic', valueEnv: 'TOKEN' }, // unsupported kind
      { kind: 'header', header: 'x api key', valueEnv: 'TOKEN' }, // header charset
      { kind: 'bearer' }, // no credential reference at all
    ]) {
      expect(() => parseMcpServers(JSON.stringify([{ ...VALID_HTTP, auth: bad }])))
        .toThrow(/Invalid TRELLIS_MCP_SERVERS/);
    }
  });

  it('strips unknown auth keys so an inline credential value can never ride along', () => {
    const servers = parseMcpServers(
      JSON.stringify([
        { ...VALID_HTTP, auth: { kind: 'bearer', valueEnv: 'TOKEN', value: 'inline-secret' } },
      ])
    );
    expect(JSON.stringify(servers)).not.toContain('inline-secret');
  });
});

describe('isPrivateMcpHost', () => {
  it('matches the documented private posture exactly', () => {
    for (const priv of ['localhost', '127.0.0.1', '127.9.9.9', '10.0.0.1', '192.168.0.1', '172.16.0.1', '172.31.255.255', 'mcp-fixture', '::1']) {
      expect(isPrivateMcpHost(priv), priv).toBe(true);
    }
    for (const pub of ['example.com', 'tools.internal.corp', '8.8.8.8', '172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.0.1', '999.1.1.300']) {
      expect(isPrivateMcpHost(pub), pub).toBe(false);
    }
  });
});

describe('resolveMcpCredentialEnv', () => {
  const HTTP_WITH_AUTH = {
    ...VALID_HTTP,
    auth: { kind: 'bearer', valueEnv: 'MCP_REMOTE_TOKEN' },
  };

  it('resolves exactly the named variables', () => {
    const servers = parseMcpServers(JSON.stringify([VALID[0], HTTP_WITH_AUTH]));
    const resolved = resolveMcpCredentialEnv(servers, {
      MCP_REMOTE_TOKEN: 'secret-value',
      UNRELATED: 'noise',
    });
    expect(resolved).toEqual({ MCP_REMOTE_TOKEN: 'secret-value' });
  });

  it('returns an empty map for stdio-only and auth-free registries', () => {
    const servers = parseMcpServers(JSON.stringify([VALID[0], VALID_HTTP]));
    expect(resolveMcpCredentialEnv(servers, {})).toEqual({});
  });

  it('fails fast on a missing or empty credential variable, naming it without its value', () => {
    const servers = parseMcpServers(JSON.stringify([HTTP_WITH_AUTH]));
    expect(() => resolveMcpCredentialEnv(servers, {})).toThrow(/MCP_REMOTE_TOKEN.*remote/);
    expect(() => resolveMcpCredentialEnv(servers, { MCP_REMOTE_TOKEN: '' }))
      .toThrow(/MCP_REMOTE_TOKEN/);
  });

  it('allows two servers to share one credential variable', () => {
    const servers = parseMcpServers(
      JSON.stringify([HTTP_WITH_AUTH, { ...HTTP_WITH_AUTH, name: 'remote2' }])
    );
    expect(resolveMcpCredentialEnv(servers, { MCP_REMOTE_TOKEN: 'v' }))
      .toEqual({ MCP_REMOTE_TOKEN: 'v' });
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
