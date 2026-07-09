import { z } from 'zod';
import { BoundedLineScanner } from './line_scanner.js';
import { MODULE_ADDENDUM_MAX_BYTES_CAP } from '../../config/modules.js';

// Session 19 (design record docs/architecture/GROUNDED_AUTHORING.md §4,
// §9): the author-mode result envelope. An author run prints one
// machine-readable line `TRELLIS_DRAFT: {...}` on stdout — the draft the
// operator driver collects, sibling of RlmResultScanner. Like every RLM
// stdout observer this is a pure, bounded line scanner over the same
// byte stream the SSE/Redis path publishes.
//
// The draft carries prose only — purpose, addendum, gap notes — and NO
// hashes: the harness pins research provenance from the promotion output
// (§5), so the pen never passes to the model. A draft carrying any
// 64-hex token is therefore REFUSED at the scanner, not parsed: an
// attempt to cite is a refusal, not data (Guardrail 3).
//
// Failure posture mirrors rlm_result.ts: a malformed payload degrades to
// `malformed` rather than throwing; a citing payload degrades to
// `refused`. Neither corrupts the client stream.

const DRAFT_PREFIX = 'TRELLIS_DRAFT:';

// A draft is purpose + a bounded addendum + a few gap notes. This cap
// bounds a runaway line while comfortably fitting the largest legal
// addendum (the module cap) once JSON-escaped.
const DEFAULT_MAX_LINE_BYTES = 96 * 1024;

// Any 64-hex run is an AST-hash-shaped token; the model must never emit
// one (citations are pinned by the harness). Case-insensitive so an
// upper-case variant cannot slip through.
const AST_HASH_TOKEN = /[0-9a-f]{64}/i;

export const MAX_GAP_NOTES = 32;
const GAP_NOTE_MAX_CHARS = 512;

// Process output, not an LLM completion routed through parseLlmResponse:
// validated with plain Zod, failures degrade to `malformed`. Bounds
// mirror the manifest they feed (purpose ≤ 512, addendum ≤ the module
// addendum cap).
export const DraftEnvelopeSchema = z
  .object({
    purpose: z.string().min(1).max(512),
    addendum: z.string().min(1).max(MODULE_ADDENDUM_MAX_BYTES_CAP),
    gapNotes: z.array(z.string().min(1).max(GAP_NOTE_MAX_CHARS)).max(MAX_GAP_NOTES),
  })
  .strict();

export type DraftEnvelope = z.infer<typeof DraftEnvelopeSchema>;

export type DraftEvent =
  | { kind: 'draft'; draft: DraftEnvelope }
  | { kind: 'refused'; reason: string }
  | { kind: 'malformed'; reason: string };

export function parseDraftLine(line: string): DraftEvent {
  const payload = line.slice(DRAFT_PREFIX.length).trim();
  // The no-hash rule runs on the raw payload BEFORE parsing: a 64-hex
  // token anywhere in the draft (a key, a note, the addendum) is a
  // refusal regardless of where the model tried to hide it.
  if (AST_HASH_TOKEN.test(payload)) {
    return {
      kind: 'refused',
      reason: 'draft contains a 64-hex token; citations are pinned by the harness, never chosen by the model',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { kind: 'malformed', reason: 'invalid JSON payload' };
  }
  const result = DraftEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { kind: 'malformed', reason: `draft failed schema: ${issues}` };
  }
  return { kind: 'draft', draft: result.data };
}

/**
 * Reads and validates a saved draft envelope (the driver's `--draft`
 * replay path — the stub-replay precedent). Returns the envelope or
 * throws a readable error; the no-hash rule applies identically to a
 * saved draft as to a live one.
 */
export function parseDraftPayload(raw: string, where: string): DraftEnvelope {
  const event = parseDraftLine(`${DRAFT_PREFIX} ${raw}`);
  if (event.kind === 'draft') return event.draft;
  throw new Error(`Draft from ${where} ${event.kind}: ${event.reason}`);
}

/**
 * Bounded incremental scanner for the draft envelope, sibling of
 * RlmResultScanner. feed() with each chunk; flush() at process exit for a
 * final line without a trailing newline.
 */
export class RlmDraftScanner {
  private readonly lines: BoundedLineScanner;

  constructor(
    onEvent: (event: DraftEvent) => void,
    maxLineBytes: number = DEFAULT_MAX_LINE_BYTES
  ) {
    this.lines = new BoundedLineScanner(line => {
      if (!line.startsWith(DRAFT_PREFIX)) return;
      onEvent(parseDraftLine(line));
    }, maxLineBytes);
  }

  feed(chunk: string): void {
    this.lines.feed(chunk);
  }

  flush(): void {
    this.lines.flush();
  }
}
