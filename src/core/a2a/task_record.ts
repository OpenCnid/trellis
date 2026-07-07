import { z } from 'zod';

// Session 11: the pure translation between the Session 9 goal lifecycle
// and the A2A v1.0 task model. One agentic goal is one A2A task; goal
// events observed on agent-stream:<goalId> drive a small record state
// machine, and rendering functions map records/events onto the spec's
// ProtoJSON wire shapes (Task, TaskStatusUpdateEvent,
// TaskArtifactUpdateEvent). No I/O here — the Express layer owns Redis
// and SSE; this module owns every wire byte's shape.
//
// State mapping:
//   enqueued                      -> TASK_STATE_SUBMITTED
//   goal_started / decision /
//   task_started / task_result    -> TASK_STATE_WORKING
//   goal_completed                -> TASK_STATE_COMPLETED + one text artifact
//   goal_failed (typed failure)   -> TASK_STATE_FAILED + status message
//
// TASK_STATE_CANCELED / REJECTED / INPUT_REQUIRED / AUTH_REQUIRED are
// never produced: the loop has no abort path, admission failures never
// create a task, and goals are one-shot (HANDOFF §8).

export const A2A_TASK_STATES = [
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
] as const;

export type A2aTaskState = (typeof A2A_TASK_STATES)[number];

export const A2aTaskRecordSchema = z.object({
  /** Task id — identical to the goalId minted at dispatch. */
  id: z.string().min(1),
  /** Server-generated context id (spec §3.4.1); one per task. */
  contextId: z.string().min(1),
  state: z.enum(A2A_TASK_STATES),
  finalAnswer: z.string().nullable(),
  failure: z.object({ kind: z.string(), reason: z.string() }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type A2aTaskRecord = z.infer<typeof A2aTaskRecordSchema>;

export function newTaskRecord(id: string, contextId: string, now: string): A2aTaskRecord {
  return {
    id,
    contextId,
    state: 'TASK_STATE_SUBMITTED',
    finalAnswer: null,
    failure: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function isTerminalTaskState(state: A2aTaskState): boolean {
  return state === 'TASK_STATE_COMPLETED' || state === 'TASK_STATE_FAILED';
}

/** Round-trips a stored record; null on any malformed payload. */
export function parseTaskRecord(raw: string): A2aTaskRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = A2aTaskRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

// Goal events arrive as already-published JSON from the agent worker;
// the record transition validates just what it consumes so a malformed
// or future event degrades to "no transition", never a crash.
const GoalEventSchema = z.looseObject({
  type: z.string(),
  finalAnswer: z.string().optional(),
  failure: z.looseObject({ kind: z.string(), reason: z.string() }).optional(),
});

const WORKING_EVENT_TYPES = new Set(['goal_started', 'decision', 'task_started', 'task_result']);

/**
 * Applies one observed goal event to a task record. Pure and total:
 * terminal records never regress, unknown events are ignored, and the
 * five typed GoalFailureKinds all land as TASK_STATE_FAILED with the
 * typed reason preserved.
 */
export function applyAgentEvent(record: A2aTaskRecord, event: unknown, now: string): A2aTaskRecord {
  if (isTerminalTaskState(record.state)) return record;
  const parsed = GoalEventSchema.safeParse(event);
  if (!parsed.success) return record;
  const goalEvent = parsed.data;

  if (WORKING_EVENT_TYPES.has(goalEvent.type)) {
    return { ...record, state: 'TASK_STATE_WORKING', updatedAt: now };
  }
  if (goalEvent.type === 'goal_completed') {
    return {
      ...record,
      state: 'TASK_STATE_COMPLETED',
      finalAnswer: goalEvent.finalAnswer ?? '',
      updatedAt: now,
    };
  }
  if (goalEvent.type === 'goal_failed') {
    return {
      ...record,
      state: 'TASK_STATE_FAILED',
      failure: {
        kind: goalEvent.failure?.kind ?? 'unknown',
        reason: goalEvent.failure?.reason ?? 'goal failed without a typed reason',
      },
      updatedAt: now,
    };
  }
  return record;
}

// --- Wire rendering (ProtoJSON shapes, spec §4.1/§4.2) -------------------

function failureStatusMessage(record: A2aTaskRecord): Record<string, unknown> | undefined {
  if (!record.failure) return undefined;
  return {
    messageId: `msg-${record.id}-status`,
    role: 'ROLE_AGENT',
    parts: [{ text: `${record.failure.kind}: ${record.failure.reason}` }],
  };
}

function renderStatus(record: A2aTaskRecord): Record<string, unknown> {
  const message = failureStatusMessage(record);
  return {
    state: record.state,
    timestamp: record.updatedAt,
    ...(message !== undefined && { message }),
  };
}

function renderArtifact(record: A2aTaskRecord): Record<string, unknown> {
  return {
    artifactId: `artifact-${record.id}`,
    name: 'goal-answer',
    parts: [{ text: record.finalAnswer ?? '' }],
  };
}

/** The spec Task object for SendMessage results and GetTask polling. */
export function renderTask(record: A2aTaskRecord): Record<string, unknown> {
  return {
    id: record.id,
    contextId: record.contextId,
    status: renderStatus(record),
    ...(record.state === 'TASK_STATE_COMPLETED' && { artifacts: [renderArtifact(record)] }),
  };
}

/**
 * StreamResponse payloads for one observed goal event, given the record
 * AFTER the event was applied. Progress events each yield one WORKING
 * status update (ids and states only — goal/task text never crosses
 * into A2A frames mid-flight); completion yields the answer artifact
 * (lastChunk) then the terminal status; failure yields the terminal
 * status carrying the typed reason. The stream MUST close after a
 * terminal status frame (spec §3.1.2).
 */
export function streamFramesFor(event: unknown, record: A2aTaskRecord): Record<string, unknown>[] {
  const parsed = GoalEventSchema.safeParse(event);
  if (!parsed.success) return [];
  const type = parsed.data.type;

  const statusUpdate = {
    statusUpdate: {
      taskId: record.id,
      contextId: record.contextId,
      status: renderStatus(record),
    },
  };

  if (WORKING_EVENT_TYPES.has(type)) return [statusUpdate];
  if (type === 'goal_completed') {
    return [
      {
        artifactUpdate: {
          taskId: record.id,
          contextId: record.contextId,
          artifact: renderArtifact(record),
          lastChunk: true,
        },
      },
      statusUpdate,
    ];
  }
  if (type === 'goal_failed') return [statusUpdate];
  return [];
}
