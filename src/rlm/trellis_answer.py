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
