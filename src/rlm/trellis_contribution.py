"""The contribution frame: what a surface says about itself in the one
description line rlms reserves for it, and the budget that refuses a
composition rather than letting it grow.

Design records: docs/architecture/HARNESS_SELF_MODEL.md §5 (Boundedness
— "The read has a budget that RAISES, not a budget that is hoped for"),
docs/architecture/SELF_DESCRIBING_SURFACES.md §9.1 (one encoding, owned
by whoever is authoritative for the fact) and §11 (descriptors are a
registration, not a schema — this module validates no field set).

WHAT rlms RESERVES, AND WHAT TRELLIS PUTS THERE TODAY.
`rlm/environments/base_env.py` renders each `custom_tools` entry as
exactly one line, `- name: description`, and `parse_tool_entry` accepts
a `dict` carrying `tool` and `description` in place of a bare value.
Trellis passes bare values, so every injected surface renders as
"A custom <Type> value". The listing is spliced into the rlms base
prompt at character 1,335 of 2,116 (both measured, not estimated) —
ahead of every Trellis directive. It is the highest-primacy text a run
sees about its own surfaces, and it currently carries type names.

WHAT THIS MODULE IS. The invariant frame, and nothing else. It selects,
resolves, guards, and bounds. It contributes no prose: the rendered
pieces are joined with the EMPTY string, so the frame does not
contribute even the spaces between them. Every character it returns came
out of a descriptor field or a guard-derived expectation, which is the
property that makes §9.1's "one encoding" checkable by reading this file
— there is no second copy here to disagree with the first.

WHAT THE SLOT CAN AND CANNOT CARRY. One line is an ORIENTING line, not
an account. A surface whose guard-backed expectations run to several
sentences — `trellis_textedit` is exactly that class — cannot fit its
composed read here, and the honest split is that the slot says what the
surface is and when to reach for it while the addendum path
(`build_textedit_addendum` and its siblings) carries the expectations in
full. Truncating an expectation to fit would ship a bound the run was
told half of, which is the failure class HARNESS_SELF_MODEL.md §3 names;
this module refuses instead, and the refusal names what to compress.

THE TWO OWNED ENCODINGS, unchanged from the reference instance
(`trellis_textedit.py`: TEXTEDIT_DESCRIPTOR, _TEXTEDIT_GUARD_EXPECTS,
derive_textedit_expects, render_textedit_addendum). A descriptor's
`contributes` list holds ordered pieces:

  * a plain `str` is editorial — a human is authoritative for it, and
    nothing derives a second copy;
  * an `("expects", key)` pair pulls the guard-owned phrase from the
    derived expectations, so no guard-backed sentence is encoded twice.

`contributes` is a new field. Adding one is an edit, not a ceremony
(§11): nothing validates the descriptor's field set, here or anywhere,
and a descriptor that carries no `contributes` contributes zero bytes.

BRACES. rlms runs `.format()` over the system prompt with the rendered
listing as a SUBSTITUTED ARGUMENT, so a doubled brace here would reach
the model as two literal braces while a single brace would break under
any edition that formats the composed block instead. Brace-FREE is the
only text correct under both, which is the posture module addenda
already take (.claude/rules/prompt-authoring.md rule 6, "stricter than
doubled"). A brace in a contribution is refused, never doubled.

ABSENCE. A surface this run did not inject contributes zero bytes: a
`None` descriptor is skipped, a descriptor with no `contributes` is
skipped, and `attach_contributions` leaves every undescribed name as the
bare value it is today. A gated-off surface therefore leaves the
composed prompt byte-identical — the `build_mcp_addendum([])` precedent.

Provenance standing: NONE. Nothing here reads or writes the substrate,
performs I/O, or counts as a database tool call. Zero-paid by
construction.
"""

import json

# The size budget, in characters, for the WHOLE composed contribution —
# the sum of the description strings Trellis authors into the rlms
# listing. It bounds what this repository contributes, not what rlms
# renders around it: surface names and the "A custom <Type> value"
# fallback are rlms's bytes and no author here has a lever on them.
#
# Where the number comes from. The listing is spliced into the rlms base
# prompt at character 1,335 of 2,116 — both received from a command
# against `rlm.utils.prompts.RLM_SYSTEM_PROMPT`, never read off by eye
# (AGENTS.md rule 5). The bound stated: Trellis's total contributed
# description bytes stay under the protocol prompt they are spliced
# into, so the protocol keeps the majority of that primacy region. 2,000
# sits under the measured 2,116 and is round on purpose — a stated bound
# rather than a coincidence of a third-party constant, which an rlms
# upgrade would move silently. It is also the figure UPSUM_BUDGET
# carries, and HARNESS_SELF_MODEL.md §5 names that surface's treatment
# (UPSUM_BUDGET -> trellis_upsum.commit) as the one to apply here.
#
# Kernel constant, never env-tunable (Guardrail 5). The drill re-measures
# the rlms prompt and holds the budget under it.
CONTRIBUTION_BUDGET = 2000

