"""The Tier-3 in-REPL workspace for the Trellis RLM (Session 14).

Design record: docs/architecture/WORKSPACE_AND_MODULES.md §4. The
workspace is the RLM's harness-managed working memory: a holder object
injected via rlms `custom_tools` as `trellis_workspace` (non-callable, so
it lands in the REPL's persistent locals and survives every turn of one
completion by construction — Appendix A). Inner state is a plain
JSON-serializable, version-tagged dict — the data-not-objects contract
that makes cross-task lineage (§5) a serialization away.

Trust standing: NONE. Workspace segments hold unverified external
content and self-notes; segment ids are UUIDv4 — structurally disjoint
from AST hashes (^[0-9a-f]{64}$) — and nothing stored here ever
satisfies the provenance protocol or passes as sourceNodeIds. The
hardened write path (trellis_tools.py) enforces that independently.

Wrapper discipline (mirrors trellis_tools.py / trellis_mcp.py): every
model-visible method returns a JSON STRING and raises real exceptions
with readable messages for REPL self-correction. `capture` is
harness-side: the MCP wrapper calls it from inside `call_tool`, so
external results are deposited mechanically — capture is guaranteed at
the harness layer, never dependent on model discipline (§4.1) — and its
origin stamps are wrapper-owned: the model has no API to forge them.

Budgets are validated configuration with hard maxima (the
mcp_servers.ts discipline). Over-budget writes RAISE with current usage
and a drop() hint; stored state is never silently truncated — a torn
stored entry would poison later readers (§4.7).
"""

import json
import os
import threading
import uuid
from datetime import datetime, timezone

# Bounds: defaults and hard caps (must mirror src/config/index.ts).
WORKSPACE_MAX_SEGMENTS_DEFAULT = 128
WORKSPACE_MAX_SEGMENTS_CAP = 1024
WORKSPACE_MAX_BYTES_DEFAULT = 4 * 1024 * 1024
WORKSPACE_MAX_BYTES_CAP = 32 * 1024 * 1024

# Stub previews are a thin control channel: enough to recognize a
# result, never enough to substitute for reading the segment (§4.3).
WORKSPACE_PREVIEW_CHARS = 500


class WorkspaceBudgetError(Exception):
    """Raised when a write would exceed the workspace budget. The
    message carries current usage so the REPL loop can self-correct by
    dropping segments it no longer needs."""


def _require_bound(value, name, default, cap):
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError(
            f"Invalid {name}: must be a positive integer <= {cap}, got {value!r}."
        ) from None
    if isinstance(value, bool) or not 0 < parsed <= cap:
        raise ValueError(
            f"Invalid {name}: must be a positive integer <= {cap}, got {value!r}."
        )
    return parsed


def parse_workspace_bounds(environ=None):
    """Defensive re-validation of the worker-forwarded bounds (the
    parse_mcp_config precedent): same defaults and hard caps as the Zod
    schema; a value passing one validator and not the other is a
    defect. Returns (max_segments, max_bytes)."""
    env = os.environ if environ is None else environ
    return (
        _require_bound(
            env.get("TRELLIS_WORKSPACE_MAX_SEGMENTS"),
            "TRELLIS_WORKSPACE_MAX_SEGMENTS",
            WORKSPACE_MAX_SEGMENTS_DEFAULT,
            WORKSPACE_MAX_SEGMENTS_CAP,
        ),
        _require_bound(
            env.get("TRELLIS_WORKSPACE_MAX_BYTES"),
            "TRELLIS_WORKSPACE_MAX_BYTES",
            WORKSPACE_MAX_BYTES_DEFAULT,
            WORKSPACE_MAX_BYTES_CAP,
        ),
    )


def _utf8_len(text):
    return len(text.encode("utf-8"))


