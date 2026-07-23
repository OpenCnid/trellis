"""Tests for the CapabilityDescriptor lifecycle.

Generated source is never executed here. `ast.parse` proves it is well-formed and
the parsed tree proves an escape held; running it is the guest supervisor's job,
which lives behind the real boundary and not in a test process.
"""

from __future__ import annotations

import ast

import pytest

from repl_sandbox.capabilities import (
    PRE_REGISTERED,
    PRE_REGISTERED_NAMES,
    RESERVED_NAMES,
    CapabilityDescriptor,
    CapabilityRegistry,
    one_line,
)
from repl_sandbox.errors import DeniedError

GUEST_CID = 7
OTHER_CID = 11

#: A token distinctive enough that a substring search for it is meaningful.
SENTINEL_DISPATCH_REF = "SENTINEL-ROUTE-TOKEN-9f3a2c"


def make_run_query(dispatch_ref: str = SENTINEL_DISPATCH_REF) -> CapabilityDescriptor:
    """A representative handle-returning broker capability."""
    return CapabilityDescriptor(
        name="run_query",
        typed_signature={
            "type": "object",
            "properties": {
                "sql": {"type": "string"},
                "params": {"type": "array"},
                "limit": {"type": "integer", "default": 100},
            },
            "required": ["sql"],
            "returns": {"type": "object"},
        },
        doc="Run a read-only SQL query; returns a handle plus row count and schema, not rows.",
        dispatch_ref=dispatch_ref,
    )


def make_run_cypher() -> CapabilityDescriptor:
    return CapabilityDescriptor(
        name="run_cypher",
        typed_signature={
            "type": "object",
            "properties": {"query": {"type": "string"}, "params": {"type": "object"}},
            "required": ["query"],
            "returns": {"type": "object"},
        },
        doc="Run a read-only Cypher query; returns a handle plus safe metadata.",
        dispatch_ref="trellis.db.v1.cypher",
    )


def function_defs(source: str) -> dict[str, ast.FunctionDef]:
    tree = ast.parse(source)
    return {
        node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)
    }


# ---------------------------------------------------------------------------
# Registration and per-CID isolation
# ---------------------------------------------------------------------------


def test_register_and_read_back_in_order():
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")
    registry.register(GUEST_CID, make_run_cypher(), "DB_PORT")

    assert [d.name for d in registry.descriptors(GUEST_CID)] == [
        "run_query",
        "run_cypher",
    ]


def test_unknown_cid_has_no_grants():
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")

    assert registry.descriptors(OTHER_CID) == ()
    assert registry.render(OTHER_CID) == ""


def test_per_cid_isolation_of_materialised_source():
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")
    registry.register(OTHER_CID, make_run_cypher(), "DB_PORT")

    granted = function_defs(registry.materialise(GUEST_CID))
    other = function_defs(registry.materialise(OTHER_CID))

    assert set(granted) == {"run_query"}
    assert set(other) == {"run_cypher"}


def test_ungranted_op_has_no_stub():
    """Denial is the absence of registration: no descriptor, no stub, no path."""
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")

    source = registry.materialise(GUEST_CID)

    assert set(function_defs(source)) == {"run_query"}
    assert "run_cypher" not in source


def test_duplicate_registration_refused():
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")
    with pytest.raises(DeniedError):
        registry.register(GUEST_CID, make_run_query(), "DB_PORT")


def test_non_guest_cid_refused():
    registry = CapabilityRegistry()
    for cid in (0, 1, 2, -1):
        with pytest.raises(DeniedError):
            registry.register(cid, make_run_query(), "DB_PORT")


def test_unknown_port_refused():
    registry = CapabilityRegistry()
    with pytest.raises(DeniedError):
        registry.register(GUEST_CID, make_run_query(), "SOME_OTHER_PORT")


# ---------------------------------------------------------------------------
# Reserved names
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name", sorted(RESERVED_NAMES - set(PRE_REGISTERED_NAMES))
)
def test_reserved_names_refused(name):
    registry = CapabilityRegistry()
    descriptor = CapabilityDescriptor(
        name=name,
        typed_signature={"type": "object", "properties": {}},
        doc="A capability trying to take an rlms reserved name.",
        dispatch_ref="trellis.test.v1",
    )
    with pytest.raises(DeniedError):
        registry.register(GUEST_CID, descriptor, "DB_PORT")


