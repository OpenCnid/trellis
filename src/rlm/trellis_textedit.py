"""The code-mediated editing toolkit for the Trellis RLM (Session 20).

Design record: docs/architecture/CODE_MEDIATED_TEXT.md §2 (the discipline
this holder embodies) and §7 (measured structure selection and bounds).
The pillar in one line: the model never counts, and the model never
copies. Locations are engine-computed and returned by query (`locate`);
existing bytes are moved by code at computed addresses (`splice` over a
held list-of-lines frame); writes are hash-guarded (`write_back` re-hashes
the disk bytes against the load-time digest and REFUSES a stale write).
Enforcement is tooling shape, not prompt text (§2.8): the surface accepts
structured operations, never blobs to "apply".

A `TrellisTextEdit` holder is injected via rlms `custom_tools` as
`trellis_textedit` ONLY when the operator sets TRELLIS_EDIT_ROOT — never
from a queue payload or a model completion. Every path strictly resolves
inside that root (resolve-then-commonpath, so `..`, absolute paths, and
symlink escapes are refused before any I/O). Unset means nothing is
injected and the system prompt is byte-identical (the TRELLIS_MCP_SERVERS
gating precedent, pinned by npm run test:textedit).

Wrapper discipline (mirrors trellis_workspace.py / trellis_mcp.py): every
model-visible method returns a JSON STRING and raises real exceptions
with readable messages for REPL self-correction. Budgets are validated
configuration with hard maxima; over-budget operations RAISE with usage —
never silent truncation. Slice/hit/diff caps are kernel constants, not
env (Guardrail 5).

Provenance standing: NONE. Toolkit operations are counted by their own
holder-level counters (the mcp_calls mold) and never increment the
database tool-call count; file content read through a frame is working
material, never sourceNodeIds — citability is earned only through
verified ingest/promotion. Frames are transient working state (§2.5):
load -> query -> splice -> write_back -> discard; the store (the file) is
the truth, and the digest guard is what makes that safe.

Frame representation: `text.split("\\n")`. The join is the exact inverse
("\\n".join(split) == text for every text), so a load -> write_back with
no staged splices re-writes the file byte-identically; CR characters in
CRLF files stay embedded in line content and survive moves verbatim.
Addresses are 0-based, half-open [start, end) — Python slice semantics,
computed by `locate`, never estimated by the model.

The guarded splice family (Session 41; design record
docs/architecture/STRUCTURAL_SPLICE.md): `replace_lines`,
`insert_lines`, and `delete_lines` are anchor-guarded, minimal-span
staging operations — every call states the exact bytes it removes (or
inserts beside) and the engine verifies that statement against the
frame byte-exactly BEFORE staging; divergence raises
AnchorMismatchError and stages nothing. A window sharing an unchanged
leading/trailing line between expected and new content is refused as
over-wide with the minimal window named. This is the mechanical answer
to the retype-splice neighbor-deletion class (the record's §1): the
removal set is an explicit, verified declaration, never a side effect
of an index pair. `splice` is unchanged for existing callers.
"""

import hashlib
import json
import os
import posixpath
import re
import stat
import tempfile
import threading

# Bounds: defaults and hard caps (must mirror src/config/index.ts).
TEXTEDIT_MAX_FILE_BYTES_DEFAULT = 4 * 1024 * 1024
TEXTEDIT_MAX_FILE_BYTES_CAP = 32 * 1024 * 1024
TEXTEDIT_MAX_FILES_DEFAULT = 16
TEXTEDIT_MAX_FILES_CAP = 64

# Kernel constants (never env-tunable, never payload-selectable): the
# per-call viewport bounds. Display truncation is not data truncation —
# a capped listing reports the total so the model narrows its query.
TEXTEDIT_SLICE_MAX_LINES = 200
TEXTEDIT_LOCATE_MAX_HITS = 40
TEXTEDIT_DIFF_MAX_LINES = 400
TEXTEDIT_PREVIEW_CHARS = 160

# Guarded-only mode (the July 19, 2026 pass). OFF by default so an unset environment
# keeps the pre-Session-69 surface byte-identical — the additive rule for
# every operator gate in this kernel. Turning it ON removes raw splice()
# from the run: an operator decision, kernel-side, never model-writable.
TEXTEDIT_GUARDED_ONLY_DEFAULT = False


class TextEditBudgetError(Exception):
    """Raised when an operation would exceed a validated budget. The
    message carries current usage so the REPL loop can self-correct."""


class StaleFileError(Exception):
    """Raised by write_back when the bytes on disk no longer match the
    load-time digest: the file moved underneath the frame. The remedy is
    re-load and re-derive — never a silent overwrite (§2.6)."""


class AnchorMismatchError(Exception):
    """Raised by the guarded splice family (Session 41,
    STRUCTURAL_SPLICE.md §3) when the caller's stated bytes diverge
    from the held frame: the model's belief about the window drifted.
    Nothing is staged. The remedy is re-read (`lines`/`locate`) and
    re-derive by query — never retype lines from memory."""


