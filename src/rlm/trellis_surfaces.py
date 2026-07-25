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

AND WIRED IS STILL NOT DELIVERED. The three rungs are per-surface and
they stop at the composing call. What that call RETURNS has to be
attached back to `custom_tools` and that mapping has to be the one rlms
is handed, or every composed line is computed, budget-checked, and
dropped while all three rungs read closed and the prompt reverts to
"A custom <Type> value" for every surface. `derive_delivery` reads those
links — attached, rendered, and not undone by a later seam mutation —
from the same source, and reports them as ONE seam-wide property rather
than a fourth per-surface flag, because attach either runs on the whole
dict or on none of it.

AND DELIVERY IS PER RUN MODE, NOT PER FILE. `trellis_agent.py` holds two
constructions of `custom_tools`, one per `--mode`, and each hands its own
mapping to its own renderer call. Delivery is a chain inside ONE
function, so there are as many delivery answers as there are functions
composing — and a read returning one of them names a property of one run
mode while reading like a property of the file. This module derived
exactly that for a while: it took the LAST composing function and called
its answer the answer, which was harmless only because the second mode
composed nothing at all. `_composing_scopes` returns them all,
`derive_delivery` answers per seam and reports `delivered` as the
conjunction, and `format_coverage` names each seam, so a mode that stops
delivering cannot hide behind a sibling that still does.

A RUN MODE THAT RENDERS WITHOUT COMPOSING is the shape that state was in
before anyone noticed, and it is invisible to every read above: its
surfaces are not in the injected roster (they arrive through a factory,
named under `dynamic_sources`), it owns no composing call for the wired
rung to read, and its delivery answer does not exist to be false.
Everything reads closed and its model reads type names.
`derive_delivery` therefore also reports `rendering_without_composing` —
functions handing the renderer a `custom_tools=` with no composing call
of their own — which is derived from the same parse and is the one
condition that names a whole run mode rather than a surface.