def test_pre_registered_names_are_grantable_on_the_lm_port():
    registry = CapabilityRegistry()
    for descriptor in PRE_REGISTERED:
        registry.register(GUEST_CID, descriptor, "LM_PORT")

    assert [d.name for d in registry.descriptors(GUEST_CID)] == list(PRE_REGISTERED_NAMES)


def test_pre_registered_capability_refused_on_the_db_port():
    registry = CapabilityRegistry()
    with pytest.raises(DeniedError):
        registry.register(GUEST_CID, PRE_REGISTERED[0], "DB_PORT")


def test_pre_registered_set_is_the_two_lm_sinks():
    assert tuple(d.name for d in PRE_REGISTERED) == PRE_REGISTERED_NAMES
    for descriptor in PRE_REGISTERED:
        assert "meter" in descriptor.doc.lower()


# ---------------------------------------------------------------------------
# Materialised source: shape and parseability
# ---------------------------------------------------------------------------


def test_materialised_source_parses_and_carries_the_envelope():
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")
    registry.register(GUEST_CID, PRE_REGISTERED[0], "LM_PORT")

    source = registry.materialise(GUEST_CID)
    tree = ast.parse(source)
    defs = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
    assert set(defs) == {"run_query", "llm_query"}

    # The body of a stub is exactly a docstring plus the RPC return.
    body = defs["run_query"].body
    assert isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant)
    assert isinstance(body[-1], ast.Return)

    call = body[-1].value
    assert isinstance(call, ast.Call)
    assert isinstance(call.func, ast.Name) and call.func.id == "_trellis_rpc"
    assert isinstance(call.args[0], ast.Constant) and call.args[0].value == "DB_PORT"

    envelope = call.args[1]
    assert isinstance(envelope, ast.Dict)
    keys = [k.value for k in envelope.keys if isinstance(k, ast.Constant)]
    assert keys == ["v", "req_id", "op", "args"]


def test_llm_query_stub_targets_the_lm_port():
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, PRE_REGISTERED[0], "LM_PORT")

    defs = function_defs(registry.materialise(GUEST_CID))
    call = defs["llm_query"].body[-1].value
    assert call.args[0].value == "LM_PORT"


def test_empty_registry_still_materialises_a_parseable_module():
    registry = CapabilityRegistry()
    tree = ast.parse(registry.materialise(GUEST_CID))
    assert not [node for node in tree.body if isinstance(node, ast.FunctionDef)]


def test_stub_arguments_forward_the_parameter_names():
    """Required args are sent unconditionally; optional ones are guarded.

    The stub builds `args` in a local rather than as one literal, because an
    optional parameter the caller left unset must be *absent* from the map and
    not present carrying a null — every host op reads its optionals with
    `args.get(name, default)`, and `.get` hands back the null rather than the
    default when the key exists. Pinned structurally here (this module does not
    execute generated source); the behaviour it buys — `run_query(sql)` reaching
    the broker as `{'sql': ...}` and succeeding — is driven end to end against
    the real broker in `test_s4_paid.py`.
    """
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")

    body = function_defs(registry.materialise(GUEST_CID))["run_query"].body

    # The args map starts as a literal of the required parameters only.
    assign = body[1]
    assert isinstance(assign, ast.Assign)
    local = assign.targets[0].id
    assert isinstance(assign.value, ast.Dict)
    assert [k.value for k in assign.value.keys] == ["sql"]
    assert [v.id for v in assign.value.values] == ["sql"]

    # Each optional parameter is added only when the caller set it.
    guarded = {}
    for node in body[2:-1]:
        assert isinstance(node, ast.If)
        assert isinstance(node.test, ast.Compare)
        assert isinstance(node.test.ops[0], ast.IsNot)
        assert node.test.comparators[0].value is None
        subscript = node.body[0].targets[0]
        assert subscript.value.id == local
        guarded[node.test.left.id] = subscript.slice.value
    assert guarded == {"params": "params", "limit": "limit"}

    # ...and that same local is what the envelope carries.
    assert body[-1].value.args[1].values[-1].id == local


# ---------------------------------------------------------------------------
# The dispatch_ref never crosses
# ---------------------------------------------------------------------------