class RawSpliceDisabledError(Exception):
    """Raised by splice() when the toolkit runs in guarded-only mode.

    Session 41 built the guarded family to close the retype-splice
    neighbor-deletion class mechanically, but left raw `splice()`
    reachable with the preference expressed only in prompt prose — so
    the closure was available, not enforced, and the guarded/raw
    telemetry split could only MEASURE the choice after the fact.
    Guarded-only mode is the explicit off-switch (the July 19, 2026 pass, Murphy
    direction, owner-approved): the operator turns it on and the raw
    index-pair path stops existing for that run."""


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


def parse_textedit_bounds(environ=None):
    """Defensive re-validation of the worker-forwarded bounds (the
    parse_workspace_bounds precedent): same defaults and hard caps as the
    Zod schema; a value passing one validator and not the other is a
    defect. Returns (max_file_bytes, max_files)."""
    env = os.environ if environ is None else environ
    return (
        _require_bound(
            env.get("TRELLIS_TEXTEDIT_MAX_FILE_BYTES"),
            "TRELLIS_TEXTEDIT_MAX_FILE_BYTES",
            TEXTEDIT_MAX_FILE_BYTES_DEFAULT,
            TEXTEDIT_MAX_FILE_BYTES_CAP,
        ),
        _require_bound(
            env.get("TRELLIS_TEXTEDIT_MAX_FILES"),
            "TRELLIS_TEXTEDIT_MAX_FILES",
            TEXTEDIT_MAX_FILES_DEFAULT,
            TEXTEDIT_MAX_FILES_CAP,
        ),
    )


def parse_textedit_guarded_only(environ=None):
    """Read the explicit off-switch for raw splice() from the operator
    environment: TRELLIS_TEXTEDIT_GUARDED_ONLY.

    Accepts "1"/"true"/"yes"/"on" (enable) and "0"/"false"/"no"/"off",
    unset, or blank (leave off), case-insensitively. Anything else RAISES
    here, before any paid work — an operator who misspells a safety
    switch must not silently get the unsafe default (the
    parse_mcp_config fail-fast rule). Returns a bool."""
    env = os.environ if environ is None else environ
    raw = env.get("TRELLIS_TEXTEDIT_GUARDED_ONLY")
    if raw is None or raw.strip() == "":
        return TEXTEDIT_GUARDED_ONLY_DEFAULT
    value = raw.strip().lower()
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    raise ValueError(
        "Invalid TRELLIS_TEXTEDIT_GUARDED_ONLY: expected one of "
        "1/true/yes/on or 0/false/no/off (case-insensitive), got "
        f"{raw!r}."
    )


