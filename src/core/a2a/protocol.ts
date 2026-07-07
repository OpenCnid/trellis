import { z } from 'zod';
import { OracleScriptSchema, type OracleScript } from '../agent/oracle.js';

// Session 11: the A2A (Agent2Agent) protocol boundary, pinned to spec
// v1.0.0 (a2a-protocol.org, JSON-RPC binding §9, ProtoJSON JSON shapes
// per specification/a2a.proto). Every inbound JSON-RPC envelope and
// method parameter crosses these Zod schemas before it can influence
// anything — the same T8 discipline the LLM boundary enforces
// (Guardrail 7). Pure module: no I/O, no Express, no Redis.
//
// Scope (HANDOFF §8): Trellis is an A2A *server* for one-shot goal
// tasks. Multi-turn continuations, client-provided context ids, push
// notifications, task listing/subscription, and non-text parts are
// declined with the spec's error vocabulary, never accepted partially.

/** The only protocol version this surface speaks (spec §3.6). */
export const A2A_SUPPORTED_VERSION = '1.0';

/** Well-known discovery path (spec §8.2). */
export const AGENT_CARD_PATH = '/.well-known/agent-card.json';

/** The single JSON-RPC endpoint path advertised in the Agent Card. */
export const A2A_RPC_PATH = '/a2a/v1';

// Standard JSON-RPC 2.0 error codes (spec §9.5).
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

// A2A-specific error codes (spec §5.4).
export const A2A_TASK_NOT_FOUND = -32001;
export const A2A_TASK_NOT_CANCELABLE = -32002;
export const A2A_PUSH_NOTIFICATION_NOT_SUPPORTED = -32003;
export const A2A_UNSUPPORTED_OPERATION = -32004;
export const A2A_CONTENT_TYPE_NOT_SUPPORTED = -32005;
export const A2A_VERSION_NOT_SUPPORTED = -32009;

// Inbound size caps (Guardrail 6): a misbehaving external agent must
// degrade to protocol errors, never resource exhaustion. The express
// body limit is the outer wall; these are the semantic caps.
export const A2A_MAX_PARTS = 8;
export const A2A_MAX_GOAL_CHARS = 32_768;
export const A2A_MAX_ID_CHARS = 128;

export type JsonRpcId = string | number;

/**
 * The JSON-RPC 2.0 request envelope. Requests without an id are
 * notifications, which no A2A method can meaningfully be (every method
 * returns a result), so a missing id fails the envelope stage. Unknown
 * extra fields are ignored (spec §5.7 forward compatibility).
 */
export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string().min(1).max(A2A_MAX_ID_CHARS), z.number()]),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export function jsonRpcResult(id: JsonRpcId, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result };
}

export function jsonRpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown[]
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined && { data }) },
  };
}

/** Spec-shaped ErrorInfo detail entry for the JSON-RPC error `data` array. */
export function errorInfo(
  reason: string,
  metadata?: Record<string, string>
): Record<string, unknown> {
  return {
    '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
    reason,
    domain: 'a2a-protocol.org',
    ...(metadata !== undefined && { metadata }),
  };
}

// --- Version negotiation (spec §3.6) -----------------------------------
//
// Clients MUST send A2A-Version; servers MUST interpret an absent or
// empty value as protocol 0.3, which this surface does not speak. Only
// Major.Minor "1.0" is accepted — patch elements MUST NOT participate
// in negotiation, so "1.0.0" is rejected as sent.

export type VersionCheck = { ok: true } | { ok: false; requested: string };

export function checkA2aVersion(value: string | undefined): VersionCheck {
  const requested = (value ?? '').trim() || '0.3';
  return requested === A2A_SUPPORTED_VERSION ? { ok: true } : { ok: false, requested };
}

// --- Method classification ----------------------------------------------
//
// The full spec method vocabulary (§5.3), partitioned by how this
// server answers. Anything outside the vocabulary is a plain JSON-RPC
// method-not-found; spec methods this implementation does not offer get
// the spec's typed decline so a compliant client understands why.