def test_dispatch_ref_absent_from_generated_source():
    """A routing token riding in from the guest is the confused-deputy path."""
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")
    registry.register(GUEST_CID, PRE_REGISTERED[0], "LM_PORT")

    materialised = registry.materialise(GUEST_CID)
    rendered = registry.render(GUEST_CID)

    for source in (materialised, rendered):
        assert SENTINEL_DISPATCH_REF not in source
        for descriptor in registry.descriptors(GUEST_CID):
            assert descriptor.dispatch_ref not in source

    # And no constant anywhere in the parsed tree carries it.
    constants = {
        node.value
        for node in ast.walk(ast.parse(materialised))
        if isinstance(node, ast.Constant)
    }
    assert SENTINEL_DISPATCH_REF not in constants


# ---------------------------------------------------------------------------
# Hostile input to the source generator
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        "run_query, __import__('os').system('id')",
        "run_query()",
        "run\nquery",
        "run query",
        'run_query"; import os',
        "class",
        "_secret",
        "__import__",
        "ﬁlter",  # NFKC-normalises onto "filter"
        "",
        "x" * 200,
    ],
)
def test_hostile_capability_name_refused(name):
    with pytest.raises(DeniedError):
        CapabilityDescriptor(
            name=name,
            typed_signature={"type": "object", "properties": {}},
            doc="A capability with a hostile name.",
            dispatch_ref="trellis.test.v1",
        )


def test_ordinary_name_is_not_refused():
    """The positive control for the refusal above: plain names still register."""
    descriptor = CapabilityDescriptor(
        name="fileff",
        typed_signature={"type": "object", "properties": {}},
        doc="A perfectly ordinary name.",
        dispatch_ref="trellis.test.v1",
    )
    assert descriptor.name == "fileff"


@pytest.mark.parametrize(
    "hostile_doc",
    [
        "closes the docstring: \"\"\"\n)\nimport os\nos.system('id')\n#",
        "'; import os; os.system('id') #",
        "breaks the call: \\n)\nimport os\n",
        "carries an escape \x1b[31m and a null \x00",
    ],
)
def test_hostile_doc_is_escaped_and_the_module_still_parses(hostile_doc):
    registry = CapabilityRegistry()
    descriptor = CapabilityDescriptor(
        name="run_query",
        typed_signature={
            "type": "object",
            "properties": {"sql": {"type": "string"}},
            "required": ["sql"],
        },
        doc=hostile_doc,
        dispatch_ref="trellis.test.v1",
    )
    registry.register(GUEST_CID, descriptor, "DB_PORT")

    source = registry.materialise(GUEST_CID)
    tree = ast.parse(source)

    # The escape held: nothing new appeared at module level.
    assert all(
        isinstance(node, (ast.ImportFrom, ast.Import, ast.Assign, ast.FunctionDef))
        for node in tree.body
    )
    assert [node.name for node in tree.body if isinstance(node, ast.FunctionDef)] == [
        "run_query"
    ]
    # No injected reference to os / system survived anywhere in the tree.
    names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
    assert "os" not in names
    assert not any(
        isinstance(node, ast.Attribute) and node.attr == "system"
        for node in ast.walk(tree)
    )

    # The hostile text landed inside the docstring literal, one line, printable.
    fn = next(node for node in tree.body if isinstance(node, ast.FunctionDef))
    docstring = ast.get_docstring(fn)
    assert docstring == one_line(hostile_doc)
    assert "\n" not in docstring
    assert all(ch.isprintable() for ch in docstring)


def test_hostile_schema_property_name_refused():
    with pytest.raises(DeniedError):
        CapabilityDescriptor(
            name="run_query",
            typed_signature={
                "type": "object",
                "properties": {"sql): import os; os.system('id') #": {"type": "string"}},
            },
            doc="A capability whose schema tries to inject through a parameter name.",
            dispatch_ref="trellis.test.v1",
        )


def test_hostile_string_default_is_escaped():
    registry = CapabilityRegistry()
    descriptor = CapabilityDescriptor(
        name="run_query",
        typed_signature={
            "type": "object",
            "properties": {
                "mode": {"type": "string", "default": "read'); import os #"}
            },
        },
        doc="A capability with a hostile default in its schema.",
        dispatch_ref="trellis.test.v1",
    )
    registry.register(GUEST_CID, descriptor, "DB_PORT")

    tree = ast.parse(registry.materialise(GUEST_CID))
    fn = next(node for node in tree.body if isinstance(node, ast.FunctionDef))
    default = fn.args.defaults[0]
    assert isinstance(default, ast.Constant)
    assert default.value == "read'); import os #"
    assert "os" not in {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}