# The one tuple tag a `contributes` piece may carry. One tag, matching
# the reference instance's ("expects", key) slots.
EXPECTS_TAG = "expects"

# The tag for a slot pulling a field the descriptor itself owns, so a
# line reuses `purpose` rather than restating it.
DESCRIPTOR_TAG = "descriptor"

# The descriptor field this frame reads. Absent is a state distinct from
# every present value: absent means the surface has authored no
# contribution and renders as it renders today.
CONTRIBUTES_FIELD = "contributes"


class ContributionShapeError(Exception):
    """Raised when a contribution is not the shape the description slot
    takes: a piece that is neither editorial text nor a resolvable
    guard slot, an expectation that is not a string, or a rendered line
    carrying a brace, a newline, boundary whitespace, or nothing at all.

    Shape is engine-checked because every one of those failures is
    silent at the point it matters. A brace fails inside rlms as a
    KeyError or a stray literal; a newline breaks the one-line-per-
    surface listing into an orphan line the model reads as a directive
    of its own; an empty contribution claims a slot and says nothing."""


class ContributionBudgetError(Exception):
    """Raised by compose_contributions when the composed contribution
    exceeds CONTRIBUTION_BUDGET. The message carries the measured size,
    the budget, the overage, and the per-surface sizes ranked largest
    first, so the surface to compress is a number the engine computed
    rather than one an author estimated (CODE_MEDIATED_TEXT.md §1: the
    model never counts). Same shape as UpsumBudgetError, for the same
    reason — HARNESS_SELF_MODEL.md §5 asks for exactly that treatment."""


def _surface_name(descriptor):
    """The registry key, on the same one precondition register_surface
    holds: a non-empty string `name`. Not a field validation — every
    other field is the surface's own business (§11) — but without a name
    there is nothing to key a contribution under."""
    if not isinstance(descriptor, dict):
        raise ContributionShapeError(
            f"A surface descriptor must be a dict, got "
            f"{type(descriptor).__name__}."
        )
    name = descriptor.get("name")
    if not isinstance(name, str) or name.strip() == "":
        raise ContributionShapeError(
            "A surface descriptor needs a non-empty string 'name' before it "
            "can contribute: the name is what rlms renders the description "
            "beside."
        )
    return name


def _resolve_piece(name, index, piece, expects, descriptor=None):
    """One piece to its bytes. Editorial text is taken verbatim; an
    ("expects", key) slot is looked up in the guard-derived expectations
    and never authored here; a ("descriptor", field) slot is looked up
    in the surface's own descriptor.

    The descriptor slot exists so a line can reuse a field the
    descriptor already owns — `purpose`, most often — instead of
    restating it as editorial text. Restating it would put one fact in
    two places on one surface, which is the failure class this whole
    frame exists to close (SELF_DESCRIBING_SURFACES.md §9.1). The two
    tags differ in who is authoritative, not in mechanism: `expects`
    pulls from the guard that refuses, `descriptor` pulls from the
    human who authored the intent."""
    if isinstance(piece, str):
        return piece
    if (isinstance(piece, (tuple, list)) and len(piece) == 2
            and piece[0] == DESCRIPTOR_TAG and isinstance(piece[1], str)):
        field = piece[1]
        if not isinstance(descriptor, dict):
            raise ContributionShapeError(
                f"{name} piece {index} is a ('{DESCRIPTOR_TAG}', {field!r}) "
                f"slot, but no descriptor was available to resolve it."
            )
        if field not in descriptor:
            raise ContributionShapeError(
                f"{name} piece {index} asks for the descriptor field "
                f"{field!r}, which this descriptor does not carry. "
                f"Available: {sorted(k for k in descriptor if k != CONTRIBUTES_FIELD)}. "
                f"A slot pointing at an absent field would ship a "
                f"description with a hole in it."
            )
        value = descriptor[field]
        if not isinstance(value, str):
            raise ContributionShapeError(
                f"{name} piece {index} resolves the descriptor field "
                f"{field!r} to a {type(value).__name__}, not a string. Name a "
                f"text field here, or make the piece editorial text."
            )
        return value
    if (isinstance(piece, (tuple, list)) and len(piece) == 2
            and piece[0] == EXPECTS_TAG and isinstance(piece[1], str)):
        key = piece[1]
        if not isinstance(expects, dict):
            raise ContributionShapeError(
                f"{name} piece {index} is an ('{EXPECTS_TAG}', {key!r}) slot, "
                f"but no derived expectations were passed. Pass the surface's "
                f"derive_*_expects(...) result, or make the piece editorial "
                f"text if no guard is authoritative for it."
            )
        if key not in expects:
            raise ContributionShapeError(
                f"{name} piece {index} asks for the guard-owned phrase "
                f"{key!r}, which the derived expectations do not carry. "
                f"Available: {sorted(expects)}. A slot pointing at an absent "
                f"guard would ship a description with a hole in it."
            )
        value = expects[key]
        if not isinstance(value, str):
            raise ContributionShapeError(
                f"{name} piece {index} resolves {key!r} to a "
                f"{type(value).__name__}, not a string. Derived expectations "
                f"also carry non-text state (a mode bool, for instance); "
                f"select on it in the descriptor and name a text phrase here."
            )
        return value
    raise ContributionShapeError(
        f"{name} piece {index} is a {type(piece).__name__}: a "
        f"'{CONTRIBUTES_FIELD}' piece is either editorial text (a str), an "
        f"('{EXPECTS_TAG}', key) slot pulling one guard-owned phrase, or a "
        f"('{DESCRIPTOR_TAG}', field) slot pulling one descriptor-owned field."
    )