export const A2A_SUPPORTED_METHODS = [
  'SendMessage',
  'SendStreamingMessage',
  'GetTask',
  'CancelTask',
] as const;

export type A2aSupportedMethod = (typeof A2A_SUPPORTED_METHODS)[number];

const PUSH_NOTIFICATION_METHODS = new Set([
  'CreateTaskPushNotificationConfig',
  'GetTaskPushNotificationConfig',
  'ListTaskPushNotificationConfigs',
  'DeleteTaskPushNotificationConfig',
]);

const DECLINED_METHODS = new Set(['ListTasks', 'SubscribeToTask', 'GetExtendedAgentCard']);

export type MethodClass =
  | { kind: 'supported'; method: A2aSupportedMethod }
  | { kind: 'push_notification' }
  | { kind: 'declined' }
  | { kind: 'unknown' };

export function classifyMethod(method: string): MethodClass {
  if ((A2A_SUPPORTED_METHODS as readonly string[]).includes(method)) {
    return { kind: 'supported', method: method as A2aSupportedMethod };
  }
  if (PUSH_NOTIFICATION_METHODS.has(method)) return { kind: 'push_notification' };
  if (DECLINED_METHODS.has(method)) return { kind: 'declined' };
  return { kind: 'unknown' };
}

// --- Method parameter schemas -------------------------------------------

// A Part is a proto oneof (text | raw | url | data). This server's
// input mode is text/plain only; the schema stays structural and the
// content decision (text vs unsupported media) happens in
// parseSendMessage so it can map to the spec's ContentTypeNotSupported
// code instead of a generic invalid-params.
const PartSchema = z.looseObject({
  text: z.string().optional(),
  raw: z.unknown().optional(),
  url: z.unknown().optional(),
  data: z.unknown().optional(),
  mediaType: z.string().optional(),
});

