---
name: hypershot-protocol
description: >-
  Meta-prompting technique using zero-contamination structural examples. A
  hypershot is a frame with free variables; the variables range across a
  continuum from unbounded spread operators (...) to fully-loaded
  instruction-bearing variables ({Concise_Action_Oriented_Reply_With_No_Fluff}).
  Use whenever authoring a prompt template, workflow output schema, agent
  instruction, wiki entry another agent will read, or any artifact that primes
  a model's generation, even when the user does not explicitly say "hypershot."
  It is the right move anytime you would otherwise reach for few-shot examples
  and risk semantic contamination of the context window. Pairs with the
  prompt-engineering skill, whose master template is a hypershot.
---

# Hypershot Protocol

> The art of priming structure without priming content.

## 1. Why this exists

Few-shot prompting works by showing the model a handful of concrete input/output pairs. It is also, by construction, a contamination vector. If the example is "the answer to 2+2 is 4," the model picks up an arithmetic prior even when the actual task is to write a poem. The example's content leaks into the response distribution.

A hypershot solves this by giving the model a **frame**, a structural skeleton with **free variables in it**, instead of filled-in examples. The model learns the shape of the response space without picking up any topical bias from invented filler content. One zero-semantic frame implicitly enumerates every valid instantiation; the model inhabits the equivalence class directly rather than interpolating between scattered sample points.

The mechanism this exploits is real: **primacy** in the context window sets the strongest prior for the rest of the generation. A hypershot placed at the start of the context seeds the distribution with the desired shape *before any output begins*. The undesired patterns (terminal-art equals-bars, throat-clearing preambles, whatever you are trying to design out) never become live options because the basin of attraction is already set.

## 2. The continuum

A hypershot variable sits somewhere on a dial:

- **Unbounded end (spread):** `...`
  Pure structural slot. No type constraint. No instruction load. The frame around it carries all the shaping.

- **Mid-range (categoric primitive):** `{Greeting_Input}`
  Abstract type with no instruction. Constrains the *kind* of content, not the behavior.

- **Loaded end (instruction-bearing variable):** `{Warm_Professional_Response_With_No_Fluff}`
  The variable name carries its own generation rule. The model reads the type and the behavioral spec in the same token-position.

**Which setting to use is a function of how much instruction load the frame itself is already carrying.** If the markdown structure (heading hierarchy, list shape, sentence rhythm, punctuation) tells the model what each slot wants, spread operators are sufficient and cleanest. If the frame is structurally ambiguous, push the dial toward named instruction-bearing variables to compensate.

A single hypershot can mix settings. The frame is a collection of slots; each slot picks its own point on the dial. Use the lightest variable that does the job; over-specifying variables when the frame is already carrying load just adds noise.

## 3. Construction rules

### Rule A: Abstraction over specificity
Never use a concrete example unless the skill is specifically about that thing. Concrete tokens in a hypershot are contamination by definition.
- Weak: `User: "Hello" -> AI: "Hi there!"`
- Hyper: `User: "{Greeting_Input}" -> AI: "{Warm_Professional_Response}"`
- Also valid (spread end): `User: "..." -> AI: "..."` *when the surrounding frame already tells the model what kind of exchange this is*

### Rule B: Instruction-bearing variables describe behavior, not data type
When you go past pure spread, the variable name should describe *how to generate*, not just *what slot this is*.
- Weak: `{Response}`
- Hyper: `{Concise_Action_Oriented_Reply_With_No_Fluff}`

The underscores-as-spaces convention keeps the name parseable as a single token-position while letting it carry a full descriptive phrase. Treat the variable name as a tiny embedded prompt.

### Rule C: Make the structure visible
The frame is the other half of the hypershot. If the structure is not legible, the variables cannot do their work. Use markdown formatting (headings, lists, code fences, blockquotes), explicit brackets around variables, and intentional whitespace to make the shape readable at a glance.

### Rule D: Place the hypershot before the generation it shapes
Primacy is part of the mechanism, not a nice-to-have. A hypershot buried mid-context has weaker priors than the surrounding noise. Put it at the start, in the system prompt, or at the head of the user message; wherever it lands before the model begins generating the thing you want shaped.

## 4. Worked examples

### Minimal (spread-dominant)
The frame carries all the load; the variables are pure spread.

```md
# {Project_Name} v{Version}

...

1. ...
2. ...
3. ...
4. ...

...?
```

The model learns: title with version, brief intro paragraph, four-item numbered list, brief outro, open-ended trailing question. Zero contamination from filler content. The trailing `...?` is the structural cue that the closing should be an invitation, not a declaration. This is the exact form that solved the Nexus Singularity Engine TTS bar-of-equals problem; the engine learns to *not* generate ornament because no ornament appears in the seeded frame.

### Mid-range (categoric primitives)
The frame is informative but the slots need typing.

```md
**User Request:** "{Complex_Ambiguous_Query}"

**AI Thought Process:**
1. Analyze "{Ambiguity_Source}".
2. Consult "{Relevant_Knowledge_Base}".
3. Formulate strategy.

**AI Response:**
"I have analyzed {Topic} and found {Key_Insight}. I recommend {Actionable_Step_1} and {Actionable_Step_2}."
```

