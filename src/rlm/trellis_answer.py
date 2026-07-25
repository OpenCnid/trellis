"""The by-reference final-answer channel for the Trellis RLM (Session 22).

Design record: docs/architecture/CODE_MEDIATED_TEXT.md — the pillar's §1
names transcription error (attention retyping bytes that code already
produced) as the core pathology, and the Session 21 effective-context
probe measured it alive in the one channel the discipline did not yet
mediate: the run whose REPL printed a computed count of 55 answered 47,
because the model's final turn set answer['content'] to a hand-typed
literal. Per the pillar's enforcement posture (§2.8: tooling shape, not
prompt text), this module closes that channel.

`TrellisAnswer` is injected via rlms `custom_tools` as `trellis_answer`
in every research-mode run (it is kernel surface, like the database
tools — not operator-gated). Its single model-visible method:

    trellis_answer.submit(expression_text)

takes the TEXT of a Python expression — a variable name, a subscript, an
f-string interpolating variables — evaluates it in the caller's live
REPL namespace (the caller frame's globals/locals, so the value that
lands is the value the code computed, fetched by reference), renders it
deterministically, prefixes 'FINAL_ANSWER: ' engine-side, and sets
answer['content'] / answer['ready'] itself. The model never retypes the
value and never types the prefix.

Enforcement is structural, not advisory:
  - The argument must be expression TEXT (a string). Passing the value
    itself is refused with a teaching message — the value must flow
    through evaluation, where a typo'd name is a loud NameError instead
    of a silently wrong digit.
  - A constant-only expression (submit("47"), submit("'some text'"),
    submit("40 + 7")) is refused: it contains no reference to REPL
    state, so it can only be a retyped literal — exactly the error class
    this channel exists to prevent.
  - The expression is evaluated under the REPL's own namespace and
    builtins (the caller frame's globals carry rlms' safe-builtins
    table), so this channel widens nothing: whatever code could not do,
    submit's expression cannot do either.

The channel is ADDITIVE. Direct assignment to answer['content'] still
works exactly as before (rlms semantics untouched), the TRELLIS_RESULT
envelope is unchanged, and telemetry gains only the counts-only
`answer_submits`. Wrapper discipline follows the house pattern
(trellis_workspace / trellis_textedit): the model-visible method returns
a JSON string and raises real exceptions with readable messages for REPL
self-correction; viewport bounds are kernel constants, never env.
"""

import ast
import json
import sys
import threading

from trellis_surfaces import register_surface

# The engine-owned answer prefix (the workflow contract the benchmark
# client and the TRELLIS_RESULT extraction both key on).
ANSWER_PREFIX = "FINAL_ANSWER: "

# Kernel constants (never env-tunable): an expression names a computed
# result — it is a short piece of code, never content. Content beyond
# the cap means the model is typing the answer INTO the expression,
# which is the pathology itself. The content cap matches the pre-
# existing reality that answers are bounded working text, and refusing
# with usage beats silently truncating (Guardrail 6).
ANSWER_EXPRESSION_MAX_CHARS = 400
ANSWER_CONTENT_MAX_CHARS = 64 * 1024
ANSWER_PREVIEW_CHARS = 500

_submit_lock = threading.Lock()
_submit_stats = {"count": 0}


def get_answer_submit_count() -> int:
    """Counts-only telemetry (the mcp_calls mold): how many times the
    run set its answer through the mediated channel. Never a value,
    never an expression."""
    return _submit_stats["count"]


def _references_repl_state(tree):
    """True when the parsed expression reaches into the caller's
    namespace somewhere: a Name, an Attribute, a Subscript, or a Call.
    A tree with none of those is constants all the way down — a retyped
    literal, however it is dressed (unary minus, arithmetic on literals,
    an f-string with no interpolated variable)."""
    return any(
        isinstance(node, (ast.Name, ast.Attribute, ast.Subscript, ast.Call))
        for node in ast.walk(tree)
    )


