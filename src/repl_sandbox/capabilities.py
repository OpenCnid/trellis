"""The CapabilityDescriptor lifecycle: one object, two renderings.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 6
(CapabilityDescriptor lifecycle — one object, two renderings) and
REPL_SANDBOX_SPEC.md section 4.3 (CapabilityDescriptor (tool registration)).

A descriptor is registered once, host-side, and then rendered twice:

* `materialise(cid)` emits Python source the guest supervisor executes to define
  proxy stubs in the worker namespace. A stub holds **no credential and no live
  client** — only the RPC envelope and the name of the vsock port to send it on.
* `render(cid, names)` emits the typed, doc-commented stub the model writes code
  against: signature, a one-line doc, the guard-derived bounds as comment lines,
  body stripped. Code shaped like the model's pretraining rather than JSON
  schema recited in prose (REPL_SANDBOX_RESEARCH.md section 7
  (Prompt-composition-by-function)).

The two renderings diverge on exactly one thing, and deliberately: the bounds
go to the prompt and not into the guest module. `materialise` emits what a
supervisor executes, and the host enforces every bound whatever the guest holds,
so a bound rendered into executable source would grow that module for no
enforcement gain. `expects_source` is therefore read by `render` alone.

Both come off the same descriptor, which is what buys modularity (swap the
backend, callers unchanged) and prompt-composition-by-function at once.

Three properties this module is responsible for.

**Registration is host-side and trusted-driver-only** (INTERFACES section 1,
seam 6). Nothing here parses guest input; there is no code path from the wire to
`register`. Denial is therefore the *absence* of registration — no descriptor
means no stub means no dispatch path — so an op never granted to a CID simply
does not appear in that CID's materialised source.

**The dispatch_ref never crosses into the guest.** It is a host routing token;
the broker resolves routing from its own `(CID, op)` table (INTERFACES section 5,
Tool denial). A token that rode in from the guest and was trusted for routing is
the confused-deputy path, so the generated source contains no dispatch_ref value
at all.

**Generated source is built only from validated fragments.** Every identifier
interpolated into Python source is checked (`_validate_identifier`); every other
value is emitted through `repr()` of a Python scalar, which cannot break out of
its literal. Docs and schema defaults are escaped, never concatenated raw.

This module is not a boundary and does not describe itself as one. The boundary
is the microVM plus the data-flow property that the guest holds handles, not
secret-bearing payloads (REPL_SANDBOX_ARCHITECTURE.md section 3.1 (The
exfiltration resolution)). What this module contributes to that property is
shape: a capability's schema returns a handle and safe metadata, and content
crosses only through the named metered sinks of REPL_SANDBOX_DATA_MODEL.md
section 6 (The bounded materialisation exception).
"""

from __future__ import annotations

import json
import keyword
import math
from collections.abc import Sequence
from dataclasses import dataclass

from repl_sandbox.errors import ERROR_CODES, DeniedError, retry_phrase

# ---------------------------------------------------------------------------
# Names and bounds
# ---------------------------------------------------------------------------

#: rlms reserved namespace names, which model code cannot override
#: (INTERFACES section 2, Reserved namespace names; source-confirmed against the
#: pinned rlms==0.1.3). Registering one of these as a new capability would give a
#: stub a name the driver re-pins every turn, so all but the two pre-registered
#: LM names are refused.
RESERVED_NAMES: frozenset[str] = frozenset(
    {
        "llm_query",
        "llm_query_batched",
        "rlm_query",
        "rlm_query_batched",
        "SHOW_VARS",
        "answer",
        "context",
        "history",
    }
)

#: The two reserved names that ARE capabilities: pre-registered, on `LM_PORT`.
PRE_REGISTERED_NAMES: tuple[str, ...] = ("llm_query", "llm_query_batched")

#: Symbolic vsock port names a registration may name (INTERFACES section 1,
#: Seam map). The numbers live in `config.VsockPorts`; the generated stub carries
#: the symbolic name and the guest transport resolves it.
PORT_NAMES: tuple[str, ...] = ("LM_PORT", "DB_PORT")