The seam keeps one hand-kept roster below the derived one: `_expects`,
which supplies the guard-owned phrases an ('expects', key) slot resolves
through. A surface missing from it does not lose a line — the
composition raises while the run is starting and takes the run with it.
`derive_expects_roster` reads that dict so the requirement can be
computed against the registry rather than read off by eye.
"""

import ast
import os

# The injection seam this diagnostic derives from. Both run modes build a
# local named this, so the per-surface rungs read the research mode's
# literal entries while the authoring mode's arrive through a factory and
# are named under `dynamic_sources` — reported as unenumerable rather
# than silently omitted, which is the failure class
# HARNESS_SELF_MODEL.md §5 names. The seam-wide reads below are per
# function, so they answer per run mode.
_AGENT_MODULE = "trellis_agent.py"
_SEAM_VARIABLE = "custom_tools"

# The composing call the WIRED rung is derived from, and the registry
# lookup a literal roster spells a surface's name inside. Both live in
# the same file as the injection seam, so one parse answers all three
# rungs.
_COMPOSE_FUNCTION = "compose_contributions"
_DESCRIPTOR_LOOKUP = "descriptor_for"

# THE LINKS PAST THE COMPOSING CALL. Composing is necessary and is not
# sufficient: a composed mapping that is discarded, or attached to a name
# rlms never renders, produces byte-for-byte what an uncomposed run
# produces — every surface back to "A custom <Type> value" — while the
# WIRED rung above still reads closed, because that rung reads the
# composing call and nothing downstream of it. `RLM` is rlms's entry point
# and `custom_tools=` is the parameter whose entries it renders, so this
# pair is the seam's FAR end the way _SEAM_VARIABLE is its near end.
_RENDERER = "RLM"
_RENDER_KEYWORD = "custom_tools"

# The per-surface expectation suppliers the composing call reads. A
# descriptor asking for a guard-owned phrase resolves through this dict at
# compose time, so a surface missing from it is a startup exception rather
# than a missing line — the composition raises and the whole run ends.
_EXPECTS_ROSTER = "_expects"

# COVERAGE'S RECORDED EXCEPTIONS, and why these are recorded where
# everything else on this page is derived.
#
# `format_coverage`'s own closing sentence is the reason: whether a name
# WARRANTS a descriptor at all is a human call. A human call is not a fact
# about the code, so no read of the code returns it — a derivation that
# tried would be inferring intent from a value's type or a name's case,
# and a wrong inference here EXEMPTS a real gap silently, which is worse
# than the gap. So the judgment is written down, with the record that made
# it, and the roster is held honest from both sides instead: a declination
# for a name the seam no longer injects, and a declination for a name that
# has since registered a descriptor, are each reported as defects in the
# roster (see coverage_report's `declined_not_injected` and
# `declined_but_described`). That is what keeps this from being the
# hand-kept list one level up — it cannot drift without saying so.
DECLINED = {
    "UPSUM_BUDGET":
        "a bare int the run injects as a REPL constant, declined a "
        "descriptor on purpose rather than missing one "
        "(SELF_DESCRIBING_SURFACES.md §13, The description slot, and the "
        "gate this did not run).",
}

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


def _statement_holding(scope, target):
    """The innermost statement in `scope` whose subtree contains `target`.

    What a composed value is DONE with is a property of the statement it
    sits in — assigned back to the seam, assigned somewhere else, or
    evaluated and dropped — so the read that answers it has to climb from
    the call to its statement. Innermost is the last one to open, which
    is the greatest (lineno, col_offset) among the statements containing
    it."""
    holders = [stmt for stmt in ast.walk(scope)
               if isinstance(stmt, ast.stmt)
               and any(child is target for child in ast.walk(stmt))]
    if not holders:
        return None
    return max(holders, key=lambda stmt: (stmt.lineno, stmt.col_offset))


def _composing_scopes(tree):
    """Every function body a composing call sits in, in source order.

    Delivery is a chain inside ONE function: compose, attach back to the
    seam, hand the seam to the renderer. Scoping to that function is what
    keeps one run mode's `RLM(custom_tools=custom_tools)` from answering
    another's question — a read that ranged over the module would let a
    healthy mode's renderer call stand in for a sibling that had stopped
    attaching.

    ALL of them, never one. This returned a single scope until July 25,
    2026, chosen as the last one to open, and the choice was invisible
    because only one function composed. The moment the second run mode
    composed, that `max` picked one mode's chain and reported it as the
    file's — the same defect as the hand-kept roster one rung up, moved
    from surfaces to run modes. The callers below answer per scope and
    aggregate by conjunction, so every mode has to deliver for the report
    to say delivered."""
    scopes = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for child in ast.walk(node):
            if isinstance(child, ast.Call) and _call_name(child) == _COMPOSE_FUNCTION:
                scopes.append(node)
                break
    return sorted(scopes, key=lambda fn: (fn.lineno, fn.col_offset))


def _rendering_scopes(tree):
    """Every function body that hands the renderer a `custom_tools=`, in
    source order, by name.

    This is the read that sees a WHOLE RUN MODE go undescribed. Every
    other read here is anchored on a composing call or on the seam's
    literal entries, so a mode that builds its mapping from a factory and
    composes nothing is absent from all of them: no injected names to
    count, no roster to read, no delivery answer to be false. It renders,
    its model reads type names, and the report is silent. Compared
    against the composing scopes, its absence becomes a positive
    statement instead."""
    names = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for child in ast.walk(node):
            if not (isinstance(child, ast.Call)
                    and _call_name(child) == _RENDERER):
                continue
            if any(keyword.arg == _RENDER_KEYWORD for keyword in child.keywords):
                names.append((node.lineno, node.col_offset, node.name))
                break
    return [name for _, _, name in sorted(names)]


def _seam_mutations(scope):
    """Every statement in `scope` that puts a surface into the seam after
    the dict exists — a `custom_tools["name"] = ...` subscript assignment
    and a `custom_tools.update(...)` merge. Returns sorted (lineno, label)
    pairs.

    Read for ORDER, which is the one thing about these that the injected
    roster does not settle: `attach_contributions` returns a NEW mapping,
    so a surface added to the seam after that call carries the bare value
    it was added with and its composed line is dropped on the floor. That
    is plant 1 again, restricted to one surface instead of all of them."""
    found = []
    for node in ast.walk(scope):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if (isinstance(target, ast.Subscript)
                        and isinstance(target.value, ast.Name)
                        and target.value.id == _SEAM_VARIABLE):
                    label = (target.slice.value
                             if isinstance(target.slice, ast.Constant)
                             and isinstance(target.slice.value, str)
                             else "<computed key>")
                    found.append((node.lineno, label))
        elif isinstance(node, ast.Call):
            func = node.func
            if (isinstance(func, ast.Attribute) and func.attr == "update"
                    and isinstance(func.value, ast.Name)
                    and func.value.id == _SEAM_VARIABLE):
                merged = ", ".join(_source_label(arg) for arg in node.args)
                found.append((node.lineno, merged or "<nothing>"))
    return sorted(found)


def _delivery_in(scope):
    """One composing function's delivery chain: compose, attach back to
    the seam, hand the seam to the renderer, and touch the seam no more.

    One function is the whole unit of this question — see
    `_composing_scopes`. `derive_delivery` calls this once per seam and
    reports the conjunction."""
    delivery = {
        "composed": True,
        "attached": False,
        "attach_sinks": [],
        "rendered": False,
        "render_sources": [],
        "mutated_after_attach": [],
        "seam_wide": False,
        "delivered": False,
        "scope": scope.name,
    }

    sinks = set()
    attach_lines = []
    for node in ast.walk(scope):
        if not (isinstance(node, ast.Call)
                and _call_name(node) == _COMPOSE_FUNCTION):
            continue
        # The wiring SHAPE, per seam. `derive_wired_names` ORs its flag
        # across every composing call in the file, which answers "is any
        # roster drawn from its seam" — a fair question with one seam and
        # the wrong one with two, since a mode that curated its roster
        # would read seam-wide off its sibling. Here it is the shape of
        # THIS seam's roster and nothing else's.
        argument = node.args[0] if node.args else None
        if argument is None:
            for keyword in node.keywords:
                if keyword.arg in (None, "entries"):
                    argument = keyword.value
                    break
        if argument is not None and _roster_from(argument)[1]:
            delivery["seam_wide"] = True
        holder = _statement_holding(scope, node)
        if isinstance(holder, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == _SEAM_VARIABLE
                for target in holder.targets):
            delivery["attached"] = True
            attach_lines.append(holder.lineno)
        elif isinstance(holder, ast.Assign):
            sinks.add(", ".join(_source_label(t) for t in holder.targets)
                      or "<expression>")
        elif isinstance(holder, ast.AnnAssign) and holder.target is not None:
            sinks.add(_source_label(holder.target))
        elif isinstance(holder, ast.Expr):
            sinks.add("<discarded: composed, then never assigned>")
        elif holder is None:
            sinks.add("<no enclosing statement>")
        else:
            sinks.add(f"<{type(holder).__name__}>")
    delivery["attach_sinks"] = sorted(sinks)

    render_sources = set()
    for node in ast.walk(scope):
        if not (isinstance(node, ast.Call) and _call_name(node) == _RENDERER):
            continue
        for keyword in node.keywords:
            if keyword.arg != _RENDER_KEYWORD:
                continue
            if (isinstance(keyword.value, ast.Name)
                    and keyword.value.id == _SEAM_VARIABLE):
                delivery["rendered"] = True
            else:
                render_sources.add(_source_label(keyword.value))
    delivery["render_sources"] = sorted(render_sources)

    if attach_lines:
        cutoff = max(attach_lines)
        delivery["mutated_after_attach"] = [
            label for lineno, label in _seam_mutations(scope) if lineno > cutoff]

    delivery["delivered"] = bool(
        delivery["attached"] and delivery["rendered"]
        and not delivery["mutated_after_attach"])
    return delivery


def derive_delivery(agent_path=None):
    """Whether a composed contribution can REACH a model — the three
    links past the composing call, derived from the same source the other
    rungs are.

    The WIRED rung answers *does a run pass this surface to
    compose_contributions*. It does not answer *does the result go
    anywhere*, and those come apart in one edit: drop the
    `attach_contributions` wrapper and every composed line is computed,
    measured against the budget, and discarded, while the roster is still
    drawn from the seam and every rung above still reads closed. The
    prompt reverts to what it was before the layer landed and the report
    says nothing changed.

    Returns a dict:

      * `composed` — a composing call exists at all,
      * `attached` — its value is assigned BACK to the seam variable, so
        the descriptions land in the dict that gets rendered,
      * `attach_sinks` — where the composed value goes when it is not the
        seam, named rather than dropped (`<discarded ...>` for a bare
        expression statement),
      * `rendered` — the seam variable itself is what the renderer is
        handed as `custom_tools=`,
      * `render_sources` — what the renderer is handed instead, named,
      * `mutated_after_attach` — surfaces put into the seam after the
        attach, whose lines the new mapping cannot carry,
      * `seam_wide` — THIS seam's roster is drawn from `custom_tools`
        itself, so nothing per-surface is left for this mode to forget
        (the file-wide flag on `derive_wired_names` cannot say that of
        one mode once a second mode composes),
      * `delivered` — all of the above, which is the property,
      * `scope` — the composing function(s) all of this was read inside,
        named in source order,
      * `seams` — one such dict per composing function, so a mode that
        stopped delivering is named rather than averaged away, and
      * `rendering_without_composing` — functions handing the renderer a
        `custom_tools=` and composing nothing, which is a whole run mode
        reading type names and is invisible to every other read here.

    ONE ANSWER PER RUN MODE, aggregated by conjunction. The keys above
    the seam list are the file's answer: `attached` and `rendered` and
    `delivered` hold when they hold in EVERY composing seam, and the
    sink and source lists are the union across seams, so a report reading
    delivered is a report about all of them. `composed` stays a statement
    that something composes at all.
    """
    tree = _parse_agent(agent_path)
    seams = [_delivery_in(scope) for scope in _composing_scopes(tree)]
    composing = {seam["scope"] for seam in seams}
    orphaned = [name for name in _rendering_scopes(tree)
                if name not in composing]

    if not seams:
        return {
            "composed": False,
            "attached": False,
            "attach_sinks": [],
            "rendered": False,
            "render_sources": [],
            "mutated_after_attach": [],
            "seam_wide": False,
            "delivered": False,
            "scope": None,
            "seams": [],
            "rendering_without_composing": orphaned,
        }

    return {
        "composed": True,
        "attached": all(seam["attached"] for seam in seams),
        "attach_sinks": sorted({sink for seam in seams
                                for sink in seam["attach_sinks"]}),
        "rendered": all(seam["rendered"] for seam in seams),
        "render_sources": sorted({source for seam in seams
                                  for source in seam["render_sources"]}),
        "mutated_after_attach": sorted({label for seam in seams
                                        for label in seam["mutated_after_attach"]}),
        "seam_wide": all(seam["seam_wide"] for seam in seams),
        "delivered": all(seam["delivered"] for seam in seams),
        "scope": ", ".join(seam["scope"] for seam in seams),
        "seams": seams,
        "rendering_without_composing": orphaned,
    }


def derive_expects_roster(agent_path=None):
    """The surfaces the composing call can supply guard-derived
    expectations for, read from the `_expects` dict at the seam.

    Returns (names, sources): the literal keys, and any key or whole
    roster this static read cannot enumerate.

    This is the one roster at the seam that is still kept by hand, one
    level BELOW the derived one: the composing call iterates
    `custom_tools`, so every injected surface is composed, but a surface
    whose descriptor carries an ('expects', ...) slot resolves that slot
    through this dict. A name dropped from it does not lose a line — it
    raises ContributionShapeError while the run is starting, before any
    paid call, and takes the whole run with it. Derived here so the
    requirement can be computed against the registry instead of read off
    by eye.

    THE UNION ACROSS COMPOSING SEAMS, where delivery is the conjunction,
    and the asymmetry is the failure mode rather than an oversight. An
    unsupplied slot is LOUD: the run raises while it is starting, so it
    reaches no model and ships nothing. An undelivered seam is SILENT: the
    run completes and its model reads type names. This diagnostic exists
    for the silent one, so delivery is answered per mode; the roster is
    answered for the file, because what it settles is whether a slot can
    resolve anywhere."""
    tree = _parse_agent(agent_path)
    names = set()
    sources = set()
    for scope in _composing_scopes(tree):
        for node in ast.walk(scope):
            if not isinstance(node, ast.Assign):
                continue
            if not any(isinstance(target, ast.Name) and target.id == _EXPECTS_ROSTER
                       for target in node.targets):
                continue
            if isinstance(node.value, ast.Dict):
                for key in node.value.keys:
                    if isinstance(key, ast.Constant) and isinstance(key.value, str):
                        names.add(key.value)
                    else:
                        sources.add(_source_label(key))
            else:
                sources.add(_source_label(node.value))
    return sorted(names), sorted(sources)


def _expects_tag():
    """The tuple tag a guard-owned slot carries, taken from the module
    that owns it rather than copied here — the `_contributes_field`
    discipline, for the same reason (§9.1, one encoding)."""
    from trellis_contribution import EXPECTS_TAG
    return EXPECTS_TAG


def _needs_expects(descriptor, tag, field):
    """True when this descriptor cannot render without a derived
    expectation mapping — it carries at least one (tag, key) slot."""
    if not isinstance(descriptor, dict):
        return False
    pieces = descriptor.get(field)
    if not isinstance(pieces, (list, tuple)):
        return False
    return any(isinstance(piece, (tuple, list)) and len(piece) == 2
               and piece[0] == tag for piece in pieces)


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
    # Coverage is the enforced property (§11), and it has recorded
    # exceptions rather than none. Splitting the two is what lets a
    # reader — and an exit code — tell "this seam is fully covered, with
    # one name declined on the record" from "one name is missing". The
    # undescribed list keeps its meaning and its name; `gaps` is the
    # subset nobody has decided about.
    declined = [n for n in undescribed if n in DECLINED]
    gaps = [n for n in undescribed if n not in DECLINED]
    # The two ways the recorded roster goes wrong, both derived against
    # the seam so the roster cannot quietly outlive what it exempts.
    declined_not_injected = sorted(n for n in DECLINED if n not in injected_set)
    declined_but_described = sorted(n for n in DECLINED if n in known)
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

    # One row per name this diagnostic knows about, from any direction:
    # injected by the seam, registered in the registry, or named at the
    # composing call. A name appearing from only one of the three is the
    # interesting case, so the domain is their union rather than any one.
    rungs = {}
    for name in sorted(injected_set | set(known) | wired_set):
        rungs[name] = {
            "registered": name in known,
            "contributes": name in contributing_set,
            "injected": name in injected_set,
            "wired": _wired(name),
        }

    # Past the per-surface rungs: whether the composed mapping reaches the
    # renderer at all, and whether every slot that needs a guard-derived
    # phrase has a supplier at the seam. Both are seam-wide rather than
    # per-surface — attach either runs on the whole dict or on none of
    # it — so they qualify the whole W column instead of adding a fourth
    # flag to it, and §13's three-rung table stays the table it is.
    delivery = derive_delivery(agent_path)
    expects_roster, expects_roster_sources = derive_expects_roster(agent_path)
    expects_tag = _expects_tag()
    needs_expects = {name for name, descriptor in known.items()
                     if _needs_expects(descriptor, expects_tag, field)}
    roster_set = set(expects_roster)
    expects_required = sorted(n for n in needs_expects if n in injected_set)
    expects_unsupplied = [n for n in expects_required if n not in roster_set]
    expects_orphaned = sorted(n for n in expects_roster if n not in injected_set)

    return {
        "injected": injected,
        "described": described,
        "undescribed": undescribed,
        "declined": declined,
        "gaps": gaps,
        "declined_not_injected": declined_not_injected,
        "declined_but_described": declined_but_described,
        "registered_not_injected": registered_not_injected,
        "dynamic_sources": dynamic,
        "contributing": contributing,
        "wired": wired_names,
        "wired_seam_wide": seam_wide,
        "wired_sources": wired_sources,
        "contributing_unwired": contributing_unwired,
        "delivery": delivery,
        "expects_roster": expects_roster,
        "expects_roster_sources": expects_roster_sources,
        "expects_required": expects_required,
        "expects_unsupplied": expects_unsupplied,
        "expects_orphaned": expects_orphaned,
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
        "three rungs, and an earlier one does not establish a later one:"
    )
    lines.append(
        "  R registered, carries a descriptor | C contributes, that "
        "descriptor carries a line"
    )
    lines.append(
        f"  W wired, a run passes it to {_COMPOSE_FUNCTION} -- '-' means it "
        "has a line no run passes on"
    )
    lines.append(
        "  '?' the seam may inject it dynamically, which this static read "
        "cannot settle | '.' nothing at that rung"
    )

    total = len(report["injected"])
    contributing = report["contributing"]
    rungs = report["rungs"]
    settled_wired = [n for n in contributing if rungs[n]["wired"] is True]
    unsettled = [n for n in contributing if rungs[n]["wired"] is None]
    lines.append(
        f"{len(report['described'])} of {total} injected surface(s) carry a "
        f"descriptor | {len(contributing)} registered surface(s) carry a "
        f"contribution | {len(settled_wired)} of those are wired at this seam"
        + (f", {len(unsettled)} not settleable statically" if unsettled else "")
    )
    lines.append(
        f"coverage: {len(report['gaps'])} gap(s), "
        f"{len(report['declined'])} declined on the record"
    )
    delivery = report["delivery"]
    seams = delivery.get("seams") or []
    if delivery["delivered"]:
        lines.append(
            f"  D: the composed mapping is attached back to {_SEAM_VARIABLE} and "
            f"{_SEAM_VARIABLE} is what {_RENDERER} renders, so a wired line "
            f"reaches a model. Read inside "
            + ", ".join(f"{seam['scope']}()" for seam in seams)
            + f" -- {len(seams)} composing seam(s), and each one is a run mode "
            f"answered separately."
        )
    else:
        lines.append(
            "  NOT DELIVERED -- every W above is a line that reaches no model:"
        )
        if not delivery["composed"]:
            lines.append(
                f"    no {_COMPOSE_FUNCTION} call inside any function, so "
                f"nothing is composed to deliver."
            )
        # Per seam, so a mode that stopped delivering is named instead of
        # being averaged into a sibling that still does.
        for seam in seams:
            if seam["delivered"]:
                continue
            if not seam["attached"]:
                lines.append(
                    f"    {seam['scope']}(): the composed mapping is never "
                    f"assigned back to {_SEAM_VARIABLE}; it goes to: "
                    + (", ".join(seam["attach_sinks"]) or "<nothing readable>")
                )
            if not seam["rendered"]:
                lines.append(
                    f"    {seam['scope']}(): {_RENDERER} is not handed "
                    f"{_SEAM_VARIABLE} as {_RENDER_KEYWORD}=; it is handed: "
                    + (", ".join(seam["render_sources"]) or "<no such call here>")
                )
            if seam["mutated_after_attach"]:
                lines.append(
                    f"    {seam['scope']}(): put into the seam AFTER the "
                    "attach, so the attached mapping cannot carry their "
                    "lines: " + ", ".join(seam["mutated_after_attach"])
                )
    _narrow = [seam["scope"] for seam in seams if not seam["seam_wide"]]
    if _narrow:
        lines.append(
            f"  ROSTER BESIDE THE SEAM in: "
            + ", ".join(f"{name}()" for name in _narrow)
            + f" -- that mode composes from a list rather than from "
            f"{_SEAM_VARIABLE}, so a surface added to its seam stays "
            "undescribed. The W column above cannot say this: its flag is "
            "true if ANY mode draws from its seam."
        )
    if delivery.get("rendering_without_composing"):
        lines.append(
            f"  A RUN MODE THAT RENDERS AND COMPOSES NOTHING -- it hands "
            f"{_RENDERER} a {_RENDER_KEYWORD}= of its own and owns no "
            f"{_COMPOSE_FUNCTION} call, so every surface it injects reaches "
            "its model as a type name and no rung above says so: "
            + ", ".join(f"{name}()" for name
                        in delivery["rendering_without_composing"])
        )
    if report["expects_unsupplied"]:
        lines.append(
            "  NO EXPECTATION SUPPLIER -- a descriptor slot that resolves "
            f"through the seam's {_EXPECTS_ROSTER} roster, for a surface the "
            "roster does not name. This ends the run at composition, not at "
            "the line: " + ", ".join(report["expects_unsupplied"])
        )
    if report["expects_orphaned"]:
        lines.append(
            f"  {_EXPECTS_ROSTER} names surface(s) this seam does not inject "
            "(harmless until the name is real again, and how a rename goes "
            "unnoticed): " + ", ".join(report["expects_orphaned"])
        )
    if report["expects_roster_sources"]:
        lines.append(
            f"  {_EXPECTS_ROSTER} entries this read cannot enumerate: "
            + ", ".join(report["expects_roster_sources"])
        )

    for name, rung in rungs.items():
        wired = rung["wired"]
        if not rung["contributes"]:
            # Nothing at the wired rung: a surface with no contribution
            # contributes zero bytes, so there is no line to pass on.
            wired_flag = "."
        elif wired is True:
            wired_flag = "W"
        elif wired is None:
            wired_flag = "?"
        else:
            wired_flag = "-"
        flags = (("R" if rung["registered"] else "-")
                 + ("C" if rung["contributes"] else "-")
                 + wired_flag)
        if not rung["injected"]:
            note = "   (not injected at this seam)"
        elif name in DECLINED:
            note = "   (descriptor declined on the record, not a gap)"
        else:
            note = ""
        lines.append(f"  [{flags}] {name}{note}")

    if report["wired_seam_wide"]:
        lines.append(
            f"  W: the composing call draws its roster from {_SEAM_VARIABLE} "
            f"itself, so every surface a run injects is wired and no "
            f"per-surface wiring decision is left to forget."
        )
    elif report["wired"]:
        lines.append(
            f"  W: the composing call names {len(report['wired'])} surface(s) "
            f"literally -- a roster beside the seam, so a surface added to "
            f"the seam stays unwired until it is named there too: "
            + ", ".join(report["wired"])
        )
    else:
        lines.append(
            f"  W: no readable {_COMPOSE_FUNCTION} roster at this seam, so no "
            f"contribution reaches a model from here."
        )
    if report["contributing_unwired"]:
        lines.append(
            "  CONTRIBUTES BUT IS NOT WIRED -- a finished line no run passes "
            "on: " + ", ".join(report["contributing_unwired"])
        )
    if report["wired_sources"]:
        lines.append(
            "  roster(s) at the composing call this read cannot enumerate: "
            + ", ".join(report["wired_sources"])
        )
    if report["registered_not_injected"]:
        lines.append(
            "  registered but not injected at this seam (a dynamic source "
            "below may still inject it; a name here matching none of them is "
            "how a rename goes unnoticed): "
            + ", ".join(report["registered_not_injected"])
        )
    if report["dynamic_sources"]:
        lines.append(
            "  not enumerable statically, so NOT counted above: "
            + ", ".join(report["dynamic_sources"])
        )
    if report["declined_not_injected"]:
        lines.append(
            "  DECLINATION FOR A NAME THIS SEAM NO LONGER INJECTS -- a dead "
            "exemption that would silently cover a future surface taking the "
            "name: " + ", ".join(report["declined_not_injected"])
        )
    if report["declined_but_described"]:
        lines.append(
            "  DECLINED AND ALSO REGISTERED -- the record says no descriptor "
            "and the registry holds one; drop the declination: "
            + ", ".join(report["declined_but_described"])
        )
    lines.append(
        "This reports; it refuses nothing. Whether a name warrants a "
        "descriptor at all is a human call."
    )
    return "\n".join(lines)
