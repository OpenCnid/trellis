"""Tests for where a descriptor is bound and where its `expects` comes from.

Two properties, and they fail differently.

*Coverage* — every op a host can grant carries a descriptor — is the property
`SELF_DESCRIBING_SURFACES.md` section 11 rules is worth mechanizing, because it
stays a stable question while the fields underneath it move. It fails by a name
being absent.

*Derivation* — the rendered account is composed from the predicates that refuse
— is what section 3.3 asks for, and it fails silently: prose and guard agree on
the day the prose is written and nothing binds them afterwards. So the tests
below do not check that a sentence is present. They check that the sentence
moves when the thing it describes moves: `_ARG_KEYS` decides which arguments a
signature marks required, `_INPUT_KINDS` decides which kinds the account names,
and an error class's own attributes decide its retry clause.
"""

from __future__ import annotations

import ast
import inspect

import pytest

from repl_sandbox import algebra, broker, host, surfaces
from repl_sandbox.capabilities import CapabilityDescriptor, CapabilityRegistry
from repl_sandbox.errors import (
    ERROR_CODES,
    CapRateError,
    DeniedError,
    retry_phrase,
)

GUEST_CID = 7


# ---------------------------------------------------------------------------
# Coverage: the descriptor is bound at the definition site
# ---------------------------------------------------------------------------


def test_every_broker_op_carries_a_descriptor():
    """Coverage over `broker.BROKER_OPS`, the set the broker actually serves."""
    assert surfaces.undescribed(broker.BROKER_OPS) == []


def test_the_described_algebra_ops_are_exactly_the_ones_the_host_can_name():
    """The subset is a decision, so it is written down and counted both ways."""
    described = set(algebra.DESCRIBED_ALGEBRA_OPS)
    assert described <= set(algebra.ALGEBRA_OPS)
    assert surfaces.undescribed(algebra.DESCRIBED_ALGEBRA_OPS) == []
    # The rest are routable and undescribed. Pinned so adding an algebra op is a
    # decision about its descriptor rather than a silent omission (rule 22(c)).
    assert surfaces.undescribed(algebra.ALGEBRA_OPS) == [
        "concat",
        "get_ast_blocks",
        "join",
        "union",
        "vector_search",
    ]


def test_the_host_grant_set_is_the_registry_and_not_a_second_list():
    """`BROKER_CAPABILITIES` is a read, so it cannot drift from what is defined."""
    assert host.BROKER_CAPABILITIES == surfaces.registry()
    assert set(host.BROKER_CAPABILITIES) == set(broker.BROKER_OPS) | set(
        algebra.DESCRIBED_ALGEBRA_OPS
    )


def test_a_broker_descriptor_is_named_by_its_own_handler():
    """The rename bind: the op name is read off the handler, not typed twice.

    `Broker._handlers` is the routing table and `@describes` reads
    `func.__name__`, so a handler renamed without its table entry leaves a
    descriptor under a name nothing routes — which this catches — and a handler
    renamed *with* its table entry moves the descriptor along with it.
    """
    routing = inspect.getsource(broker.Broker.__init__)
    for op in broker.BROKER_OPS:
        handler_name = f"{surfaces.HANDLER_PREFIX}{op}"
        handler = getattr(broker.Broker, handler_name)
        assert callable(handler)
        assert handler.__name__ == handler_name
        assert f'"{op}": self.{handler_name},' in routing
        assert surfaces.descriptor_for(op) is not None


def test_registering_a_different_descriptor_under_a_live_name_is_refused():
    impostor = CapabilityDescriptor(
        name="slice",
        typed_signature={"type": "object", "properties": {}},
        doc="A second surface claiming an occupied name.",
        dispatch_ref="trellis.test.v1",
    )
    with pytest.raises(DeniedError):
        surfaces.register_surface(impostor)
    # ...and the live one is untouched.
    assert surfaces.descriptor_for("slice").dispatch_ref == "trellis.db.v1.slice"


def test_re_registering_the_same_descriptor_is_a_no_op():
    """A re-imported module must not raise; equality is the test, not identity."""
    live = surfaces.descriptor_for("narrow")
    assert surfaces.register_surface(live) is live
    twin = CapabilityDescriptor(
        name=live.name,
        typed_signature=dict(live.typed_signature),
        doc=live.doc,
        dispatch_ref=live.dispatch_ref,
        expects=live.expects,
        error_codes=live.error_codes,
    )
    assert surfaces.register_surface(twin) is twin


