"""RLM harness scaffolding for the Trellis RLM (Session 50).

Design record: docs/architecture/RLM_HARNESS_SCAFFOLDING.md. The
motivating measurement is Session 48's T1 run 2 (the increment record
REPOSITORY_INGESTION_REPORT.md §5h.8): the rlms REPL is stateful and
the root loop carries the FULL history, yet the run violated a rule
that sat verbatim in its context for ~10 iterations — an attention
failure over a long transcript, not a memory failure. The scaffolds
below are the prompt-and-tooling-level answer: the model finds the
operator's instructions BY CODE, keeps a running state it re-reads,
and verifies regions through engine-computed joins instead of
re-assembled expectations.

Three surfaces, all riding the `custom_tools` construction seam (zero
rlms modification, the trellis_neo4j injection path):

  S1 — task-context isolation. The run driver (trellis_agent.py)
  generates one UUID per run and wraps the operator task text at BOTH
  injection points (the system-prompt splice and the completion query)
  in <rlm_usercontext-UUID> tags via `wrap_task_text`. The same text
  rides `TrellisTask`, injected as `trellis_task`: `.text()` returns
  the task verbatim, `.grep(pattern)` is an engine-side bounded regex
  over it, `.uuid` lets code verify provenance. The precedence rule
  (only uuid-tagged text is operator instruction) is taught by the
  addendum; retrieved blocks and file bytes cannot carry the run's
  uuid because it did not exist when they were written. RESIDUAL,
  recorded in the design record §2: this defends against pre-existing
  injected content, not against a same-run echo loop.

  S2a — UPSUM is taught by the addendum (the REPL's persistent locals
  ARE the state store); this module carries only its code-checked size
  budget, the UPSUM_BUDGET constant the driver injects into every
  research run's namespace so the model bounds state size BY CODE
  (len(str(upsum)) against the constant), never by eye — the counting
  doctrine of CODE_MEDIATED_TEXT.md §1 (RLM_HARNESS_SCAFFOLDING.md
  §3/§7). S2b (rlms compaction) is DEFERRED behind its own measured
  proposal and is deliberately absent here.

  S3 — staged helpers, each a mechanical answer to a measured failure
  class: `frame_text` / `region_lines` / `region_equal` (the
  Session 48 run-1 terminator-less-expectation class closed at the
  namespace level), `concat_files` (the llm_query-buffer pattern as
  one call), and `citable` (the Session 48 run-2 escalation rule as a
  READ-ONLY probe: retrieved-this-run AND bridges to a named file).

Return-type convention, deliberate and taught by the addendum: the
S3 helpers and `trellis_task.text()` return PYTHON VALUES (strings,
lists, dicts, booleans) because their outputs feed code — assertions,
buffers, branches — not JSON re-parsing; `trellis_task.grep` returns
a JSON string (a bounded structured listing, the locate() mold).

Provenance standing: NONE anywhere in this module. Nothing here
increments the database tool-call count, feeds the retrieval set or
the citation audit, or gates a write. `citable` mirrors the
stage-2 checker's liveness join (gatherHashEvidence in
scripts/stage2_selfedit_check.ts — the documents MAX(version) +
document_nodes membership join) and the checkEvidence named-file
bridge; the selfedit harness drill pins the two sides against the
same fixture so a divergence fails loudly (mirror-with-pin, never a
silent fork). It informs; the Session 31/35 gates keep their jobs.

The frame helpers read held frames through the toolkit's own
`_require_frame` accessor under the toolkit lock — the frame
representation (text.split("\n"); the join is the exact inverse) is
the documented trellis_textedit contract, and the unit pins fail
loudly if it ever moves. Stdlib-only ON PURPOSE (the trellis_blocks
precedent) so the unit suite can spawn it inside plain `npm test`:
`citable` reaches Postgres only through the injected TrellisPostgres
instance's connection at call time.
"""

import json
import os
import re