#: `v` of the Trellis broker envelope (INTERFACES section 5).
BROKER_ENVELOPE_VERSION = 1

#: The transport the guest supervisor binds before executing materialised source:
#: `_trellis_rpc(port_name: str, request: dict) -> dict`. Named here so the
#: supervisor imports the constant instead of duplicating the string.
TRANSPORT_HOOK = "_trellis_rpc"

#: Module-private alias the generated source imports `uuid` under, kept out of
#: the way of model code by the leading underscore.
UUID_ALIAS = "_trellis_uuid"

#: Local name a generated stub builds its `args` map in before sending. Safe to
#: interpolate beside parameter names because `_validate_identifier` refuses a
#: leading underscore on every capability and property name, so no parameter can
#: ever collide with it.
ARGS_LOCAL = "_args"

#: The lowest CID a registration may be keyed on. 0/1/2 are the reserved vsock
#: CIDs (hypervisor / local / host), so a registration below 3 is a host bug.
#: Who *supplies* the value depends on the VMM — a kernel-read peer CID under
#: native vhost-vsock, a host-assigned id bound to the sandbox's socket path
#: under the ratified VMM's hybrid vsock (INTERFACES section 3.1a). The range
#: check is the same either way, which is why this constant does not care.
FIRST_GUEST_CID = 3

MAX_NAME_LEN = 64
MAX_DOC_LEN = 400
MAX_DOC_LINE = 200
MAX_PARAMS = 16
MAX_DISPATCH_REF_LEN = 256
MAX_DEFAULT_LITERAL_LEN = 120

#: Bounds on the guard-derived half of a descriptor. `expects` phrases reach
#: prompt text through `one_line`, exactly as the doc does, so they are held to
#: the same per-line ceiling; the count bound keeps one op's account from
#: crowding out the signatures around it.
MAX_EXPECTS = 12
MAX_EXPECTS_LEN = 400

#: JSON Schema `type` to the annotation shown in both renderings.
_JSON_TYPE_TO_PY: dict[str, str] = {
    "string": "str",
    "integer": "int",
    "number": "float",
    "boolean": "bool",
    "array": "list",
    "object": "dict",
    "null": "None",
}

#: Annotation for a handle-typed slot. Handles are opaque tokens; the guest holds
#: them and cannot read their referents (DATA_MODEL section 1).
HANDLE_ANNOTATION = "Handle"

#: Fallback when a schema fragment does not pin a type.
ANY_ANNOTATION = "Any"

#: The schema fragment for a handle-typed slot, kept beside the `_annotation`
#: rule that renders it. Every module that declares a handle parameter names
#: this constant, so "what a handle looks like in a signature" is decided once,
#: here, rather than re-typed as a dict literal at each declaration site.
HANDLE_SCHEMA: dict = {"type": "object", "format": "handle"}


# ---------------------------------------------------------------------------
# Validation of everything that reaches generated source
# ---------------------------------------------------------------------------


def _validate_identifier(value: object, *, what: str) -> str:
    """Refuse anything that is not a plain ASCII Python identifier.

    This is the gate in front of source generation: a capability name and every
    schema property name is interpolated into Python source as a bare name, so
    only values that can be nothing but a name are allowed through.

    ASCII is required on top of `str.isidentifier` because Python NFKC-normalises
    identifiers at parse time — a non-ASCII name can silently normalise onto a
    different capability's name.
    """
    if not isinstance(value, str) or not value:
        raise DeniedError(f"{what} must be a non-empty string")
    if len(value) > MAX_NAME_LEN:
        raise DeniedError(f"{what} exceeds {MAX_NAME_LEN} characters")
    if not value.isascii():
        raise DeniedError(f"{what} {value!r} must be ASCII")
    if not value.isidentifier():
        raise DeniedError(f"{what} {value!r} is not a Python identifier")
    if keyword.iskeyword(value) or keyword.issoftkeyword(value):
        raise DeniedError(f"{what} {value!r} is a Python keyword")
    if value.startswith("_"):
        raise DeniedError(
            f"{what} {value!r} may not start with an underscore; the generated "
            "module's own transport and imports live in that space"
        )
    return value


