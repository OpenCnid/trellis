"""Off-host coverage for the S4 `[A]` paid harness.

Specification: docs/product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md section 5.4,
the `[A]` half. Nothing here needs `/dev/kvm`, a Postgres, a provider key, or a
network: what is under test is the harness's **verdict logic** — every assessor
that turns a guest report into a pass/fail, the prompt builder, and the code
extractor — so a mistake in *what counts as a pass* surfaces on a development box
rather than after money is spent.

The strongest check available without KVM is at the bottom: the whole shipping
host-side chain — `CapabilityRegistry.render` for the prompt,
`CapabilityRegistry.materialise` for the guest, a model-shaped block executed
against those stubs, `GuestRpc`, the loopback transport double, `Broker`, the
handle table, and a fake Postgres backend — driven end to end so that
`run_query(...)` → `materialize(...)` returns the fixture rows. What it
structurally cannot reach, and what the host run supplies, is a frame crossing a
VM boundary and a real Postgres role.
"""

from __future__ import annotations

import importlib.util
import os

import pytest

from repl_sandbox.audit import AuditLog
from repl_sandbox.backends import ResultSet
from repl_sandbox.capabilities import TRANSPORT_HOOK
from repl_sandbox.config import SandboxConfig
from repl_sandbox.errors import DeniedError
from repl_sandbox.guest_rpc import GuestRpc
from repl_sandbox.host import TrellisSandboxHost

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)


def _load_paid():
    """Import the harness by path, the way the other probe tests do."""
    path = os.path.join(REPO_ROOT, "scripts", "repl_sandbox_s4_paid.py")
    spec = importlib.util.spec_from_file_location("repl_sandbox_s4_paid", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


paid = _load_paid()


# ---------------------------------------------------------------------------
# The fixture is what makes a correct answer meaningful
# ---------------------------------------------------------------------------


def _research_totals() -> dict[str, int]:
    tagged = {doc_id for doc_id, tag in paid.TAGS if tag == "research"}
    totals: dict[str, int] = {}
    for doc_id, _title, author, words, _created in paid.DOCUMENTS:
        if doc_id in tagged:
            totals[author] = totals.get(author, 0) + words
    return totals


def test_expected_answer_is_what_the_fixture_actually_says():
    """The declared answer is derived from the fixture, not asserted beside it."""
    totals = _research_totals()
    winner = max(totals, key=totals.__getitem__)
    assert winner == paid.EXPECTED_AUTHOR
    assert totals[winner] == paid.EXPECTED_TOTAL
    # And it is a strict winner, so "greatest" has one answer.
    assert sorted(totals.values())[-1] != sorted(totals.values())[-2]


def test_every_shortcut_lands_on_a_different_author():
    """The decoys are real: a model that skips the query cannot land on the answer.

    This is the property that makes `--no-db` a fair falsifier rather than a
    formality — the two aggregates a model could plausibly guess at both name
    someone else.
    """
    by_words: dict[str, int] = {}
    by_count: dict[str, int] = {}
    for _id, _title, author, words, _created in paid.DOCUMENTS:
        by_words[author] = by_words.get(author, 0) + words
        by_count[author] = by_count.get(author, 0) + 1

    assert max(by_words, key=by_words.__getitem__) != paid.EXPECTED_AUTHOR
    assert max(by_count, key=by_count.__getitem__) != paid.EXPECTED_AUTHOR
    assert set(paid.DECOY_ANSWERS) == {"okonkwo", "vasquez"}


def test_the_prompt_never_carries_a_row_value():
    """The model is shown the schema and never the data.

    If a word count reached the prompt the run would measure reading
    comprehension, not the facade.
    """
    prompt = paid.system_frame("") + paid.TASK_TURN.format(
        schema=paid.SCHEMA_TEXT, question=paid.QUESTION
    )
    for _id, title, author, words, created in paid.DOCUMENTS:
        assert str(words) not in prompt
        assert title not in prompt
        assert created not in prompt
    assert str(paid.EXPECTED_TOTAL) not in prompt
    # Author names are data too: none of them is named anywhere in the prompt.
    for author in {d[2] for d in paid.DOCUMENTS}:
        assert author not in prompt


def test_the_output_frame_shows_no_call_sequence():
    """The hypershot carries the submission contract, not the composition.

    A worked `run_query(...)` → `materialize(...)` example in the frame would
    hand the model the very composition the ergonomics claim is about.
    """
    frame = paid.system_frame("")
    assert "run_query(" not in frame
    assert "materialize(" not in frame
    assert "SELECT" not in frame.upper().replace("SELECTION", "")
    # It does carry the answer channel, which is rlms scaffold and not the facade.
    assert 'answer["ready"]' in frame
    # And the hypershot's free variables survive substitution intact — they are
    # the frame's whole mechanism, and `.format` would have eaten them.
    assert "{Python_That_Reaches_The_Facts_Through_The_Tools_Above}" in frame
    assert paid.TOOLS_SLOT not in frame


def test_the_tools_slot_is_filled_with_the_sessions_own_stubs():
    frame = paid.system_frame("def run_query(sql: str) -> dict:\n    ...")
    assert "def run_query(sql: str) -> dict:" in frame
    assert paid.TOOLS_SLOT not in frame


# ---------------------------------------------------------------------------
# Code extraction
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "reply,expected",
    [
        ("```python\nx = 1\n```", "x = 1"),
        ("```py\nx = 1\n```", "x = 1"),
        ("```\nx = 1\n```", "x = 1"),
        ("prose\n```python\nx = 1\n```\nmore prose", "x = 1"),
        ("x = 1", "x = 1"),  # unfenced: still runnable
        ("```python\na\n```\n```python\nb\n```", "a"),  # the first block
    ],
)
def test_extract_code(reply, expected):
    assert paid.extract_code(reply) == expected


