import { describe, expect, it } from 'vitest';
import {
  A2A_CONTENT_TYPE_NOT_SUPPORTED,
  A2A_MAX_GOAL_CHARS,
  A2A_MAX_PARTS,
  A2A_SUPPORTED_VERSION,
  A2A_UNSUPPORTED_OPERATION,
  JSONRPC_INVALID_PARAMS,
  JsonRpcRequestSchema,
  checkA2aVersion,
  classifyMethod,
  errorInfo,
  jsonRpcError,
  jsonRpcResult,
  parseSendMessage,
  parseTaskRef,
} from './protocol';

// Session 11: the inbound A2A protocol boundary, pinned like the T8 LLM
// boundary — every envelope, method, and parameter shape is validated
// before it can influence dispatch (Guardrail 7).

function sendParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message: {
      messageId: 'msg-1',
      role: 'ROLE_USER',
      parts: [{ text: 'probe the graph' }],
      ...(overrides.message as Record<string, unknown> | undefined),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'message')),
  };
}

describe('JSON-RPC envelope validation', () => {
  it('accepts a well-formed request with string or numeric id', () => {
    for (const id of ['req-1', 7]) {
      const parsed = JsonRpcRequestSchema.safeParse({
        jsonrpc: '2.0',
        id,
        method: 'SendMessage',
        params: {},
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('rejects missing jsonrpc marker, wrong version, missing id, and missing method', () => {
    for (const bad of [
      { id: 1, method: 'GetTask' },
      { jsonrpc: '1.0', id: 1, method: 'GetTask' },
      { jsonrpc: '2.0', method: 'GetTask' },
      { jsonrpc: '2.0', id: 1 },
      { jsonrpc: '2.0', id: 1, method: '' },
      'not an object',
      42,
      null,
    ]) {
      expect(JsonRpcRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('builds spec-shaped result and error envelopes', () => {
    expect(jsonRpcResult('req-1', { task: { id: 't' } })).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { task: { id: 't' } },
    });
    expect(jsonRpcError(3, -32601, 'Method not found')).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32601, message: 'Method not found' },
    });
    // A parse failure has no readable id: the spec's null-id error shape.
    const withData = jsonRpcError(null, -32009, 'Version not supported', [
      errorInfo('VERSION_NOT_SUPPORTED', { supportedVersions: A2A_SUPPORTED_VERSION }),
    ]);
    expect(withData.id).toBeNull();
    expect((withData.error as any).data[0]['@type']).toBe(
      'type.googleapis.com/google.rpc.ErrorInfo'
    );
  });
});

describe('A2A version negotiation', () => {
  it('accepts exactly the supported Major.Minor', () => {
    expect(checkA2aVersion('1.0')).toEqual({ ok: true });
    expect(checkA2aVersion(' 1.0 ')).toEqual({ ok: true });
  });

  it('treats an absent or empty header as a 0.3 client and rejects it', () => {
    expect(checkA2aVersion(undefined)).toEqual({ ok: false, requested: '0.3' });
    expect(checkA2aVersion('')).toEqual({ ok: false, requested: '0.3' });
    expect(checkA2aVersion('  ')).toEqual({ ok: false, requested: '0.3' });
  });

  it('rejects other versions, including patch-qualified ones', () => {
    for (const bad of ['0.3', '1.0.0', '1.1', '2.0']) {
      expect(checkA2aVersion(bad)).toEqual({ ok: false, requested: bad });
    }
  });
});

describe('method classification', () => {
  it('recognizes the four supported methods', () => {
    for (const method of ['SendMessage', 'SendStreamingMessage', 'GetTask', 'CancelTask']) {
      expect(classifyMethod(method)).toEqual({ kind: 'supported', method });
    }
  });

  it('routes push-notification config methods to their typed decline', () => {
    for (const method of [
      'CreateTaskPushNotificationConfig',
      'GetTaskPushNotificationConfig',
      'ListTaskPushNotificationConfigs',
      'DeleteTaskPushNotificationConfig',
    ]) {
      expect(classifyMethod(method)).toEqual({ kind: 'push_notification' });
    }
  });

  it('declines spec methods this server does not offer', () => {
    for (const method of ['ListTasks', 'SubscribeToTask', 'GetExtendedAgentCard']) {
      expect(classifyMethod(method)).toEqual({ kind: 'declined' });
    }
  });

  it('reports anything else as unknown', () => {
    for (const method of ['message/send', 'tasks/get', 'DropTables', '']) {
      expect(classifyMethod(method)).toEqual({ kind: 'unknown' });
    }
  });
});

describe('parseSendMessage', () => {
  const opts = { oracleEnabled: false };

  it('extracts the goal text from one or more text parts', () => {
    const single = parseSendMessage(sendParams(), opts);
    expect(single).toMatchObject({ ok: true, goalText: 'probe the graph', messageId: 'msg-1' });

    const multi = parseSendMessage(
      sendParams({
        message: {
          messageId: 'msg-2',
          role: 'ROLE_USER',
          parts: [{ text: 'first line' }, { text: 'second line', mediaType: 'text/plain' }],
        },
      }),
      opts
    );
    expect(multi).toMatchObject({ ok: true, goalText: 'first line\nsecond line' });
  });

  it('defaults to blocking execution and honors returnImmediately', () => {
    expect(parseSendMessage(sendParams(), opts)).toMatchObject({ returnImmediately: false });
    expect(
      parseSendMessage(sendParams({ configuration: { returnImmediately: true } }), opts)
    ).toMatchObject({ returnImmediately: true });
    expect(
      parseSendMessage(sendParams({ configuration: { returnImmediately: false } }), opts)
    ).toMatchObject({ returnImmediately: false });
  });

  it('rejects structural failures as invalid params', () => {
    for (const bad of [
      undefined,
      null,
      {},
      { message: {} },
      { message: { messageId: '', role: 'ROLE_USER', parts: [{ text: 'x' }] } },
      { message: { messageId: 'm', role: 'ROLE_USER', parts: [] } },
    ]) {
      expect(parseSendMessage(bad, opts)).toMatchObject({
        ok: false,
        code: JSONRPC_INVALID_PARAMS,
      });
    }
  });

  it('rejects non-user roles and oversized part batches', () => {
    expect(
      parseSendMessage(
        sendParams({ message: { messageId: 'm', role: 'ROLE_AGENT', parts: [{ text: 'x' }] } }),
        opts
      )
    ).toMatchObject({ ok: false, code: JSONRPC_INVALID_PARAMS });

    const tooManyParts = Array.from({ length: A2A_MAX_PARTS + 1 }, () => ({ text: 'x' }));
    expect(
      parseSendMessage(
        sendParams({ message: { messageId: 'm', role: 'ROLE_USER', parts: tooManyParts } }),
        opts
      )
    ).toMatchObject({ ok: false, code: JSONRPC_INVALID_PARAMS });
  });

  it('declines multi-turn task references and client contexts as unsupported', () => {
    expect(
      parseSendMessage(
        sendParams({
          message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'x' }], taskId: 't-1' },
        }),
        opts
      )
    ).toMatchObject({ ok: false, code: A2A_UNSUPPORTED_OPERATION });
    expect(
      parseSendMessage(
        sendParams({
          message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'x' }], contextId: 'c-1' },
        }),
        opts
      )
    ).toMatchObject({ ok: false, code: A2A_UNSUPPORTED_OPERATION });
  });

  it('declines file, url, and structured-data parts as unsupported content', () => {
    for (const part of [
      { raw: 'aGVsbG8=' },
      { url: 'https://example.com/file.pdf' },
      { data: { structured: true } },
      { text: 'x', mediaType: 'application/json' },
    ]) {
      expect(
        parseSendMessage(
          sendParams({ message: { messageId: 'm', role: 'ROLE_USER', parts: [part] } }),
          opts
        )
      ).toMatchObject({ ok: false, code: A2A_CONTENT_TYPE_NOT_SUPPORTED });
    }
  });

  it('rejects tenant routing and empty or oversized goal text', () => {
    expect(parseSendMessage(sendParams({ tenant: 'other-agent' }), opts)).toMatchObject({
      ok: false,
      code: JSONRPC_INVALID_PARAMS,
    });
    expect(
      parseSendMessage(
        sendParams({ message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: '   ' }] } }),
        opts
      )
    ).toMatchObject({ ok: false, code: JSONRPC_INVALID_PARAMS });
    expect(
      parseSendMessage(
        sendParams({
          message: {
            messageId: 'm',
            role: 'ROLE_USER',
            parts: [{ text: 'g'.repeat(A2A_MAX_GOAL_CHARS + 1) }],
          },
        }),
        opts
      )
    ).toMatchObject({ ok: false, code: JSONRPC_INVALID_PARAMS });
  });

  it('rejects oracle metadata unless drill mode is enabled', () => {
    const withOracle = sendParams({
      metadata: { oracle: { steps: [{ decision: { action: 'finish', finalAnswer: 'x' } }] } },
    });
    expect(parseSendMessage(withOracle, { oracleEnabled: false })).toMatchObject({
      ok: false,
      code: JSONRPC_INVALID_PARAMS,
    });
    const allowed = parseSendMessage(withOracle, { oracleEnabled: true });
    expect(allowed).toMatchObject({ ok: true });
    expect((allowed as any).oracle.steps).toHaveLength(1);
  });

  it('rejects malformed oracle metadata even in drill mode', () => {
    expect(
      parseSendMessage(sendParams({ metadata: { oracle: 'not-a-script' } }), {
        oracleEnabled: true,
      })
    ).toMatchObject({ ok: false, code: JSONRPC_INVALID_PARAMS });
  });

  it('never emits an oracle field for goals without oracle metadata', () => {
    const parsed = parseSendMessage(sendParams(), { oracleEnabled: true });
    expect(parsed).toMatchObject({ ok: true });
    expect('oracle' in (parsed as any)).toBe(false);
  });
});

describe('parseTaskRef', () => {
  it('extracts the task id and tolerates historyLength', () => {
    expect(parseTaskRef({ id: 'task-1' })).toEqual({ ok: true, taskId: 'task-1' });
    expect(parseTaskRef({ id: 'task-1', historyLength: 0 })).toEqual({ ok: true, taskId: 'task-1' });
  });

  it('rejects missing/empty ids and tenant routing', () => {
    for (const bad of [undefined, {}, { id: '' }, { id: 42 }]) {
      expect(parseTaskRef(bad)).toMatchObject({ ok: false, code: JSONRPC_INVALID_PARAMS });
    }
    expect(parseTaskRef({ id: 'task-1', tenant: 'x' })).toMatchObject({
      ok: false,
      code: JSONRPC_INVALID_PARAMS,
    });
  });
});
