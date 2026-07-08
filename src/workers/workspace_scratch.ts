import { z } from 'zod';

// Session 16: cross-task workspace lineage (design record §5) — the
// pure half of the serialize/park/seed path. The agent writes its
// end-of-run snapshot to a worker-named temp file; the worker validates
// it here and parks it in Redis under a goal-scoped, TTL-bounded key
// (the a2a:task:<id> precedent); a later task in the SAME goal names
// prior task ids and the worker resolves, merges, and re-validates them
// into one seed snapshot the agent restores at spawn. Redis is a
// parking lot for checkpoints, never a live store the model queries —
// tasks in one batch stay independent; inheritance runs between
// iterations.
//
// Everything here is pure (schema, merge, summaries, key names) so the
// contract is pinned by unit test; the worker owns all I/O.

// The Python snapshot's segment shape (trellis_workspace.py capture):
// wrapper-owned origin stamps plus the content itself. goalId/taskId
// correlation stamps are optional. Python re-validates the seed with
// its own twin checks (including the bytes-matches-content integrity
// check); this schema keeps obviously torn or non-snapshot payloads out
// of Redis in the first place.
const WorkspaceSegmentSchema = z.object({
  origin: z.object({
    server: z.string(),
    tool: z.string(),
    argsHash: z.string(),
  }),
  fetchedAt: z.string(),
  bytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  content: z.string(),
  goalId: z.string().optional(),
  taskId: z.string().optional(),
});

export const WorkspaceSnapshotSchema = z.object({
  version: z.literal(1),
  /** Arbitrary plain JSON — set_plan accepts any JSON-serializable value. */
  plan: z.unknown(),
  notes: z.array(z.string().min(1)),
  segments: z.record(z.string(), WorkspaceSegmentSchema),
});

export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;

/**
 * Counts-only summary of a parked snapshot, carried on the job
 * completion value and rendered into the orchestrator's observations.
 * Never content (T16 house style; the orchestrator routes by reference).
 */
export interface WorkspaceRef {
  taskId: string;
  segments: number;
  bytes: number;
}

/** Redis key for one task's parked snapshot. */
export function scratchKey(goalId: string, taskId: string): string {
  return `scratch:goal:${goalId}:task:${taskId}`;
}

/** Redis key for the goal-scoped parked-bytes counter (expires alongside). */
export function scratchBytesKey(goalId: string): string {
  return `scratch:goal:${goalId}:bytes`;
}

/** Serialized size of a snapshot — what the per-goal parked-bytes cap meters. */
export function snapshotBytes(snapshot: WorkspaceSnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
}

export function workspaceRefFor(taskId: string, snapshot: WorkspaceSnapshot): WorkspaceRef {
  return {
    taskId,
    segments: Object.keys(snapshot.segments).length,
    bytes: snapshotBytes(snapshot),
  };
}

/**
 * Parses one serialized snapshot; throws a readable error on anything
 * that is not a well-formed version-1 workspace snapshot. `where` names
 * the source (the temp file, a Redis key) so a failure is diagnosable.
 */
export function parseWorkspaceSnapshot(raw: string, where: string): WorkspaceSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Workspace snapshot from ${where} is not valid JSON`);
  }
  const result = WorkspaceSnapshotSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Workspace snapshot from ${where} is malformed: ${z.prettifyError(result.error)}`
    );
  }
  return result.data;
}

/**
 * Merges parked snapshots, in seed order, into the single seed the
 * agent restores. Notes concatenate; the LAST seed with a non-default
 * plan wins (a plan is one coherent value, not a mergeable list); the
 * segments union keeps the first occurrence of a segment id — segment
 * ids are uuid4, so a collision only happens when two seeds share a
 * common ancestor snapshot, in which case the records are identical.
 */
export function mergeSnapshots(snapshots: readonly WorkspaceSnapshot[]): WorkspaceSnapshot {
  const merged: WorkspaceSnapshot = { version: 1, plan: [], notes: [], segments: {} };
  for (const snapshot of snapshots) {
    if (JSON.stringify(snapshot.plan) !== '[]') {
      merged.plan = snapshot.plan;
    }
    merged.notes.push(...snapshot.notes);
    for (const [segmentId, segment] of Object.entries(snapshot.segments)) {
      if (!(segmentId in merged.segments)) {
        merged.segments[segmentId] = segment;
      }
    }
  }
  return merged;
}