const InboundMessageSchema = z.looseObject({
  messageId: z.string().min(1).max(A2A_MAX_ID_CHARS),
  role: z.string(),
  parts: z.array(PartSchema).min(1).max(A2A_MAX_PARTS),
  contextId: z.string().optional(),
  taskId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const SendMessageParamsSchema = z.looseObject({
  tenant: z.string().optional(),
  message: InboundMessageSchema,
  configuration: z
    .looseObject({
      returnImmediately: z.boolean().optional(),
      historyLength: z.number().int().nonnegative().optional(),
      acceptedOutputModes: z.array(z.string()).optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const TaskIdParamsSchema = z.looseObject({
  tenant: z.string().optional(),
  id: z.string().min(1).max(A2A_MAX_ID_CHARS),
  historyLength: z.number().int().nonnegative().optional(),
});

// --- Parsed operation results -------------------------------------------

export interface ParsedSendMessage {
  ok: true;
  /** Concatenated text-part content — the ONLY payload that enters the goal loop. */
  goalText: string;
  messageId: string;
  returnImmediately: boolean;
  /** Drill-only scripted decisions; present only when oracle mode was allowed. */
  oracle?: OracleScript;
}

export interface ParseFailure {
  ok: false;
  code: number;
  message: string;
}

/**
 * Validates SendMessage / SendStreamingMessage params into the goal
 * dispatch inputs. Everything this server cannot honor is a typed
 * decline: multi-turn task references and client contexts are
 * unsupported operations, non-text parts are unsupported content, and
 * oracle metadata outside drill mode is invalid params (mirroring the
 * SSE endpoint's 400 for a disabled oracle).
 */
export function parseSendMessage(
  params: unknown,
  options: { oracleEnabled: boolean }
): ParsedSendMessage | ParseFailure {
  const parsed = SendMessageParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { ok: false, code: JSONRPC_INVALID_PARAMS, message: 'Invalid SendMessage parameters' };
  }
  const { tenant, message, configuration, metadata } = parsed.data;

  if (tenant !== undefined && tenant !== '') {
    return {
      ok: false,
      code: JSONRPC_INVALID_PARAMS,
      message: 'tenant routing is not supported by this agent',
    };
  }
  if (message.taskId !== undefined && message.taskId !== '') {
    return {
      ok: false,
      code: A2A_UNSUPPORTED_OPERATION,
      message: 'Multi-turn task continuation is not supported; goals are one-shot',
    };
  }
  if (message.contextId !== undefined && message.contextId !== '') {
    return {
      ok: false,
      code: A2A_UNSUPPORTED_OPERATION,
      message: 'Client-provided contextId values are not accepted; the server generates one per task',
    };
  }
  if (message.role !== 'ROLE_USER') {
    return {
      ok: false,
      code: JSONRPC_INVALID_PARAMS,
      message: 'message.role must be ROLE_USER',
    };
  }

  const texts: string[] = [];
  for (const part of message.parts) {
    if (part.raw !== undefined || part.url !== undefined || part.data !== undefined) {
      return {
        ok: false,
        code: A2A_CONTENT_TYPE_NOT_SUPPORTED,
        message: 'Only text parts are supported (defaultInputModes: text/plain)',
      };
    }
    if (part.mediaType !== undefined && part.mediaType !== 'text/plain') {
      return {
        ok: false,
        code: A2A_CONTENT_TYPE_NOT_SUPPORTED,
        message: `Unsupported part media type ${JSON.stringify(part.mediaType)}; only text/plain is accepted`,
      };
    }
    if (typeof part.text !== 'string' || part.text.length === 0) {
      return {
        ok: false,
        code: JSONRPC_INVALID_PARAMS,
        message: 'Every part must carry non-empty text content',
      };
    }
    texts.push(part.text);
  }

  const goalText = texts.join('\n').trim();
  if (goalText.length === 0) {
    return { ok: false, code: JSONRPC_INVALID_PARAMS, message: 'Message text is empty' };
  }
  if (goalText.length > A2A_MAX_GOAL_CHARS) {
    return {
      ok: false,
      code: JSONRPC_INVALID_PARAMS,
      message: `Message text exceeds ${A2A_MAX_GOAL_CHARS} characters`,
    };
  }

  // Drill-only oracle threading (the Session 9 SSE-endpoint posture):
  // scripted decisions ride in request metadata, are honored only when
  // AGENT_ORACLE_ENABLED=true, and are rejected — never silently
  // dropped — otherwise, so production surfaces only accept goals.
  let oracle: OracleScript | undefined;
  if (metadata !== undefined && 'oracle' in metadata) {
    if (!options.oracleEnabled) {
      return {
        ok: false,
        code: JSONRPC_INVALID_PARAMS,
        message: 'Oracle metadata is disabled (set AGENT_ORACLE_ENABLED=true for drills)',
      };
    }
    const validated = OracleScriptSchema.safeParse(metadata.oracle);
    if (!validated.success) {
      return { ok: false, code: JSONRPC_INVALID_PARAMS, message: 'Oracle metadata failed validation' };
    }
    oracle = validated.data;
  }

  return {
    ok: true,
    goalText,
    messageId: message.messageId,
    returnImmediately: configuration?.returnImmediately === true,
    ...(oracle !== undefined && { oracle }),
  };
}

export interface ParsedTaskRef {
  ok: true;
  taskId: string;
}

/** Validates GetTask / CancelTask params down to the task reference. */
export function parseTaskRef(params: unknown): ParsedTaskRef | ParseFailure {
  const parsed = TaskIdParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { ok: false, code: JSONRPC_INVALID_PARAMS, message: 'Invalid task parameters: id is required' };
  }
  if (parsed.data.tenant !== undefined && parsed.data.tenant !== '') {
    return {
      ok: false,
      code: JSONRPC_INVALID_PARAMS,
      message: 'tenant routing is not supported by this agent',
    };
  }
  return { ok: true, taskId: parsed.data.id };
}
