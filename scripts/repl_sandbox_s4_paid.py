"""REPL-sandbox S4 `[A]`: a real model drives the `run_query` facade.

Specification: docs/product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md section 5.4
(S4 - DB broker minimal proof), the **`[A]` half**: *"a metered real-model run
drives the facade (`pg.query(...)`) to complete a real workspace query - the
ergonomics/adoption check that the facade 'feels native' enough for
model-authored code."* Entrypoint: `npm run repl-sandbox:s4-paid`.

The `[R]` half (`scripts/repl_sandbox_s4_probe.py`) proved the seam *reachable*:
a scripted query crossed the bridge to a real Postgres with no credential in the
guest. It proved nothing about whether the facade is **usable**, because the
author of that probe already knew the wire by heart and hand-wrote the envelopes.
This script closes that: a real model, shown nothing but the rendered stubs, has
to compose `run_query` -> `materialize` itself and answer a question whose answer
is only in the database.

**This is a paid run.** The credential is read host-side from
`TRELLIS_LM_API_KEY` (never a flag, never logged), and every completion is
charged to `SpendLedger`, whose `LMCaps.spend_usd` hard-stop is session-terminal.
Estimate before, report after (AGENTS.md section 4).

**What is different from S3 `[A]`, and why it is the harder claim.** There the
model was the thing at the *end* of the channel: the guest sent it a prompt and
its answer came back. Here the model is the thing *driving* the channel - it
authors the Python, and that Python is what dials the broker. So S3 `[A]` could
pass with a facade nobody could use; this cannot.

**Where the model runs, and why that is not a shortcut.** The authoring calls are
made **host-side**, by this script, exactly as rlms' own driver holds the LM
client and hands `execute_code` to the backend. The guest is opened with
`lm=False` and holds no LM capability at all - the only port it dials is
`config.ports.db`. That is requirement 2 (the API key is host-side only) as a
structural fact rather than a promise: there is no code path from the guest to
the provider. It also means the run exercises **one** listener, the DB one.

**The two renderings are the thing under test** (INTERFACES section 6 -
CapabilityDescriptor lifecycle, one object two renderings). Both come off the
same descriptors, and until this run neither S3 `[A]` nor S4 `[R]` had used
either - both hand-rolled their envelopes, so `capabilities.py` had never carried
a real workload:

  * `registry.render(cid)` produces the typed, doc-commented stubs that go into
    the model's prompt. If the model cannot write working code against them, the
    prompt-facing rendering is the defect.
  * `registry.materialise(cid)` produces the proxy stubs the guest executes. If
    the model's code raises against them, the guest-facing rendering is the
    defect.

**The answer cannot be guessed, and `--no-db` is what establishes that.** The
model is shown the *schema* - table and column names - and never a row. The
fixture is then built so that both lazy shortcuts are wrong: the author with the
most documents is not the answer, and neither is the author with the highest
total word count overall. Only the filtered, grouped query gets it. `--no-db`
asks the same real model the same question with the tools removed, and the run
is only meaningful if it *fails*. A correct answer that was guessable would make
the positive run prove nothing about the facade (AGENTS.md section 4 rule 19(c),
and the house rule that a null result is not a validated one).

What this proves, past what `[R]` already did:

  1. **Model-authored code drove the real facade.** The block the model wrote
     ran in the guest against `capabilities.materialise` stubs, dialed
     `config.ports.db`, and came back with rows from a real Postgres the broker
     held the credential for.
  2. **The answer is right, and only the database had it.** It is checked
     against a value this script fixed in advance; `--no-db` shows the same
     model cannot reach it without the tools.
  3. **The ergonomics number is the attempt count.** A first-attempt pass is the
     strong result. Later attempts are driven by feeding the block's real
     `stdout`/`stderr` back, which is INTERFACES section 7's surfacing rule doing
     the job it exists for - so the count is a measurement of the facade, and the
     record carries the prompt verbatim so a reader can judge how much of the
     work the frame did rather than taking this script's word for it.
  4. **The bill is real and bounded.** `spend_ledger.spent(cid)` is positive (a
     model was billed - a stub answers at $0) and at or under the cap.

The host-side witness is retained from `[R]` and is still the load-bearing
thing: a guest that answered itself would produce a perfectly good answer, and
only the count of connections that arrived at the host separates a crossed
boundary from a guest talking to itself.

Modes:
  default             provision, author, execute, check. The `[A]` run.
  --no-db             the falsifier: ask the model the same question with no
                      tools. DETECTED (exit 3) - it could not answer - is the
                      healthy result and is what makes the default run mean
                      something. Costs one completion.
  --negative-control  the guest answers ITSELF with canned rows, never dialing
                      the DB port. Every model-visible claim still passes and
                      only the host witness catches it. DETECTED (exit 3) is
                      healthy.
  --max-attempts N    authoring attempts before the run fails (default 3)
  --keep              leave the sandbox and Postgres running (skips teardown)
  --json              emit the observation record as JSON on stdout

**Scope limit carried honestly: this does not run `supervisor.GuestSupervisor`.**
The shipping supervisor is the natural host for "bind the transport hook, exec
the materialised stubs, exec model code", and it is not used here because it
imports `rlm.environments.base_env` and the guest image
(`python:3.12-slim` plus the shipped package) has no rlms in it. Shipping a
hand-written `rlm` shim to satisfy that import would make the run *look* like it
exercised the shipping supervisor while faking the very pin the supervisor exists
to hold, so the guest program below re-implements only the small part S4 needs -
bind the hook, exec the stubs, exec one block, read the `answer` channel - and
claims nothing about namespace persistence, reserved-name re-pinning, or
`locals` marshaling, which are the supervisor's and S6's. **The finding stands on
its own: the guest image must carry rlms before S6 can run its equivalence
harness.** Each attempt is a fresh guest process, so the model is told its block
must be self-contained.

Off-host coverage is `src/repl_sandbox/tests/test_s4_paid.py`: every assessor,
the code extractor, the prompt builder, and - the strongest check available
without KVM - the whole shipping chain (render -> a real model-shaped block ->
materialised stubs -> broker -> handle table) driven over the loopback double, so
a mistake in what counts as a pass surfaces before any money is spent.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "src"))


def _load_script(name: str):
    """Import a sibling probe script by path.

    They are scripts, not package modules, so they are loaded the way their own
    tests load them.
    """
    path = os.path.join(REPO_ROOT, "scripts", f"{name}.py")
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


#: The S4 `[R]` probe: Postgres provisioning, the credential grep and its canary,
#: and the guest payload shipment. It in turn loaded the S3 probe, and `s4.probe`
#: is that one module object - taking it from here rather than loading a second
#: copy keeps one `Sandbox`/`Witness` per process.
s4 = _load_script("repl_sandbox_s4_probe")
probe = s4.probe

from repl_sandbox.audit import AuditLog  # noqa: E402
from repl_sandbox.backends import postgres_backend_from_env, postgres_role_ddl  # noqa: E402
from repl_sandbox.config import LMCaps, SandboxConfig  # noqa: E402
from repl_sandbox.host import TrellisSandboxHost  # noqa: E402
from repl_sandbox.lm_handler import openai_chat_provider_from_env  # noqa: E402
from repl_sandbox.transport import HybridVsockListener, serve_forever  # noqa: E402

#: Credential and provider selection, all read host-side. Same names S3 `[A]`
#: used, so one `.lm_env` on the host serves both runs.
API_KEY_ENV = "TRELLIS_LM_API_KEY"
MODEL_ENV = "TRELLIS_LM_MODEL"
IN_PRICE_ENV = "TRELLIS_LM_USD_PER_1K_INPUT"
OUT_PRICE_ENV = "TRELLIS_LM_USD_PER_1K_OUTPUT"
BASE_URL_ENV = "TRELLIS_LM_BASE_URL"

GUEST_DIR = probe.GUEST_DIR
GUEST_CID = probe.GUEST_CID

#: The grant this session gets. `resolve_meta` is included because a model that
#: wants to check a handle's shape before materialising it should be able to;
#: leaving it out would measure a facade narrower than the one that ships.
GRANTED_OPS = ("run_query", "resolve_meta", "materialize")


# ---------------------------------------------------------------------------
# The workspace fixture — built so the answer is only in the database
# ---------------------------------------------------------------------------

#: Documents. Distinct, unremarkable values; the interesting property is the
#: relationship between them, below.
DOCUMENTS = [
    (1, "Lattice notes", "okonkwo", 4100, "2026-01-14"),
    (2, "Field survey", "okonkwo", 2300, "2026-02-02"),
    (3, "Margin remarks", "okonkwo", 3200, "2026-02-19"),
    (4, "Ledger draft", "okonkwo", 2400, "2026-03-05"),
    (5, "Corpus study", "vasquez", 8600, "2026-01-22"),
    (6, "Signal digest", "vasquez", 6800, "2026-03-11"),
    (7, "Boundary paper", "delacroix", 5240, "2026-01-30"),
    (8, "Handle algebra", "delacroix", 3900, "2026-02-27"),
    (9, "Errata", "delacroix", 1860, "2026-03-18"),
]

#: Tags. Document 5 carries two, so a join that forgets to filter on the tag
#: double-counts it - a wrong answer that looks like a plausible one.
TAGS = [
    (1, "draft"), (2, "research"), (3, "archive"), (4, "draft"),
    (5, "research"), (5, "draft"), (6, "archive"),
    (7, "research"), (8, "research"), (9, "draft"),
]

#: The question. Its answer is `delacroix`, 9140 - and **every shortcut is
#: wrong**, which is what makes a correct answer evidence that the query ran:
#:
#:   * most documents overall .............. okonkwo (4)      -> wrong author
#:   * highest total word_count overall .... vasquez (15400)  -> wrong author
#:   * highest research-tagged total ....... delacroix (9140) -> the answer
#:
#: So a model that pattern-matches the schema without reading a row lands on a
#: decoy, and `--no-db` measures exactly that.
QUESTION = (
    "Among the documents tagged 'research', which author has the greatest total "
    "word_count, and what is that total?"
)
EXPECTED_AUTHOR = "delacroix"
EXPECTED_TOTAL = 9140

#: What the shortcuts produce. Recorded when seen, so a wrong run says *how* it
#: was wrong rather than only that it was.
DECOY_ANSWERS = {
    "okonkwo": "most documents overall (4)",
    "vasquez": "highest total word_count overall (15400)",
}

#: Shown to the model. Names and types only - never a row.
SCHEMA_TEXT = (
    "workspace_document(id integer, title text, author text, word_count integer, "
    "created_on date)\n"
    "workspace_tag(doc_id integer, tag text)"
)

WORKSPACE_DDL = (
    "DROP TABLE IF EXISTS workspace_tag;"
    "DROP TABLE IF EXISTS workspace_document;"
    "CREATE TABLE workspace_document ("
    " id int PRIMARY KEY, title text, author text, word_count int, created_on date);"
    "CREATE TABLE workspace_tag (doc_id int REFERENCES workspace_document(id), tag text);"
    + "".join(
        "INSERT INTO workspace_document (id, title, author, word_count, created_on) "
        f"VALUES ({d[0]}, '{d[1]}', '{d[2]}', {d[3]}, '{d[4]}');"
        for d in DOCUMENTS
    )
    + "".join(
        f"INSERT INTO workspace_tag (doc_id, tag) VALUES ({t[0]}, '{t[1]}');"
        for t in TAGS
    )
)


class WorkspaceFixture(s4.PostgresFixture):
    """The `[R]` fixture's provisioning, carrying the workspace tables instead.

    Everything about the server, the role, the random host-held password and the
    teardown is inherited; only the table set differs. The role DDL is applied
    *after* the tables exist, because `GRANT SELECT ON ALL TABLES` covers what is
    there when it runs.
    """

    def _apply_ddl(self, caps) -> None:
        database = s4.PG_DATABASE
        self._psql_admin(f"CREATE DATABASE {database};", check=False, database=None)
        self._psql_admin(WORKSPACE_DDL, database=database)
        self._psql_admin(
            f'DROP OWNED BY "{self.role}"; DROP ROLE IF EXISTS "{self.role}";',
            check=False,
            database=database,
        )
        self._psql_admin(
            postgres_role_ddl(caps, role=self.role, database=database), database=database
        )
        self._psql_admin(
            'ALTER ROLE "%s" WITH LOGIN PASSWORD %s;'
            % (self.role, s4._sql_literal(self.password)),
            database=database,
        )


# ---------------------------------------------------------------------------
# The prompt — authored under AGENTS.md section 4 rule 16 (Guardrail 15)
# ---------------------------------------------------------------------------
#
# `prompt-engineering` and `hypershot-protocol` were both invoked before these
# bytes were written. Two decisions those protocols drove, both of which affect
# whether the measurement is valid rather than merely whether the prose is tidy:
#
#   * **The system layer carries only invariants** - the role, the tool
#     signatures (the system's own vocabulary), and the output frame. The schema,
#     the question, and any feedback from a previous attempt are variant per run
#     and live in the user turn.
#   * **The output frame is a hypershot, not an example.** Its variables are free
#     (`{...}`), and it deliberately shows *no* call sequence and *no* SQL. A
#     worked `run_query(...) -> materialize(...)` example would hand the model
#     the very composition the ergonomics claim is about, so the frame carries
#     only the answer-submission contract, which is rlms scaffold and not the
#     facade under test.

#: Where the rendered stubs are substituted into the frame. A sentinel replaced
#: by `str.replace` rather than a `str.format` field, because the frame's own
#: `{...}` are hypershot free variables that must reach the model **verbatim** —
#: running `.format` over the frame would try to substitute them and raise. The
#: prompt's bytes are the artifact here, so the substitution mechanism bends
#: around them rather than the other way round.
TOOLS_SLOT = "<!--rendered-stubs-->"

SYSTEM_FRAME = """\
<context>
  Substrate: a Python REPL inside a Trellis sandbox microVM.
  Reach: the functions below are the only path from this REPL to any data. There is
  no network, no filesystem corpus and no database client in this namespace.
