"""The surface registry and its coverage diagnostic (Workstream B
increment 2).

Design records: docs/architecture/SELF_DESCRIBING_SURFACES.md §11
(Descriptors are a registration, not a schema — the owner ruling this
module implements) and §3.2/§3.3; the buildable spec is
docs/architecture/LLM_HELP_SPEC.md §1 (the descriptor) and §11.

The one line: a surface registers its own descriptor at the site where
the surface is defined — MASH's *one call site, one commitment* — and
the registry is what a coverage diagnostic, and later `llm_help`, read.

TWO PROPERTIES, DELIBERATELY SEPARATED (the §11 ruling):

  * COVERAGE is the enforced property. "Does every injected surface
    carry a descriptor at all" stays a stable question while the fields
    underneath it move, so it is the one worth mechanizing.
  * FIELD SHAPE IS NOT ENFORCED. This module validates no field set.
    A descriptor may carry whatever fields its surface needs, and
    adding one is an edit rather than a ceremony — a vocabulary that
    became law early could not survive the iteration prompt authoring
    requires. The only thing `register_surface` insists on is a name,
    because without one there is no key to register under; that is the
    registry's own precondition, not a schema.

The diagnostic INFORMS and never refuses (SELF_DESCRIBING_SURFACES.md
§11; HARNESS_SELF_MODEL.md §12.2 keeps every gate separately
owner-gated). It reports; nothing downstream is blocked by what it
finds, and no run behaves differently because of it.

Injected names are DERIVED from the code that injects them — the
`custom_tools` construction in trellis_agent.py, read by AST at
diagnostic time — so the roster cannot drift from the seam the way a
hand-maintained list would. That is the same move the density-chain
checker makes by parsing the map's own table instead of storing a copy.
"""

import ast
import os

# The research-run injection seam this diagnostic derives from. The
# authoring seam (build_author_tools) is a SECOND construction and is
# reported as out of scope rather than silently omitted — silent
# absence is the failure class HARNESS_SELF_MODEL.md §5 names.
_AGENT_MODULE = "trellis_agent.py"
_SEAM_VARIABLE = "custom_tools"

_REGISTRY = {}


def register_surface(descriptor):
    """Bind a descriptor to its surface, at the surface's definition
    site. Returns the descriptor so it can be registered inline.

    Field shape is NOT validated (§11): the descriptor may carry any
    fields. A non-empty string `name` is required because it is the
    registry key. Re-registering the identical descriptor is a no-op,
    so a re-imported module is harmless; registering a DIFFERENT
    descriptor under a live name raises, because two surfaces claiming
    one name is a real defect the registry can see."""
    if not isinstance(descriptor, dict):
        raise ValueError(
            f"A surface descriptor must be a dict, got "
            f"{type(descriptor).__name__}."
        )
    name = descriptor.get("name")
    if not isinstance(name, str) or name.strip() == "":
        raise ValueError(
            "A surface descriptor needs a non-empty string 'name': it is "
            "the registry key, not a validated field. Every other field "
            "is the surface's own business (SELF_DESCRIBING_SURFACES.md "
            "§11)."
        )
    existing = _REGISTRY.get(name)
    if existing is not None and existing is not descriptor and existing != descriptor:
        raise ValueError(
            f"Surface {name!r} is already registered with a different "
            f"descriptor. Two surfaces cannot share one name — rename "
            f"one, or register the same descriptor object."
        )
    _REGISTRY[name] = descriptor
    return descriptor


def registry():
    """A copy of the live registry: surface name -> descriptor."""
    return dict(_REGISTRY)


def descriptor_for(name):
    """The descriptor registered under `name`, or None. `llm_help`'s
    per-surface account will read through here."""
    return _REGISTRY.get(name)


def _agent_source_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        _AGENT_MODULE)


