// Session 19 (design record docs/architecture/GROUNDED_AUTHORING.md §6):
// the authoring template — Layer 3, derivation incentive.
//
// The harness composes the ENTIRE authoring prompt from exactly two
// operator inputs: a bounded topic sentence and the promoted corpus doc
// keys. The template says, in substance: here is a fixed research corpus
// in your workspace; derive the operating protocol this corpus implies
// for <topic>; every directive must be traceable to what the corpus
// actually says; where the corpus is silent, declare a gap rather than
// inventing. Pre-stating the target directives is structurally
// impossible because the operator's only free-text input is the bounded
// topic — this module is the mechanism that makes that a code property
// rather than a matter of discipline.
//
// The template is a KERNEL constant (Guardrail 5): human-owned, never
// env-tunable, never writable by a completion, never authored by the
// flywheel. It is unit-pinned so drift fails loudly. It transits rlms
// `.format()` on the Python side, so it — and every value spliced into
// it — must be brace-free; the two substitution tokens follow the module
// registry's <<...>> idiom rather than curly braces.

/** Topic sentences are the operator's only free text; keep them short. */
export const AUTHORING_TOPIC_MAX_CHARS = 200;

const TOPIC_TOKEN = '<<AUTHORING_TOPIC>>';
const DOC_KEYS_TOKEN = '<<AUTHORING_DOC_KEYS>>';

// Brace-free by construction (rlms .format() safety): the output contract
// describes a JSON object in prose without ever writing a literal brace,
// and validated topics/doc keys cannot introduce one.
export const AUTHORING_TEMPLATE = `GROUNDED AUTHORING TASK

You are authoring exactly one Trellis protocol module addendum. Your complete working corpus — verified research already promoted into Trellis — has been seeded into your workspace as read-only segments. You have one tool and one tool only: trellis_workspace. There is no database, no search, no external network, and no write path. You cannot see anything outside the seeded corpus, and you must not try to.

TOPIC: ${TOPIC_TOKEN}

YOUR JOB: derive the operating protocol this research corpus implies for the topic above — sources in, protocol out. The result is a compact set of imperative directives a later RLM will follow.

METHOD:
- In your VERY FIRST repl block call trellis_workspace.read() to see the seeded corpus index, then pull segments with trellis_workspace.segment(segment_id) and read them before writing anything.
- Every directive you write must be traceable to something the corpus actually says. Do not import directives from your own prior knowledge of the topic.
- Where the corpus is silent on something the topic would need, record it as a gap note. Never invent a directive to cover a gap.
- Write the durable mechanic the evidence supports, not the measured numbers behind it. Do not restate specific measurements and do not emit any content hash.

CORPUS DOCUMENTS seeded read-only into your workspace: ${DOC_KEYS_TOKEN}

OUTPUT: when the protocol is complete, set your final answer to a single JSON object and nothing else, with exactly these three keys:
- purpose: one sentence naming the capability this protocol teaches.
- addendum: the protocol text itself — imperative directives, grouped into short titled sections, containing no curly braces, no content hashes, and no measured numerals.
- gap_notes: a list of strings, each naming something the topic needs that the corpus did not cover; an empty list if the corpus covered everything the protocol requires.
`;

export type TopicValidation = { ok: true } | { ok: false; message: string };

// Single-line printable guard: reject C0 control characters and DEL. A
// per-code-point scan rather than a regex literal so the source itself
// carries no control bytes.
function hasControlChar(value: string): boolean {
  return Array.from(value).some(ch => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

/**
 * Validates the operator's one free-text input. Bounded, single-line,
 * printable, and brace-free (it splices into a prompt rlms formats). The
 * semantic residual — an operator smuggling directives into a
 * grammatically-valid topic — is out of scope for a structural check and
 * lands on human review (design record §6, §8).
 */
export function validateAuthoringTopic(topic: string): TopicValidation {
  if (topic.trim().length === 0) {
    return { ok: false, message: 'topic must not be empty' };
  }
  if (topic.length > AUTHORING_TOPIC_MAX_CHARS) {
    return { ok: false, message: `topic exceeds ${AUTHORING_TOPIC_MAX_CHARS} characters` };
  }
  if (hasControlChar(topic)) {
    return { ok: false, message: 'topic must be a single line of printable text' };
  }
  if (topic.includes('{') || topic.includes('}')) {
    return {
      ok: false,
      message: 'topic must not contain curly braces (the prompt transits rlms .format())',
    };
  }
  return { ok: true };
}

/**
 * Composes the full authoring prompt from the bounded topic and the
 * corpus doc keys. Pure and deterministic: the same inputs render the
 * same bytes, which the unit test pins. Doc keys are rendered in the
 * order the operator supplied them; they were already validated by the
 * promotion path (whitespace-free, brace-free, bounded), so no
 * brace-bearing value can reach the composed prompt.
 */
export function composeAuthoringPrompt(topic: string, docKeys: readonly string[]): string {
  const topicCheck = validateAuthoringTopic(topic);
  if (!topicCheck.ok) {
    throw new Error(`Invalid authoring topic: ${topicCheck.message}`);
  }
  if (docKeys.length === 0) {
    throw new Error('At least one corpus doc key is required to compose an authoring prompt.');
  }
  const rendered = AUTHORING_TEMPLATE.replace(TOPIC_TOKEN, topic).replace(
    DOC_KEYS_TOKEN,
    docKeys.join(', ')
  );
  if (rendered.includes('{') || rendered.includes('}')) {
    // Defensive: a validated topic and validated doc keys cannot trip
    // this, but the prompt transits rlms .format() and a brace here would
    // crash the spawned run — fail in the driver instead.
    throw new Error('Composed authoring prompt contains a curly brace; refusing to spawn.');
  }
  return rendered;
}