def _piece_owning(rendered, offset):
    """Which piece a character offset in the joined line came out of.
    Engine-computed, so a refusal names the piece to edit instead of
    handing the author a line to scan (CODE_MEDIATED_TEXT.md §1)."""
    consumed = 0
    for index, text in enumerate(rendered):
        if offset < consumed + len(text):
            return index
        consumed += len(text)
    return max(len(rendered) - 1, 0)


def _guard_line(name, rendered, line):
    """The four ways a one-line contribution breaks, checked in a pinned
    order: it says nothing, it carries slop at its edges, it is not one
    line, or it carries a brace."""
    if line == "":
        raise ContributionShapeError(
            f"{name} composes to an empty description. A surface with nothing "
            f"to say drops its '{CONTRIBUTES_FIELD}' field instead — an "
            f"absent field contributes zero bytes and renders exactly as it "
            f"renders today."
        )
    if line != line.strip():
        raise ContributionShapeError(
            f"{name} composes to a description with leading or trailing "
            f"whitespace. rlms renders it directly after a colon and directly "
            f"before a newline, so edge whitespace is slop in the prompt: "
            f"trim the first and last piece."
        )
    for char, label in (("\n", "newline"), ("\r", "carriage return")):
        if char in line:
            offset = line.index(char)
            raise ContributionShapeError(
                f"{name} composes to a description carrying a {label} at "
                f"character {offset}, from piece {_piece_owning(rendered, offset)}. "
                f"rlms renders ONE line per surface; a break here becomes an "
                f"unindented line the model reads as a directive of its own. "
                f"Compress it to one line, and let the surface's addendum "
                f"carry what does not fit."
            )
    for char in ("{", "}"):
        if char in line:
            offset = line.index(char)
            raise ContributionShapeError(
                f"{name} composes to a description carrying {char!r} at "
                f"character {offset}, from piece {_piece_owning(rendered, offset)}. "
                f"The listing is substituted into a prompt rlms runs .format() "
                f"over, so a doubled brace reaches the model literally and a "
                f"single one breaks the call: write the shape in prose without "
                f"a brace, as module addenda do."
            )
    return line


def render_contribution(descriptor, expects=None) -> str:
    """The invariant frame: one surface's descriptor plus its derived
    expectations to the single brace-free line rlms's description slot
    takes. Returns the empty string when the descriptor is absent or
    carries no contribution, so a surface this run did not inject leaves
    the composed prompt byte-identical.

    The frame contributes structure and no prose. Pieces are joined with
    the empty string — every character of the result came out of a
    descriptor field or a guard-derived expectation, and spacing is
    owned by whoever authored the piece (the render_textedit_addendum
    entry() discipline). Raises ContributionShapeError for a piece it
    cannot resolve or a line the slot cannot take; it never repairs one
    silently."""
    if descriptor is None:
        return ""
    name = _surface_name(descriptor)
    if CONTRIBUTES_FIELD not in descriptor:
        return ""
    pieces = descriptor[CONTRIBUTES_FIELD]
    if not isinstance(pieces, (list, tuple)):
        raise ContributionShapeError(
            f"{name}'s '{CONTRIBUTES_FIELD}' must be an ordered list of "
            f"pieces, got {type(pieces).__name__}."
        )
    if len(pieces) == 0:
        raise ContributionShapeError(
            f"{name}'s '{CONTRIBUTES_FIELD}' is empty. Drop the field rather "
            f"than stating nothing with it: an absent field contributes zero "
            f"bytes, which is the same effect and one less question for a "
            f"reader."
        )
    rendered = [_resolve_piece(name, index, piece, expects, descriptor)
                for index, piece in enumerate(pieces)]
    return _guard_line(name, rendered, "".join(rendered))