</context>

<tools>
<!--rendered-stubs-->
</tools>

<task>
  Write one Python block that uses the tools above to obtain the facts a question
  needs, and then states the answer.
</task>

<constraints>
  *** CRITICAL ***
  - Reach every fact through the tools above. A value you did not read through them
    is a guess, and a guess is a wrong answer even when it looks right.
  - Statements are read-only; this session's database role is granted nothing else.
  - A tool returns a dict. Print what you get back and read it before assuming a key.
  - Each block runs in a FRESH namespace. Make it self-contained.
  - Set answer["content"] first and answer["ready"] = True last, exactly once.
</constraints>

<output_instructions>
  Format: exactly one ```python code block, with no prose outside it.
  Shape:

  ```python
  {Python_That_Reaches_The_Facts_Through_The_Tools_Above}

  print({Intermediate_Values_Worth_Seeing_If_This_Block_Raises})
  answer["content"] = "{One_Sentence_Stating_The_Answer_And_Its_Number}"
  answer["ready"] = True
  ```
</output_instructions>"""

TASK_TURN = """\
<workspace>
  The tables this session can read. Values are not shown here; read them with the
  tools.

{schema}
</workspace>

<question>
{question}
</question>"""

RETRY_TURN = """\
<previous_attempt>
  Your block ran in the REPL. What it produced:

  <stdout>
{stdout}
  </stdout>

  <stderr>
{stderr}
  </stderr>
</previous_attempt>

<task>
  Write the next block, self-contained, accounting for what the output above
  shows. Answer the same question.
</task>"""

#: The `--no-db` falsifier's turn. Same model, same question, same schema, no
#: tools - and the instruction to answer anyway, because a refusal and a wrong
#: answer are the same result here (neither reaches 9140) and pressing for an
#: answer is the *harder* test of whether the value is guessable.
NO_DB_PROMPT = """\
<workspace>
  A database with these tables and columns:

{schema}
</workspace>

<question>
{question}
</question>

<output_instructions>
  Give your single best answer: the author's name and the total, as a sentence.
  State a specific number even if you must estimate it.
</output_instructions>"""


def system_frame(rendered_stubs: str) -> str:
    """The frame with the session's actual stubs in the tools slot."""
    return SYSTEM_FRAME.replace(TOOLS_SLOT, rendered_stubs)


def build_messages(rendered_stubs: str, attempts: list[dict]) -> list[dict]:
    """The conversation for the next authoring attempt.

    One system turn carrying the frame and the tools, then the task, then one
    pair of (code, its real output) per attempt already made. Feeding the block's
    own `stdout`/`stderr` back is INTERFACES section 7's surfacing rule used as
    designed - the refusal or traceback a host produced is what the model debugs
    against.
    """
    messages = [
        {"role": "system", "content": system_frame(rendered_stubs)},
        {
            "role": "user",
            "content": TASK_TURN.format(schema=_indent(SCHEMA_TEXT), question=_indent(QUESTION)),
        },
    ]
    for attempt in attempts:
        messages.append({"role": "assistant", "content": attempt["raw_reply"]})
        messages.append(
            {
                "role": "user",
                "content": RETRY_TURN.format(
                    stdout=_indent(attempt["stdout"] or "(nothing)", 4),
                    stderr=_indent(attempt["stderr"] or "(nothing)", 4),
                ),
            }
        )
    return messages


def _indent(text: str, spaces: int = 2) -> str:
    pad = " " * spaces
    return "\n".join(pad + line for line in text.splitlines())


_FENCE = re.compile(r"```(?:python|py)?\s*\n(.*?)```", re.DOTALL)


def extract_code(reply: str) -> str:
    """The Python block from a model reply.

    Takes the first fenced block; falls back to the whole reply when the model
    answered without a fence, because a bare block is still runnable and failing
    the run on a formatting nicety would measure this parser, not the facade.
    """
    found = _FENCE.search(reply or "")
    return (found.group(1) if found else (reply or "")).strip()


# ---------------------------------------------------------------------------
# The guest program — materialised stubs, one model block, the answer channel
# ---------------------------------------------------------------------------
#
# Prints one JSON object. It binds `capabilities.TRANSPORT_HOOK` to a real
# `GuestRpc` over `transport.VsockClient`, executes the host-generated stub
# source, and then executes the model's block in that namespace - the shipping
# path a materialised stub takes. It is NOT `supervisor.GuestSupervisor`: see the
# module docstring for why (rlms is not in this image) and for what that costs.
GUEST_SOURCE = r'''
import argparse, io, json, os, sys, traceback
from contextlib import redirect_stderr, redirect_stdout

sys.path.insert(0, "/run/s3")

from repl_sandbox.capabilities import TRANSPORT_HOOK
from repl_sandbox.errors import DeniedError
from repl_sandbox.guest_rpc import GuestRpc
from repl_sandbox.transport import VsockClient

VMADDR_CID_HOST = 2

#: Mirrors supervisor.MarshalCaps-shaped output shaping. Not a boundary: this
#: bounds what the transcript carries, and every byte here was already in the
#: guest and charged at its sink.
MAX_TEXT = 20000


class FakeRpc:
    """The negative control's guest-local answerer. NOT a boundary crossing.

    Forges the broker's replies exactly - a handle for any read, the fixture rows
    for materialize - without opening a socket. Every model-visible claim still
    passes; only the host witness, counting connections that never arrived, can
    tell. Anything that is not a read is refused, so no guest-visible claim can
    catch this control ahead of the witness.
    """

    def __init__(self, canned):
        self._canned = canned

    def __call__(self, port_name, request):
        op = request.get("op")
        if op in ("run_query", "resolve_meta"):
            return dict(self._canned["run_query"])
        if op == "materialize":
            return dict(self._canned["materialize"])
        raise DeniedError("denied: fabricated by the negative control")


def _dump_self(canary):
    """The guest's own secret-free surfaces, for the host to grep.

    The credential is never sent in, so there is nothing here to find unless
    something leaked it. `canary` is planted on purpose: the host grep must find
    it (its positive control) and must not find the real secret. Same surfaces
    the S4 [R] guest dumps, and the same honest note about the one it cannot
    reach from Python.
    """
    os.environ["TRELLIS_S4_CANARY"] = canary
    try:
        environ_raw = open("/proc/self/environ", "rb").read().decode("utf-8", "replace")
    except OSError:
        environ_raw = ""
    return {
        "environ": dict(os.environ),
        "environ_raw": environ_raw,
        "argv": list(sys.argv),
        "globals_repr": repr({k: v for k, v in list(globals().items())
                              if not k.startswith("__")}),
        "surfaces_scanned": ["os.environ", "/proc/self/environ", "sys.argv",
                             "module globals"],
        "surfaces_not_scanned": ["raw process heap (not portable from Python)"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--max-frame-len", type=int, required=True)
    parser.add_argument("--stubs", required=True, help="host-generated stub source")
    parser.add_argument("--code", required=True, help="the model's block")
    parser.add_argument("--canary", required=True)
    parser.add_argument("--fake-local", default="", help="canned replies; negative control")
    args = parser.parse_args()

    report = {"kernel": os.uname().release}

    if args.fake_local:
        rpc = FakeRpc(json.load(open(args.fake_local)))
        report["dialed"] = "in-guest (negative control)"
    else:
        client = VsockClient(VMADDR_CID_HOST, args.port, timeout_s=120.0)
        rpc = GuestRpc({"DB_PORT": client}, args.max_frame_len)
        report["dialed"] = "AF_VSOCK (%d, %d)" % (VMADDR_CID_HOST, args.port)

    # The namespace the model's block runs in: the transport hook, the stubs the
    # host generated from its own descriptors, and the rlms `answer` channel.
    namespace = {TRANSPORT_HOOK: rpc, "answer": {}}
    try:
        exec(open(args.stubs).read(), namespace, namespace)
    except Exception as exc:
        report["stub_error"] = "%s: %s" % (type(exc).__name__, exc)
        print(json.dumps(report))
        return
    report["stub_names"] = sorted(
        n for n in namespace if not n.startswith("_") and n != "answer"
    )

    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        try:
            exec(open(args.code).read(), namespace, namespace)
        except BaseException:
            traceback.print_exc(file=err)

    answer = namespace.get("answer")
    answer = answer if isinstance(answer, dict) else {}
    report["stdout"] = out.getvalue()[:MAX_TEXT]
    report["stderr"] = err.getvalue()[:MAX_TEXT]
    report["answer_ready"] = bool(answer.get("ready"))
    report["answer_content"] = str(answer.get("content", ""))[:MAX_TEXT]
    report["dump"] = _dump_self(args.canary)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
'''


# ---------------------------------------------------------------------------
# Host plumbing
# ---------------------------------------------------------------------------


def build_provider():
    """Construct the real provider from the environment, or say what is missing.

    The one credential-reading call site in this script. Prices are required: a
    provider reporting $0 would leave the dollar ledger present and functionally
    absent, which is a documented bound with no engine behind it.
    """
    model = os.environ.get(MODEL_ENV)
    if not model:
        raise probe.ProbeError(
            f"{MODEL_ENV} is not set: name the model this run should call, set "
            "beside the key on the host."
        )
    try:
        in_price = float(os.environ[IN_PRICE_ENV])
        out_price = float(os.environ[OUT_PRICE_ENV])
    except KeyError as exc:
        raise probe.ProbeError(
            f"{exc.args[0]} is not set: the ledger needs the model's price (USD per "
            "1k tokens) to meter the run. A wrong price mis-reports the bill but "
            "cannot exceed the in-engine cap."
        ) from exc
    except ValueError as exc:
        raise probe.ProbeError(f"a price env var is not a number: {exc}") from exc

    base_url = os.environ.get(BASE_URL_ENV) or None
    try:
        provider = openai_chat_provider_from_env(
            default_model=model,
            usd_per_1k_input=in_price,
            usd_per_1k_output=out_price,
            env_var=API_KEY_ENV,
            base_url=base_url,
        )
    except RuntimeError as exc:  # the key is absent
        raise probe.ProbeError(str(exc)) from exc
    return provider, {
        "model": model,
        "usd_per_1k_input": in_price,
        "usd_per_1k_output": out_price,
        "base_url": base_url,
    }


def complete_and_charge(provider, ledger, messages: list[dict]) -> tuple[str, float]:
    """One completion, charged to the session ledger before it is used.

    The authoring calls are the *driver's*, not the guest's, and they are charged
    to the guest's CID anyway: they are this session's cost, and one cap over the
    session's whole bill is the honest accounting. `SpendLedger.charge` is the
    engine-side hard stop, so `--cap-usd` bounds the run rather than describing
    it.
    """
    completion, usd = provider.complete({"messages": messages}, None)
    ledger.charge(GUEST_CID, usd)
    return completion.get("response") or "", usd


def _canned_replies() -> dict:
    """Replies the negative-control guest answers itself with.

    Built from the real fixture so the fabricated rows are byte-plausible: the
    control tests a guest replaying a correct-looking protocol, which is what a
    cheating guest would actually do.
    """
    rows = [[d[2], d[3]] for d in DOCUMENTS]
    return {
        "run_query": {
            "handle": {"id": "canned-handle", "kind": "result-set"},
            "rowcount": len(rows),
            "schema": [{"name": "author"}, {"name": "total"}],
        },
        "materialize": {"rows": [[EXPECTED_AUTHOR, EXPECTED_TOTAL]], "truncated": False},
    }


# ---------------------------------------------------------------------------
# Host-side verdict logic — pure, and under off-host test
# ---------------------------------------------------------------------------


def answer_text(guest: dict) -> str:
    """What the model actually submitted.

    The `answer` channel is the shipping convention, but a block that printed its
    conclusion and never set `answer["ready"]` still *did the work*, and failing
    it on the submission channel would measure the frame rather than the facade.
    So stdout is a fallback, and which channel was used is recorded as its own
    ergonomics datum.
    """
    if guest.get("answer_ready") and guest.get("answer_content"):
        return str(guest["answer_content"])
    return str(guest.get("stdout") or "")


def assess_answer(guest: dict, failures: list[str]) -> dict:
    """Claim 2: the answer is the one only the database had.

    Decidable without a judge: the expected author's name and the expected total,
    both fixed in advance. An LLM-graded check would fold the thing under test
    into the grader.
    """
    text = answer_text(guest)
    lowered = text.lower()
    numbers = {int(n) for n in re.findall(r"-?\d+", text.replace(",", ""))}

    record = {
        "channel": "answer" if guest.get("answer_ready") else "stdout",
        "submitted": text[:2000],
        "expected_author": EXPECTED_AUTHOR,
        "expected_total": EXPECTED_TOTAL,
        "author_found": EXPECTED_AUTHOR in lowered,
        "total_found": EXPECTED_TOTAL in numbers,
    }
    record["decoys_named"] = sorted(
        f"{name} ({why})" for name, why in DECOY_ANSWERS.items() if name in lowered
    )
    if not record["author_found"]:
        failures.append(
            f"the answer does not name {EXPECTED_AUTHOR!r}: {text[:200]!r}"
            + (f" (it named {record['decoys_named']})" if record["decoys_named"] else "")
        )
    if not record["total_found"]:
        failures.append(
            f"the answer does not carry the total {EXPECTED_TOTAL}: {text[:200]!r}"
        )
    return record


def assess_crossing(guest: dict, witness_accepted: int, failures: list[str]) -> dict:
    """Claim 1: the model's code actually crossed to the host.

    The load-bearing check. A guest answering itself produces a perfectly good
    answer, so the count of connections that arrived is the only thing separating
    a crossed boundary from a guest talking to itself. A correct answer needs at
    least a read and a materialise, so fewer than two is not the facade working.
    """
    record = {
        "witness_accepted": witness_accepted,
        "dialed": guest.get("dialed"),
        "stub_names": guest.get("stub_names"),
    }
    if witness_accepted < 2:
        failures.append(
            f"the host accepted {witness_accepted} connections; answering needs at "
            "least a run_query and a materialize, so the model's code did not "
            "drive the facade across the bridge"
        )
    if guest.get("stub_error"):
        failures.append(
            "the materialised stub source failed to execute in the guest: "
            f"{guest['stub_error']} — the guest-facing rendering is the defect"
        )
    missing = [op for op in GRANTED_OPS if op not in (guest.get("stub_names") or [])]
    if missing:
        failures.append(f"granted ops {missing} were not defined in the guest namespace")
    return record


def assess_spend(spent: float, cap: float, failures: list[str]) -> dict:
    """Claim 4: a real model was billed, within the cap.

    A $0 charge means a stub answered or the provider under-reported; either way
    it is not the adoption run it claims to be.
    """
    record = {"charged_usd": round(spent, 6), "cap_usd": cap}
    if spent <= 0.0:
        failures.append(
            "the spend ledger charged $0: no real model was billed, so this is not "
            "the adoption run it claims to be"
        )
    if spent > cap:
        failures.append(f"the ledger charged ${spent} over the ${cap} cap")
    return record


def assess_no_db(reply: str) -> dict:
    """The falsifier's verdict: could the model answer with no tools?

    DETECTED (the healthy result) means it could not. If it *could*, the default
    run's correct answer would be worthless as evidence about the facade, because
    a model that never called a tool would produce it too.
    """
    lowered = (reply or "").lower()
    numbers = {int(n) for n in re.findall(r"-?\d+", (reply or "").replace(",", ""))}
    author_found = EXPECTED_AUTHOR in lowered
    total_found = EXPECTED_TOTAL in numbers
    return {
        "reply": (reply or "")[:2000],
        "author_found": author_found,
        "total_found": total_found,
        # Both halves are needed to call the answer guessable: naming one of
        # three authors by chance is a coin flip, but naming it *with* the exact
        # total is not.
        "guessable": author_found and total_found,
    }


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------


def run_no_db(cap_usd: float) -> tuple[dict, list[str]]:
    """The `--no-db` falsifier. One completion, no sandbox, no database."""
    record: dict = {"mode": "no-db"}
    failures: list[str] = []
    provider, provider_facts = build_provider()
    record["provider"] = provider_facts

    audit = AuditLog()
    host = TrellisSandboxHost(
        config=SandboxConfig(lm_caps=LMCaps(spend_usd=cap_usd)),
        backends={},
        provider=provider,
        audit=audit,
    )
    host.open_session(GUEST_CID, "s4-paid-nodb", lm=False)
    try:
        prompt = NO_DB_PROMPT.format(
            schema=_indent(SCHEMA_TEXT), question=_indent(QUESTION)
        )
        record["prompt"] = prompt
        reply, usd = complete_and_charge(
            provider, host.spend_ledger, [{"role": "user", "content": prompt}]
        )
        record["no_db"] = assess_no_db(reply)
        record["spend"] = assess_spend(
            host.spend_ledger.spent(GUEST_CID), host.spend_ledger.cap_usd, failures
        )
        if record["no_db"]["guessable"]:
            failures.append(
                f"the model answered {EXPECTED_AUTHOR}/{EXPECTED_TOTAL} with no "
                "database access: the answer is guessable from the schema, so a "
                "correct answer in the default run is not evidence the facade was used"
            )
    finally:
        host.close()
    return record, failures


def run_paid(
    image: str,
    *,
    negative_control: bool,
    external_pg: bool,
    keep: bool,
    max_attempts: int,
    cap_usd: float,
) -> tuple[dict, list[str]]:
    """Provision, author, execute, check. Returns (record, failures)."""
    record: dict = {"mode": "negative-control" if negative_control else "default"}
    failures: list[str] = []
    record["host"] = probe.preconditions()

    provider, provider_facts = build_provider()
    record["provider"] = provider_facts

    config = SandboxConfig(lm_caps=LMCaps(spend_usd=cap_usd))
    record["spend_cap_usd"] = config.lm_caps.spend_usd
    canary = f"postgresql://canary:{uuid.uuid4().hex}@canary.invalid/db"

    # -- the workspace the broker serves -------------------------------------
    fixture = WorkspaceFixture(external=external_pg)
    fixture.setup(config.broker_caps)
    record["postgres"] = dict(fixture.facts)
    # Held here, searched for in the guest dump, never printed and never sent in.
    real_secrets = [os.environ["TRELLIS_PG_DSN"], fixture.password]

    audit = AuditLog()
    backend = postgres_backend_from_env(config.broker_caps)  # reads the DSN host-side
    host = TrellisSandboxHost(
        config=config, backends={"postgres": backend}, provider=provider, audit=audit
    )
    # `lm=False`: the guest holds no LM capability. The model runs host-side, so
    # there is no code path from the guest to the provider or its key.
    session = host.open_session(GUEST_CID, "s4-paid-guest", ops=GRANTED_OPS, lm=False)

    # The two renderings, off the same descriptors. This is the seam under test.
    rendered_stubs = session.capabilities.render(GUEST_CID)
    stub_source = session.capabilities.materialise(GUEST_CID)
    record["facade"] = {
        "granted_ops": list(session.granted_ops),
        "rendered_stubs": rendered_stubs,
        "materialised_bytes": len(stub_source),
    }
    record["system_frame"] = system_frame(rendered_stubs)

    name = f"s4paid-{uuid.uuid4().hex[:10]}"
    sandbox = probe.Sandbox(name, image)
    record["sandbox"] = name
    record["image"] = image

    witness = probe.Witness()
    listener = None
    stop = threading.Event()
    server: threading.Thread | None = None
    attempts: list[dict] = []

    started = time.monotonic()
    sandbox.boot()
    record["ctr_run_detached_seconds"] = round(time.monotonic() - started, 3)

    try:
        record["guest"] = sandbox.guest_identity()
        if record["guest"]["kernel"] == record["host"]["host_kernel"]:
            failures.append(
                f"guest kernel equals host kernel ({record['guest']['kernel']}): "
                "this is not a VM boundary and the query would cross no bridge"
            )

        # -- the host end of the DB bridge -----------------------------------
        discovered = probe.discover_vsock_uds(sandbox)
        record["bridge"] = {"kind": "hybrid", **discovered, "port": config.ports.db}
        listener = HybridVsockListener(
            discovered["uds_path"],
            config.ports.db,
            GUEST_CID,
            accept_timeout_s=0.05,
            read_timeout_s=120.0,
        )
        record["bridge"]["listen_path"] = listener.path

        server = threading.Thread(
            target=serve_forever,
            args=(
                listener,
                witness.counted(host.broker_handler),
                config.max_frame_len,
                witness.audit,
                stop,
            ),
            daemon=True,
        )
        server.start()

        # -- ship the package, the guest program, and the materialised stubs --
        s4.install_guest_payload(sandbox)
        sandbox.put_bytes(GUEST_SOURCE.encode(), f"{GUEST_DIR}/guest_paid.py")
        sandbox.put_bytes(stub_source.encode(), f"{GUEST_DIR}/stubs.py")
        if negative_control:
            sandbox.put_bytes(
                json.dumps(_canned_replies()).encode(), f"{GUEST_DIR}/canned.json"
            )

        # -- author, run, feed back, repeat ----------------------------------
        guest: dict = {}
        for index in range(1, max_attempts + 1):
            messages = build_messages(rendered_stubs, attempts)
            reply, usd = complete_and_charge(provider, host.spend_ledger, messages)
            code = extract_code(reply)
            sandbox.put_bytes(code.encode(), f"{GUEST_DIR}/model_code.py")

            command = (
                f"cd {GUEST_DIR} && python3 guest_paid.py --port {config.ports.db} "
                f"--max-frame-len {config.max_frame_len} --stubs {GUEST_DIR}/stubs.py "
                f"--code {GUEST_DIR}/model_code.py --canary {canary}"
            )
            if negative_control:
                command += f" --fake-local {GUEST_DIR}/canned.json"
            raw = sandbox.exec(
                command, exec_id=f"s4paid-{index}-{uuid.uuid4().hex[:8]}", timeout=300.0
            )
            try:
                guest = json.loads(raw.strip().splitlines()[-1])
            except (ValueError, IndexError) as exc:
                raise probe.ProbeError(
                    f"the guest produced no parsable report: {raw!r}"
                ) from exc

            attempt = {
                "n": index,
                "usd": round(usd, 6),
                "raw_reply": reply,
                "code": code,
                "stdout": guest.get("stdout", ""),
                "stderr": guest.get("stderr", ""),
                "answer_ready": guest.get("answer_ready"),
                "answer_content": guest.get("answer_content", ""),
            }
            # Retry only on a wrong or missing answer. The verdict that decides
            # the run is taken once, after the loop, against the last guest
            # report; this call is the same assessor used only to decide whether
            # another attempt is worth buying.
            attempt_failures: list[str] = []
            assess_answer(guest, attempt_failures)
            attempt["answer_ok"] = not attempt_failures
            attempts.append(attempt)
            if attempt["answer_ok"]:
                break

        record["attempts"] = [
            {k: v for k, v in a.items() if k != "raw_reply"} for a in attempts
        ]
        record["attempts_used"] = len(attempts)
        record["first_try"] = len(attempts) == 1
        record["witness"] = {"accepted": witness.accepted, "requests": witness.requests}

        # -- the claims -------------------------------------------------------
        record["answer"] = assess_answer(guest, failures)
        record["crossing"] = assess_crossing(guest, witness.accepted, failures)
        record["credential"] = s4.assess_credential(guest, real_secrets, canary, failures)
        record["spend"] = assess_spend(
            host.spend_ledger.spent(GUEST_CID), host.spend_ledger.cap_usd, failures
        )

        # -- teardown ---------------------------------------------------------
        if keep:
            record["teardown"] = "skipped (--keep)"
        else:
            stop.set()
            if server is not None:
                server.join(timeout=10.0)
            socket_path = getattr(listener, "path", None)
            listener.close()
            listener = None
            sandbox.destroy()
            time.sleep(2.0)
            record["teardown"] = {
                "socket_removed": (socket_path is None) or (not os.path.exists(socket_path)),
                "listed_after_delete": sandbox.listed(),
                "vmm_processes_after_delete": sandbox.vmm_processes(),
            }
            if not record["teardown"]["socket_removed"]:
                failures.append(f"the listener socket {socket_path} survived teardown")
            if record["teardown"]["listed_after_delete"]:
                failures.append("the container is still listed by containerd after delete")
            if record["teardown"]["vmm_processes_after_delete"]:
                failures.append("a cloud-hypervisor process for this sandbox survived teardown")
    finally:
        stop.set()
        if server is not None:
            server.join(timeout=10.0)
        if listener is not None:
            try:
                listener.close()
            except OSError:
                pass
        host.close()
        backend.close()
        if not keep:
            sandbox.destroy()
            fixture.teardown()

    record["audit_events"] = witness.named()
    return record, failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--image", default=probe.DEFAULT_IMAGE)
    parser.add_argument("--negative-control", action="store_true")
    parser.add_argument("--no-db", action="store_true")
    parser.add_argument("--external-pg", action="store_true")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--cap-usd", type=float, default=LMCaps().spend_usd)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    try:
        if args.no_db:
            record, failures = run_no_db(args.cap_usd)
        else:
            record, failures = run_paid(
                args.image,
                negative_control=args.negative_control,
                external_pg=args.external_pg,
                keep=args.keep,
                max_attempts=args.max_attempts,
                cap_usd=args.cap_usd,
            )
    except probe.ProbeError as exc:
        print(f"S4 [A] run could not start: {exc}", file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired as exc:
        # The Kata shim intermittently wedges on `ctr task exec` and the call
        # burns its whole timeout. Infrastructure failing to run the harness is
        # not a claim about the facade failing — the distinction `ProbeError`
        # exists to keep. Teardown still ran: the raise happens inside `finally`.
        cmd = exc.cmd if isinstance(exc.cmd, list) else [str(exc.cmd)]
        print(
            f"S4 [A] run could not complete: `{' '.join(str(a) for a in cmd[:4])} ...` "
            f"timed out after {exc.timeout:.0f}s. This is the intermittent Kata-shim "
            "`task exec` hang, not a failed claim. Re-run.",
            file=sys.stderr,
        )
        return 1

    record["failures"] = failures
    if args.json:
        print(json.dumps(record, indent=2, default=str))
    else:
        _print_human(record, failures, args)

    if args.no_db:
        if record.get("no_db", {}).get("guessable"):
            print(
                "no-db control: ABSORBED - the model answered without the database, "
                "so a correct default run would prove nothing about the facade.",
                file=sys.stderr,
            )
            return 1
        print("no-db control: DETECTED - the model could not reach the answer without "
              "the tools, so the default run's answer is evidence the facade was used.")
        return 3
    if args.negative_control:
        if failures:
            print("negative control: DETECTED - the harness can tell a crossed DB "
                  "boundary from a guest answering itself.")
            return 3
        print("negative control: ABSORBED - the harness passed a guest that never "
              "dialed the DB port. It proves nothing about the bridge.", file=sys.stderr)
        return 1
    return 1 if failures else 0


def _print_human(record: dict, failures: list[str], args) -> None:
    prov = record.get("provider", {})
    print(f"model        {prov.get('model')} @ ${prov.get('usd_per_1k_input')}/1k in, "
          f"${prov.get('usd_per_1k_output')}/1k out"
          + (f"  (base_url {prov['base_url']})" if prov.get("base_url") else ""))
    if args.no_db:
        nodb = record.get("no_db", {})
        print(f"question     {QUESTION}")
        print(f"reply        {nodb.get('reply', '')[:300]!r}")
        print(f"guessable    author_found={nodb.get('author_found')} "
              f"total_found={nodb.get('total_found')}")
    else:
        print(f"sandbox      {record.get('sandbox')} ({record.get('image')})")
        bridge = record.get("bridge", {})
        print(f"listener     {bridge.get('listen_path', '-')} (port {bridge.get('port')})")
        print(f"guest kernel {record.get('guest', {}).get('kernel')}")
        print(f"granted      {record.get('facade', {}).get('granted_ops')}")
        w = record.get("witness", {})
        print(f"witness      accepted={w.get('accepted')} requests={w.get('requests')}")
        print(f"attempts     {record.get('attempts_used')} "
              f"(first_try={record.get('first_try')})")
        for attempt in record.get("attempts", []):
            head = (attempt.get("stderr") or "").strip().splitlines()
            note = head[-1][:90] if head else "ok"
            print(f"  attempt {attempt['n']}  ${attempt['usd']}  {note}")
        ans = record.get("answer", {})
        print(f"answer       via {ans.get('channel')}: {ans.get('submitted', '')[:200]!r}")
        print(f"             author_found={ans.get('author_found')} "
              f"total_found={ans.get('total_found')} "
              f"(expected {ans.get('expected_author')}/{ans.get('expected_total')})")
        cred = record.get("credential", {})
        print(f"credential   canary_found={cred.get('canary_found')} "
              f"secret_found={cred.get('secret_found')}")
        print(f"teardown     {record.get('teardown')}")
    spend = record.get("spend", {})
    print(f"spend        charged ${spend.get('charged_usd')} of ${spend.get('cap_usd')} cap")
    for failure in failures:
        print(f"FAIL  {failure}")


if __name__ == "__main__":
    raise SystemExit(main())