def test_extract_code_tolerates_an_empty_reply():
    assert paid.extract_code("") == ""
    assert paid.extract_code(None) == ""


# ---------------------------------------------------------------------------
# The assessors
# ---------------------------------------------------------------------------


def _good_guest(**over) -> dict:
    guest = {
        "answer_ready": True,
        "answer_content": f"{paid.EXPECTED_AUTHOR} has the greatest total, {paid.EXPECTED_TOTAL} words.",
        "stdout": "",
        "stderr": "",
        "dialed": "AF_VSOCK (2, 5002)",
        "stub_names": list(paid.GRANTED_OPS),
    }
    guest.update(over)
    return guest


def test_answer_passes_on_the_expected_author_and_total():
    failures: list[str] = []
    record = paid.assess_answer(_good_guest(), failures)
    assert failures == []
    assert record["author_found"] and record["total_found"]
    assert record["channel"] == "answer"


def test_answer_accepts_a_comma_formatted_total():
    """`9,140` is the same number; failing it would measure the parser."""
    failures: list[str] = []
    paid.assess_answer(
        _good_guest(answer_content=f"{paid.EXPECTED_AUTHOR}, with 9,140 words"), failures
    )
    assert failures == []


def test_answer_falls_back_to_stdout_when_the_channel_was_not_used():
    """A block that printed its conclusion still did the work."""
    failures: list[str] = []
    record = paid.assess_answer(
        _good_guest(
            answer_ready=False,
            answer_content="",
            stdout=f"{paid.EXPECTED_AUTHOR} {paid.EXPECTED_TOTAL}",
        ),
        failures,
    )
    assert failures == []
    assert record["channel"] == "stdout"


def test_answer_fails_on_a_decoy_and_says_which_one():
    failures: list[str] = []
    record = paid.assess_answer(
        _good_guest(answer_content="vasquez, with 15400 words"), failures
    )
    assert len(failures) == 2  # wrong author and wrong total
    assert record["decoys_named"] == [f"vasquez ({paid.DECOY_ANSWERS['vasquez']})"]


def test_answer_fails_on_the_right_author_with_the_wrong_total():
    failures: list[str] = []
    paid.assess_answer(
        _good_guest(answer_content=f"{paid.EXPECTED_AUTHOR}, with 11000 words"), failures
    )
    assert len(failures) == 1
    assert "does not carry the total" in failures[0]


def test_crossing_fails_when_the_witness_saw_too_few_connections():
    """The load-bearing check: a self-answering guest cannot forge this."""
    failures: list[str] = []
    paid.assess_crossing(_good_guest(), 1, failures)
    assert len(failures) == 1
    assert "did not drive the facade across the bridge" in failures[0]


def test_crossing_passes_on_two_connections():
    failures: list[str] = []
    record = paid.assess_crossing(_good_guest(), 2, failures)
    assert failures == []
    assert record["witness_accepted"] == 2


def test_crossing_reports_a_stub_source_that_would_not_execute():
    failures: list[str] = []
    paid.assess_crossing(
        _good_guest(stub_error="SyntaxError: bad", stub_names=[]), 5, failures
    )
    assert any("guest-facing rendering is the defect" in f for f in failures)


