"""Bounded statement inspection for the host DB broker.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 5
(DB-broker RPC surface), the Postgres and Neo4j control tables;
REPL_SANDBOX_ARCHITECTURE.md section 7 (Security requirements) requirements 6, 7
and 9; REPL_SANDBOX_THREAT_MODEL.md rows DB-1, DB-2 and DB-3.

**Which control is primary, and which is defense-in-depth.** For Postgres the
primary control is the *role*: a `NOSUPERUSER`, read-only role that cannot
execute `pg_read_server_files`, `pg_execute_server_program`, `dblink`,
`lo_import`/`lo_export`, `pg_read_file` or `COPY ... TO/FROM PROGRAM` however the
statement is spelled. For Neo4j the primary control is the Bolt session's
`default_access_mode = READ`. Neither of those is in this file — they live where
the real client is constructed. What *is* here is the layer on top: a small,
bounded, auditable inspection that refuses the same primitives before the
statement ever reaches a driver.

The inspector is deliberately dumb. Proxy parsers that try to be clever about SQL
are a known CVE class (REPL_SANDBOX_RESEARCH.md section 10.3), so this one does
one thing: strip the places text can hide (comments, string literals, quoted
identifiers, dollar-quoted bodies), then match a fixed token list over what is
left. It is length-bounded, allocation-bounded, and every refusal names the token
that caused it. Anything it cannot lex confidently — an unterminated literal, an
unterminated comment — is refused rather than guessed at.

Because it is conservative it will occasionally refuse a legitimate read (a
column literally named `set`, say). That is the intended failure direction: the
role is what makes the system safe, and this layer is allowed to be strict.
"""

from __future__ import annotations

import re

from repl_sandbox.errors import DeniedError

#: Longest statement the inspector will look at. Above this it refuses rather
#: than scanning, so the inspection cost is bounded by construction. The broker
#: bounds the whole args blob well below this too; this is the standalone bound
#: for callers that use the inspector directly.
MAX_STATEMENT_CHARS = 64 * 1024


# ---------------------------------------------------------------------------
# Lexical stripping — remove every place a denied token could hide
# ---------------------------------------------------------------------------

_DOLLAR_TAG_RE = re.compile(r"\$([A-Za-z_][A-Za-z_0-9]*)?\$")


def _is_word_char(ch: str) -> bool:
    return ch.isalnum() or ch == "_"