class TrellisTextEdit:
    """The injected editing holder. One held frame per file: the loaded
    snapshot (`original_lines` + digest of the disk bytes at load) and
    the working lines staged splices mutate. The file is the truth; the
    frame is transient."""

    def __init__(self, root, max_file_bytes=None, max_files=None,
                 guarded_only=False):
        if not isinstance(root, str) or root.strip() == "":
            raise ValueError("TRELLIS_EDIT_ROOT must be a non-empty directory path.")
        resolved_root = os.path.realpath(root)
        if not os.path.isdir(resolved_root):
            raise ValueError(
                f"TRELLIS_EDIT_ROOT is not an existing directory: {root!r}."
            )
        self._root = resolved_root
        self._max_file_bytes = _require_bound(
            max_file_bytes, "textedit max_file_bytes",
            TEXTEDIT_MAX_FILE_BYTES_DEFAULT, TEXTEDIT_MAX_FILE_BYTES_CAP)
        self._max_files = _require_bound(
            max_files, "textedit max_files",
            TEXTEDIT_MAX_FILES_DEFAULT, TEXTEDIT_MAX_FILES_CAP)
        if not isinstance(guarded_only, bool):
            raise ValueError(
                "guarded_only must be a bool; parse the operator environment "
                "with parse_textedit_guarded_only()."
            )
        self._guarded_only = guarded_only
        self._lock = threading.RLock()
        self._ops = 0
        self._writes = 0
        self._raw_splices = 0
        self._guarded_ops = 0
        self._raw_splice_refusals = 0
        self._frames = {}

    # --- internal helpers ------------------------------------------------

    def _count_op(self):
        with self._lock:
            self._ops += 1

    def _usage(self):
        return {
            "files": len(self._frames),
            "maxFiles": self._max_files,
            "maxFileBytes": self._max_file_bytes,
        }

    def _normalize(self, relpath):
        """Canonical frame key for a model-supplied relative path, so
        load('./src/a.py') and lines('src/a.py', ...) address the same
        frame. Containment is enforced separately by _resolve."""
        if not isinstance(relpath, str) or relpath.strip() == "":
            raise ValueError("Path must be a non-empty string relative to the edit root.")
        return posixpath.normpath(relpath.replace("\\", "/"))

    def _resolve(self, relpath):
        """Strict containment (Guardrail 4): reject absolute paths and
        any `..` component syntactically, then resolve symlinks and
        require the real path to still sit inside the real root — all
        before any file I/O. Returns (frame_key, absolute_path)."""
        key = self._normalize(relpath)
        # Explicit rooted-path checks besides isabs: Python 3.13 ntpath
        # treats a bare leading slash as drive-relative (not absolute),
        # and a drive prefix without a slash the same way — both are
        # refused as absolute here on every platform.
        if (os.path.isabs(relpath) or relpath.startswith(("/", "\\"))
                or re.match(r"^[A-Za-z]:", relpath)):
            raise ValueError(
                f"Absolute paths are refused: {relpath!r}. "
                f"Paths are relative to the edit root."
            )
        if key == ".." or key.startswith("../"):
            raise ValueError(
                f"Path {relpath!r} escapes the edit root ('..' components are refused)."
            )
        resolved = os.path.realpath(os.path.join(self._root, key))
        try:
            contained = os.path.commonpath([self._root, resolved]) == self._root
        except ValueError:
            # Different drives on Windows: definitionally outside the root.
            contained = False
        if not contained:
            raise ValueError(
                f"Path {relpath!r} resolves outside the edit root and is refused."
            )
        return key, resolved

    def _require_frame(self, relpath):
        key = self._normalize(relpath)
        frame = self._frames.get(key)
        if frame is None:
            raise ValueError(
                f"No held frame for {key!r}. Call trellis_textedit.load(relpath) first; "
                f"held frames: {sorted(self._frames) or 'none'}."
            )
        return key, frame

    @staticmethod
    def _digest(data):
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def _frame_bytes(lines):
        return len("\n".join(lines).encode("utf-8"))

    def _require_index_pair(self, start, end, line_count):
        for name, value in (("start", start), ("end", end)):
            if not isinstance(value, int) or isinstance(value, bool):
                raise ValueError(f"{name} must be an integer line index, got {value!r}.")
        if not 0 <= start <= end <= line_count:
            raise ValueError(
                f"Line range [{start}, {end}) is invalid for a {line_count}-line frame: "
                f"addresses are 0-based, half-open, engine-computed — re-run "
                f"trellis_textedit.locate() rather than estimating positions."
            )

    # --- model-visible surface (JSON strings, real exceptions) -----------

    def load(self, relpath) -> str:
        """Reads a file into a held frame (lines + load-time digest) and
        returns its shape. Re-loading refreshes the frame from disk and
        DISCARDS any staged splices."""
        self._count_op()
        key, resolved = self._resolve(relpath)
        with self._lock:
            if key not in self._frames and len(self._frames) + 1 > self._max_files:
                raise TextEditBudgetError(
                    f"Frame budget exceeded: {self._max_files} files are already held "
                    f"(current usage: {json.dumps(self._usage())}). Drop frames you no "
                    f"longer need with trellis_textedit.drop(relpath), then retry."
                )
            if not os.path.isfile(resolved):
                raise ValueError(
                    f"{key!r} is not an existing regular file under the edit root."
                )
            size = os.path.getsize(resolved)
            if size > self._max_file_bytes:
                raise TextEditBudgetError(
                    f"File budget exceeded: {key!r} is {size} bytes, over the "
                    f"{self._max_file_bytes}-byte per-file maximum "
                    f"(current usage: {json.dumps(self._usage())})."
                )
            with open(resolved, "rb") as f:
                data = f.read()
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError as e:
                raise ValueError(
                    f"{key!r} is not valid UTF-8 text ({e}); the editing toolkit "
                    f"handles text files only."
                ) from None
            lines = text.split("\n")
            self._frames[key] = {
                "abs": resolved,
                "digest": self._digest(data),
                "bytes": len(data),
                "original_lines": list(lines),
                "lines": lines,
                "splices": 0,
            }
            return json.dumps({
                "path": key,
                "lineCount": len(lines),
                "bytes": len(data),
                "digest": self._frames[key]["digest"],
            })

    def lines(self, relpath, start, end) -> str:
        """A bounded slice of the working frame: pairs of [index, text]
        for the half-open range [start, end)."""
        self._count_op()
        with self._lock:
            key, frame = self._require_frame(relpath)
            self._require_index_pair(start, end, len(frame["lines"]))
            if end - start > TEXTEDIT_SLICE_MAX_LINES:
                raise ValueError(
                    f"Slice of {end - start} lines exceeds the {TEXTEDIT_SLICE_MAX_LINES}-line "
                    f"per-call bound. Narrow the range; locate() finds the neighborhood."
                )
            return json.dumps({
                "path": key,
                "start": start,
                "end": end,
                "lines": [[i, frame["lines"][i]] for i in range(start, end)],
            })

    def locate(self, relpath, pattern, regex=False) -> str:
        """Engine-computed addresses for a content query over the working
        frame: a bounded hit listing plus the total count. This is the
        pillar's read half — the model queries for a location, it never
        counts lines."""
        self._count_op()
        if not isinstance(pattern, str) or pattern == "":
            raise ValueError("locate() needs a non-empty string pattern.")
        if regex:
            try:
                matcher = re.compile(pattern)
            except re.error as e:
                raise ValueError(f"Invalid regular expression {pattern!r}: {e}") from None
            match = matcher.search
        else:
            match = lambda text: pattern in text  # noqa: E731
        with self._lock:
            key, frame = self._require_frame(relpath)
            hits = []
            total = 0
            for i, text in enumerate(frame["lines"]):
                if match(text):
                    total += 1
                    if len(hits) < TEXTEDIT_LOCATE_MAX_HITS:
                        hits.append({"line": i, "preview": text[:TEXTEDIT_PREVIEW_CHARS]})
            return json.dumps({
                "path": key,
                "pattern": pattern,
                "regex": bool(regex),
                "totalHits": total,
                "capped": total > len(hits),
                "hits": hits,
            })

    def splice(self, relpath, start, end, new_lines) -> str:
        """Stages the replacement of working lines[start:end] with
        new_lines (a list of newline-free strings). Nothing touches disk
        until write_back. Splices compose; every address is transient —
        re-locate after each splice, never reuse a pre-splice index.

        Refused outright when the toolkit runs in guarded-only mode: see
        RawSpliceDisabledError and `replace_lines`/`insert_lines`/
        `delete_lines`, which state the bytes they are removing and are
        verified against the frame before anything is staged."""
        self._count_op()
        if self._guarded_only:
            self._raw_splice_refusals += 1
            raise RawSpliceDisabledError(
                "Raw splice() is disabled for this run (guarded-only mode). A "
                "bare index pair states no belief about WHICH bytes it "
                "removes, so a drifted window deletes neighbors silently. Use "
                "the guarded family, which verifies your stated bytes against "
                "the frame first: replace_lines(relpath, start, "
                "expected_lines, new_lines) to change a window, "
                "insert_lines(relpath, at, new_lines, after_lines=..., "
                "before_lines=...) to add without removing, and "
                "delete_lines(relpath, start, expected_lines) to remove. "
                "Re-derive the window with locate() or lines() first."
            )
        if not isinstance(new_lines, list) or any(not isinstance(l, str) for l in new_lines):
            raise ValueError(
                "new_lines must be a LIST of strings (one per line) — got "
                f"{type(new_lines).__name__}. To insert one line pass a one-element list."
            )
        for l in new_lines:
            # Refuse only "\n" — the frame delimiter. A "\r" is an ordinary
            # byte WITHIN a line under the text.split("\n") frame (every
            # line of a CRLF file ends with one), and refusing it made CRLF
            # files impossible to line-replace: the replacement must carry
            # the trailing "\r" to keep the moved bytes verbatim. Found
            # live by the Session 26 Trellis-edits-Trellis proof run.
            if "\n" in l:
                raise ValueError(
                    "new_lines entries must not contain newline characters; split the "
                    "text into one string per line first (text.split('\\n'))."
                )
        with self._lock:
            key, frame = self._require_frame(relpath)
            self._require_index_pair(start, end, len(frame["lines"]))
            staged = frame["lines"][:start] + new_lines + frame["lines"][end:]
            staged_bytes = self._frame_bytes(staged)
            if staged_bytes > self._max_file_bytes:
                raise TextEditBudgetError(
                    f"File budget exceeded: the staged frame for {key!r} would be "
                    f"{staged_bytes} bytes, over the {self._max_file_bytes}-byte per-file "
                    f"maximum (current usage: {json.dumps(self._usage())})."
                )
            frame["lines"] = staged
            frame["splices"] += 1
            self._raw_splices += 1
            return json.dumps({
                "path": key,
                "start": start,
                "end": end,
                "removed": end - start,
                "inserted": len(new_lines),
                "lineCount": len(staged),
                "pendingSplices": frame["splices"],
            })

    # --- the guarded splice family (Session 41, STRUCTURAL_SPLICE.md) ----

    @staticmethod
    def _require_guarded_lines(name, value):
        """The splice line-list contract, applied to a guarded argument:
        a list of newline-free strings ("\\r" is an ordinary byte within
        a line, the CRLF precedent)."""
        if not isinstance(value, list) or any(not isinstance(l, str) for l in value):
            raise ValueError(
                f"{name} must be a LIST of strings (one per line) — got "
                f"{type(value).__name__}."
            )
        for l in value:
            if "\n" in l:
                raise ValueError(
                    f"{name} entries must not contain newline characters; split the "
                    "text into one string per line first (text.split('\\n'))."
                )

    def _verify_anchor_lines(self, key, frame, start, expected_lines, name):
        """Byte-exact verification of the caller's stated bytes against
        the frame. Divergence raises AnchorMismatchError naming the
        first divergent absolute line with bounded previews — nothing
        is staged."""
        for offset, expected in enumerate(expected_lines):
            actual = frame["lines"][start + offset]
            if actual != expected:
                raise AnchorMismatchError(
                    f"Anchor mismatch for {key!r} at line {start + offset} ({name}): "
                    f"expected {expected[:TEXTEDIT_PREVIEW_CHARS]!r}, the frame holds "
                    f"{actual[:TEXTEDIT_PREVIEW_CHARS]!r}. Nothing was staged. Re-read "
                    f"the window with trellis_textedit.lines() and re-derive the edit "
                    f"by query — never retype lines from memory."
                )

    def _stage_window(self, key, frame, start, end, new_lines):
        """Shared staging for the guarded family: the splice staging
        semantics (budget check first, nothing staged on refusal),
        counted as a guarded operation."""
        staged = frame["lines"][:start] + new_lines + frame["lines"][end:]
        staged_bytes = self._frame_bytes(staged)
        if staged_bytes > self._max_file_bytes:
            raise TextEditBudgetError(
                f"File budget exceeded: the staged frame for {key!r} would be "
                f"{staged_bytes} bytes, over the {self._max_file_bytes}-byte per-file "
                f"maximum (current usage: {json.dumps(self._usage())})."
            )
        frame["lines"] = staged
        frame["splices"] += 1
        self._guarded_ops += 1
        return staged

    def replace_lines(self, relpath, start, end, expected_lines, new_lines) -> str:
        """The guarded replacement (STRUCTURAL_SPLICE.md §3.1): replaces
        working lines[start:end] with new_lines ONLY after verifying
        that expected_lines byte-matches the removed window. The removal
        set is an explicit declaration, never a side effect of an index
        pair. A window sharing an unchanged leading/trailing line with
        new_lines is refused as over-wide with the minimal window named
        — unchanged neighbors stay OUTSIDE a guarded edit. Nothing
        touches disk until write_back."""
        self._count_op()
        self._require_guarded_lines("expected_lines", expected_lines)
        self._require_guarded_lines("new_lines", new_lines)
        if not expected_lines:
            raise ValueError(
                "replace_lines() needs a non-empty expected_lines — a pure "
                "insertion is insert_lines()."
            )
        if not new_lines:
            raise ValueError(
                "replace_lines() needs a non-empty new_lines — a pure deletion "
                "is delete_lines()."
            )
        with self._lock:
            key, frame = self._require_frame(relpath)
            self._require_index_pair(start, end, len(frame["lines"]))
            if end - start != len(expected_lines):
                raise ValueError(
                    f"expected_lines must state exactly the removed window: "
                    f"[{start}, {end}) is {end - start} line(s) but "
                    f"{len(expected_lines)} expected line(s) were given."
                )
            self._verify_anchor_lines(key, frame, start, expected_lines, "expected_lines")
            if expected_lines == new_lines:
                raise ValueError(
                    f"expected_lines and new_lines are identical for {key!r}: the "
                    f"window is entirely unchanged neighbors — nothing to edit."
                )
            lead = 0
            max_lead = min(len(expected_lines), len(new_lines))
            while lead < max_lead and expected_lines[lead] == new_lines[lead]:
                lead += 1
            trail = 0
            max_trail = min(len(expected_lines), len(new_lines)) - lead
            while trail < max_trail and expected_lines[-1 - trail] == new_lines[-1 - trail]:
                trail += 1
            if lead or trail:
                raise ValueError(
                    f"Over-wide window for {key!r}: expected_lines and new_lines "
                    f"share {lead} leading and {trail} trailing unchanged line(s); "
                    f"unchanged neighbors stay OUTSIDE a guarded edit. The minimal "
                    f"window is [{start + lead}, {end - trail}) — retry with the "
                    f"{len(expected_lines) - lead - trail} changed expected line(s) "
                    f"and the {len(new_lines) - lead - trail} changed new line(s)."
                )
            staged = self._stage_window(key, frame, start, end, new_lines)
            return json.dumps({
                "path": key,
                "start": start,
                "end": end,
                "removed": end - start,
                "inserted": len(new_lines),
                "lineCount": len(staged),
                "pendingSplices": frame["splices"],
                "guarded": True,
            })

    def insert_lines(self, relpath, at, new_lines,
                     anchor_before=None, anchor_after=None) -> str:
        """The guarded insertion (STRUCTURAL_SPLICE.md §3.2): inserts
        new_lines at index `at` — nothing is removed, so nothing can be
        dropped, by construction. At least one anchor is REQUIRED:
        anchor_before is the expected full text of line at-1,
        anchor_after of line at; each supplied anchor is verified
        byte-exactly, which is what makes an address-drift insertion
        refusable instead of silent."""
        self._count_op()
        self._require_guarded_lines("new_lines", new_lines)
        if not new_lines:
            raise ValueError("insert_lines() needs a non-empty new_lines list.")
        for name, anchor in (("anchor_before", anchor_before),
                             ("anchor_after", anchor_after)):
            if anchor is not None:
                if not isinstance(anchor, str):
                    raise ValueError(
                        f"{name} must be a string (the expected full text of the "
                        f"neighboring line), got {type(anchor).__name__}."
                    )
                if "\n" in anchor:
                    raise ValueError(
                        f"{name} must be a single line (no newline characters)."
                    )
        if anchor_before is None and anchor_after is None:
            raise ValueError(
                "insert_lines() requires at least one anchor (anchor_before "
                "and/or anchor_after): the expected text of a neighboring line "
                "is what makes an address-drift insertion refusable. Read the "
                "neighbors with trellis_textedit.lines() first."
            )
        with self._lock:
            key, frame = self._require_frame(relpath)
            line_count = len(frame["lines"])
            if not isinstance(at, int) or isinstance(at, bool) or not 0 <= at <= line_count:
                raise ValueError(
                    f"at must be an integer insertion index in [0, {line_count}], "
                    f"got {at!r}."
                )
            if anchor_before is not None:
                if at == 0:
                    raise ValueError(
                        "anchor_before is impossible at index 0: no line exists "
                        "above the insertion point."
                    )
                self._verify_anchor_lines(key, frame, at - 1, [anchor_before],
                                          "anchor_before")
            if anchor_after is not None:
                if at == line_count:
                    raise ValueError(
                        f"anchor_after is impossible at index {at}: no line exists "
                        f"below the insertion point."
                    )
                self._verify_anchor_lines(key, frame, at, [anchor_after],
                                          "anchor_after")
            staged = self._stage_window(key, frame, at, at, new_lines)
            return json.dumps({
                "path": key,
                "at": at,
                "inserted": len(new_lines),
                "lineCount": len(staged),
                "pendingSplices": frame["splices"],
                "guarded": True,
            })

    def delete_lines(self, relpath, start, end, expected_lines) -> str:
        """The guarded deletion (STRUCTURAL_SPLICE.md §3.3): removes
        [start, end) ONLY after verifying that expected_lines
        byte-matches the removed window. Deletion under the guarded
        family is an explicit, verified declaration — never a retype
        side effect."""
        self._count_op()
        self._require_guarded_lines("expected_lines", expected_lines)
        if not expected_lines:
            raise ValueError(
                "delete_lines() needs a non-empty expected_lines stating exactly "
                "the lines being removed."
            )
        with self._lock:
            key, frame = self._require_frame(relpath)
            self._require_index_pair(start, end, len(frame["lines"]))
            if end - start != len(expected_lines):
                raise ValueError(
                    f"expected_lines must state exactly the removed window: "
                    f"[{start}, {end}) is {end - start} line(s) but "
                    f"{len(expected_lines)} expected line(s) were given."
                )
            self._verify_anchor_lines(key, frame, start, expected_lines, "expected_lines")
            staged = self._stage_window(key, frame, start, end, [])
            return json.dumps({
                "path": key,
                "start": start,
                "end": end,
                "removed": end - start,
                "lineCount": len(staged),
                "pendingSplices": frame["splices"],
                "guarded": True,
            })

    def diff(self, relpath) -> str:
        """A bounded unified diff of the working frame against the loaded
        snapshot — the in-REPL review affordance. Bounded display only:
        the staged data itself is never truncated."""
        self._count_op()
        import difflib
        with self._lock:
            key, frame = self._require_frame(relpath)
            diff_lines = list(difflib.unified_diff(
                frame["original_lines"], frame["lines"],
                fromfile=f"{key}@loaded", tofile=f"{key}@staged", lineterm=""))
            truncated = len(diff_lines) > TEXTEDIT_DIFF_MAX_LINES
            if truncated:
                diff_lines = diff_lines[:TEXTEDIT_DIFF_MAX_LINES]
            return json.dumps({
                "path": key,
                "pendingSplices": frame["splices"],
                "truncated": truncated,
                "diff": "\n".join(diff_lines),
            })

    def revert(self, relpath) -> str:
        """Discards staged splices, restoring the working frame to the
        loaded snapshot."""
        self._count_op()
        with self._lock:
            key, frame = self._require_frame(relpath)
            frame["lines"] = list(frame["original_lines"])
            frame["splices"] = 0
            return json.dumps({"path": key, "reverted": True,
                               "lineCount": len(frame["lines"])})

    def drop(self, relpath) -> str:
        """Frees one held frame (staged splices included), releasing its
        slot in the frame budget. The file on disk is untouched."""
        self._count_op()
        with self._lock:
            key = self._normalize(relpath)
            frame = self._frames.pop(key, None)
            if frame is None:
                raise ValueError(
                    f"No held frame for {key!r}; held frames: "
                    f"{sorted(self._frames) or 'none'}."
                )
            return json.dumps({"path": key, "dropped": True,
                               "pendingSplicesDiscarded": frame["splices"]})

    def write_back(self, relpath) -> str:
        """THE hash guard (§2.6): re-hashes the CURRENT disk bytes; a
        mismatch with the load-time digest RAISES and writes nothing —
        the file moved, so the frame's addresses are meaningless; re-load
        and re-derive. On a match, writes the working frame atomically
        (temp file + rename in the same directory) and refreshes the held
        snapshot to the just-written state.

        Session 29 hardening (coverage audit #2/#3/#4): containment is
        re-verified against the CURRENT resolved path (the load-time
        `_resolve` re-run, never a second implementation) and a path
        that resolves differently than it did at load is refused as
        stale; the original file mode is preserved onto the replacement
        (POSIX-meaningful — the executable bit on a script or hook no
        longer vanishes; Windows mode bits are a no-op); and the digest
        is re-checked immediately before the atomic replace. That final
        re-check NARROWS the check-to-replace race to the microseconds
        between the last re-hash and os.replace — it does not eliminate
        it. Full elimination needs OS file locking, which is out of
        scope; a second writer landing inside the residual window is
        still silently overwritten."""
        self._count_op()
        with self._lock:
            key, frame = self._require_frame(relpath)
            # Coverage audit #3: a parent directory swapped for a
            # symlink/junction AFTER load must be refused here too — the
            # OS resolves the stored path fresh at write time, so the
            # load-time check alone does not cover the write.
            _, resolved = self._resolve(key)
            if resolved != frame["abs"]:
                raise StaleFileError(
                    f"{key!r} no longer resolves to the path it resolved to at load "
                    f"(the directory tree changed underneath the frame). Nothing was "
                    f"written. Re-load the file and re-derive your edits by query."
                )
            if not os.path.isfile(resolved):
                raise StaleFileError(
                    f"{key!r} no longer exists on disk; the held frame is stale. "
                    f"Nothing was written."
                )
            with open(resolved, "rb") as f:
                current = f.read()
            if self._digest(current) != frame["digest"]:
                raise StaleFileError(
                    f"Digest mismatch for {key!r}: the file on disk changed since load "
                    f"(expected {frame['digest'][:12]}..., found "
                    f"{self._digest(current)[:12]}...). Nothing was written. Re-load the "
                    f"file and re-derive your edits by query — never retype them."
                )
            source_mode = stat.S_IMODE(os.stat(resolved).st_mode)
            data = "\n".join(frame["lines"]).encode("utf-8")
            fd, temp_path = tempfile.mkstemp(
                prefix=".trellis-textedit-", dir=os.path.dirname(resolved))
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                # Coverage audit #4: mkstemp creates 0600 — carry the
                # source's mode onto the replacement before it lands.
                os.chmod(temp_path, source_mode)
                # Coverage audit #2: the narrowed window — re-hash one
                # final time immediately before the replace, so a second
                # writer landing while the temp file was being built is
                # detected instead of overwritten.
                with open(resolved, "rb") as f:
                    final = f.read()
                if self._digest(final) != frame["digest"]:
                    raise StaleFileError(
                        f"Digest mismatch for {key!r}: a second writer changed the file "
                        f"while the replacement was being prepared. Nothing was written. "
                        f"Re-load the file and re-derive your edits by query."
                    )
                os.replace(temp_path, resolved)
            except BaseException:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
                raise
            new_digest = self._digest(data)
            frame["digest"] = new_digest
            frame["bytes"] = len(data)
            frame["original_lines"] = list(frame["lines"])
            frame["splices"] = 0
            self._writes += 1
            return json.dumps({
                "path": key,
                "bytesWritten": len(data),
                "newDigest": new_digest,
            })

    # --- telemetry (counts only — paths and content never leave) ---------

    def stats(self):
        """Bounded counters for the TRELLIS_TELEMETRY line (T16). Counts
        only: never a path, a pattern, file content, or a digest. The
        Session 41 split (guarded vs raw staging counts) is the lever an
        executable-class acceptance criterion can pre-state:
        a guarded-only run is textedit_raw_splices == 0.

        The July 19, 2026 pass adds the mode itself and its refusal count, so a run
        summary distinguishes the two ways that zero arises: a run that
        COULD have spliced raw and chose not to, versus a run where the
        operator removed the path. The first is behavior; the second is
        enforcement, and only the second is evidence about the tool."""
        with self._lock:
            return {
                "textedit_ops": self._ops,
                "textedit_files": len(self._frames),
                "textedit_writes": self._writes,
                "textedit_guarded_ops": self._guarded_ops,
                "textedit_raw_splices": self._raw_splices,
                "textedit_guarded_only": self._guarded_only,
                "textedit_raw_splice_refusals": self._raw_splice_refusals,
            }