def test_crossing_notices_a_granted_op_that_never_became_a_stub():
    failures: list[str] = []
    paid.assess_crossing(_good_guest(stub_names=["run_query"]), 5, failures)
    assert any("were not defined in the guest namespace" in f for f in failures)


def test_spend_must_be_positive():
    """A $0 charge means a stub answered, or the provider under-reported."""
    failures: list[str] = []
    paid.assess_spend(0.0, 5.0, failures)
    assert any("charged $0" in f for f in failures)


def test_spend_over_the_cap_fails():
    failures: list[str] = []
    paid.assess_spend(6.0, 5.0, failures)
    assert any("over the $5.0 cap" in f for f in failures)


def test_spend_within_the_cap_passes():
    failures: list[str] = []
    record = paid.assess_spend(0.012, 5.0, failures)
    assert failures == []
    assert record["charged_usd"] == 0.012


def test_no_db_control_is_detected_when_the_model_cannot_answer():
    record = paid.assess_no_db("Probably okonkwo, with roughly 12000 words.")
    assert record["guessable"] is False


def test_no_db_control_is_absorbed_only_on_author_and_total_together():
    """Naming one of three authors by chance is a coin flip; naming the total is not."""
    assert paid.assess_no_db(f"{paid.EXPECTED_AUTHOR}, about 8000 words")["guessable"] is False
    assert paid.assess_no_db(f"someone, {paid.EXPECTED_TOTAL} words")["guessable"] is False
    assert (
        paid.assess_no_db(f"{paid.EXPECTED_AUTHOR} with {paid.EXPECTED_TOTAL} words")[
            "guessable"
        ]
        is True
    )


# ---------------------------------------------------------------------------
# The conversation
# ---------------------------------------------------------------------------


def test_first_attempt_is_system_plus_task_only():
    messages = paid.build_messages("def run_query(...): ...", [])
    assert [m["role"] for m in messages] == ["system", "user"]
    assert "run_query" in messages[0]["content"]
    assert paid.QUESTION in messages[1]["content"]


def test_a_retry_feeds_the_real_traceback_back():
    """INTERFACES section 7's surfacing rule is what the retry loop runs on."""
    attempts = [
        {
            "raw_reply": "```python\nbad\n```",
            "stdout": "{'handle': ...}",
            "stderr": "DeniedError: denied: params must be a list",
            "code": "bad",
        }
    ]
    messages = paid.build_messages("stubs", attempts)
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]
    assert "params must be a list" in messages[-1]["content"]
    assert "{'handle': ...}" in messages[-1]["content"]


def test_a_retry_with_no_output_still_builds_a_readable_turn():
    messages = paid.build_messages("stubs", [{"raw_reply": "x", "stdout": "", "stderr": ""}])
    assert "(nothing)" in messages[-1]["content"]


# ---------------------------------------------------------------------------
# The whole host-side chain, driven end to end over the loopback double
# ---------------------------------------------------------------------------


class _FakePostgres:
    """A Postgres stand-in that answers the one aggregate the question needs.

    It is not a SQL engine: it computes the fixture's answer in Python and hands
    back a `ResultSet`. What is under test here is everything *between* the model
    and the backend — the two renderings, the RPC envelope, the broker's dispatch
    and inspection, the handle table — not Postgres, which the host run supplies.
    """

    read_only = True

    def __init__(self) -> None:
        self.seen: list[tuple[str, list]] = []

    def run_query(self, sql: str, params: list) -> ResultSet:
        self.seen.append((sql, params))
        totals = _research_totals()
        rows = sorted(([a, t] for a, t in totals.items()), key=lambda r: -r[1])
        return ResultSet(
            rows=rows,
            schema=[{"name": "author"}, {"name": "total"}],
            rowcount=len(rows),
        )

    def close(self) -> None:
        pass


class _LoopbackClient:
    """`RpcClient` straight onto a handler. A test double, not a boundary."""

    def __init__(self, handler, cid: int) -> None:
        self._handler = handler
        self._cid = cid
        self.calls = 0

    def request(self, payload: dict, max_frame_len: int) -> dict:
        self.calls += 1
        return self._handler(self._cid, payload)