def derive_injected_names(agent_path=None):
    """The names the agent injects into the REPL namespace, derived by
    AST from the injecting code itself.

    Covers the two static forms the research seam uses — the
    `custom_tools = {...}` literal and `custom_tools["name"] = ...`
    subscript assignment — and reports the dynamic contributions it
    cannot enumerate statically rather than dropping them. Returns
    (names, dynamic_sources): a sorted list, and the sorted callables
    whose returned dicts are merged in (`custom_tools.update(...)`) or
    assigned wholesale."""
    path = agent_path or _agent_source_path()
    with open(path, encoding="utf-8") as source_file:
        tree = ast.parse(source_file.read(), filename=path)

    names = set()
    dynamic = set()

    def _call_name(node):
        func = node.func
        if isinstance(func, ast.Name):
            return func.id
        if isinstance(func, ast.Attribute):
            return func.attr
        return "<expression>"

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                # custom_tools = {...} — the kernel surfaces every
                # research run gets.
                if isinstance(target, ast.Name) and target.id == _SEAM_VARIABLE:
                    if isinstance(node.value, ast.Dict):
                        for key in node.value.keys:
                            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                                names.add(key.value)
                    elif isinstance(node.value, ast.Call):
                        # A whole seam built by a factory — the
                        # authoring path. Named, never guessed at.
                        dynamic.add(_call_name(node.value))
                # custom_tools["name"] = ... — the operator-gated ones.
                elif (isinstance(target, ast.Subscript)
                        and isinstance(target.value, ast.Name)
                        and target.value.id == _SEAM_VARIABLE
                        and isinstance(target.slice, ast.Constant)
                        and isinstance(target.slice.value, str)):
                    names.add(target.slice.value)
        # custom_tools.update(factory_result) — the staged helpers.
        elif isinstance(node, ast.Call):
            func = node.func
            if (isinstance(func, ast.Attribute) and func.attr == "update"
                    and isinstance(func.value, ast.Name)
                    and func.value.id == _SEAM_VARIABLE):
                for arg in node.args:
                    if isinstance(arg, ast.Name):
                        dynamic.add(arg.id)
                    elif isinstance(arg, ast.Call):
                        dynamic.add(_call_name(arg))

    return sorted(names), sorted(dynamic)


def coverage_report(agent_path=None, registered=None):
    """What the diagnostic knows: which injected surfaces carry a
    descriptor and which do not.

    `registered` defaults to the live registry; passing one explicitly
    is how the drill exercises the gap path. This function decides
    nothing — a bare constant injected into the namespace shows up as
    undescribed exactly like a real surface would, because whether it
    WARRANTS a descriptor is a judgment the report does not make."""
    known = registry() if registered is None else dict(registered)
    injected, dynamic = derive_injected_names(agent_path)
    described = [n for n in injected if n in known]
    undescribed = [n for n in injected if n not in known]
    # A descriptor registered for something the seam never injects: not
    # an error (a surface may register before it is wired), but worth
    # showing, because it is how a rename goes unnoticed.
    unwired = sorted(n for n in known if n not in injected)
    return {
        "injected": injected,
        "described": described,
        "undescribed": undescribed,
        "unwired": unwired,
        "dynamic_sources": dynamic,
    }


def format_coverage(report):
    """The human-facing render. Reports; never refuses."""
    lines = ["surface descriptor coverage  (derived from "
             f"{_AGENT_MODULE}'s {_SEAM_VARIABLE} seam; nothing stored)"]
    total = len(report["injected"])
    lines.append(
        f"{len(report['described'])} of {total} injected surface(s) "
        f"carry a descriptor"
    )
    for name in report["described"]:
        lines.append(f"  [described]   {name}")
    for name in report["undescribed"]:
        lines.append(f"  [no descriptor] {name}")
    for name in report["unwired"]:
        lines.append(
            f"  [registered, not injected here] {name}"
        )
    if report["dynamic_sources"]:
        lines.append(
            "  not enumerable statically, so NOT counted above: "
            + ", ".join(report["dynamic_sources"])
        )
    lines.append(
        "This reports; it refuses nothing. Whether a name warrants a "
        "descriptor at all is a human call."
    )
    return "\n".join(lines)