def _render_entries(entries):
    """Every entry's contribution, in order, skipping the surfaces that
    contribute zero bytes. Returns a list of (name, line) pairs."""
    composed = []
    seen = set()
    for position, entry in enumerate(entries):
        if not isinstance(entry, (tuple, list)) or len(entry) != 2:
            raise ContributionShapeError(
                f"Entry {position} must be a (descriptor, expects) pair, got "
                f"{type(entry).__name__}. Pass (None, None) for a surface "
                f"this run did not inject, or leave it out."
            )
        descriptor, expects = entry
        line = render_contribution(descriptor, expects)
        if line == "":
            continue
        name = _surface_name(descriptor)
        if name in seen:
            raise ContributionShapeError(
                f"Surface {name!r} contributes twice. One surface holds one "
                f"slot in the rlms listing; the second entry would silently "
                f"replace the first."
            )
        seen.add(name)
        composed.append((name, line))
    return composed


def measure_contributions(entries, budget=None) -> dict:
    """The non-raising probe: measure first, compress, then compose.
    Returns total, budget, headroom, and the per-surface sizes ranked
    largest first. Shape errors still raise — an unmeasurable
    contribution is a defect, not a size (the TrellisUpsum.size
    precedent).

    `budget` defaults to CONTRIBUTION_BUDGET, read at call time rather
    than captured at definition time, so the constant is the single
    place the bound is decided."""
    budget = CONTRIBUTION_BUDGET if budget is None else budget
    composed = _render_entries(entries)
    per_surface = {name: len(line) for name, line in composed}
    ranked = sorted(per_surface.items(), key=lambda kv: kv[1], reverse=True)
    total = sum(per_surface.values())
    return {
        "total": total,
        "budget": budget,
        "headroom": budget - total,
        "surfaces": len(composed),
        "perSurface": dict(ranked),
    }


def compose_contributions(entries, budget=None) -> dict:
    """The composed contribution: surface name -> its description line,
    for the surfaces present in this run.

    `entries` is an ordered iterable of (descriptor, expects) pairs. A
    pair whose descriptor is None — the surface this run did not inject
    — is skipped, as is a descriptor carrying no contribution, so both
    kinds of absence cost zero bytes.

    REFUSES an over-budget composition with the per-surface breakdown
    ranked largest first. The budget raises rather than being hoped for:
    a bound enforced by authorial discipline is the class
    HARNESS_SELF_MODEL.md §5 exists to close, and this is that record
    applied to its own read.

    `budget` defaults to CONTRIBUTION_BUDGET, read at call time rather
    than captured at definition time, so the constant is the single
    place the bound is decided."""
    budget = CONTRIBUTION_BUDGET if budget is None else budget
    composed = _render_entries(entries)
    total = sum(len(line) for _, line in composed)
    if total > budget:
        ranked = sorted(((name, len(line)) for name, line in composed),
                        key=lambda kv: kv[1], reverse=True)
        raise ContributionBudgetError(
            f"surface contributions total {total} characters, over the "
            f"{budget}-character budget by {total - budget}. Compress the "
            f"least-decisive contributions and compose again; what does not "
            f"fit belongs in the surface's addendum, not truncated here. "
            f"Per-surface sizes, largest first: "
            f"{json.dumps(dict(ranked), ensure_ascii=False)}."
        )
    return dict(composed)


def attach_contributions(custom_tools, contributions) -> dict:
    """A new `custom_tools` mapping in rlms's entry form: every name
    carrying a contribution becomes a dict of `tool` and `description`,
    and every other name keeps the bare value it has today.

    Byte-identity when absent is enforced here rather than hoped for.
    An undescribed name is untouched, so its listing line is the one
    rlms already renders; and a contribution naming a surface this run
    did not inject RAISES, because a description composed for an absent
    surface spends budget on bytes no run will ever see. The input
    mapping is not mutated, and key order is preserved — rlms renders
    the listing in iteration order."""
    if not isinstance(custom_tools, dict):
        raise ContributionShapeError(
            f"custom_tools must be a dict, got {type(custom_tools).__name__}."
        )
    if not isinstance(contributions, dict):
        raise ContributionShapeError(
            f"contributions must be a dict of surface name -> description, "
            f"got {type(contributions).__name__}."
        )
    unwired = sorted(n for n in contributions if n not in custom_tools)
    if unwired:
        raise ContributionShapeError(
            f"Contributions were composed for surface(s) {unwired} that this "
            f"run does not inject. Gate each entry on the surface's presence, "
            f"the way build_textedit_addendum gates on its holder: a "
            f"description for an absent surface reaches no prompt and still "
            f"spends the budget."
        )
    attached = {}
    for name, value in custom_tools.items():
        description = contributions.get(name)
        if isinstance(description, str) and description != "":
            attached[name] = {"tool": value, "description": description}
        else:
            attached[name] = value
    return attached