@pytest.fixture()
def wired():
    """Host, session, and a guest namespace holding the materialised stubs."""
    backend = _FakePostgres()
    host = TrellisSandboxHost(
        config=SandboxConfig(),
        backends={"postgres": backend},
        provider=None,
        audit=AuditLog(),
    )
    session = host.open_session(
        paid.GUEST_CID, "test", ops=paid.GRANTED_OPS, lm=False
    )
    client = _LoopbackClient(host.broker_handler, paid.GUEST_CID)
    namespace = {
        TRANSPORT_HOOK: GuestRpc({"DB_PORT": client}, SandboxConfig().max_frame_len),
        "answer": {},
    }
    exec(session.capabilities.materialise(paid.GUEST_CID), namespace, namespace)
    yield host, session, backend, client, namespace
    host.close()


def test_the_rendered_stubs_are_what_the_model_is_shown(wired):
    """The prompt-facing rendering carries signatures and docs, and no routing token."""
    _host, session, _backend, _client, _ns = wired
    rendered = session.capabilities.render(paid.GUEST_CID)
    for op in paid.GRANTED_OPS:
        assert f"def {op}(" in rendered
    assert "trellis.db.v1" not in rendered  # the dispatch_ref never crosses
    assert "..." in rendered  # bodies are stripped


def test_a_model_shaped_block_runs_against_the_materialised_stubs(wired):
    """The end-to-end check: the natural call composes and returns the fixture rows.

    The block is written the way a model would write it — `run_query(sql)` with
    `params` left at its default — which is exactly the call that was refused
    `denied: params must be a list, got NoneType` before
    `capabilities._stub_source` stopped sending unset optionals as nulls.
    """
    _host, _session, backend, client, namespace = wired
    block = (
        "opened = run_query(\n"
        "    \"SELECT d.author, SUM(d.word_count) AS total FROM workspace_document d \"\n"
        "    \"JOIN workspace_tag t ON t.doc_id = d.id WHERE t.tag = 'research' \"\n"
        "    \"GROUP BY d.author ORDER BY total DESC\"\n"
        ")\n"
        "rows = materialize(opened['handle'])['rows']\n"
        "author, total = rows[0]\n"
        "answer['content'] = '%s has the most, %s words' % (author, total)\n"
        "answer['ready'] = True\n"
    )
    exec(block, namespace, namespace)

    assert namespace["answer"]["ready"] is True
    assert paid.EXPECTED_AUTHOR in namespace["answer"]["content"]
    assert str(paid.EXPECTED_TOTAL) in namespace["answer"]["content"]
    # Two crossings, which is the minimum the witness demands on the host.
    assert client.calls == 2
    # The backend really was asked, with the bound-parameter list the broker
    # supplies when the caller omitted it.
    assert backend.seen and backend.seen[0][1] == []


def test_the_natural_call_reaches_the_broker_without_a_null_params(wired):
    """The regression pin for the defect this harness's authoring found.

    `run_query(sql)` is the call the rendered signature invites. Sending
    `params: None` made it a `denied` refusal, which meant no model could use the
    facade as documented.
    """
    _host, _session, _backend, client, namespace = wired
    sent: list[dict] = []
    original = client.request

    def recording(payload, max_frame_len):
        sent.append(payload)
        return original(payload, max_frame_len)

    client.request = recording  # type: ignore[method-assign]
    namespace["run_query"]("SELECT 1")
    assert sent[0]["args"] == {"sql": "SELECT 1"}
    assert "params" not in sent[0]["args"]


def test_an_explicit_params_list_still_crosses(wired):
    _host, _session, backend, _client, namespace = wired
    namespace["run_query"]("SELECT 1", [])
    assert backend.seen[-1][1] == []


def test_a_write_is_still_refused_through_the_facade(wired):
    """The facade being usable did not make it permissive."""
    _host, _session, _backend, _client, namespace = wired
    with pytest.raises(DeniedError):
        namespace["run_query"]("INSERT INTO workspace_document VALUES (99)")


def test_an_ungranted_op_has_no_stub_at_all(wired):
    """Denial is the absence of registration, so there is nothing to call."""
    _host, _session, _backend, _client, namespace = wired
    assert "run_cypher" not in namespace
    assert "slice" not in namespace


def test_the_guest_namespace_holds_no_credential(wired):
    """A stub carries an envelope and a port name, and nothing else."""
    _host, session, _backend, _client, _ns = wired
    source = session.capabilities.materialise(paid.GUEST_CID)
    assert "password" not in source.lower()
    assert "dsn" not in source.lower()
    assert "TRELLIS_PG" not in source