def _render(value):
    """Deterministic engine-side rendering of the evaluated value.
    Strings pass through verbatim (quote fidelity is the point);
    numbers render exactly (repr for floats is the shortest round-trip
    form); containers render as compact JSON. None is refused upstream
    — it is almost always a function that returned nothing, not a
    result."""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, default=str)
    return str(value)


class TrellisAnswer:
    """The injected final-answer holder. Stateless apart from the
    module-level submit counter; every call re-reads the live `answer`
    binding from the caller frame, so scaffold restore replacing the
    answer object between turns can never leave this holder mutating a
    dead one."""

    def submit(self, expression):
        """Evaluate `expression` (Python expression TEXT) in the calling
        REPL frame, render the value, and set the final answer from it —
        'FINAL_ANSWER: ' prefix included. Returns a JSON receipt with a
        bounded preview of what landed."""
        if not isinstance(expression, str):
            raise ValueError(
                "trellis_answer.submit takes the TEXT of an expression, not the value: "
                "compute your result into a variable and call, e.g., "
                "trellis_answer.submit(\"total\") — the engine evaluates it in your "
                "REPL namespace so the computed value lands unretyped."
            )
        text = expression.strip()
        if not text:
            raise ValueError("trellis_answer.submit: empty expression.")
        if len(text) > ANSWER_EXPRESSION_MAX_CHARS:
            raise ValueError(
                f"trellis_answer.submit: expression is {len(text)} chars "
                f"(cap {ANSWER_EXPRESSION_MAX_CHARS}). An expression names a computed "
                "result; it is never the content itself. Build the content into a "
                "variable in code and submit that variable's name."
            )
        try:
            tree = ast.parse(text, mode="eval")
        except SyntaxError as e:
            raise ValueError(
                f"trellis_answer.submit: not a valid Python expression ({e.msg}): {text!r}"
            ) from None
        if not _references_repl_state(tree):
            raise ValueError(
                "trellis_answer.submit: refused — the expression is a bare literal and "
                "references nothing you computed. Retyping a value by hand is exactly "
                "the transcription error this channel prevents. Compute the result into "
                "a variable and submit the variable's name (e.g. "
                "trellis_answer.submit(\"count\") or trellis_answer.submit(\"counts['x']\"))."
            )

        frame = sys._getframe(1)
        try:
            caller_globals = frame.f_globals
            caller_locals = frame.f_locals
        finally:
            del frame

        value = eval(  # noqa: S307 — evaluated under the caller's (safe-builtins) namespace
            compile(tree, "<trellis_answer>", "eval"), caller_globals, caller_locals
        )
        if value is None:
            raise ValueError(
                "trellis_answer.submit: the expression evaluated to None — that is "
                "almost certainly not your result (a function that printed instead of "
                "returning?). Bind the result to a variable and submit that."
            )
        rendered = _render(value)
        content = ANSWER_PREFIX + rendered
        if len(content) > ANSWER_CONTENT_MAX_CHARS:
            raise ValueError(
                f"trellis_answer.submit: rendered answer is {len(content)} chars "
                f"(cap {ANSWER_CONTENT_MAX_CHARS}). Submit the result, not the corpus."
            )

        answer = caller_globals.get("answer")
        if not isinstance(answer, dict):
            raise RuntimeError(
                "trellis_answer.submit: no REPL answer channel in scope — call submit "
                "directly from REPL code."
            )
        answer["content"] = content
        answer["ready"] = True
        with _submit_lock:
            _submit_stats["count"] += 1
        preview = content[:ANSWER_PREVIEW_CHARS]
        return json.dumps({
            "submitted": True,
            "content_chars": len(content),
            "preview": preview,
            "preview_truncated": len(content) > len(preview),
        })


