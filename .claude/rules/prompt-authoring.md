# Prompt and instruction authoring

`AGENTS.md` rules 16 and 6, carried for work whose output includes text that
primes a model's generation. Each states something true of this repository: a
session that makes one of these sentences false has shipped prompt bytes
outside the protocols that discipline them. The numbers are cited from code and
from other records and stay as they are. Rules 8, 17 and 20 keep their own text
in `AGENTS.md` and bear on this work too.

## 16. The protocols run before the bytes

Permanent; owner-directed July 13, 2026. The house nickname "Guardrail 15",
used across `.claude/skills/`, resolves to this rule and to no other number.

**The trigger is an act, not an intent.** A session is prompt authoring when
the bytes it writes will enter some model's context as instruction — whatever
the file is named, whoever runs that model, and whatever the session takes its
purpose to be. Kernel and module addenda, RLM task text, agent and sub-agent
instructions, extraction and classification prompts, output schemas, hypershot
frames, judge rubrics and anchor items are the named cases. A skill body, a
hook-injected system reminder, a rule file like this one, an agent-read wiki
entry, and a sub-agent's inherited-context block are the same act under other
filenames. A session that reads its work as documentation, policy, config,
refactoring, a rename, or a one-line fix is inside rule 16 for exactly as long
as bytes of that kind are among its output, because what the rule reads is the
output and never the session's account of itself.

**Exactly two skills open the gate:** `prompt-engineering` and
`hypershot-protocol`. Both are invoked, in the session doing the writing,
before its first authored byte, and the authoring runs against the guidance
those invocations load — the protocols shape the bytes rather than grading them
afterwards. Judge-shaped work invokes `judge-composition` as a third; sub-agent
definitions add `subagent-composition`. Where a skill is unavailable to a
session, that session reports the unavailability and authors nothing.

**Exactly one thing satisfies rule 16:** those invocations, present in the
session that wrote the bytes, before them. The whole set of records a session
can produce afterwards satisfies none of it — a report, a handoff line, a
commit message, a PR body, a header comment, a checklist tick, a sentence
naming the two skills, this paragraph quoted back. Each of those is a
description of the gate and is never the gate, so a transcript carrying the
description without the two invocations is a transcript of an ungated write.
The repair when it happens is stated plainly and the bytes are authored again
through the gate; a later attestation does not reach back and open it.

## 6. The rlms prompt contract

**One base.** Every prompt this repository hands rlms at `custom_system_prompt=`
has exactly one base: `RLM_SYSTEM_PROMPT`, entire and unaltered, as its opening
segment, with every Trellis directive appended after it. `build_author_system_prompt`
in `src/rlm/trellis_agent.py` is the shape — `RLM_SYSTEM_PROMPT + AUTHOR_ADDENDUM
+ WORKSPACE_ADDENDUM + …` — and the two call sites in that file pass what it
composes. The duty is on the string rlms receives, so it is unmet by any route
that leaves the constant's own bytes untouched: a prompt composed from a
different base, a copy with a passage dropped, a persona string passed straight
at the parameter, or a wrapper that appends before it. rlms substitutes what it
is given for the whole protocol prompt, so a prompt missing that base leaves the
model without the fenced `repl` execution protocol and without the
`{custom_tools_section}` field rlms fills with the injected tool listing, and it
can then execute no code at all. A second persona reaches its model through
plain structured chat completions instead of through rlms, which is why the
orchestrator prompt lives outside this path entirely
(`src/core/agent/orchestrator_prompt.ts`).

**Every string the formatter touches.** rlms runs `.format()` over the prompt
it receives, and the duty to double literal braces ranges over the whole set of
strings that reach that call, not the base prompt alone. That set: `RLM_SYSTEM_PROMPT`
itself, every addendum concatenated onto it, the rubric text, the operator task
text, the uuid tags wrapped around that task text, and the authoring template
together with every value spliced into it. Every literal brace in every member
of that set is doubled before splicing, and the only single braces surviving
into what rlms formats are rlms's own format fields. A string carrying one
undoubled literal brace into that call is outside the contract whether or not
it is the system prompt, and it fails as a `KeyError` or a silent substitution
rather than as a review comment. Reference semantics: `_SAFE_RUBRIC` doubling
the versioned rubric text and the defensive doubling in
`build_author_system_prompt` (`src/rlm/trellis_agent.py`); the brace-free run
uuid checked in `wrap_task_text` (`src/rlm/trellis_scaffold.py`); the
brace-freedom pin in `trellis_scaffold.test.ts`.

**Module addenda are stricter than doubled.** A module addendum file carries no
braces at all — not doubled ones, not single ones — and exactly one substitution
token, `<<TRELLIS_RUBRIC>>`. Both loaders refuse the file otherwise, on the same
message and the same bound (`src/rlm/trellis_modules.py`, `src/config/modules.ts`),
and `npm run test:modules` pins the composed result byte-for-byte. Prompt text
authored anywhere else under this contract reaches the same place by the same
route: it describes its JSON output contract in prose without writing a brace,
and it carries its substitutions in the `<<…>>` idiom
(`src/core/authoring/template.ts`, whose validators refuse a brace in the one
free-text field an operator supplies).