# The prompt addendum, appended when (and only when) the toolkit is
# injected. rlms runs .format() over the system prompt, so this text is
# brace-free (the workspace addendum idiom).
#
# July 19, 2026 (harness-invariants pass): the text is composed HEAD + <mode block> + TAIL so the
# raw-splice bullet is not taught to a run that would refuse it. The
# default (raw-allowed) composition is byte-identical to the
# pre-Session-69 constant — only the guarded-only arm is new text.
_TEXTEDIT_ADDENDUM_HEAD = """

=== TEXT EDITING (CODE-MEDIATED, HASH-GUARDED) ===
`trellis_textedit` edits files under the operator-configured edit root. Paths are relative to the root; nothing outside it is reachable. Every method returns a JSON STRING — wrap results in json.loads(...). Line addresses are 0-based and half-open, exactly Python slice semantics.
- `trellis_textedit.load(relpath)` reads a file into a held frame and returns its lineCount, bytes, and content digest. Re-loading refreshes from disk and DISCARDS staged edits.
- `trellis_textedit.lines(relpath, start, end)` returns the slice [start, end) as pairs of line index and text (bounded per call).
- `trellis_textedit.locate(relpath, pattern, regex=False)` returns engine-computed line addresses for a content query: bounded hits plus the total count. LOCATE, NEVER COUNT: query for every address; never estimate a line number by reading the file.
"""