def test_a_non_descriptor_is_refused():
    with pytest.raises(DeniedError):
        surfaces.register_surface({"name": "slice"})


# ---------------------------------------------------------------------------
# Derivation 1: the algebra signature follows `_ARG_KEYS`
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("op", algebra.DESCRIBED_ALGEBRA_OPS)
def test_the_rendered_signature_takes_its_required_set_from_the_guard(op):
    """The signature and the arg checker read one table, so they cannot disagree.

    This is the failure `SELF_DESCRIBING_SURFACES.md` section 3.3 names with
    MASH's `@mind`: a documented gate and the real gate that agree today with
    nothing binding them. Here the stub cannot invite a call `_check_args`
    refuses, because the stub's required list is `_ARG_KEYS`' required set.
    """
    required, optional = algebra._ARG_KEYS[op]
    signature = surfaces.descriptor_for(op).typed_signature
    assert set(signature["required"]) == required
    assert set(signature["properties"]) == required | optional


def test_an_argument_with_no_render_position_fails_at_import(monkeypatch):
    """The other half of the bind: membership derived, order declared, drift red."""
    monkeypatch.setitem(algebra._ARG_ORDER, "narrow", ("handle", "start"))
    with pytest.raises(DeniedError) as caught:
        algebra._describe("narrow", doc="A narrowing op.", expects=("bounded.",))
    assert "render position" in str(caught.value)


def test_the_kinds_sentence_is_composed_from_the_kind_table(monkeypatch):
    """`_check_kinds` refuses from `_INPUT_KINDS`; the sentence reads that table."""
    before = algebra._kinds_phrase("project")
    assert "table" in before and "result-set" in before

    monkeypatch.setitem(algebra._INPUT_KINDS, "project", ("graph-view",))
    after = algebra._kinds_phrase("project")
    assert after == "The handle must be of kind graph-view; any other kind is refused."
    assert "table" not in after


def test_the_size_phrases_carry_this_modules_own_constants():
    """A bound stated in prose and a bound in a constant is two encodings."""
    assert str(algebra.MAX_QUERY_CHARS) in algebra._ALGEBRA_GUARD_EXPECTS["text_bound"]
    assert str(algebra.MAX_COLUMNS) in algebra._ALGEBRA_GUARD_EXPECTS["cols"]
    assert str(algebra.MAX_ARGS_BYTES) in algebra._ALGEBRA_GUARD_EXPECTS["args_size"]
    assert (
        str(algebra.MAX_ADDRESS_RESULTS) in algebra._ALGEBRA_GUARD_EXPECTS["limit"]
    )


# ---------------------------------------------------------------------------
# Derivation 2: the retry account follows the error classes' attributes
# ---------------------------------------------------------------------------


def test_every_taxonomy_code_has_a_phrase():
    for code in ERROR_CODES:
        assert retry_phrase(code).startswith(f"{code} ")


def test_an_unknown_code_is_refused_rather_than_described():
    with pytest.raises(KeyError):
        retry_phrase("not_a_code")


def test_the_retry_clause_follows_the_class_attribute(monkeypatch):
    """Flip the flag the caller is handed and the sentence flips with it.

    `to_error_object` puts `retryable` on the wire from this same attribute, so
    this is the check that the prompt-facing account and the wire-facing flag
    have one source.
    """
    assert "may be retried" in retry_phrase("cap_rate")
    monkeypatch.setattr(CapRateError, "retryable", False)
    assert "not retryable" in retry_phrase("cap_rate")


def test_the_three_terminal_postures_are_distinguishable():
    """What a model can now tell apart: drop, halt, and carry on."""
    assert "drops the connection" in retry_phrase("auth")
    assert "drops the connection" in retry_phrase("frame")
    assert "halts the session" in retry_phrase("cap_spend")
    assert "the session continues" in retry_phrase("cap_bytes")
    assert "may be retried" in retry_phrase("cap_concurrency")


@pytest.mark.parametrize("name", sorted(host.BROKER_CAPABILITIES))
def test_declared_error_codes_are_taxonomy_members(name):
    for code in host.BROKER_CAPABILITIES[name].error_codes:
        assert code in ERROR_CODES


