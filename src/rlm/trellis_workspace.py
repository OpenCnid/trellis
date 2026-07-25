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

from trellis_surfaces import register_surface

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


# --- The surface descriptor (Workstream B, July 25, 2026) -------------------
#
# Ownership follows SELF_DESCRIBING_SURFACES.md §9.1 — one encoding, owned
# by whoever is authoritative for the fact. Every sentence a guard on THIS
# surface enforces lives in the expectations below, keyed by its guard
# class; the editorial teaching prose lives in the descriptor. Nothing
# here renders: WORKSPACE_ADDENDUM below is untouched and is still the
# live prompt encoding, so the addendum's own copies of the guard-backed
# sentences stand until a pass authorized to move kernel-prompt bytes
# retires them. `expects` is deliberately absent from the descriptor — it
# is derived by derive_workspace_expects() from the guards, never
# authored here.
#
# Field shape is NOT validated (SELF_DESCRIBING_SURFACES.md §11, owner
# ruling): a descriptor is a REGISTRATION, not a schema, so fields vary
# per surface and adding one is an edit. Vocabulary drawn from
# LLM_HELP_SPEC.md §1 plus MASH's `usage`, as trellis_textedit draws it.
#
# THE THREE ACTIVATION CAUSES ARE NOT ONE THING. trellis_agent.py injects
# this surface when the run is seeded, when MCP servers are configured,
# or when the run carries a goal id, and each tells a model to do
# something different. Where each is answerable from:
#
#   * goal-scoped   DERIVED from state. `_goal_id` is the same attribute
#                   capture() stamps onto every segment, so the account
#                   and the stamp cannot drift apart (HARNESS_SELF_MODEL.md
#                   §2.1 applied to this surface).
#   * seeded        NOT DERIVABLE from state. seed_from_snapshot leaves no
#                   mark on the instance and no guard here reads
#                   seededness — it is a construction-path fact the caller
#                   holds. derive_workspace_expects takes it exactly as
#                   build_workspace_addendum takes it, and the phrase it
#                   selects sits in the EDITORIAL half, because a caller
#                   flag is not a refusing predicate.
#   * MCP-attached  OWNED BY THE OTHER SURFACE. The predicate is
#                   TrellisMcp.call_tool's `self._workspace is not None`
#                   branch, so the capture-stub sentence is homed in
#                   trellis_mcp.py's expectations and is deliberately not
#                   restated here.
WORKSPACE_DESCRIPTOR = {
    "name": "trellis_workspace",
    "purpose": ("holds this run's working state — plan, self-notes, and "
                "captured external results — across every REPL turn."),
    # llm_help-facing editorial fields. No predicate refuses when these are
    # wrong and no derivation can supply them (§9.1's human-authoritative
    # half); they are authored once, here, and nowhere else.
    "whenToUse": ("the run has state worth carrying between turns. Three run "
                  "conditions put this surface in the namespace and they do "
                  "not mean the same thing: a SEEDED run inherits earlier "
                  "tasks' state and should read before it fetches anything; a "
                  "run with external tools configured receives every tool "
                  "result here instead of inline; a GOAL-SCOPED run leaves "
                  "what it writes to sibling tasks of the same goal. Which "
                  "conditions are live this run is derived, never authored"),
    # The ONE description line rlms reserves for this surface. It pulls the
    # purpose this descriptor already owns and authors nothing beside it.
    #
    # WHY NOTHING RIDES ALONG. Every guard-backed bound on this surface is
    # stated IN FULL by WORKSPACE_ADDENDUM, and build_workspace_addendum
    # emits it on exactly the runs trellis_agent injects the surface on —
    # both gate on the same holder being present, so a copy in this slot
    # reaches no run the addendum does not already reach. It would spend a
    # slot on a surface that has an addendum, against siblings that have
    # none (trellis_postgres and trellis_neo4j state their bounds here
    # because nothing else states them). Measured, largest first, the
    # phrases that could ride along are byte_budget, plan_json,
    # segment_budget, plan_replacement, goal_stamped, index_excludes_content
    # and unknown_segment; the purpose clause plus the shortest of those is
    # already 187 characters, and the only phrase that fits beside it is the
    # note-shape refusal — the least decisive thing this surface enforces,
    # which is padding rather than orientation.
    #
    # WHY whenToUse IS NOT PULLED. It runs to 451 characters, and it
    # enumerates three activation causes of which any subset is live: a
    # seeded run, a run with external tools configured, and a goal-scoped
    # run do not mean the same thing, so a line stating all three states two
    # conditions that are not this run's. Selecting among them takes a
    # derived phrase, and SELF_DESCRIBING_SURFACES.md §13 (The description
    # slot, and the gate this did not run) binds §6's self-play validation
    # gate BEFORE whenToUse reaches any composed line. That gate has not
    # run, so this line carries no intent claim.
    "contributes": [
        ("descriptor", "purpose"),
    ],
    "example": ("state = json.loads(trellis_workspace.read()); "
                "full = json.loads(trellis_workspace.segment(some_segment_id))"),
    "seeAlso": ["trellis_mcp", "trellis_textedit"],
    # An editorial grouping label (MASH's category).
    "category": "WORKSPACE (TIER-3 WORKING STATE)",
    # Cross-cutting protocol lines (MASH's `usage`). All four are ADVISORY
    # in HARNESS_SELF_MODEL.md §4's sense — no predicate on THIS surface
    # refuses when they are ignored. "provenance" is enforced by the
    # database write path, a different surface; "seeded_run" is selected by
    # a caller flag rather than by a refusing bool, which is why it sits
    # here rather than among the guard-owned phrases.
    "usage": {
        "returns": ("Every method returns a JSON STRING — wrap results in "
                    "json.loads(...)."),
        "persistence": ("This state survives every REPL turn of the run; your "
                        "own local variables do too, but only this survives "
                        "as data the harness can park and hand on."),
        "atomic_updates": ("ATOMIC UPDATES: when changing state that must not "
                           "tear, build the new value first and then rebind "
                           "through set_plan in one call — rebinding survives "
                           "errors atomically, while a half-finished in-place "
                           "mutation from a failed block persists and must be "
                           "repaired by re-reading."),
        "seeded_run": ("SEEDED RUN: this workspace was pre-populated with "
                       "state inherited from earlier tasks in the same goal, "
                       "origin stamps intact. Call trellis_workspace.read() in "
                       "your VERY FIRST repl block and reuse what is already "
                       "there instead of re-fetching it. Inherited content has "
                       "the same trust standing as everything else in the "
                       "workspace: NONE."),
        "provenance": ("HARD RULE: the workspace has NO provenance standing. "
                       "Segment ids and workspace content are NEVER "
                       "sourceNodeIds and can never be written to the graph as "
                       "provenance; database provenance stays mandatory for "
                       "every answer and every cached insight."),
    },
    # One entry per model-visible method, in render order. Plain strings are
    # editorial teaching prose; ("expects", key) slots pull the guard-owned
    # phrase from the derived expectations, so no guard-backed sentence is
    # encoded twice. capture() is absent on purpose: it is harness-side, the
    # wrapper calls it from inside trellis_mcp.call_tool, and a model that
    # called it itself would be forging origin stamps.
    "exposes": [
        {
            "call": "trellis_workspace.read()",
            "doc": ["returns the bounded index — your plan, your notes, and "
                    "each stored segment's id, origin, size and timestamp. ",
                    ("expects", "index_excludes_content")],
        },
        {
            "call": "trellis_workspace.segment(segment_id)",
            "doc": ["returns one segment in full, content included. ",
                    ("expects", "unknown_segment")],
        },
        {
            "call": "trellis_workspace.set_plan(plan)",
            "doc": ["replaces your plan, e.g. a list of "
                    "dict(id='s1', desc='...', status='pending') steps; keep "
                    "it current as you work. ", ("expects", "plan_json"), " ",
                    ("expects", "plan_replacement")],
        },
        {
            "call": "trellis_workspace.add_note(text)",
            "doc": ["appends one self-note. ", ("expects", "note_shape")],
        },
        {
            "call": "trellis_workspace.drop(segment_id)",
            "doc": ["removes a segment you no longer need and reports the "
                    "bytes it freed. ", ("expects", "unknown_segment")],
        },
    ],
    # Render order for the closing lines, the generalization of what
    # render_textedit_addendum hardcodes at its tail. ("expects", key) is a
    # guard-owned phrase, ("usage", key) an editorial one.
    "tail": [
        ("expects", "segment_budget"),
        ("expects", "byte_budget"),
        ("usage", "provenance"),
    ],
}

