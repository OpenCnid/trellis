import { z } from 'zod';

// Session 10: the operator-configured MCP server registry. The RLM
// sub-agent's external tool surface comes from this validated value and
// nowhere else — no queue payload, model completion, or REPL string can
// name or spawn a server or tool outside it (Guardrail 5).
//
// The registry is a JSON array in the TRELLIS_MCP_SERVERS env var.
// src/config/index.ts validates it once at startup; rlm_worker.ts
// forwards the canonical re-serialization to the spawned Python agent,
// which re-validates it defensively in src/rlm/trellis_mcp.py. The two
// validators must stay bound-for-bound identical.
//
// Session 12: the registry is a union discriminated on `transport`.
// `stdio` (the default when the field is absent, so every pre-Session-12
// registry parses unchanged) spawns a child process from an argument
// vector; `http` dials a remote server over the MCP Streamable HTTP
// transport, optionally with an operator-owned credential referenced by
// environment-variable NAME only — the value never sits in the registry.

// Server and tool names appear verbatim in the RLM system prompt
// addendum, which rlms runs .format() over — so the charset is locked
// down hard enough that a name can never contain a curly brace,
// whitespace trick, or control character. Lowercase alphanumerics plus
// - and _, starting with a letter.
export const MCP_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

// Credential references are conventional environment variable names.
export const MCP_VALUE_ENV_PATTERN = /^[A-Z][A-Z0-9_]*$/;

// Custom auth header names: HTTP token charset, conservatively.
export const MCP_HEADER_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/;

// Per-call bounds. A hung or oversized MCP server must degrade to a
// raised tool error, never a hung RLM run (Guardrail 6).
export const MCP_TIMEOUT_MS_MAX = 300_000;
export const MCP_TIMEOUT_MS_DEFAULT = 10_000;
export const MCP_MAX_RESULT_BYTES_MAX = 4 * 1024 * 1024;
export const MCP_MAX_RESULT_BYTES_DEFAULT = 64 * 1024;

/**
 * Plain-http posture (mirrored bound-for-bound in trellis_mcp.py):
 * `https://` is always acceptable; `http://` only where the traffic
 * cannot leave operator-controlled networks — loopback, RFC1918 private
 * addresses, or dot-free hostnames (Compose/LAN service DNS). Anything
 * else must be https so a bearer credential is never sent in cleartext
 * across a public network.
 */
export function isPrivateMcpHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const octets = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (octets) {
    const [a, b] = [Number(octets[1]), Number(octets[2])];
    if ([a, b, Number(octets[3]), Number(octets[4])].some(o => o > 255)) return false;
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  // Dot-free names resolve only on a local/private network (Compose
  // service DNS, LAN hosts) — never on the public internet.
  return !host.includes('.');
}

function validateMcpUrl(url: string, ctx: z.RefinementCtx): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    ctx.addIssue({ code: 'custom', message: `url ${JSON.stringify(url)} is not a valid URL` });
    return;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    ctx.addIssue({ code: 'custom', message: 'url must use http(s)' });
    return;
  }
  if (parsed.protocol === 'http:' && !isPrivateMcpHost(parsed.hostname)) {
    ctx.addIssue({
      code: 'custom',
      message:
        'plain http is allowed only for loopback, RFC1918, or dot-free (private-network) hosts; use https',
    });
  }
}

export const McpAuthSchema = z
  .object({
    kind: z.enum(['bearer', 'header']),
    /** Header name for kind 'header'; 'bearer' sends Authorization: Bearer. */
    header: z.string().min(1).max(64).regex(MCP_HEADER_PATTERN).optional(),
    /**
     * NAME of the environment variable holding the credential value. The
     * worker resolves it at startup (fail-fast if missing) and forwards
     * exactly the named variables to the spawned agent, which resolves
     * the value from its own environment. The value itself never appears
     * in the registry, logs, prompts, or error messages.
     */
    valueEnv: z.string().min(1).max(128).regex(MCP_VALUE_ENV_PATTERN),
  })
  .superRefine((auth, ctx) => {
    if (auth.kind === 'header' && auth.header === undefined) {
      ctx.addIssue({ code: 'custom', message: "auth kind 'header' requires a header name" });
    }
    if (auth.kind === 'bearer' && auth.header !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: "auth kind 'bearer' sends the Authorization header; do not set 'header'",
      });
    }
  });

