import type { ExtractionSourceKind } from '../core/ast/persist.js';

// Session 25: pure extraction-job payload parsing and prompt selection
// for extraction_worker.ts (the workspace_scratch.ts / rlm_job.ts mold:
// the worker file has import-time side effects, so everything a unit
// test must pin lives here).
//
// Back-compat contract (pinned in extraction_job.test.ts): a payload
// WITHOUT sourceKind — anything already queued, any pre-Session-25
// producer — yields the EXACT legacy prompt bytes. `prose` yields those
// same bytes. Only `code` selects the code-tuned prompt. Unknown values
// are refused loudly at this boundary, before any I/O or paid call.
// Both prompts are kernel-fixed strings (Guardrail 5), and both feed the
// unchanged GraphSchema / zodResponseFormat / parseLlmResponse contract.

// The language vocabulary mirrors source_parser.ts's SourceLanguage
// table. It only ever decorates the code prompt's header; anything
// outside the table is refused rather than interpolated into a prompt.
const KNOWN_LANGUAGES: ReadonlySet<string> = new Set([
  'typescript',
  'javascript',
  'python',
  'markdown',
  'text',
]);

export class ExtractionJobDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionJobDataError';
  }
}

export interface ParsedExtractionJobData {
  astNodeId: string;
  text: string;
  /** null = legacy payload (no field): exact legacy prompt bytes. */
  sourceKind: ExtractionSourceKind | null;
  language: string | null;
}

export function parseExtractionJobData(data: unknown): ParsedExtractionJobData {
  if (!data || typeof data !== 'object') {
    throw new ExtractionJobDataError('extraction job data is not an object');
  }
  const record = data as Record<string, unknown>;
  if (typeof record.astNodeId !== 'string' || record.astNodeId.length === 0) {
    throw new ExtractionJobDataError('extraction job data is missing astNodeId');
  }
  if (typeof record.text !== 'string') {
    throw new ExtractionJobDataError('extraction job data is missing text');
  }

  let sourceKind: ExtractionSourceKind | null = null;
  if (record.sourceKind !== undefined) {
    if (record.sourceKind !== 'code' && record.sourceKind !== 'prose') {
      throw new ExtractionJobDataError(
        `extraction job sourceKind must be "code" or "prose", got ${JSON.stringify(record.sourceKind)}`
      );
    }
    sourceKind = record.sourceKind;
  }

  let language: string | null = null;
  if (record.language !== undefined) {
    if (typeof record.language !== 'string' || !KNOWN_LANGUAGES.has(record.language)) {
      throw new ExtractionJobDataError(
        `extraction job language is not in the known table, got ${JSON.stringify(record.language)}`
      );
    }
    language = record.language;
  }

  return { astNodeId: record.astNodeId, text: record.text, sourceKind, language };
}

export interface ExtractionPrompt {
  system: string;
  user: string;
}

// The pre-Session-25 prompt, byte-for-byte. Moving these strings is a
// witting change to what every prose/legacy extraction pays for — the
// unit pin exists so it can never move by accident.
export const LEGACY_EXTRACTION_SYSTEM_PROMPT =
  'You are an expert GraphRAG extraction engine that strictly outputs sparse, high-level business logic graphs.';

export function legacyExtractionUserPrompt(text: string, astNodeId: string): string {
  return `Extract the entities and actions from the following text. Map the provided AST Node ID to the 'sourceNodeIds' array. Extract ONLY the most critical, macro-level business entities and relationships. Be extremely sparse to avoid graph bloat.\n\n--- Text ---\nContent: ${text}\nAST Node ID: ${astNodeId}`;
}

// The code-tuned prompt (the recorded pilot finding: the document-generic
// prompt improvises on source code — "organization --[is_default_type_for]->
// organization"). API-level facts, qualified names, and an explicit ban on
// bare generic identifiers; the deterministic suppression filter in
// generic_suppression.ts is what enforces that ban.
export const CODE_EXTRACTION_SYSTEM_PROMPT =
  'You are an expert code-knowledge extraction engine that strictly outputs sparse, API-level source code graphs.';

export function codeExtractionUserPrompt(
  text: string,
  astNodeId: string,
  language: string | null
): string {
  const header = language ?? 'code';
  return `Extract the entities and actions from the following source code. Map the provided AST Node ID to the 'sourceNodeIds' array. Extract ONLY API-level facts: exported symbols (functions, classes, constants), the modules, configuration keys, queue names, or tables they use or constrain, and how they relate. Name entities by their qualified identifiers exactly as written in the code (for example a function name like planExtraction or a queue name like extraction_queue). NEVER emit a bare generic identifier (for example entity, name, id, data, value, result) as an entity. Be extremely sparse: a few load-bearing API facts beat an exhaustive listing.\n\n--- Source code (${header}) ---\nContent: ${text}\nAST Node ID: ${astNodeId}`;
}

/**
 * Selects the prompt for one parsed job. Absent sourceKind and 'prose'
 * are byte-identical to the legacy prompt; 'code' selects the code-tuned
 * prompt.
 */
export function buildExtractionPrompt(job: ParsedExtractionJobData): ExtractionPrompt {
  if (job.sourceKind === 'code') {
    return {
      system: CODE_EXTRACTION_SYSTEM_PROMPT,
      user: codeExtractionUserPrompt(job.text, job.astNodeId, job.language),
    };
  }
  return {
    system: LEGACY_EXTRACTION_SYSTEM_PROMPT,
    user: legacyExtractionUserPrompt(job.text, job.astNodeId),
  };
}
