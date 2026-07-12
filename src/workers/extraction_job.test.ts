import { describe, expect, it } from 'vitest';
import {
  buildExtractionPrompt,
  codeExtractionUserPrompt,
  parseExtractionJobData,
  ExtractionJobDataError,
  CODE_EXTRACTION_SYSTEM_PROMPT,
  LEGACY_EXTRACTION_SYSTEM_PROMPT,
} from './extraction_job';

// The pre-Session-25 prompt bytes, copied verbatim from the worker as it
// stood before this change. A payload WITHOUT sourceKind (anything
// already queued, any pre-Session-25 producer) and a 'prose' payload must
// both compose EXACTLY these bytes — moving them is a witting change to
// what every prose extraction pays for.
const PINNED_LEGACY_SYSTEM =
  'You are an expert GraphRAG extraction engine that strictly outputs sparse, high-level business logic graphs.';
function pinnedLegacyUser(text: string, astNodeId: string): string {
  return `Extract the entities and actions from the following text. Map the provided AST Node ID to the 'sourceNodeIds' array. Extract ONLY the most critical, macro-level business entities and relationships. Be extremely sparse to avoid graph bloat.\n\n--- Text ---\nContent: ${text}\nAST Node ID: ${astNodeId}`;
}

const HASH = 'f'.repeat(64);

describe('parseExtractionJobData', () => {
  it('parses a legacy payload (no sourceKind) to the legacy route', () => {
    const parsed = parseExtractionJobData({ astNodeId: HASH, text: 'Some block.' });
    expect(parsed).toEqual({ astNodeId: HASH, text: 'Some block.', sourceKind: null, language: null });
  });

  it('ignores unrelated correlation fields, as the worker always has', () => {
    const parsed = parseExtractionJobData({
      astNodeId: HASH,
      text: 'x',
      requestId: 'r',
      docKey: 'doc:1',
      version: 3,
    });
    expect(parsed.sourceKind).toBeNull();
  });

  it('accepts code and prose with a known language', () => {
    expect(parseExtractionJobData({ astNodeId: HASH, text: 'x', sourceKind: 'code', language: 'typescript' }))
      .toEqual({ astNodeId: HASH, text: 'x', sourceKind: 'code', language: 'typescript' });
    expect(parseExtractionJobData({ astNodeId: HASH, text: 'x', sourceKind: 'prose' }).sourceKind)
      .toBe('prose');
  });

  it('refuses unknown sourceKind values at the boundary', () => {
    for (const bad of ['markdown', 'CODE', '', 42, null, {}]) {
      expect(() => parseExtractionJobData({ astNodeId: HASH, text: 'x', sourceKind: bad }))
        .toThrow(ExtractionJobDataError);
    }
  });

  it('refuses languages outside the known table', () => {
    for (const bad of ['rust', 'TypeScript', '', 7]) {
      expect(() => parseExtractionJobData({ astNodeId: HASH, text: 'x', sourceKind: 'code', language: bad }))
        .toThrow(ExtractionJobDataError);
    }
  });

  it('refuses structurally broken payloads before any I/O', () => {
    expect(() => parseExtractionJobData(null)).toThrow(ExtractionJobDataError);
    expect(() => parseExtractionJobData({ text: 'x' })).toThrow(ExtractionJobDataError);
    expect(() => parseExtractionJobData({ astNodeId: '', text: 'x' })).toThrow(ExtractionJobDataError);
    expect(() => parseExtractionJobData({ astNodeId: HASH })).toThrow(ExtractionJobDataError);
  });
});

describe('buildExtractionPrompt', () => {
  it('a legacy payload yields the EXACT legacy prompt bytes', () => {
    const prompt = buildExtractionPrompt(
      parseExtractionJobData({ astNodeId: HASH, text: 'Globex acquired Initech.' })
    );
    expect(prompt.system).toBe(PINNED_LEGACY_SYSTEM);
    expect(prompt.user).toBe(pinnedLegacyUser('Globex acquired Initech.', HASH));
  });

  it('prose yields those same legacy bytes', () => {
    const legacy = buildExtractionPrompt(parseExtractionJobData({ astNodeId: HASH, text: 'T' }));
    const prose = buildExtractionPrompt(
      parseExtractionJobData({ astNodeId: HASH, text: 'T', sourceKind: 'prose' })
    );
    expect(prose).toEqual(legacy);
    expect(LEGACY_EXTRACTION_SYSTEM_PROMPT).toBe(PINNED_LEGACY_SYSTEM);
  });

  it('code selects the code-tuned prompt with the language header', () => {
    const prompt = buildExtractionPrompt(
      parseExtractionJobData({ astNodeId: HASH, text: 'export function f() {}', sourceKind: 'code', language: 'typescript' })
    );
    expect(prompt.system).toBe(CODE_EXTRACTION_SYSTEM_PROMPT);
    expect(prompt.user).toBe(codeExtractionUserPrompt('export function f() {}', HASH, 'typescript'));
    expect(prompt.user).toContain('--- Source code (typescript) ---');
    expect(prompt.user).toContain(`AST Node ID: ${HASH}`);
    // The code prompt asks for API-level sparsity and teaches the fact
    // shape as a hypershot frame — bracketed instruction-bearing
    // variables, no concrete example symbols (this repository's own
    // identifiers would bias its own extraction). Generic-name
    // enforcement lives in generic_suppression.ts, not here.
    expect(prompt.user).toContain('API-level facts');
    expect(prompt.user).toContain(
      '{Exported_Symbol_Exactly_As_Written} --[{specific_verb}]--> {Module_Config_Key_Queue_Or_Table_Exactly_As_Written}'
    );
    expect(prompt.user).toContain('too generic to emit');
    // No concrete repository symbol appears as an example in the frame.
    expect(prompt.user).not.toContain('planExtraction');
    expect(prompt.user).not.toContain('extraction_queue');
  });

  it('code without a language falls back to a plain header', () => {
    const prompt = buildExtractionPrompt(
      parseExtractionJobData({ astNodeId: HASH, text: 'x = 1', sourceKind: 'code' })
    );
    expect(prompt.user).toContain('--- Source code (code) ---');
  });
});