def _strip_sql_noise(sql: str) -> str:
    """Replace SQL comments, string literals, and quoted identifiers with spaces.

    Spaces rather than nothing, so that stripping never fuses two tokens into a
    third. Handles `--` line comments, nested `/* */` block comments (Postgres
    nests them), `'...'` with `''` doubling, `E'...'` with backslash escapes,
    `"..."` quoted identifiers, and `$tag$...$tag$` dollar quoting.

    An unterminated literal or comment raises rather than returning a
    best-effort strip: if the lexer cannot tell where the code ends, no scan of
    the result means anything.
    """
    out: list[str] = []
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        if sql.startswith("--", i):
            end = sql.find("\n", i)
            i = n if end == -1 else end
            out.append(" ")
        elif sql.startswith("/*", i):
            depth = 1
            i += 2
            while i < n and depth:
                if sql.startswith("/*", i):
                    depth += 1
                    i += 2
                elif sql.startswith("*/", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            if depth:
                raise DeniedError("statement has an unterminated block comment")
            out.append(" ")
        elif ch == "'":
            backslash_escapes = (
                i >= 1
                and sql[i - 1] in "Ee"
                and (i < 2 or not _is_word_char(sql[i - 2]))
            )
            i += 1
            closed = False
            while i < n:
                cur = sql[i]
                if backslash_escapes and cur == "\\" and i + 1 < n:
                    i += 2
                    continue
                if cur == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2
                        continue
                    i += 1
                    closed = True
                    break
                i += 1
            if not closed:
                raise DeniedError("statement has an unterminated string literal")
            out.append(" ")
        elif ch == '"':
            i += 1
            closed = False
            while i < n:
                if sql[i] == '"':
                    if i + 1 < n and sql[i + 1] == '"':
                        i += 2
                        continue
                    i += 1
                    closed = True
                    break
                i += 1
            if not closed:
                raise DeniedError("statement has an unterminated quoted identifier")
            out.append(" ")
        elif ch == "$":
            match = _DOLLAR_TAG_RE.match(sql, i)
            if match is None:
                # A bare `$` — a `$1` placeholder, not a dollar-quoted body.
                out.append(ch)
                i += 1
                continue
            tag = match.group(0)
            end = sql.find(tag, match.end())
            if end == -1:
                raise DeniedError("statement has an unterminated dollar-quoted string")
            i = end + len(tag)
            out.append(" ")
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _strip_cypher_noise(query: str) -> str:
    """Replace Cypher comments, string literals, and backticked names with spaces.

    Cypher's lexical rules differ from SQL's: `//` line comments, non-nesting
    `/* */`, backslash escapes inside both `'...'` and `"..."`, and backticked
    identifiers. Same fail-closed discipline on anything unterminated.
    """
    out: list[str] = []
    i = 0
    n = len(query)
    while i < n:
        ch = query[i]
        if query.startswith("//", i):
            end = query.find("\n", i)
            i = n if end == -1 else end
            out.append(" ")
        elif query.startswith("/*", i):
            end = query.find("*/", i + 2)
            if end == -1:
                raise DeniedError("query has an unterminated block comment")
            i = end + 2
            out.append(" ")
        elif ch in "'\"`":
            quote = ch
            i += 1
            closed = False
            while i < n:
                cur = query[i]
                if cur == "\\" and quote != "`" and i + 1 < n:
                    i += 2
                    continue
                if cur == quote:
                    i += 1
                    closed = True
                    break
                i += 1
            if not closed:
                raise DeniedError("query has an unterminated string or quoted name")
            out.append(" ")
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _guard_input(text: object, what: str) -> str:
    if not isinstance(text, str):
        raise DeniedError(f"{what} must be a string, got {type(text).__name__}")
    if not text.strip():
        raise DeniedError(f"{what} is empty")
    if len(text) > MAX_STATEMENT_CHARS:
        raise DeniedError(
            f"{what} of {len(text)} characters exceeds the inspection bound "
            f"{MAX_STATEMENT_CHARS}"
        )
    return text


def _reject_stacked(stripped: str, what: str) -> None:
    """Refuse more than one statement in one call.

    A stacked second statement is how an injected fragment escapes whatever the
    first statement was allowed to be.
    """
    segments = [seg for seg in stripped.split(";") if seg.strip()]
    if len(segments) > 1:
        raise DeniedError(f"{what} contains {len(segments)} statements; one is allowed")


# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------

#: The escape primitives of ARCHITECTURE section 7 requirement 9 and THREAT_MODEL
#: row DB-1, plus the neighbouring server-file readers that reach the same asset.
#: The read-only NOSUPERUSER role is what actually denies these; this list is the
#: layer above it.
SQL_DENIED_TOKENS: tuple[str, ...] = (
    "pg_read_server_files",
    "pg_write_server_files",
    "pg_execute_server_program",
    "pg_read_file",
    "pg_read_binary_file",
    "pg_ls_dir",
    "pg_stat_file",
    "pg_file_write",
    "pg_file_unlink",
    "dblink",
    "dblink_connect",
    "dblink_exec",
    "lo_import",
    "lo_export",
)

#: Statement kinds the read-only path may begin with. `EXPLAIN` is absent on
#: purpose: `EXPLAIN ANALYZE <write>` executes the write.
SQL_READ_KINDS: frozenset[str] = frozenset({"select", "with", "values", "table", "show"})

#: Keywords that make a statement write, change session state, or run a program.
#: Trimmed to tokens that are dangerous *and* rare as bare column names — a
#: false positive here costs a legitimate query, so the list stays short.
SQL_WRITE_KEYWORDS: tuple[str, ...] = (
    "insert", "update", "delete", "truncate", "drop", "alter", "create",
    "grant", "revoke", "merge", "copy", "call", "do", "vacuum", "reindex",
    "refresh", "lock", "prepare", "execute", "set", "reset", "listen",
    "notify", "begin", "commit", "rollback", "savepoint",
)

_SQL_DENIED_RE = re.compile(
    r"\b(" + "|".join(re.escape(tok) for tok in SQL_DENIED_TOKENS) + r")\b",
    re.IGNORECASE,
)
_SQL_WRITE_RE = re.compile(
    r"\b(" + "|".join(SQL_WRITE_KEYWORDS) + r")\b", re.IGNORECASE
)
_COPY_PROGRAM_RE = re.compile(r"\bcopy\b[\s\S]{0,4096}?\b(?:to|from)\s+program\b", re.IGNORECASE)
_FIRST_WORD_RE = re.compile(r"[A-Za-z_][A-Za-z_0-9]*")


def inspect_sql(sql: str) -> None:
    """Refuse a Postgres statement the read-only broker path may not run.

    Defense-in-depth on the `NOSUPERUSER` read-only role, which is the primary
    control (INTERFACES section 5, Postgres controls). Refuses, in order: an
    unlexable statement, a stacked second statement, any token from
    `SQL_DENIED_TOKENS`, `COPY ... TO/FROM PROGRAM`, a statement that does not
    begin with a read kind, and any write keyword anywhere (which is what catches
    a data-modifying CTE such as `WITH x AS (...) INSERT ...`).

    Returns `None` when the statement passes; raises `DeniedError` otherwise. It
    never rewrites the statement — the broker sends the caller's bytes or none.
    """
    sql = _guard_input(sql, "sql")
    stripped = _strip_sql_noise(sql)
    _reject_stacked(stripped, "sql")

    denied = _SQL_DENIED_RE.search(stripped)
    if denied is not None:
        raise DeniedError(f"sql references the denied primitive {denied.group(1).lower()!r}")

    if _COPY_PROGRAM_RE.search(stripped) is not None:
        raise DeniedError("sql uses COPY ... TO/FROM PROGRAM")

    head = _FIRST_WORD_RE.search(stripped.lstrip().lstrip("("))
    kind = head.group(0).lower() if head is not None else ""
    if kind not in SQL_READ_KINDS:
        raise DeniedError(
            f"sql begins with {kind or '?'!r}; the read-only path allows "
            + ", ".join(sorted(SQL_READ_KINDS))
        )

    write = _SQL_WRITE_RE.search(stripped)
    if write is not None:
        raise DeniedError(f"sql contains the write keyword {write.group(1).lower()!r}")


# ---------------------------------------------------------------------------
# Neo4j / Cypher
# ---------------------------------------------------------------------------

#: Clauses that write, or that fetch a URL. `READ` access mode denies the writes;
#: it does not deny `LOAD CSV`, which is a URL fetch of the same shape as the
#: `apoc.load.*` SSRF requirement 6 closes.
CYPHER_WRITE_KEYWORDS: tuple[str, ...] = (
    "create", "merge", "delete", "detach", "set", "remove", "drop", "foreach",
)

_CYPHER_WRITE_RE = re.compile(
    r"\b(" + "|".join(CYPHER_WRITE_KEYWORDS) + r")\b", re.IGNORECASE
)
_LOAD_CSV_RE = re.compile(r"\bload\s+csv\b", re.IGNORECASE)
_PERIODIC_COMMIT_RE = re.compile(r"\busing\s+periodic\s+commit\b", re.IGNORECASE)
_BRACKET_RE = re.compile(r"\[[^\]]*\]")
#: `*`, `*n`, `*n..m`, `*..m`, `*n..` inside a relationship pattern.
_VAR_LENGTH_RE = re.compile(r"\*\s*(\d*)\s*(\.\.)?\s*(\d*)")


def inspect_cypher(query: str) -> None:
    """Refuse a Cypher query the read-only broker path may not run.

    Defense-in-depth on the Bolt session's `default_access_mode = READ`, which is
    the primary control (INTERFACES section 5, Neo4j controls). Refuses an
    unlexable query, a stacked second statement, a write clause, `LOAD CSV` /
    `USING PERIODIC COMMIT`, and — requirement 7 — an unbounded `[*]`
    variable-length path.

    "Unbounded" means no upper hop bound: `[*]`, `[r:KNOWS*]`, `[*2..]` are
    refused; `[*3]`, `[*1..3]`, `[*..5]` are allowed. Only `*` inside a bracketed
    pattern counts, so `count(*)` and `a * b` are untouched.

    APOC procedure references are *not* checked here — that is `ApocAllowlist`,
    which the broker applies alongside this function.
    """
    query = _guard_input(query, "cypher")
    stripped = _strip_cypher_noise(query)
    _reject_stacked(stripped, "cypher")

    if _LOAD_CSV_RE.search(stripped) is not None:
        raise DeniedError("cypher uses LOAD CSV")
    if _PERIODIC_COMMIT_RE.search(stripped) is not None:
        raise DeniedError("cypher uses USING PERIODIC COMMIT")

    write = _CYPHER_WRITE_RE.search(stripped)
    if write is not None:
        raise DeniedError(f"cypher contains the write clause {write.group(1).upper()!r}")

    for bracket in _BRACKET_RE.finditer(stripped):
        body = bracket.group(0)
        for hop in _VAR_LENGTH_RE.finditer(body):
            lower, dots, upper = hop.group(1), hop.group(2), hop.group(3)
            if dots:
                bounded = bool(upper)
            else:
                bounded = bool(lower)
            if not bounded:
                raise DeniedError(
                    f"cypher uses the unbounded variable-length path {body!r}"
                )


#: Cypher procedure names are case-insensitive, so the scan must be too.
_APOC_REF_RE = re.compile(r"\bapoc\.[A-Za-z_0-9.]+", re.IGNORECASE)


class ApocAllowlist:
    """Deny-by-default allowlist of APOC procedures (requirement 6, THREAT_MODEL DB-2).

    `READ` access mode does not block `apoc.load.json` or `apoc.export.*`, so the
    allowlist — not the access mode — is the control that closes that SSRF. The
    default is the empty set: with no named tool granting an APOC procedure, every
    `apoc.*` reference is refused.

    An entry is an exact lower-cased procedure name (`apoc.meta.stats`) or a
    prefix wildcard (`apoc.coll.*`). A wildcard is a review decision about a
    whole namespace and should be spelled out at the grant, not assumed here.
    """

    def __init__(self, allowed: frozenset[str] = frozenset()):
        normalised = {entry.strip().lower() for entry in allowed if entry.strip()}
        self.exact: frozenset[str] = frozenset(e for e in normalised if not e.endswith(".*"))
        self.prefixes: tuple[str, ...] = tuple(
            sorted(e[:-1] for e in normalised if e.endswith(".*"))
        )

    def permits(self, procedure: str) -> bool:
        """True when `procedure` is allowlisted. Deny-by-default on an empty set."""
        name = procedure.strip().lower()
        if name in self.exact:
            return True
        return any(name.startswith(prefix) for prefix in self.prefixes)

    def check(self, query: str) -> None:
        """Refuse the query when it references an APOC procedure that is not allowed.

        Runs over the lexically stripped query, so `apoc.load.json` inside a
        string literal or a comment is not a reference and does not trip it.
        """
        query = _guard_input(query, "cypher")
        stripped = _strip_cypher_noise(query)
        for match in _APOC_REF_RE.finditer(stripped):
            procedure = match.group(0).lower().rstrip(".")
            if not self.permits(procedure):
                raise DeniedError(
                    f"cypher calls the APOC procedure {procedure!r}, which is not allowlisted"
                )