# Guard-owned expectation phrases: ONE encoding per guard class, keyed by
# the guard that is authoritative for it. Granularity is the guard CLASS,
# not the raise site — `unknown_segment` accounts for the identical
# refusal in segment() and drop(), `byte_budget` for both
# _require_byte_budget and set_plan's replacement-semantics twin.
#
# What is NOT in here, and why:
#   * The two budget sentences carry the RUN's numbers, so their bytes
#     depend on run state and derive_workspace_expects composes them from
#     the same attributes the guards compare against. A static phrase
#     could only say "bounded", which is exactly the gap this descriptor
#     exists to close.
#   * _require_bound and parse_workspace_bounds refuse the OPERATOR before
#     a run exists, and seed_from_snapshot refuses the WORKER's snapshot
#     before the model's first turn. The composed read is addressed to the
#     model, so those guards have no phrase — the trellis_textedit
#     precedent for operator-facing guards.
_WORKSPACE_GUARD_EXPECTS = {
    # read(): the index comprehension drops the content key, so the index
    # cannot carry segment bytes even if a caller wanted it to.
    "index_excludes_content": ("The index never carries segment contents — "
                               "pull those deliberately, one segment at a "
                               "time."),
    # segment() / drop(): an id that is not stored raises and names the
    # remedy (re-read the index).
    "unknown_segment": ("An unknown segment id raises and names read() as the "
                        "way to see which ids exist."),
    # set_plan(): json.dumps(plan) raises BEFORE the lock is taken, so a
    # rejected plan leaves the stored one exactly as it was.
    "plan_json": ("A plan must be plain JSON-serializable data — lists, "
                  "dicts, strings, numbers — never live objects; anything "
                  "else raises before the stored plan changes."),
    # set_plan(): the budget check sums segments + notes + the incoming
    # plan, deliberately excluding the plan currently held.
    "plan_replacement": ("set_plan replaces the whole plan, so a new plan "
                         "competes for the budget the current plan already "
                         "holds rather than adding to it."),
    # add_note(): non-string or empty raises.
    "note_shape": "A note must be a non-empty string.",
    # capture(): a segment whose goal id is set is stamped with it, which
    # is the same attribute derive_workspace_expects reads for goalScoped.
    "goal_stamped": ("This run belongs to a goal, so every result captured "
                     "here carries that goal id as part of its origin stamp."),
}