const commonFields = {
  /** Registry key the REPL uses in call_tool(server, ...). */
  name: z.string().min(1).max(64).regex(MCP_NAME_PATTERN),
  /** Tool allowlist; anything outside it is rejected before any I/O. */
  tools: z.array(z.string().min(1).max(64).regex(MCP_NAME_PATTERN)).min(1),
  timeoutMs: z.number().int().positive().max(MCP_TIMEOUT_MS_MAX).default(MCP_TIMEOUT_MS_DEFAULT),
  maxResultBytes: z
    .number()
    .int()
    .positive()
    .max(MCP_MAX_RESULT_BYTES_MAX)
    .default(MCP_MAX_RESULT_BYTES_DEFAULT),
};

export const McpStdioServerSchema = z.object({
  transport: z.literal('stdio'),
  /** Argument vector spawned as a child of the RLM process — never a shell string. */
  command: z.array(z.string().min(1)).min(1),
  ...commonFields,
});

export const McpHttpServerSchema = z.object({
  transport: z.literal('http'),
  /** Full Streamable HTTP endpoint URL (typically ending in /mcp). */
  url: z.string().min(1).max(2048).superRefine(validateMcpUrl),
  auth: McpAuthSchema.optional(),
  ...commonFields,
});

// A missing `transport` means the pre-Session-12 stdio shape; the
// preprocess fills it in so old registry values parse byte-identically.
export const McpServerSchema = z.preprocess(
  value =>
    typeof value === 'object' && value !== null && !('transport' in value)
      ? { ...value, transport: 'stdio' }
      : value,
  z.discriminatedUnion('transport', [McpStdioServerSchema, McpHttpServerSchema])
);

export type McpServerConfig = z.infer<typeof McpServerSchema>;
export type McpHttpServerConfig = z.infer<typeof McpHttpServerSchema>;

export const McpServersSchema = z
  .array(McpServerSchema)
  .max(8)
  .refine(
    servers => new Set(servers.map(s => s.name)).size === servers.length,
    { message: 'MCP server names must be unique' }
  );

/**
 * Parses the TRELLIS_MCP_SERVERS env value. Unset or blank means no
 * servers: nothing is injected and RLM behavior is byte-identical to a
 * pre-Session-10 run. Anything else must be a valid JSON registry —
 * a malformed value fails startup rather than silently dropping tools.
 */
export function parseMcpServers(raw: string | undefined): McpServerConfig[] {
  if (raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('TRELLIS_MCP_SERVERS is not valid JSON');
  }
  const result = McpServersSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid TRELLIS_MCP_SERVERS:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * Resolves the credential environment variables the http servers name.
 * Fail-fast (Guardrail 5): a registry naming a variable the process
 * does not have is a startup error, not a mid-run tool failure. The
 * returned map is what buildAgentEnv forwards to the spawned agent —
 * exactly the named variables, nothing else. Error messages carry
 * variable NAMES only, never values.
 */
export function resolveMcpCredentialEnv(
  servers: McpServerConfig[],
  env: Record<string, string | undefined>
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  for (const server of servers) {
    if (server.transport !== 'http' || server.auth === undefined) continue;
    const name = server.auth.valueEnv;
    const value = env[name];
    if (value === undefined || value === '') {
      missing.push(`${name} (server '${server.name}')`);
    } else {
      resolved[name] = value;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `TRELLIS_MCP_SERVERS names credential environment variables that are not set: ${missing.join(', ')}`
    );
  }
  return resolved;
}

/**
 * Canonical serialization forwarded to the spawned agent's environment
 * (the NEO4J_* pattern): the Python half only ever sees the validated,
 * default-filled shape — including the explicit `transport` field.
 * Empty registry serializes to undefined so the child env carries no
 * MCP variable at all.
 */
export function serializeMcpServers(servers: McpServerConfig[]): string | undefined {
  return servers.length === 0 ? undefined : JSON.stringify(servers);
}