# Raw-allowed mode (default): the pre-Session-69 bullets, verbatim.
_TEXTEDIT_ADDENDUM_RAW_MODE = """- `trellis_textedit.splice(relpath, start, end, new_lines)` stages the replacement of lines start..end with new_lines, a LIST of newline-free strings. Author only genuinely NEW lines; move existing text by slicing it out of the frame in code — never retype lines that already exist. Addresses are transient: re-locate after every splice.
- PREFER THE GUARDED FAMILY for every edit. Each guarded call states the exact bytes it removes or inserts beside, and the engine verifies that statement against the frame BEFORE staging; a divergence raises AnchorMismatchError and stages nothing — re-read with lines() and re-derive, never retype from memory.
"""

# Guarded-only mode: the raw path does not exist for this run, so it is
# described as absent rather than discouraged. Positive framing — the
# text says which calls to make, not which to avoid.
_TEXTEDIT_ADDENDUM_GUARDED_MODE = """- *** GUARDED-ONLY MODE IS ACTIVE FOR THIS RUN. *** Every edit goes through the guarded family below. Each guarded call states the exact bytes it removes or inserts beside, and the engine verifies that statement against the frame BEFORE staging; a divergence raises AnchorMismatchError and stages nothing — re-read with lines() and re-derive, never retype from memory.
- The raw `trellis_textedit.splice(relpath, start, end, new_lines)` path is DISABLED and raises RawSpliceDisabledError. A bare index pair states no belief about which bytes it removes, so a drifted window deletes neighbors silently. State your bytes and let the engine check them.
"""