### Loaded (instruction-bearing)
The frame is structurally simple; the variables do the heavy lifting.

```md
User: "{Question_About_A_Topic_You_Have_Strong_Opinions_About}"
AI: "{Direct_Substantive_Answer_That_States_The_Opinion_First_Then_Briefly_Justifies_It_Without_Hedging}"
```

## 5. Mastery checklist

Before shipping a hypershot, ask:

1. **Contamination check.** Does the example contain any specific noun, name, topic, or content that could bias the model? If yes, abstract it.
2. **Variable load check.** Does each variable carry the right amount of instruction for its slot, neither over-specifying when the frame already shapes the slot, nor under-specifying when the frame is ambiguous?
3. **Structure visibility check.** Is the frame's shape legible at a glance? Headings, lists, brackets, whitespace?
4. **Primacy check.** Will the hypershot land *before* the generation it is meant to shape?
5. **Frame-vs-variable balance check.** If you removed the variables and kept only the frame, would the model still get useful structural information? If yes, the frame is doing its job; if no, the variables are carrying too much load and the frame needs work.

## 6. Where examples live: invariants at the system layer, data downstream

The hypershot rule is not "never use concrete examples." It is that **concrete content that varies across invocations must not live at the system layer.** Primacy makes anything placed there into a prior for everything that follows; variant content placed up-front contaminates the response distribution for the whole session.

The cleaner architectural principle is a split by *layer*:

**System layer (up-front, primes everything downstream); allow only invariants:**
- Hypershots (frames with free variables, by construction invariant in shape).
- Tool names, function names, command names. The string `search_emails` is identical in every invocation; naming the tool is not exemplifying a response.
- Schema field names and fixed enums. A `priority` field is `priority` every time. "Status must be one of: open, in_progress, done."
- Canonical entities. Agent names, project names, fixed roles the system always references.

**Data layer (downstream, accompanies a specific task); concrete examples are fine, with conditions:**
- **Narrowly scoped.** The example covers *one* facet of behavior, not the whole output shape. The system already has the shape from the hypershot up top; the downstream example fills in one slot for one invocation.
- **Not the entire output.** A voice fragment, an edge-case sample, a reference input, not a full input/output pair that the model will pattern-match against wholesale.
- **Bound to the task that needs it.** When the task is done, the example is gone; it never became part of the system's general behavior.

### The invariance test
Before placing any concrete token at the system layer, ask: **across a hundred invocations of this system, will this exact token appear identically in all hundred contexts?**

If yes, it is invariant. System layer is correct.

If no, it is variant. Either pull it down to the data layer (as task-accompanying material) or abstract it into a hypershot variable.

### Worked example: tool naming (invariant, belongs up-front)
A system that uses an email tool should name the tool concretely in the system prompt:

```md
Available tools:
- `search_emails(query, accountId)`: search the user's mailbox.
- `read_email(email_id, accountId)`: read a specific email by ID.
```

The tool names are invariant. No contamination; the strings are not examples of *what to generate*, they are part of the system's own vocabulary. This is the correct place for them.

What would be wrong at the system layer is a *sample tool call* with concrete arguments. That belongs in a hypershot (`search_emails("{Specific_Query}", accountId)`) or downstream as a task-bound example.

### Worked example: voice imitation (variant, belongs downstream)
The wrong move is to put concrete voice samples in the system prompt: "Match this writing style: [three full paragraphs of the target author]." Primacy will contaminate every response, even when the task changes.

The right move is to describe the *shape* of the voice up-front via instruction-bearing variables, `{Direct_Sentences_With_Active_Voice_And_No_Hedging}`, and ship the concrete voice samples downstream as task-bound reference data, scoped to the specific writing job and dropped after it completes.

### When hypershots are not the right tool at all
- **Purely declarative tasks.** "What is the capital of France?" does not benefit from a structural frame. Use plain instruction.
- **One-off prompts.** If you are not building a reusable template, prompt, or schema, the overhead of authoring a clean hypershot is not worth it. Hypershots pay off across many invocations; for a single throwaway prompt, write the prompt and move on.

## 7. Relationship to other techniques

- **Zero-shot:** instruction only, no example. Hypershot adds a structural example without adding contamination.
- **Few-shot:** concrete examples that pattern-match and contaminate. Hypershot replaces them with abstract structural examples that prime form without priming content.
- **Chain-of-thought scaffolding:** specifies *steps*. A hypershot can include a CoT scaffold as part of its frame (see the Mid-range example above); the two compose cleanly.
- **Output templates:** a hypershot is a template, but a template is not always a hypershot. The hypershot-ness is in the deliberate use of free variables (spread or instruction-bearing) to keep the frame contamination-free.
- **prompt-engineering skill:** the broader toolkit (tags, markers, placeholders, collections, attention). Its master template is a hypershot; this skill is the deep dive on that one technique.