class TrellisWorkspace:
    """The injected Tier-3 holder. State lives in one plain dict
    (`version`/`plan`/`notes`/`segments`); the holder is transport, the
    dict is the interface (§4.5)."""

    def __init__(self, max_segments=None, max_bytes=None, goal_id=None, task_id=None):
        self._max_segments = _require_bound(
            max_segments, "workspace max_segments",
            WORKSPACE_MAX_SEGMENTS_DEFAULT, WORKSPACE_MAX_SEGMENTS_CAP)
        self._max_bytes = _require_bound(
            max_bytes, "workspace max_bytes",
            WORKSPACE_MAX_BYTES_DEFAULT, WORKSPACE_MAX_BYTES_CAP)
        self._goal_id = goal_id or None
        self._task_id = task_id or None
        self._lock = threading.RLock()
        self._ops = 0
        self._plan_bytes = 0
        self._note_bytes = 0
        self._state = {"version": 1, "plan": [], "notes": [], "segments": {}}

    # --- internal accounting ------------------------------------------

    def _count_op(self):
        with self._lock:
            self._ops += 1

    def _segment_bytes(self):
        return sum(seg["bytes"] for seg in self._state["segments"].values())

    def _total_bytes(self):
        return self._segment_bytes() + self._plan_bytes + self._note_bytes

    def _usage(self):
        return {
            "segments": len(self._state["segments"]),
            "maxSegments": self._max_segments,
            "bytes": self._total_bytes(),
            "maxBytes": self._max_bytes,
        }

    def _require_byte_budget(self, incoming_bytes, what):
        if self._total_bytes() + incoming_bytes > self._max_bytes:
            raise WorkspaceBudgetError(
                f"Workspace byte budget exceeded: storing this {what} ({incoming_bytes} bytes) "
                f"would pass {self._max_bytes} bytes (current usage: "
                f"{json.dumps(self._usage())}). Drop segments you no longer need with "
                f"trellis_workspace.drop(segment_id), then retry."
            )

    # --- harness-side capture (§4.1–§4.3) ------------------------------

    def capture(self, server, tool, args_hash, content, truncated):
        """Deposits one external tool result as an origin-stamped
        segment and returns the stub dict the tool wrapper hands the
        model. Harness-side: called from inside `trellis_mcp.call_tool`;
        every stamp is derived here, so the model cannot claim origins
        for itself. A capture that trips the budget raises BEFORE
        storing — the result is discarded deterministically."""
        self._count_op()
        content = str(content)
        content_bytes = _utf8_len(content)
        with self._lock:
            if len(self._state["segments"]) + 1 > self._max_segments:
                raise WorkspaceBudgetError(
                    f"Workspace segment budget exceeded: {self._max_segments} segments are "
                    f"already stored (current usage: {json.dumps(self._usage())}). Drop "
                    f"segments you no longer need with trellis_workspace.drop(segment_id), "
                    f"then retry."
                )
            self._require_byte_budget(content_bytes, "tool result")
            segment_id = str(uuid.uuid4())
            segment = {
                "origin": {"server": str(server), "tool": str(tool), "argsHash": str(args_hash)},
                "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "bytes": content_bytes,
                "truncated": bool(truncated),
                "content": content,
            }
            if self._goal_id:
                segment["goalId"] = self._goal_id
            if self._task_id:
                segment["taskId"] = self._task_id
            self._state["segments"][segment_id] = segment
            return {
                "server": str(server),
                "tool": str(tool),
                "segmentId": segment_id,
                "bytes": content_bytes,
                "truncated": bool(truncated),
                "preview": content[:WORKSPACE_PREVIEW_CHARS],
            }

    # --- model-visible surface (JSON strings, real exceptions) ---------

    def read(self) -> str:
        """The bounded workspace index: plan, notes, and per-segment
        metadata (origin, size, timestamps) — never segment contents.
        Pull full content deliberately with segment(segment_id)."""
        self._count_op()
        with self._lock:
            index = {
                "version": self._state["version"],
                "plan": self._state["plan"],
                "notes": self._state["notes"],
                "segments": {
                    segment_id: {k: v for k, v in seg.items() if k != "content"}
                    for segment_id, seg in self._state["segments"].items()
                },
                "usage": self._usage(),
            }
            return json.dumps(index)

    def segment(self, segment_id) -> str:
        """Full record for one segment, content included."""
        self._count_op()
        with self._lock:
            seg = self._state["segments"].get(segment_id)
            if seg is None:
                raise ValueError(
                    f"Unknown workspace segment id {str(segment_id)[:80]!r}. Call "
                    f"trellis_workspace.read() for the index of stored segments."
                )
            return json.dumps({"segmentId": segment_id, **seg})

    def set_plan(self, plan) -> str:
        """Replaces the plan. The plan must be plain JSON-serializable
        data (the data-not-objects contract); rebinding the whole plan
        through this method is the atomic-update idiom."""
        self._count_op()
        try:
            canonical = json.dumps(plan)
        except (TypeError, ValueError) as e:
            raise ValueError(
                f"Workspace plans must be plain JSON-serializable data (lists/dicts/strings/"
                f"numbers), not live objects: {e}"
            ) from None
        with self._lock:
            incoming = _utf8_len(canonical)
            # Replacement semantics: the new plan competes for the budget
            # the old plan currently holds.
            if self._segment_bytes() + self._note_bytes + incoming > self._max_bytes:
                raise WorkspaceBudgetError(
                    f"Workspace byte budget exceeded: storing this plan ({incoming} bytes) "
                    f"would pass {self._max_bytes} bytes (current usage: "
                    f"{json.dumps(self._usage())}). Drop segments you no longer need with "
                    f"trellis_workspace.drop(segment_id), then retry."
                )
            self._state["plan"] = json.loads(canonical)
            self._plan_bytes = incoming
            return json.dumps({"plan": "set", "bytes": incoming})

    def add_note(self, text) -> str:
        """Appends one self-note string."""
        self._count_op()
        if not isinstance(text, str) or text == "":
            raise ValueError("Workspace notes must be non-empty strings.")
        with self._lock:
            incoming = _utf8_len(text)
            self._require_byte_budget(incoming, "note")
            self._state["notes"].append(text)
            self._note_bytes += incoming
            return json.dumps({"notes": len(self._state["notes"]), "bytes": incoming})

    def drop(self, segment_id) -> str:
        """Removes one segment, freeing its budget."""
        self._count_op()
        with self._lock:
            seg = self._state["segments"].pop(segment_id, None)
            if seg is None:
                raise ValueError(
                    f"Unknown workspace segment id {str(segment_id)[:80]!r}. Call "
                    f"trellis_workspace.read() for the index of stored segments."
                )
            return json.dumps({"dropped": segment_id, "freedBytes": seg["bytes"]})

    def snapshot(self) -> str:
        """The whole workspace dict as canonical JSON (sorted keys,
        compact separators) — the serialization seam cross-task lineage
        (design record §5) parks and seeds."""
        self._count_op()
        with self._lock:
            return json.dumps(self._state, sort_keys=True, separators=(",", ":"))

    # --- lineage (Session 16, design record §5) -------------------------

    def is_empty(self):
        """Harness-side: True when there is nothing worth parking."""
        with self._lock:
            return (
                not self._state["segments"]
                and not self._state["notes"]
                and self._state["plan"] == []
            )

    @classmethod
    def seed_from_snapshot(cls, data, max_segments=None, max_bytes=None,
                           goal_id=None, task_id=None):
        """Constructs a workspace pre-populated from a parked snapshot
        (the worker resolved and merged it from Redis). Wrapper stamps
        are preserved exactly — a seeded segment still records the task
        that originally fetched it. Every structural defect and every
        budget violation RAISES before the run's first turn: an
        over-budget or torn seed fails the task fast, never silently
        truncates (§4.7 applied to inheritance)."""
        if not isinstance(data, dict) or data.get("version") != 1:
            raise ValueError(
                "Workspace seed must be a version-1 snapshot dict "
                "(keys: version, plan, notes, segments)."
            )
        notes = data.get("notes", [])
        segments = data.get("segments", {})
        plan = data.get("plan", [])
        if not isinstance(notes, list) or any(
            not isinstance(n, str) or n == "" for n in notes
        ):
            raise ValueError("Workspace seed notes must be a list of non-empty strings.")
        if not isinstance(segments, dict):
            raise ValueError("Workspace seed segments must be a dict keyed by segment id.")
        for segment_id, seg in segments.items():
            if not isinstance(seg, dict):
                raise ValueError(
                    f"Workspace seed segment {str(segment_id)[:80]!r} is not a dict."
                )
            origin = seg.get("origin")
            content = seg.get("content")
            if (
                not isinstance(origin, dict)
                or not all(isinstance(origin.get(k), str) for k in ("server", "tool", "argsHash"))
                or not isinstance(content, str)
                or not isinstance(seg.get("fetchedAt"), str)
                or not isinstance(seg.get("truncated"), bool)
            ):
                raise ValueError(
                    f"Workspace seed segment {str(segment_id)[:80]!r} is missing required "
                    f"stamps (origin server/tool/argsHash, fetchedAt, truncated, content)."
                )
            if seg.get("bytes") != _utf8_len(content):
                raise ValueError(
                    f"Workspace seed segment {str(segment_id)[:80]!r} is torn: its bytes "
                    f"stamp does not match its content."
                )
        try:
            plan = json.loads(json.dumps(plan))
        except (TypeError, ValueError) as e:
            raise ValueError(f"Workspace seed plan is not plain JSON data: {e}") from None

        ws = cls(max_segments=max_segments, max_bytes=max_bytes,
                 goal_id=goal_id, task_id=task_id)
        if len(segments) > ws._max_segments:
            raise WorkspaceBudgetError(
                f"Workspace seed exceeds the segment budget: {len(segments)} seeded "
                f"segments over the {ws._max_segments} maximum. Seed fewer tasks or "
                f"raise TRELLIS_WORKSPACE_MAX_SEGMENTS."
            )
        plan_bytes = _utf8_len(json.dumps(plan))
        note_bytes = sum(_utf8_len(n) for n in notes)
        segment_bytes = sum(seg["bytes"] for seg in segments.values())
        total = plan_bytes + note_bytes + segment_bytes
        if total > ws._max_bytes:
            raise WorkspaceBudgetError(
                f"Workspace seed exceeds the byte budget: {total} seeded bytes over "
                f"the {ws._max_bytes} maximum. Seed fewer tasks or raise "
                f"TRELLIS_WORKSPACE_MAX_BYTES."
            )
        ws._state = {
            "version": 1,
            "plan": plan,
            "notes": list(notes),
            "segments": {str(sid): dict(seg) for sid, seg in segments.items()},
        }
        ws._plan_bytes = plan_bytes
        ws._note_bytes = note_bytes
        return ws

    # --- telemetry (counts only — content never leaves as telemetry) ---

    def stats(self):
        """Bounded counters for the TRELLIS_TELEMETRY line (§4.8)."""
        with self._lock:
            return {
                "workspace_ops": self._ops,
                "workspace_segments": len(self._state["segments"]),
                "workspace_bytes": self._total_bytes(),
            }