_TEXTEDIT_ADDENDUM_TAIL = """- `trellis_textedit.replace_lines(relpath, start, end, expected_lines, new_lines)` replaces exactly [start, end): expected_lines must byte-match the removed lines. A window sharing an unchanged leading or trailing line with new_lines is refused as over-wide and the refusal names the minimal window — keep unchanged neighbors OUTSIDE the window.
- `trellis_textedit.insert_lines(relpath, at, new_lines, anchor_before=None, anchor_after=None)` inserts at index `at` and removes nothing. At least one anchor — the expected full text of the neighboring line — is required and verified.
- `trellis_textedit.delete_lines(relpath, start, end, expected_lines)` removes exactly the verified lines: deletion is an explicit declaration, never a retype side effect.
- `trellis_textedit.diff(relpath)` shows a bounded unified diff of staged edits; `trellis_textedit.revert(relpath)` discards them; `trellis_textedit.drop(relpath)` frees a frame slot.
- `trellis_textedit.write_back(relpath)` verifies the disk bytes still match the load-time digest, then writes the staged frame atomically. A digest mismatch RAISES and writes nothing: the file changed since load — re-load and re-derive your edits by query; never reconstruct them from memory.
Budgets are bounded; over-budget operations raise with current usage. HARD RULE: toolkit operations have NO provenance standing — they never count as database tool calls, and file content is NEVER sourceNodeIds; database provenance stays mandatory for every answer and every cached insight.
"""

# The default composition, byte-identical to the pre-Session-69
# constant. Kept as a module-level name because the drills and the
# addendum-identity pins address it directly.
TEXTEDIT_ADDENDUM = (
    _TEXTEDIT_ADDENDUM_HEAD
    + _TEXTEDIT_ADDENDUM_RAW_MODE
    + _TEXTEDIT_ADDENDUM_TAIL
)

TEXTEDIT_ADDENDUM_GUARDED_ONLY = (
    _TEXTEDIT_ADDENDUM_HEAD
    + _TEXTEDIT_ADDENDUM_GUARDED_MODE
    + _TEXTEDIT_ADDENDUM_TAIL
)


def build_textedit_addendum(textedit) -> str:
    """Empty string when no toolkit is injected, so a gated-off run's
    system prompt stays byte-identical (the build_mcp_addendum /
    build_workspace_addendum precedent, pinned by test).

    When the toolkit runs in guarded-only mode the addendum describes
    the guarded family as the whole surface and names the raw path as
    disabled — a run is never taught a call that would refuse it."""
    if textedit is None:
        return ""
    if getattr(textedit, "_guarded_only", False):
        return TEXTEDIT_ADDENDUM_GUARDED_ONLY
    return TEXTEDIT_ADDENDUM
