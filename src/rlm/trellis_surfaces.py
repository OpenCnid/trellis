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

THREE RUNGS, AND AN EARLIER ONE DOES NOT ESTABLISH A LATER ONE
(SELF_DESCRIBING_SURFACES.md §13, the ladder table; AMBIENT.md rule 15
one level down — correct is a different claim from reachable):

  * REGISTERED — the surface carries a descriptor. A name in the
    registry.
  * CONTRIBUTES — that descriptor carries a `contributes` list, so the
    frame can render a line for it.
  * WIRED — a run passes that descriptor to `compose_contributions`, so
    the line reaches the rlms listing and a model reads it.

A surface can sit at rung two forever. It happened: a pass shipped
thirteen contributing surfaces with two named at the composing call, so
eleven finished lines reached no model while a report saying "8 of 9
described" read as progress. This module reports all three rungs
because reporting only the first is what made that state look measured.

The WIRED rung is derived the same way the injected roster is —
by AST, from the `compose_contributions` call in the same file — and it
is derived rather than listed for exactly the reason the defect
occurred: a hand-kept roster of wired surfaces would be the same class
of drift one level up. The derivation reads WHAT THE COMPOSING CALL
DRAWS FROM, so it distinguishes a call that iterates the seam itself
(every injected surface is wired, by construction) from one naming
surfaces literally (only those are wired, and a surface added to the
seam stays unwired until it is named there too).
"""

import ast
import os

# The research-run injection seam this diagnostic derives from. The
# authoring seam (build_author_tools) is a SECOND construction and is
# reported as out of scope rather than silently omitted — silent
# absence is the failure class HARNESS_SELF_MODEL.md §5 names.
_AGENT_MODULE = "trellis_agent.py"
_SEAM_VARIABLE = "custom_tools"

# The composing call the WIRED rung is derived from, and the registry
# lookup a literal roster spells a surface's name inside. Both live in
# the same file as the injection seam, so one parse answers all three
# rungs.
_COMPOSE_FUNCTION = "compose_contributions"
_DESCRIPTOR_LOOKUP = "descriptor_for"

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


def _parse_agent(agent_path):
    path = agent_path or _agent_source_path()
    with open(path, encoding="utf-8") as source_file:
        return ast.parse(source_file.read(), filename=path)


def _call_name(node):
    """The bare name a Call node calls, for naming a contribution this
    read cannot enumerate. Shared by both derivations."""
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return "<expression>"


def _source_label(node):
    """A name for whatever `node` evaluates to, so an unenumerable
    roster is NAMED rather than dropped (the derive_injected_names
    posture, applied at the composing call)."""
    if node is None:
        return "<nothing>"
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Call):
        return _call_name(node)
    if isinstance(node, ast.Attribute):
        return node.attr
    return "<expression>"


def _draws_from_seam(node):
    """True when `node` evaluates the injection seam itself — the bare
    `custom_tools`, a `.keys()`/`.items()` view of it, or a wrapper such
    as `sorted(custom_tools)` around one.

    This is the whole difference between the two wiring shapes. A roster
    drawn from the seam is the seam, so every injected surface is wired
    and no per-surface decision exists to forget. A roster built any
    other way is a second list beside the seam, which is the drift this
    module exists to make visible."""
    if isinstance(node, ast.Name):
        return node.id == _SEAM_VARIABLE
    if isinstance(node, ast.Attribute):
        return _draws_from_seam(node.value)
    if isinstance(node, ast.Call):
        return (_draws_from_seam(node.func)
                or any(_draws_from_seam(arg) for arg in node.args))
    return False


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
    tree = _parse_agent(agent_path)

    names = set()
    dynamic = set()

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


def _roster_from(argument):
    """One composing call's roster argument, read for (names, seam_wide,
    sources).

    `names` are the surfaces spelled literally at the call — the
    `descriptor_for("trellis_postgres")` form. `seam_wide` says the
    roster is drawn from `custom_tools` itself. `sources` names every
    iterable this static read cannot enumerate, so an unreadable roster
    shows up as unreadable rather than as zero wired surfaces."""
    names = set()
    sources = set()
    seam_wide = False

    if isinstance(argument, (ast.ListComp, ast.GeneratorExp, ast.SetComp)):
        # compose_contributions([... for name in custom_tools]) — the
        # roster IS the seam. A generator over anything else is a second
        # list, and it is named.
        for generator in argument.generators:
            if _draws_from_seam(generator.iter):
                seam_wide = True
            else:
                sources.add(_source_label(generator.iter))
    elif isinstance(argument, (ast.List, ast.Tuple, ast.Set)):
        # A literal roster. Entries spelled out are read below; entries
        # spliced in from elsewhere are named.
        for element in argument.elts:
            if isinstance(element, ast.Starred):
                sources.add(_source_label(element.value))
            elif isinstance(element, ast.Name):
                sources.add(element.id)
    elif _draws_from_seam(argument):
        seam_wide = True
    else:
        sources.add(_source_label(argument))

    for child in ast.walk(argument):
        if not isinstance(child, ast.Call):
            continue
        if _call_name(child) != _DESCRIPTOR_LOOKUP:
            continue
        first = child.args[0] if child.args else None
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            names.add(first.value)
        elif not seam_wide:
            # A lookup on a computed name inside a roster that is NOT the
            # seam: the roster is partly opaque, and saying so is the
            # difference between "nothing wired" and "cannot tell".
            sources.add(f"{_DESCRIPTOR_LOOKUP}({_source_label(first)})")

    return names, seam_wide, sources


def derive_wired_names(agent_path=None):
    """The surfaces a run passes to `compose_contributions`, derived by
    AST from the composing code itself — the third rung.

    Returns (names, seam_wide, sources):

      * `names` — surfaces the composing call spells out literally,
      * `seam_wide` — True when the call draws its roster from
        `custom_tools` itself, in which case every injected surface is
        wired and a literal roster is not the answer,
      * `sources` — rosters this read cannot enumerate, named.

    Derived, never listed. A hand-kept set of wired surfaces here would
    be the same defect this rung exists to expose, one level up: the
    reason eleven finished lines reached no model was a list beside the
    seam rather than the seam. Both shapes are read, so reverting the
    composing call to a curated list is visible in the report the same
    turn it lands."""
    tree = _parse_agent(agent_path)

    names = set()
    sources = set()
    seam_wide = False

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if _call_name(node) != _COMPOSE_FUNCTION:
            continue
        argument = node.args[0] if node.args else None
        if argument is None:
            for keyword in node.keywords:
                if keyword.arg in (None, "entries"):
                    argument = keyword.value
                    break
        if argument is None:
            sources.add(f"{_COMPOSE_FUNCTION}(<no roster argument>)")
            continue
        found, wide, dynamic = _roster_from(argument)
        names |= found
        sources |= dynamic
        seam_wide = seam_wide or wide

    return sorted(names), seam_wide, sorted(sources)


def _contributes_field():
    """The descriptor field the contribution frame reads, taken from the
    module that owns it rather than copied here — one encoding, owned by
    whoever is authoritative for it (SELF_DESCRIBING_SURFACES.md §9.1).

    Imported INSIDE the function so this module's own imports stay `ast`
    and `os`: every surface module imports trellis_surfaces at its own
    definition site, and none of them should acquire a dependency to
    answer a diagnostic's question. An unimportable frame raises rather
    than falling back to a copied literal — a fallback would report an
    empty contributing rung and read exactly like a real zero."""
    from trellis_contribution import CONTRIBUTES_FIELD
    return CONTRIBUTES_FIELD


def coverage_report(agent_path=None, registered=None):
    """What the diagnostic knows, at all three rungs: which injected
    surfaces carry a descriptor, which of those descriptors carry a
    contribution, and which contributions a run actually wires.

    `registered` defaults to the live registry; passing one explicitly
    is how the drill exercises the gap paths. This function decides
    nothing — a bare constant injected into the namespace shows up as
    undescribed exactly like a real surface would, because whether it
    WARRANTS a descriptor is a judgment the report does not make.

    `contributing_unwired` is the set worth watching: a surface whose
    line is finished and whom no run passes on. It is empty when the
    composing call draws from the seam (nothing per-surface is left to
    forget) and computed against the literal roster otherwise.
    `attach_contributions` already refuses the opposite direction — a
    line composed for a surface this run does not inject — so between
    that runtime guard and this report both directions are covered."""
    known = registry() if registered is None else dict(registered)
    injected, dynamic = derive_injected_names(agent_path)
    wired_names, seam_wide, wired_sources = derive_wired_names(agent_path)
    field = _contributes_field()

    injected_set = set(injected)
    wired_set = set(wired_names)
    described = [n for n in injected if n in known]
    undescribed = [n for n in injected if n not in known]
    # A descriptor registered for something the seam never injects
    # STATICALLY: not an error (the staged helpers arrive through
    # custom_tools.update and are named under dynamic_sources), but worth
    # showing, because it is also how a rename goes unnoticed.
    registered_not_injected = sorted(n for n in known if n not in injected_set)

    contributing = sorted(
        name for name, descriptor in known.items()
        if isinstance(descriptor, dict) and field in descriptor)
    contributing_set = set(contributing)

    def _wired(name):
        # Seam-wide: wired is the same question as injected, and the
        # static read settles that for the literal seam entries only.
        # None means unsettled, never "no" — a helper arriving through a
        # named dynamic source is not a wiring failure.
        if seam_wide:
            return True if name in injected_set else None
        return name in wired_set

    if seam_wide:
        contributing_unwired = []
    else:
        contributing_unwired = sorted(contributing_set - wired_set)

    rungs = {}
    for name in sorted(injected_set | contributing_set | wired_set):
        rungs[name] = {
            "registered": name in known,
            "contributes": name in contributing_set,
            "wired": _wired(name),
        }

    return {
        "injected": injected,
        "described": described,
        "undescribed": undescribed,
        "registered_not_injected": registered_not_injected,
        "dynamic_sources": dynamic,
        "contributing": contributing,
        "wired": wired_names,
        "wired_seam_wide": seam_wide,
        "wired_sources": wired_sources,
        "contributing_unwired": contributing_unwired,
        "rungs": rungs,
    }


def format_coverage(report):
    """The human-facing render, one row per surface and one column per
    rung. Reports; never refuses.

    Three rungs on one row because the failure this render exists to
    make visible is a surface sitting high on one rung and absent from
    the next. A headline naming only the first reads as progress toward
    the third, which is exactly how eleven finished lines shipped
    reaching no model."""
    lines = ["surface descriptor coverage  (derived from "
             f"{_AGENT_MODULE}'s {_SEAM_VARIABLE} seam; nothing stored)"]
    lines.append(
        "three rungs, and an earlier one does not establish a later one — "
        "R registered (carries a descriptor) · C contributes (that "
        "descriptor carries a line) · W wired (a run passes it to "
        f"{_COMPOSE_FUNCTION})"
    )

    total = len(report["injected"])
    contributing = report["contributing"]
    rungs = report["rungs"]
    settled_wired = [n for n in contributing if rungs[n]["wired"] is True]
    unsettled = [n for n in contributing if rungs[n]["wired"] is None]
    lines.append(
        f"{len(report['described'])} of {total} injected surface(s) carry a "
        f"descriptor · {len(contributing)} carry a contribution · "
        f"{len(settled_wired)} of those are wired at this seam"
        + (f" ({len(unsettled)} not settleable statically)" if unsettled else "")
    )

    for name, rung in rungs.items():
        wired = rung["wired"]
        flags = (("R" if rung["registered"] else "-")
                 + ("C" if rung["contributes"] else "-")
                 + ("W" if wired is True else ("?" if wired is None else "-")))
        lines.append(f"  [{flags}] {name}")

    if report["wired_seam_wide"]:
        lines.append(
            f"  W: the composing call draws its roster from {_SEAM_VARIABLE} "
            f"itself, so every surface a run injects is wired and no "
            f"per-surface wiring decision is left to forget. ? marks a "
            f"surface whose injection this static read cannot settle."
        )
    elif report["wired"]:
        lines.append(
            f"  W: the composing call names {len(report['wired'])} surface(s) "
            f"literally — a roster beside the seam, so a surface added to the "
            f"seam stays unwired until it is named there too: "
            + ", ".join(report["wired"])
        )
    else:
        lines.append(
            f"  W: no readable {_COMPOSE_FUNCTION} roster at this seam, so no "
            f"contribution reaches a model from here."
        )
    if report["contributing_unwired"]:
        lines.append(
            "  CONTRIBUTES BUT IS NOT WIRED — a finished line no run passes "
            "on: " + ", ".join(report["contributing_unwired"])
        )
    if report["wired_sources"]:
        lines.append(
            "  roster(s) at the composing call this read cannot enumerate: "
            + ", ".join(report["wired_sources"])
        )
    for name in report["registered_not_injected"]:
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