def _validate_text(value: object, *, what: str, max_len: int) -> str:
    """Refuse non-text, oversized text, and text that cannot be UTF-8 encoded.

    Lone surrogates parse as a Python literal but fail on the way to the wire,
    where every frame is UTF-8 JSON (`frame.py`), so they are refused here rather
    than at the seam.
    """
    if not isinstance(value, str):
        raise DeniedError(f"{what} must be a string, got {type(value).__name__}")
    if len(value) > max_len:
        raise DeniedError(f"{what} exceeds {max_len} characters")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise DeniedError(f"{what} is not UTF-8 encodable: {exc}") from exc
    return value


def one_line(text: str) -> str:
    """Collapse a doc to a single printable line, truncating at `MAX_DOC_LINE`.

    Both renderings use this. Whitespace collapse removes newlines; the printable
    filter removes the control characters `str.split` leaves behind, so no escape
    sequence reaches prompt text.
    """
    collapsed = " ".join(text.split())
    printable = "".join(ch for ch in collapsed if ch.isprintable())
    if len(printable) > MAX_DOC_LINE:
        printable = printable[: MAX_DOC_LINE - 3].rstrip() + "..."
    return printable


def _annotation(fragment: object) -> str:
    """Map one JSON Schema fragment to the annotation both renderings show.

    The result is always drawn from a fixed vocabulary — never copied out of the
    schema — because it is interpolated into generated source.
    """
    if not isinstance(fragment, dict):
        return ANY_ANNOTATION
    if fragment.get("format") == "handle" or fragment.get("x-trellis-kind") == "handle":
        return HANDLE_ANNOTATION
    declared = fragment.get("type")
    if isinstance(declared, str):
        return _JSON_TYPE_TO_PY.get(declared, ANY_ANNOTATION)
    if isinstance(declared, list):
        mapped = [
            _JSON_TYPE_TO_PY[item]
            for item in declared
            if isinstance(item, str) and item in _JSON_TYPE_TO_PY
        ]
        deduped = list(dict.fromkeys(mapped))
        if deduped:
            return " | ".join(deduped)
    return ANY_ANNOTATION


def _default_source(fragment: dict) -> str:
    """Python source for an optional parameter's default.

    Only JSON scalars survive, and only through `repr`, which for these types is
    a literal that parses back to the same value. Containers become `None`
    rather than a mutable default; non-finite floats become `None` because their
    `repr` is a bare name, not a literal.
    """
    if "default" not in fragment:
        return "None"
    value = fragment["default"]
    if value is None or isinstance(value, bool) or isinstance(value, int):
        return repr(value)
    if isinstance(value, float):
        return repr(value) if math.isfinite(value) else "None"
    if isinstance(value, str) and len(value) <= MAX_DEFAULT_LITERAL_LEN:
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            return "None"
        return repr(value)
    return "None"


@dataclass(frozen=True)
class _Parameter:
    """One rendered parameter: a validated name, an annotation, a default."""

    name: str
    annotation: str
    #: `None` for a required parameter; Python source for an optional one.
    default_source: str | None


def _parameters(typed_signature: dict) -> tuple[_Parameter, ...]:
    """Derive the rendered parameter list from a descriptor's JSON Schema.

    Required parameters come first because Python forbids a non-default after a
    default; within each group the schema's `properties` order is preserved.
    """
    properties = typed_signature.get("properties") or {}
    required = typed_signature.get("required") or []
    required_set = {name for name in required if isinstance(name, str)}

    ordered = [name for name in properties if name in required_set]
    ordered += [name for name in properties if name not in required_set]

    params: list[_Parameter] = []
    for name in ordered:
        fragment = properties[name]
        annotation = _annotation(fragment)
        if name in required_set:
            params.append(_Parameter(name, annotation, None))
            continue
        default_source = _default_source(fragment if isinstance(fragment, dict) else {})
        if default_source == "None" and annotation not in (ANY_ANNOTATION, "None"):
            if "None" not in [part.strip() for part in annotation.split("|")]:
                annotation = f"{annotation} | None"
        params.append(_Parameter(name, annotation, default_source))
    return tuple(params)