# Kernel constants (never env-tunable). The grep hit cap is the
# locate() viewport mold; hit TEXT is never truncated — a decisive
# rule cut mid-sentence would defeat the surface's purpose (task
# lines are short by authoring convention; the CAP bounds output).
TASK_GREP_MAX_HITS = 40
# Bounded round trip for the citability probe (the ast_hashes_exist
# batch shape).
CITABLE_MAX_HASHES = 64
# The one substrate this kernel edition bridges named files against
# (repo-key `trellis`, REPOSITORY_INGESTION_REPORT.md §5d). Drills
# construct the factory with their own fixture prefix.
TASK_DOC_KEY_PREFIX_DEFAULT = "repo:trellis:"
# S2a UPSUM (RLM_HARNESS_SCAFFOLDING.md §3/§7): the code-checked size
# budget, in characters of the serialized `upsum` dict, for the model's
# running-state summary. The driver injects it into every research run's
# REPL namespace beside trellis_task so the model bounds state size BY
# CODE — computing len(str(upsum)) and comparing it to THIS constant,
# never eyeballing a length (CODE_MEDIATED_TEXT.md §1: the model never
# counts). A soft, self-correcting target the model compresses toward;
# kernel constant, never env-tunable.
UPSUM_BUDGET = 2000


def wrap_task_text(text, run_uuid):
    """Wraps operator task text in this run's uuid tags — the S1
    wrapper, applied by the driver at BOTH injection points. The tag
    body is hex-and-hyphen only, so the wrapped text adds no braces
    for rlms .format() to trip on (the task text itself is escaped by
    the caller exactly as before at the system-prompt splice)."""
    if not isinstance(text, str) or text == "":
        raise ValueError("wrap_task_text needs a non-empty task text string.")
    if not isinstance(run_uuid, str) or run_uuid.strip() == "":
        raise ValueError("wrap_task_text needs a non-empty run uuid string.")
    if "{" in run_uuid or "}" in run_uuid:
        raise ValueError("wrap_task_text: the run uuid must be brace-free.")
    return (
        f"<rlm_usercontext-{run_uuid}>\n"
        f"{text}\n"
        f"</rlm_usercontext-{run_uuid}>"
    )


class TrellisTask:
    """The operator task, engine-held: re-reading instructions becomes
    a code act with primacy in the current cell, immune to transcript
    distance. Reading this surface has NO provenance standing and is
    never counted as a database tool call."""

    def __init__(self, text, run_uuid):
        if not isinstance(text, str) or text == "":
            raise ValueError("TrellisTask needs a non-empty task text string.")
        if not isinstance(run_uuid, str) or run_uuid.strip() == "":
            raise ValueError("TrellisTask needs a non-empty run uuid string.")
        self._text = text
        self.uuid = run_uuid

    def text(self):
        """The operator task text VERBATIM, as a plain string (not
        JSON): exactly the bytes inside this run's uuid tags."""
        return self._text

    def grep(self, pattern):
        """Engine-side regex over the task text, one line at a time.
        Returns a JSON string with bounded hits (the locate() mold):
        pattern, totalHits, capped, and hits as objects with keys line
        and text. Hit text is never truncated — a rule cut short would
        defeat the re-read."""
        if not isinstance(pattern, str) or pattern == "":
            raise ValueError("trellis_task.grep needs a non-empty string pattern.")
        try:
            matcher = re.compile(pattern)
        except re.error as e:
            raise ValueError(f"Invalid regular expression {pattern!r}: {e}") from None
        hits = []
        total = 0
        for i, line in enumerate(self._text.split("\n")):
            if matcher.search(line):
                total += 1
                if len(hits) < TASK_GREP_MAX_HITS:
                    hits.append({"line": i, "text": line})
        return json.dumps({
            "pattern": pattern,
            "totalHits": total,
            "capped": total > len(hits),
            "hits": hits,
        })


def parse_task_named_files(environ=None):
    """Driver input for the `citable` helper (design record §4): the
    TRELLIS_TASK_NAMED_FILES environment variable is a JSON array of
    repo-relative paths the task names. Unset, blank, or an explicit
    [] means the probe is not injected (returns None). Malformed
    values raise here, before any paid work (the parse_mcp_config
    fail-fast rule). The worker never forwards this variable
    (buildAgentEnv deletes it unconditionally); only a direct spawn's
    own environment — the stage-2 driver — can set it."""
    env = os.environ if environ is None else environ
    raw = env.get("TRELLIS_TASK_NAMED_FILES")
    if raw is None or not raw.strip():
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"TRELLIS_TASK_NAMED_FILES is not valid JSON: {e}") from None
    if not isinstance(data, list):
        raise ValueError(
            "Invalid TRELLIS_TASK_NAMED_FILES: expected a JSON array of "
            "repo-relative file paths."
        )
    if not data:
        return None
    if len(data) > 16:
        raise ValueError(
            "Invalid TRELLIS_TASK_NAMED_FILES: at most 16 named files per run."
        )
    files = []
    for entry in data:
        if not isinstance(entry, str) or not 1 <= len(entry) <= 512:
            raise ValueError(
                f"Invalid TRELLIS_TASK_NAMED_FILES entry {entry!r}: each entry "
                f"must be a non-empty string of at most 512 characters."
            )
        normalized = entry.replace("\\", "/")
        if normalized not in files:
            files.append(normalized)
    return files


