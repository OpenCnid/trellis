"""Where a capability's descriptor is bound: at the definition site of the op.

Design record: docs/architecture/SELF_DESCRIBING_SURFACES.md section 3.2
(Extend the manifest), whose shipped precedent is MASH's `register_command` —
the doc fragment is bound at the *same call site* as the handler, so a command
cannot exist without its description. **One call site, one commitment.** Section
11 (Descriptors are a registration, not a schema) is the standing that governs
what this module may insist on, and section 3.3 is where the `expects` line's
guard-derivation rule comes from.

**This is a local mirror of `src/rlm/trellis_surfaces.py`, and the mirroring is
deliberate rather than a duplication nobody noticed.** Three boundaries forbid
the import that would otherwise be the convergent move:

* *Process.* `capabilities.py` is imported by `guest_main.py`, the entry point
  that runs **inside** the microVM, and `tests/test_guest_main.py` pins that the
  entry point imports and works with the `rlm` module root blocked outright.
  `trellis_surfaces` is host-side by construction: `derive_injected_names`
  AST-parses `trellis_agent.py` off its own `__file__`, a file the guest image
  does not carry.
* *Import.* `src/rlm/` has no `__init__.py`. Its modules are flat top-level
  names reached by placing that directory on `sys.path`
  (`scripts/check_surface_coverage.py`, `src/rlm/trellis_textedit.py`), while
  this package is `repl_sandbox.*` under `src/`. The top-level name `rlm` is
  already the pinned rlms library (`kata_repl.py`'s `from rlm.core.types
  import ...`), so `src/rlm/` can never become a package this side could name.
* *Shape.* `trellis_surfaces` keeps one process-global name -> descriptor map.
  That is the right shape for *definitions* and is what this module mirrors. It
  is the wrong shape for *grants*: `CapabilityRegistry` is per-CID and
  per-session, and `render(an_ungranted_cid) == ""` is the pinned denial
  property. The two registries answer different questions and neither can serve
  the other's.

What converges is therefore the mechanism, not the module: registration at the
definition site, coverage as the enforced property, and field shape left
unvalidated beyond the key.

**What this module insists on, and what it does not.** The key is the
descriptor's `name`, because without one there is no key. Everything else is
`CapabilityDescriptor`'s own business — and that class already validates every
byte that reaches generated Python source, which is a syntax gate rather than a
field-set schema. Nothing here adds a required-field validator; section 11 rules
that a descriptor vocabulary must stay editable while prompt authoring is still
iterating.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import TypeVar

from repl_sandbox.capabilities import CapabilityDescriptor
from repl_sandbox.errors import DeniedError

#: name -> descriptor, populated at import of whichever module defines the op.
#: A definition table, never a grant table: presence here says the host knows
#: what this op is, and says nothing about which CID may call it.
_REGISTRY: dict[str, CapabilityDescriptor] = {}

#: Prefix a host-side op handler's method name carries. `Broker._op_slice`
#: describes the op `slice`, and deriving the one from the other is what stops
#: a descriptor and its handler from drifting apart under a rename.
HANDLER_PREFIX = "_op_"

_F = TypeVar("_F", bound=Callable)


def register_surface(descriptor: CapabilityDescriptor) -> CapabilityDescriptor:
    """Bind a descriptor to its surface, at the surface's definition site.

    Returns the descriptor so a caller can register it inline. Re-registering
    an equal descriptor is a no-op, so a re-imported module is harmless;
    registering a *different* descriptor under a live name raises, because two
    surfaces claiming one name is a real defect the registry can see.
    """
    if not isinstance(descriptor, CapabilityDescriptor):
        raise DeniedError(
            f"a surface descriptor must be a CapabilityDescriptor, got "
            f"{type(descriptor).__name__}"
        )
    existing = _REGISTRY.get(descriptor.name)
    if existing is not None and existing != descriptor:
        raise DeniedError(
            f"surface {descriptor.name!r} is already registered with a different "
            "descriptor; two surfaces cannot share one name"
        )
    _REGISTRY[descriptor.name] = descriptor
    return descriptor


def registry() -> dict[str, CapabilityDescriptor]:
    """A copy of the live definition table: op name -> descriptor."""
    return dict(_REGISTRY)


def descriptor_for(name: str) -> CapabilityDescriptor | None:
    """The descriptor registered under `name`, or `None`."""
    return _REGISTRY.get(name)


def describes(
    *,
    doc: str,
    dispatch_ref: str,
    properties: Mapping[str, dict],
    required: Sequence[str],
    expects: Iterable[str] = (),
    error_codes: Iterable[str] = (),
    returns: dict | None = None,
) -> Callable[[_F], _F]:
    """Bind one op's descriptor to the handler that implements it.

    The decorated function keeps its identity — this returns it unchanged — so
    the only thing the decoration adds is the registration. The op name is read
    off the handler's own `__name__` with `HANDLER_PREFIX` stripped, which is
    what makes the pair inseparable: renaming the handler renames the surface,
    and there is no second place to forget.

    `expects` carries phrases the guards in the decorated module own, and
    `error_codes` names the taxonomy codes reachable from this handler. Neither
    is prompt prose composed here; both are read back out by
    `CapabilityRegistry.render`, which turns `error_codes` into retry sentences
    through `errors.retry_phrase`.
    """

    def bind(func: _F) -> _F:
        name = func.__name__
        if name.startswith(HANDLER_PREFIX):
            name = name[len(HANDLER_PREFIX) :]
        register_surface(
            CapabilityDescriptor(
                name=name,
                typed_signature={
                    "type": "object",
                    "properties": dict(properties),
                    "required": list(required),
                    "returns": dict(returns) if returns is not None else {"type": "object"},
                },
                doc=doc,
                dispatch_ref=dispatch_ref,
                expects=tuple(expects),
                error_codes=tuple(error_codes),
            )
        )
        return func

    return bind


def undescribed(names: Iterable[str]) -> list[str]:
    """Which of `names` carry no descriptor. Reports; refuses nothing.

    The coverage half of `trellis_surfaces.coverage_report`, kept to the one
    question section 11 rules is worth mechanizing — *does every live surface
    carry a descriptor at all* — and kept informational for the same reason:
    nothing derived from a descriptor gates anything without its own owner gate
    (HARNESS_SELF_MODEL.md section 12.2).
    """
    return sorted(name for name in names if name not in _REGISTRY)


__all__ = [
    "HANDLER_PREFIX",
    "describes",
    "descriptor_for",
    "register_surface",
    "registry",
    "undescribed",
]