def _validate_schema(typed_signature: object) -> None:
    """Refuse a schema that could not be turned into safe source.

    Checked here, at descriptor construction, so a descriptor that exists is
    always renderable.
    """
    if not isinstance(typed_signature, dict):
        raise DeniedError(
            f"typed_signature must be a JSON Schema object, got "
            f"{type(typed_signature).__name__}"
        )
    try:
        json.dumps(typed_signature, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise DeniedError(f"typed_signature is not JSON-serialisable: {exc}") from exc

    declared_type = typed_signature.get("type")
    if declared_type is not None and declared_type != "object":
        raise DeniedError(
            f"typed_signature.type must be 'object' (a parameter map), got {declared_type!r}"
        )

    properties = typed_signature.get("properties")
    if properties is not None and not isinstance(properties, dict):
        raise DeniedError("typed_signature.properties must be an object")
    properties = properties or {}
    if len(properties) > MAX_PARAMS:
        raise DeniedError(f"typed_signature declares more than {MAX_PARAMS} parameters")
    for name in properties:
        _validate_identifier(name, what="parameter name")

    required = typed_signature.get("required")
    if required is not None:
        if not isinstance(required, list):
            raise DeniedError("typed_signature.required must be a list")
        for name in required:
            if not isinstance(name, str) or name not in properties:
                raise DeniedError(
                    f"typed_signature.required names {name!r}, which is not a property"
                )


# ---------------------------------------------------------------------------
# The descriptor
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CapabilityDescriptor:
    """One capability: what it is called, its typed signature, its doc, its route.

    INTERFACES section 6:

        CapabilityDescriptor = { name, typed_signature: JSONSchema, doc,
                                 dispatch_ref: opaque }

    `dispatch_ref` is a host routing token. It is held host-side, resolved by the
    broker from its own `(CID, op)` table, and never emitted into guest-facing or
    prompt-facing text by either rendering.

    Construction validates *syntax* — anything that will be interpolated into
    generated Python source. Policy (which names may be registered at all) is
    `CapabilityRegistry.register`'s job, because the two pre-registered LM
    capabilities are reserved names that are nonetheless legal to grant.

    Handle-first, by convention of the schema rather than by anything this class
    enforces: a capability that reads data declares a return of a handle plus
    safe metadata, and a capability that returns content is one of the named
    metered sinks (DATA_MODEL section 6).

    `doc` and `expects` are two encodings with two different owners, which is
    why they are two fields (SELF_DESCRIBING_SURFACES.md section 3.3). `doc` is
    editorial: what this capability is for. `expects` is guard-backed: a bound
    the code refuses past, written where that code lives and travelling here by
    reference. A sentence that belongs in `expects` and is typed into `doc`
    instead is a second encoding of a fact the guard already owns, and it is the
    encoding that goes stale when the guard moves.

    `error_codes` names the taxonomy codes reachable from this capability, and
    stops there. What each code *means* for a retry is not stated here at all —
    `render` derives that from `errors.retry_phrase`, which reads the error
    classes' own attributes.
    """

    name: str
    typed_signature: dict
    doc: str
    dispatch_ref: str
    #: Guard-derived phrases, each owned by the predicate that refuses.
    expects: tuple[str, ...] = ()
    #: `errors.ERROR_CODES` members this capability can raise.
    error_codes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _validate_identifier(self.name, what="capability name")
        _validate_text(self.doc, what="capability doc", max_len=MAX_DOC_LEN)
        if not one_line(self.doc):
            raise DeniedError(
                f"capability {self.name!r} has an empty doc; the rendered stub is "
                "prompt text and a signature without a behaviour line is not usable"
            )
        _validate_text(
            self.dispatch_ref, what="dispatch_ref", max_len=MAX_DISPATCH_REF_LEN
        )
        if not self.dispatch_ref:
            raise DeniedError(f"capability {self.name!r} has an empty dispatch_ref")
        _validate_schema(self.typed_signature)
        self._validate_expects()

    def _validate_expects(self) -> None:
        """Hold the guard-derived half to the doc's own bounds, and close its set.

        Every `expects` phrase reaches prompt text, so it crosses `one_line` at
        render and is bounded and UTF-8-checked here. `error_codes` is checked
        against `ERROR_CODES` because a code outside the taxonomy has no class
        to read a retry consequence off — refusing it here is what keeps the
        derivation total rather than best-effort.
        """
        if not isinstance(self.expects, tuple):
            raise DeniedError(
                f"capability {self.name!r} expects must be a tuple, got "
                f"{type(self.expects).__name__}"
            )
        if len(self.expects) > MAX_EXPECTS:
            raise DeniedError(
                f"capability {self.name!r} declares more than {MAX_EXPECTS} expectations"
            )
        for phrase in self.expects:
            _validate_text(
                phrase, what=f"capability {self.name!r} expects", max_len=MAX_EXPECTS_LEN
            )
            if not one_line(phrase):
                raise DeniedError(
                    f"capability {self.name!r} carries an empty expects phrase"
                )
        if not isinstance(self.error_codes, tuple):
            raise DeniedError(
                f"capability {self.name!r} error_codes must be a tuple, got "
                f"{type(self.error_codes).__name__}"
            )
        for code in self.error_codes:
            if code not in ERROR_CODES:
                raise DeniedError(
                    f"capability {self.name!r} names error code {code!r}, which is "
                    f"outside the taxonomy {ERROR_CODES}"
                )

    # -- rendering fragments shared by both renderings ----------------------

    def signature_source(self) -> str:
        """The `def name(...) -> T:` line, identical in both renderings."""
        parts: list[str] = []
        for param in _parameters(self.typed_signature):
            if param.default_source is None:
                parts.append(f"{param.name}: {param.annotation}")
            else:
                parts.append(
                    f"{param.name}: {param.annotation} = {param.default_source}"
                )
        returns = self.typed_signature.get("returns")
        suffix = f" -> {_annotation(returns)}" if isinstance(returns, dict) else ""
        return f"def {self.name}({', '.join(parts)}){suffix}:"

    def docstring_source(self) -> str:
        """The doc as an indented Python string literal.

        `repr` is the escape: whatever the doc contains, the result is one
        literal that parses back to exactly that text.
        """
        return f"    {one_line(self.doc)!r}"

    def expects_source(self) -> str:
        """The guard-derived account, as comment lines. Empty when there is none.

        Comments rather than more docstring, for two reasons that both hold at
        once. The rendered stub's body stays exactly a docstring and `...` — no
        AST node is added, so *what a stub is* does not change to make room for
        this — and a `#` line is what a reader of Python source already expects a
        bound to be written on, which is the whole reason this rendering emits
        code instead of a schema recited in prose.

        Two labels, because there are two derivations: `expects:` carries a
        phrase its guard owns, and `on error:` is composed here from the
        capability's declared codes through `errors.retry_phrase`. Neither line
        is authored at this call site. `one_line` runs over the phrases for the
        same reason it runs over the doc — a newline in a comment would end the
        comment and put the rest of the phrase into the source.
        """
        lines = [f"    # expects: {one_line(phrase)}" for phrase in self.expects]
        lines += [
            f"    # on error: {retry_phrase(code)}"
            for code in dict.fromkeys(self.error_codes)
        ]
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Pre-registered capabilities (INTERFACES section 6; section 4 for the wire)
# ---------------------------------------------------------------------------

#: **These two descriptors stay here, and that is a boundary rather than an
#: oversight.** Every other capability's descriptor now lives beside the code
#: that serves it, registered there through `surfaces.describes` — the LM pair
#: cannot, because the code that serves them is `lm_handler.py` and this module
#: is imported by `guest_main.py`, inside the microVM. `guest_rpc.py` records
#: the same refusal for the same reason: importing `lm_handler` carries
#: `repl_sandbox.dlp`, the detection patterns, in with it. So the LM pair's
#: `expects` is deliberately empty rather than hand-authored at a distance from
#: `lm_handler`'s guards; writing those phrases here would recreate exactly the
#: second encoding this pass removed everywhere else.
#:
#: `error_codes` is nonetheless nameable here. It names members of `ERROR_CODES`
#: — identifiers from a module this one already imports — and every sentence the
#: prompt shows for them is composed by `retry_phrase` from the error classes'
#: own attributes, so nothing about a refusal is being restated.
#:
#: **This tuple is a hand-kept list and that is the whole hazard.** It shipped
#: without `frame` while `lm_handler` raised `FrameError` at sites a caller
#: reaches with its own arguments — `llm_query_batched(prompts=[])` is one — and
#: `frame` is the one consequence in the taxonomy that drops the connection, so
#: the rendered account omitted the harshest outcome the caller could trigger.
#: Membership in `ERROR_CODES` was checked and agreement with the raise sites
#: was not, which is the second-encoding shape this layer closes everywhere else.
#: `test_the_declared_lm_codes_are_the_ones_lm_handler_raises` now reads the
#: raise sites out of `lm_handler.py` by AST at check time — never by import,
#: which would carry `repl_sandbox.dlp` into the guest image — and refuses a
#: divergence in either direction.
_LM_ERROR_CODES: tuple[str, ...] = (
    "cap_rate",
    "cap_concurrency",
    "cap_bytes",
    "cap_spend",
    "depth_ceiling",
    "denied",
    "frame",
    "upstream",
)

#: The `context` slot on both LM capabilities. A **Trellis extension to the rlms
#: LM wire** (INTERFACES section 4), not an rlms field: it takes handles, the host
#: resolves them against the per-CID handle table and splices the referents into
#: the outbound prompt, and no referent byte enters the guest
#: (DATA_MODEL section 6). `x-trellis-kind` renders it `Handle`, which is the
#: prompt-facing point — a slot annotated `Handle` is a slot a string does not fit,
#: and passing a string is exactly what the host refuses.
#:
#: `context` is an rlms *reserved namespace name*, which is a different namespace
#: from this one: `RESERVED_NAMES` governs what may be a capability's name, and
#: this is a parameter of one.
_CONTEXT_PARAMETER: dict = {"x-trellis-kind": "handle"}

_LLM_QUERY = CapabilityDescriptor(
    name="llm_query",
    typed_signature={
        "type": "object",
        "properties": {
            "prompt": {"type": "string"},
            "model": {"type": "string"},
            "context": _CONTEXT_PARAMETER,
        },
        "required": ["prompt"],
        "returns": {"type": "object"},
    },
    doc=(
        "Send one prompt to the host LM handler and return the completion. Pass "
        "handles (never text) as context: the host reads them, this guest does "
        "not. Metered both ways against the session ledgers."
    ),
    dispatch_ref="trellis.lm.v1.single",
    error_codes=_LM_ERROR_CODES,
)

_LLM_QUERY_BATCHED = CapabilityDescriptor(
    name="llm_query_batched",
    typed_signature={
        "type": "object",
        "properties": {
            "prompts": {"type": "array"},
            "model": {"type": "string"},
            "context": _CONTEXT_PARAMETER,
        },
        "required": ["prompts"],
        "returns": {"type": "object"},
    },
    doc=(
        "Send a list of prompts and return one completion each. The same metered "
        "sink as llm_query, with the same handle-only context spliced into every "
        "prompt. Fan-out is bounded host-side."
    ),
    dispatch_ref="trellis.lm.v1.batched",
    error_codes=_LM_ERROR_CODES,
)

#: Materialised for every session at `setup()` (INTERFACES section 2, step 4).
#: Both are metered sinks rather than handle-returning ops, which is why they are
#: the only content-crossing capabilities in the default set.
PRE_REGISTERED: tuple[CapabilityDescriptor, ...] = (_LLM_QUERY, _LLM_QUERY_BATCHED)


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------

_MODULE_HEADER = (
    "# Generated host-side by repl_sandbox.capabilities for guest CID {cid}.\n"
    "# Each function is an RPC proxy: it carries the envelope and the name of the\n"
    "# vsock port to send it on, and holds no credential and no live client.\n"
    "# No routing token is carried in from the guest: the broker resolves routing\n"
    "# from its own (CID, op) table (INTERFACES section 5, Tool denial).\n"
    "# The guest supervisor binds {hook}(port_name, request) -> dict before\n"
    "# executing this module.\n"
    "\n"
    "# Annotations are strings here (PEP 563), so a name such as Handle that the\n"
    "# worker namespace does not bind is still legal in a signature.\n"
    "from __future__ import annotations\n"
    "\n"
    "import uuid as {uuid_alias}\n"
    "\n"
    "_TRELLIS_ENVELOPE_VERSION = {envelope_version}\n"
)


class CapabilityRegistry:
    """The host-side `(CID, capability)` table and its two renderings.

    Instantiated by the trusted driver. Nothing in this class parses guest input,
    and there is no path from a wire frame to `register`: registration is seam 6
    (INTERFACES section 1), which never crosses the boundary.
    """

    def __init__(self) -> None:
        # cid -> ordered {name: (descriptor, port_name)}
        self._by_cid: dict[int, dict[str, tuple[CapabilityDescriptor, str]]] = {}

    # -- registration -------------------------------------------------------

    def register(self, cid: int, descriptor: CapabilityDescriptor, port: str) -> None:
        """Grant one capability to one guest CID over one vsock port.

        Refusals (all `DeniedError`): a CID that is not a guest CID, an unknown
        port name, an rlms reserved name other than the two pre-registered LM
        capabilities, an LM capability routed anywhere but `LM_PORT`, and a
        duplicate name for the same CID.
        """
        if isinstance(cid, bool) or not isinstance(cid, int):
            raise DeniedError(f"cid must be an int, got {type(cid).__name__}")
        if cid < FIRST_GUEST_CID:
            raise DeniedError(
                f"cid {cid} is below the first guest CID ({FIRST_GUEST_CID}); "
                "0/1/2 are the reserved hypervisor/local/host CIDs"
            )
        if not isinstance(descriptor, CapabilityDescriptor):
            raise DeniedError(
                f"descriptor must be a CapabilityDescriptor, got {type(descriptor).__name__}"
            )
        if port not in PORT_NAMES:
            raise DeniedError(
                f"unknown port {port!r}; registration names one of {PORT_NAMES}"
            )
        name = descriptor.name
        if name in RESERVED_NAMES and name not in PRE_REGISTERED_NAMES:
            raise DeniedError(
                f"{name!r} is an rlms reserved namespace name and cannot be a capability"
            )
        if name in PRE_REGISTERED_NAMES and port != "LM_PORT":
            raise DeniedError(f"{name!r} is served by the LM handler and must use LM_PORT")

        table = self._by_cid.setdefault(cid, {})
        if name in table:
            raise DeniedError(f"{name!r} is already registered for cid {cid}")
        table[name] = (descriptor, port)

    # -- reads --------------------------------------------------------------

    def descriptors(self, cid: int) -> tuple[CapabilityDescriptor, ...]:
        """Capabilities granted to `cid`, in registration order.

        An unknown CID has no grants, which is not an error: denial is the
        absence of registration, and the empty tuple is that absence.
        """
        return tuple(descriptor for descriptor, _port in self._registrations(cid))

    def _registrations(
        self, cid: int
    ) -> tuple[tuple[CapabilityDescriptor, str], ...]:
        return tuple(self._by_cid.get(cid, {}).values())

    # -- rendering 1: materialise (backend -> guest) ------------------------

    def materialise(self, cid: int) -> str:
        """Python source defining this CID's guest-side proxy stubs.

        The guest supervisor executes it; this module never does. A stub body
        serialises `{v, req_id, op, args}` and hands it to the transport with the
        port name the registration gave (INTERFACES section 6, Materialise).

        Only ops registered to `cid` appear. An op never granted has no stub and
        so has no dispatch path — that absence is the denial.
        """
        lines = [
            _MODULE_HEADER.format(
                cid=cid,
                hook=TRANSPORT_HOOK,
                uuid_alias=UUID_ALIAS,
                envelope_version=BROKER_ENVELOPE_VERSION,
            )
        ]
        for descriptor, port in self._registrations(cid):
            lines.append(self._stub_source(descriptor, port))
        return "\n".join(lines)

    @staticmethod
    def _stub_source(descriptor: CapabilityDescriptor, port: str) -> str:
        """One proxy stub. Every interpolation is a validated name or a `repr`.

        **An optional parameter the caller left unset is omitted from `args`
        rather than sent as an explicit null**, which is the same rule
        `guest_rpc.lm_request_from_envelope` already applies on the LM port
        ("a `model` of `None` is dropped rather than sent as null"). The DB port
        had no equivalent, and the omission was a live defect rather than a
        stylistic gap: every host-side op reads its optionals with
        `args.get(name, default)`, and `.get` returns the *null*, not the
        default, when the key is present carrying one. So the natural call the
        rendered signature invites — `run_query(sql)`, with `params` left at its
        `None` default — reached `Broker._op_run_query` as `params: None` and was
        refused `denied: params must be a list, got NoneType`. Five of the ten
        broker/algebra capabilities declare an optional parameter and every one
        of them was reachable only by passing a value the signature says is
        optional. Omitting the key here closes the whole class at one point,
        rather than obliging each op to re-handle a null it never asked for.

        A *required* parameter is always sent, `None` included: a missing
        required argument is the host's to refuse, and dropping it would turn a
        precise refusal into a vaguer one.
        """
        params = _parameters(descriptor.typed_signature)
        required = [param for param in params if param.default_source is None]
        optional = [param for param in params if param.default_source is not None]

        lines = [
            "",
            descriptor.signature_source(),
            descriptor.docstring_source(),
            "    {local} = {{{pairs}}}".format(
                local=ARGS_LOCAL,
                pairs=", ".join(f"{param.name!r}: {param.name}" for param in required),
            ),
        ]
        for param in optional:
            lines.append(f"    if {param.name} is not None:")
            lines.append(f"        {ARGS_LOCAL}[{param.name!r}] = {param.name}")
        lines += [
            f"    return {TRANSPORT_HOOK}({port!r}, {{",
            "        'v': _TRELLIS_ENVELOPE_VERSION,",
            f"        'req_id': {UUID_ALIAS}.uuid4().hex,",
            f"        'op': {descriptor.name!r},",
            f"        'args': {ARGS_LOCAL},",
            "    })",
            "",
        ]
        return "\n".join(lines)

    # -- rendering 2: render (composer -> prompt) ---------------------------

    def render(self, cid: int, names: Sequence[str] | None = None) -> str:
        """The prompt-facing stubs: signature, one-line doc, bounds, body stripped.

        This is a frame, not an example. It carries no sample arguments, no
        sample return value, and no worked call — concrete filler in a
        prompt-facing artifact primes content the caller never asked for. The
        free variables in the signature carry the shape; the doc line carries the
        behaviour; the comment lines under it carry the bounds.

        **Those comment lines are the difference between a bound that is
        discoverable and a bound that is only trippable.** A signature and a
        purpose tell a caller what to write and leave every refusal to be found
        by being refused. `expects_source` composes the rest from two derivations
        — a phrase each guard owns, and a retry consequence read off the error
        class — so what the prompt says a capability refuses is what the code
        refuses, by construction rather than by review
        (SELF_DESCRIBING_SURFACES.md section 3.3).

        `names` is progressive disclosure: a caller renders only the signatures a
        turn needs. Order follows `names`, duplicates collapse, and a name that
        was never granted to `cid` is a `DeniedError` — a composer asking for a
        capability the session does not have is a composition bug worth seeing.
        """
        registrations = self._registrations(cid)
        if names is not None:
            index = {descriptor.name: descriptor for descriptor, _port in registrations}
            selected: list[CapabilityDescriptor] = []
            for name in dict.fromkeys(names):
                if name not in index:
                    raise DeniedError(f"{name!r} is not registered for cid {cid}")
                selected.append(index[name])
        else:
            selected = [descriptor for descriptor, _port in registrations]

        blocks = []
        for descriptor in selected:
            parts = [descriptor.signature_source(), descriptor.docstring_source()]
            expects = descriptor.expects_source()
            if expects:
                parts.append(expects)
            parts.append("    ...")
            blocks.append("\n".join(parts))
        return "\n\n\n".join(blocks)