# --- Self-description (SELF_DESCRIBING_SURFACES.md §3.2, §9.1, §11) -------
# rlms reserves one description line per injected surface
# (format_tools_for_prompt, rlm/environments/base_env.py). With nothing
# registered, this surface renders to the model as a bare type name and
# the run is told nothing about the one channel it must finish through.
#
# Ownership follows §9.1 — one encoding per fact, owned by whoever is
# authoritative for it. `purpose` and `whenToUse` are EDITORIAL: no
# predicate refuses when they are wrong and no derivation can supply
# them. Every property a guard enforces lives once in
# _ANSWER_GUARD_EXPECTS, keyed by the guard class that owns it, and
# `purpose` deliberately states no bound so the two cannot disagree.
#
# NO derive_answer_expects() stands beside this dict, and that is the
# finding rather than an omission. TrellisAnswer takes no constructor
# arguments, holds no per-run state beyond a counter, and every bound it
# enforces is a kernel constant above — so a derivation would return the
# same mapping on every run and discriminate nothing. The mapping is
# bound to the descriptor here instead, at the definition site. Contrast
# derive_textedit_expects(), which earns its existence because the SAME
# bool that makes splice() refuse selects the mode account.
#
# Descriptors are a REGISTRATION, not a schema (§11, owner ruling, July
# 23, 2026): fields vary per surface, nothing validates this shape, and
# adding a field is an edit. Every string here is brace-free — rlms runs
# .format() over the prompt these bytes can reach (rule 6).
_ANSWER_GUARD_EXPECTS = {
    # submit(): a non-string argument raises before anything is
    # evaluated, so the value reaches the answer through evaluation
    # rather than through the model's own output.
    "expression_text": ("submit takes the TEXT of a Python expression, "
                        "never the value itself."),
    # submit() via _references_repl_state(): a tree that is constants all
    # the way down raises — it names no REPL state, so it can only be a
    # value typed by hand.
    "no_bare_literal": ("An expression that references nothing you "
                        "computed is refused as a retyped literal; name "
                        "a variable or an expression over your "
                        "variables instead."),
    # submit(): an expression longer than the kernel cap raises with
    # usage. The cap is a number the guard owns; the phrase states the
    # bound without restating the number beside it.
    "expression_bound": ("The expression is bounded: it names a result "
                         "and is never the content itself."),
    # submit(): a None result raises rather than landing as an answer —
    # it is almost always a function that printed instead of returning.
    "none_refused": ("An expression evaluating to None is refused "
                     "rather than submitted."),
    # submit(): rendered content over the kernel cap raises with its
    # measured size instead of silently truncating (Guardrail 6).
    "content_bound": ("The rendered answer is bounded, and an over-cap "
                      "answer raises with its measured size rather than "
                      "landing truncated."),
}

ANSWER_DESCRIPTOR = {
    "name": "trellis_answer",
    # The one-line render slot: the surface's ROLE, stating no bound.
    "purpose": ("the run's completion channel — it evaluates an "
                "expression over your REPL variables and sets the final "
                "answer from the value."),
    # Editorial: WHEN a run reaches for this surface. The workflow rules
    # in the kernel prompt own the discipline itself; this is the
    # navigational half and states no rule of its own.
    "whenToUse": "the result is computed and held in a variable",
    # The pieces of the ONE description line rlms reserves for this
    # surface. Two are ("descriptor", field) slots pulling fields this
    # descriptor already owns, so the line restates nothing; the only
    # authored bytes are the connective between them. Guard-backed
    # expectations stay OUT of this slot deliberately — one line is an
    # orienting line, and a bound stated by half is worse than a bound
    # the run reads in full where it is enforced.
    "contributes": [
        ("descriptor", "purpose"),
        " Reach for it when ",
        ("descriptor", "whenToUse"),
        ".",
    ],
    "expects": _ANSWER_GUARD_EXPECTS,
    "exposes": [
        {
            "call": "trellis_answer.submit(expression_text)",
            # Editorial teaching prose only. Every refusal this call
            # carries is stated once, above, in the expects mapping.
            "doc": ("evaluates the expression in your namespace, renders "
                    "the value deterministically, and sets the final "
                    "answer from it — returns a JSON receipt carrying a "
                    "bounded preview of what landed."),
        },
    ],
}

# One call site, one commitment: the descriptor is bound to its surface
# HERE, where the surface is defined, so the coverage diagnostic — and
# later llm_help — find it without anything wired by hand elsewhere.
register_surface(ANSWER_DESCRIPTOR)