def build_scaffold_helpers(textedit=None, postgres=None,
                           retrieved_addresses_fn=None, named_files=None,
                           doc_key_prefix=TASK_DOC_KEY_PREFIX_DEFAULT):
    """The S3 injection factory: returns the dict of helper callables
    the agent merges into `custom_tools`, gated by what the run has.
    The frame helpers ride only when the editing toolkit is injected
    (they are meaningless without held frames); `citable` rides only
    when the driver passed named files AND the database surfaces
    exist. An empty dict means a run's namespace and prompt are
    byte-identical to before this module existed (the
    build_mcp_addendum gating precedent)."""
    helpers = {}

    if textedit is not None:

        def _frame(relpath):
            # The toolkit's own accessor: the same teaching "No held
            # frame" refusal load-discipline violations get everywhere
            # else. Read under the toolkit lock; never mutated here.
            with textedit._lock:
                _, frame = textedit._require_frame(relpath)
                return list(frame["lines"])

        def frame_text(relpath):
            """The ENTIRE working frame joined with newline terminators —
            byte-identical to what write_back would write (lines keep
            their trailing carriage returns on CRLF files). Returns a
            plain string."""
            return "\n".join(_frame(relpath))

        def region_lines(relpath, start, end):
            """The working lines [start, end) as a LIST of line texts
            (0-based, half-open — Python slice semantics)."""
            lines = _frame(relpath)
            for name, value in (("start", start), ("end", end)):
                if not isinstance(value, int) or isinstance(value, bool):
                    raise ValueError(f"{name} must be an integer line index, got {value!r}.")
            if not 0 <= start <= end <= len(lines):
                raise ValueError(
                    f"Line range [{start}, {end}) is invalid for a "
                    f"{len(lines)}-line frame: addresses are 0-based, half-open, "
                    f"engine-computed — re-run trellis_textedit.locate() rather "
                    f"than estimating positions."
                )
            return lines[start:end]

        def region_equal(relpath, start, expected_lines):
            """True when expected_lines (a LIST of newline-free strings)
            byte-matches the working frame at start. The list-compare
            assertion as a helper: never substring-check a
            terminator-less concatenation."""
            if not isinstance(expected_lines, list) or not expected_lines or any(
                    not isinstance(l, str) for l in expected_lines):
                raise ValueError(
                    "expected_lines must be a non-empty LIST of strings (one per "
                    "line) — build it with text.split('\\n') or region_lines()."
                )
            for l in expected_lines:
                if "\n" in l:
                    raise ValueError(
                        "expected_lines entries must not contain newline characters; "
                        "split the text into one string per line first."
                    )
            return region_lines(relpath, start, start + len(expected_lines)) == expected_lines

        def concat_files(relpaths):
            """The held frames of the listed files joined into ONE plain
            string (each frame joined with its terminators, files joined
            with a newline) — build sub-LLM buffers with it instead of
            printing file contents through the REPL output cap. Every
            listed file must already be loaded; total size is bounded by
            the toolkit's own frame budgets."""
            if not isinstance(relpaths, list) or not relpaths or any(
                    not isinstance(p, str) for p in relpaths):
                raise ValueError(
                    "concat_files needs a non-empty LIST of relpath strings."
                )
            return "\n".join("\n".join(_frame(p)) for p in relpaths)

        helpers["frame_text"] = frame_text
        helpers["region_lines"] = region_lines
        helpers["region_equal"] = region_equal
        helpers["concat_files"] = concat_files

    if named_files and postgres is not None and retrieved_addresses_fn is not None:
        named_doc_keys = {
            doc_key_prefix + f.replace("\\", "/") for f in named_files
        }

        def citable(hashes):
            """READ-ONLY citability probe (never a gate): per hash, was
            it retrieved THIS RUN and does it bridge to a named file's
            current-version substrate document. Returns a dict keyed by
            hash with keys retrieved, exists, live_doc_keys,
            bridges_named_file, and citable. Reading it never satisfies
            the provenance protocol and never feeds the retrieval set."""
            if not isinstance(hashes, list) or not hashes or any(
                    not isinstance(h, str) for h in hashes):
                raise ValueError("citable needs a non-empty LIST of hash strings.")
            if len(hashes) > CITABLE_MAX_HASHES:
                raise ValueError(
                    f"citable takes at most {CITABLE_MAX_HASHES} hashes per call, "
                    f"got {len(hashes)}."
                )
            unique = list(dict.fromkeys(hashes))
            try:
                with postgres.conn.cursor() as cur:
                    cur.execute(
                        "SELECT id FROM ast_nodes WHERE id = ANY(%s)", (unique,)
                    )
                    exists = {row[0] for row in cur.fetchall()}
                    # The gatherHashEvidence join, mirrored: doc_keys
                    # whose CURRENT (max-version) root contains the hash
                    # (scripts/stage2_selfedit_check.ts — the selfedit
                    # harness drill pins the two sides on one fixture).
                    cur.execute(
                        """
                        SELECT dn.node_id, d.doc_key
                          FROM documents d
                          JOIN (SELECT doc_key, MAX(version) AS v
                                  FROM documents GROUP BY doc_key) latest
                            ON latest.doc_key = d.doc_key AND latest.v = d.version
                          JOIN document_nodes dn ON dn.root_hash = d.root_hash
                         WHERE dn.node_id = ANY(%s)
                         ORDER BY d.doc_key
                        """,
                        (unique,),
                    )
                    live = {}
                    for node_id, doc_key in cur.fetchall():
                        live.setdefault(node_id, []).append(doc_key)
            except Exception as e:
                # The fetch_texts rollback discipline: an aborted
                # transaction must not poison the next query.
                postgres.conn.rollback()
                raise RuntimeError(f"PostgresError during citability probe: {e}") from e
            retrieved = set(retrieved_addresses_fn())
            report = {}
            for h in unique:
                doc_keys = live.get(h, [])
                bridges = any(k in named_doc_keys for k in doc_keys)
                report[h] = {
                    "retrieved": h in retrieved,
                    "exists": h in exists,
                    "live_doc_keys": doc_keys,
                    "bridges_named_file": bridges,
                    "citable": (h in retrieved) and bridges,
                }
            return report

        helpers["citable"] = citable

    return helpers