# ---------------------------------------------------------------------------
# The second encodings are gone
# ---------------------------------------------------------------------------

#: The guard-backed sentences that used to be typed into descriptor prose in
#: `host.py`, at a distance from the predicate each described. A descriptor
#: `doc` is editorial now; if one of these reappears there, the fact has two
#: encodings again and the one in the doc is the one that will go stale.
_RETIRED_FROM_DOC = (
    "no row crosses",
    "metadata only",
    "metered sink",
    "charged to the session ledger",
    "never silently trimmed",
    "no referent is read",
    "no content crosses",
    "bounded in count and audited",
)


@pytest.mark.parametrize("name", sorted(host.BROKER_CAPABILITIES))
def test_no_guard_backed_sentence_survives_in_a_doc(name):
    doc = host.BROKER_CAPABILITIES[name].doc.lower()
    for phrase in _RETIRED_FROM_DOC:
        assert phrase not in doc, f"{name}'s doc restates {phrase!r}"


@pytest.mark.parametrize("name", sorted(host.BROKER_CAPABILITIES))
def test_every_grantable_capability_now_carries_an_account(name):
    descriptor = host.BROKER_CAPABILITIES[name]
    assert descriptor.expects, f"{name} states no bound"
    assert descriptor.error_codes, f"{name} states no failure"


# ---------------------------------------------------------------------------
# What reaches the prompt
# ---------------------------------------------------------------------------


def rendered(name: str) -> str:
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, host.BROKER_CAPABILITIES[name], "DB_PORT")
    return registry.render(GUEST_CID)


@pytest.mark.parametrize("name", sorted(host.BROKER_CAPABILITIES))
def test_the_rendered_stub_carries_the_account_and_stays_a_stripped_frame(name):
    """The bounds reach the prompt without changing what a stub *is*.

    They are comments, so the body is still exactly a docstring and `...` — the
    property `test_capabilities.test_render_is_a_body_free_signature` pins — and
    still a frame rather than an example: no call, no sample argument, no
    sample return value.
    """
    source = rendered(name)
    descriptor = host.BROKER_CAPABILITIES[name]

    assert source.count("# expects: ") == len(descriptor.expects)
    assert source.count("# on error: ") == len(set(descriptor.error_codes))

    tree = ast.parse(source)
    fn = tree.body[0]
    assert isinstance(fn, ast.FunctionDef)
    assert len(fn.body) == 2
    assert isinstance(fn.body[1].value, ast.Constant)
    assert fn.body[1].value.value is Ellipsis
    assert not [node for node in ast.walk(tree) if isinstance(node, ast.Call)]


@pytest.mark.parametrize("name", sorted(host.BROKER_CAPABILITIES))
def test_no_routing_token_rides_out_on_the_new_lines(name):
    """The `dispatch_ref` bind, re-checked over the bytes this pass added."""
    source = rendered(name)
    assert host.BROKER_CAPABILITIES[name].dispatch_ref not in source


def test_the_account_is_what_a_bound_looks_like_before_it_is_tripped():
    """`slice` names its meter and `materialize` names its refusal, in the prompt.

    Before this pass both bounds existed only in `broker.py` — the ledger charge
    at the one, the `CapBytesError` at the other — and a caller met them by being
    refused.
    """
    slice_source = rendered("slice")
    assert "charged against this session's inbound ledger" in slice_source
    assert "truncated=True" in slice_source

    materialize_source = rendered("materialize")
    assert "refused rather than trimmed" in materialize_source
    assert "cap_bytes" in materialize_source


# ---------------------------------------------------------------------------
# dlp stays undescribed
# ---------------------------------------------------------------------------


def test_no_descriptor_describes_the_dlp_layer():
    """Naming the detection patterns to a model is an evasion guide.

    `guest_rpc.py`'s module docstring records the same decision for the same
    reason — it re-derives an error parse rather than import `lm_handler`,
    because that import would carry `repl_sandbox.dlp` in with it. A descriptor
    is prompt text by construction, so it is the worst possible home for a
    detection rule.
    """
    assert surfaces.descriptor_for("dlp") is None
    for descriptor in surfaces.registry().values():
        blob = " ".join((descriptor.doc, *descriptor.expects)).lower()
        for term in ("dlp", "redact", "detection pattern", "scanner"):
            assert term not in blob, f"{descriptor.name} names {term!r}"