# The prompt addendum, appended when (and only when) a workspace is
# injected. rlms runs .format() over the system prompt, so this text is
# brace-free: schema examples use dict(...) constructor syntax, the
# existing addendum idiom (see the comment block in trellis_agent.py).
WORKSPACE_ADDENDUM = """

=== WORKSPACE (TIER-3 WORKING STATE) ===
`trellis_workspace` is your persistent working memory for this run: plan, self-notes, and captured external results. It survives every REPL turn. Every method returns a JSON STRING — wrap results in json.loads(...).
- `trellis_workspace.read()` returns the bounded index: your plan, notes, and each stored segment's id, origin, size, and timestamp — never full contents.
- `trellis_workspace.segment(segment_id)` returns one segment in full, content included.
- `trellis_workspace.set_plan(plan)` replaces your plan with plain JSON data, e.g. a list of dict(id='s1', desc='...', status='pending') steps. Keep it current: update statuses as you work.
- `trellis_workspace.add_note(text)` appends a self-note; `trellis_workspace.drop(segment_id)` frees a segment you no longer need.
External tool results are captured into the workspace automatically: when a workspace is active, `trellis_mcp.call_tool` returns a STUB — dict(server=..., tool=..., segmentId=..., bytes=..., truncated=..., preview=...) — and the full result is stored as a segment. Read it with segment(segmentId), or fan `llm_query` out over segment contents instead of pasting them into your own context.
ATOMIC UPDATES: when changing state that must not tear, build the new value first and then rebind through set_plan in one call — rebinding survives errors atomically, while a half-finished in-place mutation from a failed block persists and must be repaired by re-reading.
Budgets are bounded; over-budget writes raise with current usage — drop() what you no longer need and retry.
HARD RULE: the workspace has NO provenance standing. Segment ids and workspace content are NEVER sourceNodeIds and can never be written to the graph as provenance; database provenance stays mandatory for every answer and every cached insight.
"""

# Appended after the workspace addendum only on seeded runs (Session 16
# lineage): the model must know inherited state exists before its first
# turn, or the seed is scrollback it never reads. Brace-free like every
# rlms-formatted string.
WORKSPACE_SEEDED_ADDENDUM = """SEEDED RUN: this workspace was pre-populated with state inherited from earlier tasks in the same goal (their plan, notes, and captured segments, origin stamps intact). Call trellis_workspace.read() in your VERY FIRST repl block and reuse what is already there instead of re-fetching it. Inherited content has the same trust standing as everything else in the workspace: NONE.
"""


def build_workspace_addendum(workspace, seeded=False) -> str:
    """Empty string when no workspace is injected, so a gated-off run's
    system prompt stays byte-identical (the build_mcp_addendum
    precedent, pinned by test). An unseeded workspace run's prompt is
    likewise byte-identical to Session 14's (seeded=False default)."""
    if workspace is None:
        return ""
    if seeded:
        return WORKSPACE_ADDENDUM + WORKSPACE_SEEDED_ADDENDUM
    return WORKSPACE_ADDENDUM