# --- Prompt addenda (conditional, the build_mcp_addendum precedent) ----
# rlms runs .format() over the system prompt, so both texts are
# brace-free. Appended only when the matching helpers are injected;
# a gated-off run's prompt stays byte-identical.
HELPERS_ADDENDUM = """

=== STAGED HELPERS (CODE-MEDIATED VERIFICATION) ===
Namespace utilities over held trellis_textedit frames. They return PYTHON VALUES directly (plain strings, lists, booleans) — use them in code, no json.loads needed. Every file must be loaded with trellis_textedit.load first. They read state and change nothing; they have NO provenance standing.
- frame_text(relpath) returns the ENTIRE working frame joined with newline terminators, byte-identical to what write_back would write (each line keeps its trailing carriage return on CRLF files). Build multi-line expectations from this — never by concatenating line texts without terminators.
- region_lines(relpath, start, end) returns working lines [start, end) as a LIST of line texts (0-based, half-open).
- region_equal(relpath, start, expected_lines) returns True when expected_lines (a LIST of newline-free strings) byte-matches the frame at start. Assert regions with this, never with substring checks over terminator-less concatenations.
- concat_files(relpaths) returns the held frames of the listed files as ONE string — build llm_query buffers with it instead of printing file contents through the REPL output cap.
"""

CITABLE_ADDENDUM = """

=== CITABILITY PROBE (READ-ONLY) ===
- citable(hashes) takes a LIST of AST hashes and returns a plain dict per hash: retrieved (this run), exists, live_doc_keys, bridges_named_file, and citable (retrieved AND bridges to a task-named file). Call it BEFORE any insight write and cite only hashes whose citable field is True. It is informational only: it never writes, never gates, and reading it never satisfies the provenance protocol.
"""


def build_helpers_addendum(helpers) -> str:
    """Empty string when no frame helper is injected, so a gated-off
    run's system prompt stays byte-identical (the
    build_textedit_addendum precedent)."""
    if not helpers or "frame_text" not in helpers:
        return ""
    return HELPERS_ADDENDUM


def build_citable_addendum(helpers) -> str:
    """Empty string when the citability probe is not injected."""
    if not helpers or "citable" not in helpers:
        return ""
    return CITABLE_ADDENDUM
