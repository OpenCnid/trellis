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
"""

import hashlib
import json
import os
import posixpath
import re
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


class TextEditBudgetError(Exception):
    """Raised when an operation would exceed a validated budget. The
    message carries current usage so the REPL loop can self-correct."""


class StaleFileError(Exception):
    """Raised by write_back when the bytes on disk no longer match the
    load-time digest: the file moved underneath the frame. The remedy is
    re-load and re-derive — never a silent overwrite (§2.6)."""


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


class TrellisTextEdit:
    """The injected editing holder. One held frame per file: the loaded
    snapshot (`original_lines` + digest of the disk bytes at load) and
    the working lines staged splices mutate. The file is the truth; the
    frame is transient."""

    def __init__(self, root, max_file_bytes=None, max_files=None):
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
        self._lock = threading.RLock()
        self._ops = 0
        self._writes = 0
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
        re-locate after each splice, never reuse a pre-splice index."""
        self._count_op()
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
            return json.dumps({
                "path": key,
                "start": start,
                "end": end,
                "removed": end - start,
                "inserted": len(new_lines),
                "lineCount": len(staged),
                "pendingSplices": frame["splices"],
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
        snapshot to the just-written state."""
        self._count_op()
        with self._lock:
            key, frame = self._require_frame(relpath)
            resolved = frame["abs"]
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
            data = "\n".join(frame["lines"]).encode("utf-8")
            fd, temp_path = tempfile.mkstemp(
                prefix=".trellis-textedit-", dir=os.path.dirname(resolved))
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
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
        only: never a path, a pattern, file content, or a digest."""
        with self._lock:
            return {
                "textedit_ops": self._ops,
                "textedit_files": len(self._frames),
                "textedit_writes": self._writes,
            }


# The prompt addendum, appended when (and only when) the toolkit is
# injected. rlms runs .format() over the system prompt, so this text is
# brace-free (the workspace addendum idiom).
TEXTEDIT_ADDENDUM = """

=== TEXT EDITING (CODE-MEDIATED, HASH-GUARDED) ===
`trellis_textedit` edits files under the operator-configured edit root. Paths are relative to the root; nothing outside it is reachable. Every method returns a JSON STRING — wrap results in json.loads(...). Line addresses are 0-based and half-open, exactly Python slice semantics.
- `trellis_textedit.load(relpath)` reads a file into a held frame and returns its lineCount, bytes, and content digest. Re-loading refreshes from disk and DISCARDS staged edits.
- `trellis_textedit.lines(relpath, start, end)` returns the slice [start, end) as pairs of line index and text (bounded per call).
- `trellis_textedit.locate(relpath, pattern, regex=False)` returns engine-computed line addresses for a content query: bounded hits plus the total count. LOCATE, NEVER COUNT: query for every address; never estimate a line number by reading the file.
- `trellis_textedit.splice(relpath, start, end, new_lines)` stages the replacement of lines start..end with new_lines, a LIST of newline-free strings. Author only genuinely NEW lines; move existing text by slicing it out of the frame in code — never retype lines that already exist. Addresses are transient: re-locate after every splice.
- `trellis_textedit.diff(relpath)` shows a bounded unified diff of staged edits; `trellis_textedit.revert(relpath)` discards them; `trellis_textedit.drop(relpath)` frees a frame slot.
- `trellis_textedit.write_back(relpath)` verifies the disk bytes still match the load-time digest, then writes the staged frame atomically. A digest mismatch RAISES and writes nothing: the file changed since load — re-load and re-derive your edits by query; never reconstruct them from memory.
Budgets are bounded; over-budget operations raise with current usage. HARD RULE: toolkit operations have NO provenance standing — they never count as database tool calls, and file content is NEVER sourceNodeIds; database provenance stays mandatory for every answer and every cached insight.
"""


def build_textedit_addendum(textedit) -> str:
    """Empty string when no toolkit is injected, so a gated-off run's
    system prompt stays byte-identical (the build_mcp_addendum /
    build_workspace_addendum precedent, pinned by test)."""
    if textedit is None:
        return ""
    return TEXTEDIT_ADDENDUM