# One call site, one commitment: the descriptor is bound to its surface
# HERE, where the surface is defined, so the coverage diagnostic — and
# later llm_help — find it without anything being wired by hand elsewhere.
register_surface(WORKSPACE_DESCRIPTOR)


def derive_workspace_expects(workspace, seeded=False):
    """The guard-derived half of the composed read (HARNESS_SELF_MODEL.md
    §2: the same code that refuses is the code that explains).

    Every value here is read off the workspace holder, from the SAME
    attributes the guards compare against: `_max_segments` is what
    capture() refuses a new segment past, `_max_bytes` is what
    _require_byte_budget refuses a write past, and `_goal_id` is what
    capture() stamps onto a segment. The two budget sentences are composed
    from those numbers rather than authored, so the account cannot state a
    bound the run does not enforce.

    `seeded` is a PARAMETER and not a read, deliberately: seededness is
    the one activation cause that leaves no mark on the instance and that
    no guard on this surface consults, so it arrives from the caller the
    way build_workspace_addendum already takes it, and the phrase it
    selects lives in the descriptor's editorial half. Composed by code,
    never authored by the model."""
    expects = dict(_WORKSPACE_GUARD_EXPECTS)
    max_segments = getattr(workspace, "_max_segments", WORKSPACE_MAX_SEGMENTS_DEFAULT)
    max_bytes = getattr(workspace, "_max_bytes", WORKSPACE_MAX_BYTES_DEFAULT)
    goal_id = getattr(workspace, "_goal_id", None)
    task_id = getattr(workspace, "_task_id", None)
    # Raw values for a renderer or a diagnostic; the ids are values, never
    # spliced into prose, because they arrive from argv and this text is
    # handed to rlms .format().
    expects["maxSegments"] = max_segments
    expects["maxBytes"] = max_bytes
    expects["goalId"] = goal_id
    expects["taskId"] = task_id
    expects["goalScoped"] = goal_id is not None
    expects["seeded"] = bool(seeded)
    # capture(): the segment-count refusal, stated with the number it
    # refuses past.
    expects["segment_budget"] = (
        f"The segment budget for this run is {max_segments}; a capture past "
        f"it raises with current usage and names drop(segment_id) as the "
        f"remedy."
    )
    # _require_byte_budget() and set_plan()'s twin: the byte refusal,
    # stated with the number it refuses past and over the same total the
    # guard sums.
    expects["byte_budget"] = (
        f"The byte budget for this run is {max_bytes}, counted across plan, "
        f"notes and segments together; a write that would pass it raises "
        f"with current usage and stores nothing."
    )
    return expects


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