def test_non_serialisable_schema_refused():
    with pytest.raises(DeniedError):
        CapabilityDescriptor(
            name="run_query",
            typed_signature={"type": "object", "properties": {"sql": object()}},
            doc="A schema that cannot cross a UTF-8 JSON frame.",
            dispatch_ref="trellis.test.v1",
        )


def test_empty_doc_refused():
    with pytest.raises(DeniedError):
        CapabilityDescriptor(
            name="run_query",
            typed_signature={"type": "object", "properties": {}},
            doc="   \n\t ",
            dispatch_ref="trellis.test.v1",
        )


def test_empty_dispatch_ref_refused():
    with pytest.raises(DeniedError):
        CapabilityDescriptor(
            name="run_query",
            typed_signature={"type": "object", "properties": {}},
            doc="A capability with no route.",
            dispatch_ref="",
        )


# ---------------------------------------------------------------------------
# The prompt-facing rendering
# ---------------------------------------------------------------------------


def test_render_is_a_body_free_signature():
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")

    rendered = registry.render(GUEST_CID)
    tree = ast.parse(rendered)
    fn = tree.body[0]
    assert isinstance(fn, ast.FunctionDef)

    # Docstring, then a stripped body. Nothing else.
    assert len(fn.body) == 2
    assert ast.get_docstring(fn) == one_line(make_run_query().doc)
    assert isinstance(fn.body[1], ast.Expr)
    assert isinstance(fn.body[1].value, ast.Constant)
    assert fn.body[1].value.value is Ellipsis

    # A frame, not an example: no call, no sample value, no RPC machinery.
    assert not [node for node in ast.walk(tree) if isinstance(node, ast.Call)]
    assert "_trellis_rpc" not in rendered
    assert "req_id" not in rendered
    assert "DB_PORT" not in rendered


def test_render_carries_the_typed_signature():
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")

    rendered = registry.render(GUEST_CID)
    assert rendered.startswith(
        "def run_query(sql: str, params: list | None = None, limit: int = 100) -> dict:"
    )


def test_render_narrows_to_the_named_capabilities():
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")
    registry.register(GUEST_CID, make_run_cypher(), "DB_PORT")
    registry.register(GUEST_CID, PRE_REGISTERED[0], "LM_PORT")

    everything = registry.render(GUEST_CID)
    assert set(function_defs(everything)) == {"run_query", "run_cypher", "llm_query"}

    narrowed = registry.render(GUEST_CID, names=["llm_query"])
    assert set(function_defs(narrowed)) == {"llm_query"}
    assert "run_query" not in narrowed

    # Order follows `names`; duplicates collapse.
    ordered = registry.render(GUEST_CID, names=["run_cypher", "run_query", "run_cypher"])
    assert [node.name for node in ast.parse(ordered).body] == ["run_cypher", "run_query"]


def test_render_of_an_ungranted_name_is_refused():
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), "DB_PORT")
    with pytest.raises(DeniedError):
        registry.render(GUEST_CID, names=["run_cypher"])


def test_both_renderings_share_one_signature():
    """One object, two renderings — the signature line is literally the same."""
    registry = CapabilityRegistry()
    descriptor = make_run_query()
    registry.register(GUEST_CID, descriptor, "DB_PORT")

    materialised = registry.materialise(GUEST_CID)
    rendered = registry.render(GUEST_CID)
    signature = descriptor.signature_source()

    assert signature in materialised
    assert signature in rendered


def test_handle_typed_slots_render_as_handles():
    """Handle-first: a handle-typed parameter reads as a handle in both renderings."""
    registry = CapabilityRegistry()
    descriptor = CapabilityDescriptor(
        name="resolve_meta",
        typed_signature={
            "type": "object",
            "properties": {"h": {"type": "string", "format": "handle"}},
            "required": ["h"],
            "returns": {"type": "object"},
        },
        doc="Return shape, length, and schema for a handle. Metadata only; no payload.",
        dispatch_ref="trellis.db.v1.resolve_meta",
    )
    registry.register(GUEST_CID, descriptor, "DB_PORT")

    assert "def resolve_meta(h: Handle) -> dict:" in registry.render(GUEST_CID)
    # Annotations are strings in the materialised module, so an unbound name is legal.
    materialised = registry.materialise(GUEST_CID)
    assert "from __future__ import annotations" in materialised
    ast.parse(materialised)
