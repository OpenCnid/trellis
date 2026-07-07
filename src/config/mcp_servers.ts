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

// Server and tool names appear verbatim in the RLM system prompt
// addendum, which rlms runs .format() over — so the charset is locked
// down hard enough that a name can never contain a curly brace,
// whitespace trick, or control character. Lowercase alphanumerics plus
// - and _, starting with a letter.
export const MCP_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

// Per-call bounds. A hung or oversized MCP server must degrade to a
// raised tool error, never a hung RLM run (Guardrail 6).
export const MCP_TIMEOUT_MS_MAX = 300_000;
export const MCP_TIMEOUT_MS_DEFAULT = 10_000;
export const MCP_MAX_RESULT_BYTES_MAX = 4 * 1024 * 1024;
export const MCP_MAX_RESULT_BYTES_DEFAULT = 64 * 1024;

export const McpServerSchema = z.object({
  /** Registry key the REPL uses in call_tool(server, ...). */
  name: z.string().min(1).max(64).regex(MCP_NAME_PATTERN),
  /** Argument vector spawned as a child of the RLM process — never a shell string. */
  command: z.array(z.string().min(1)).min(1),
  /** Tool allowlist; anything outside it is rejected before any I/O. */
  tools: z.array(z.string().min(1).max(64).regex(MCP_NAME_PATTERN)).min(1),
  timeoutMs: z.number().int().positive().max(MCP_TIMEOUT_MS_MAX).default(MCP_TIMEOUT_MS_DEFAULT),
  maxResultBytes: z
    .number()
    .int()
    .positive()
    .max(MCP_MAX_RESULT_BYTES_MAX)
    .default(MCP_MAX_RESULT_BYTES_DEFAULT),
});

export type McpServerConfig = z.infer<typeof McpServerSchema>;

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
 * Canonical serialization forwarded to the spawned agent's environment
 * (the NEO4J_* pattern): the Python half only ever sees the validated,
 * default-filled shape. Empty registry serializes to undefined so the
 * child env carries no MCP variable at all.
 */
export function serializeMcpServers(servers: McpServerConfig[]): string | undefined {
  return servers.length === 0 ? undefined : JSON.stringify(servers);
}
