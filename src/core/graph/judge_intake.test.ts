/**
 * Unit pins for the judge-intake slice (JUDGE_INTAKE_DESIGN.md §6):
 * selection/ratification refusals, the address→content split, the
 * closed prompt-section union, and the write-once store. The drill
 * (`npm run test:judge-intake`) carries the byte-pinned oracle
 * comparisons; these pins keep the refusal surfaces in `npm test`.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAddressSpace,
  buildSelection,
  buildRatificationRequest,
  buildCandidate,
  toPromptInput,
  INTAKE_CLAIM_MODE_PARITY,
  IntakeSchemaError,
  EmptySelectionError,
  LiteralTextRefusedError,
  AddressNotFoundError,
  UnratifiedSelectionError,
} from './judge_intake';
import {
  composeJudgePrompt,
  renderPrompt,
  parseComposedPrompt,
  promptSectionSchema,
  PromptSchemaError,
  ClaimChannelError,
  PROMPT_ROLE_PARITY,
  PROMPT_CLAIM_MODE_PARITY,
} from './judge_intake_prompt';
import {
  emptyPreregStore,
  recordRatification,
  recordPreRegistration,
  openRun,
  getRatification,
  getPreRegistration,
  DuplicateRecordError,
  LateRegistrationError,
  PreregSchemaError,
} from './judge_prereg';
import { BlindnessViolationError, ContextAssemblyError } from './judge_panel';

const SEG_A = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaa1';
const SEG_B = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaa2';
const BLOCK = 'ab'.repeat(32);

const space = buildAddressSpace([
  { address: SEG_A, containerId: 'ws', ordinal: 0, content: 'only under the stated qualifier:', partition: 'user-a' },
  { address: SEG_B, containerId: 'ws', ordinal: 1, content: 'the claim under test.', partition: 'user-a' },
  { address: BLOCK, containerId: 'doc', ordinal: 0, content: 'a tier-1 block.' },
]);

const selection = (id: string, addresses: string[]) =>
  buildSelection(space, { selectionId: id, addresses, selectedAtMs: 1 });

const ratifiedStore = (id: string) =>
  recordRatification(emptyPreregStore(), { selectionId: id, claimMode: 'fact', confirmedAtMs: 2 });

describe('judge_intake: selection and the ratification gate', () => {
  it('pins the compile-time claim-mode parity across store, prompt, and panel', () => {
    expect(INTAKE_CLAIM_MODE_PARITY).toBe(true);
    expect(PROMPT_ROLE_PARITY).toBe(true);
    expect(PROMPT_CLAIM_MODE_PARITY).toBe(true);
  });

  it('refuses a selection carrying literal text — no channel for claim bytes', () => {
    expect(() => selection('s', ['the claim under test.'])).toThrow(LiteralTextRefusedError);
  });

  it('refuses an empty selection, an unknown address, and a duplicate address, each typed', () => {
    expect(() => selection('s', [])).toThrow(EmptySelectionError);
    expect(() => selection('s', ['cccccccc-3333-4ccc-8ccc-ccccccccccc1'])).toThrow(AddressNotFoundError);
    expect(() => selection('s', [SEG_B, SEG_B])).toThrow(IntakeSchemaError);
  });

  it('computes neighbor context engine-side with honest boundary nulls', () => {
    const request = buildRatificationRequest(space, selection('s', [SEG_B]));
    expect(request.items[0].neighborBefore).toBe('only under the stated qualifier:');
    expect(request.items[0].neighborAfter).toBeNull();
    const first = buildRatificationRequest(space, selection('s2', [SEG_A]));
    expect(first.items[0].neighborBefore).toBeNull();
  });

  it('refuses candidate construction without a recorded ratification', () => {
    expect(() => buildCandidate(space, emptyPreregStore(), selection('s', [SEG_B]))).toThrow(UnratifiedSelectionError);
  });

  it('builds the candidate through the ratification, carrying its mode and engine-copied bytes', () => {
    const candidate = buildCandidate(space, ratifiedStore('s'), selection('s', [SEG_A, SEG_B]));
    expect(candidate.claimMode).toBe('fact');
    expect(candidate.ratifiedAtMs).toBe(2);
    expect(candidate.claims.map((c) => c.content)).toEqual(['only under the stated qualifier:', 'the claim under test.']);
  });

  it('strips every address component in toPromptInput', () => {
    const candidate = buildCandidate(space, ratifiedStore('s'), selection('s', [SEG_B]));
    const input = toPromptInput(candidate) as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(['claimContent', 'claimMode', 'selectionId']);
    expect(JSON.stringify(input)).not.toContain(SEG_B);
  });

  it('refuses a malformed address space: bad shape, duplicate address, duplicate slot', () => {
    expect(() => buildAddressSpace([{ address: 'not-an-address', containerId: 'c', ordinal: 0, content: 'x' }])).toThrow(IntakeSchemaError);
    expect(() =>
      buildAddressSpace([
        { address: SEG_A, containerId: 'c', ordinal: 0, content: 'x' },
        { address: SEG_A, containerId: 'd', ordinal: 0, content: 'x' },
      ])
    ).toThrow(IntakeSchemaError);
    expect(() =>
      buildAddressSpace([
        { address: SEG_A, containerId: 'c', ordinal: 0, content: 'x' },
        { address: SEG_B, containerId: 'c', ordinal: 0, content: 'y' },
      ])
    ).toThrow(IntakeSchemaError);
  });
});

describe('judge_intake_prompt: the closed union and the clean context', () => {
  const promptInput = { selectionId: 's', claimMode: 'fact', claimContent: ['the claim under test.'] };
  const provided = { citedBytes: ['a cited span.'] };

  it('has no task-text member: kind "task" does not parse; strict sections refuse extras', () => {
    expect(promptSectionSchema.safeParse({ kind: 'task', text: 'x' }).success).toBe(false);
    expect(
      promptSectionSchema.safeParse({ kind: 'identity', role: 'J1_GROUNDING', judgeId: 'j', focus: 'x' }).success
    ).toBe(false);
  });

  it('refuses a candidate input carrying an address or task field (strict schema)', () => {
    expect(() =>
      composeJudgePrompt('J1_GROUNDING', 'j', { ...promptInput, address: SEG_B }, provided)
    ).toThrow(PromptSchemaError);
    expect(() =>
      composeJudgePrompt('J1_GROUNDING', 'j', { ...promptInput, taskText: 'x' }, provided)
    ).toThrow(PromptSchemaError);
  });

  it('refuses a caller-supplied claim and preserves blindness through the new path', () => {
    expect(() => composeJudgePrompt('J1_GROUNDING', 'j', promptInput, { ...provided, claim: 'retyped' })).toThrow(ClaimChannelError);
    expect(() => composeJudgePrompt('J1_GROUNDING', 'j', promptInput, { ...provided, history: ['x'] })).toThrow(BlindnessViolationError);
    expect(() => composeJudgePrompt('J1_GROUNDING', 'j', promptInput, {})).toThrow(ContextAssemblyError);
    expect(() => composeJudgePrompt('J4_AUDIT', 'j', promptInput, {})).toThrow(BlindnessViolationError);
  });

  it('renders deterministically and round-trips; tampered sections fail the hash re-check', () => {
    const once = composeJudgePrompt('J1_GROUNDING', 'j', promptInput, provided);
    const twice = composeJudgePrompt('J1_GROUNDING', 'j', promptInput, provided);
    expect(renderPrompt(once)).toBe(renderPrompt(twice));
    expect(once.promptHash).toBe(twice.promptHash);
    expect(parseComposedPrompt(once)).toEqual(once);
    const tampered = {
      ...once,
      sections: once.sections.map((s) => (s.kind === 'identity' ? { ...s, judgeId: 'other' } : s)),
    };
    expect(() => parseComposedPrompt(tampered)).toThrow(PromptSchemaError);
  });
});

describe('judge_prereg: the write-once store', () => {
  const expectation = { itemId: 'i', expectedVerdict: 'clean', rationale: 'r' };
  const prereg = (id: string, runId: string) => ({
    registrationId: id,
    runId,
    registeredAtMs: 10,
    expectations: [expectation],
  });

  it('is write-once for both record kinds and for run-opens; the first record survives', () => {
    let store = recordRatification(emptyPreregStore(), { selectionId: 's', claimMode: 'belief', confirmedAtMs: 1 });
    expect(() => recordRatification(store, { selectionId: 's', claimMode: 'fact', confirmedAtMs: 2 })).toThrow(DuplicateRecordError);
    expect(getRatification(store, 's')?.claimMode).toBe('belief');
    store = recordPreRegistration(store, prereg('p', 'run-1'));
    expect(() => recordPreRegistration(store, prereg('p', 'run-2'))).toThrow(DuplicateRecordError);
    store = openRun(store, { runId: 'run-9', openedAtMs: 20 });
    expect(() => openRun(store, { runId: 'run-9', openedAtMs: 21 })).toThrow(DuplicateRecordError);
  });

  it('refuses a registration after run-open, typed (rule 20)', () => {
    let store = openRun(emptyPreregStore(), { runId: 'run-1', openedAtMs: 5 });
    expect(() => recordPreRegistration(store, prereg('p', 'run-1'))).toThrow(LateRegistrationError);
    store = recordPreRegistration(store, prereg('p', 'run-2'));
    expect(getPreRegistration(store, 'p')?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('supersession references an existing record; unknown or malformed forecasts refuse', () => {
    let store = recordPreRegistration(emptyPreregStore(), prereg('p1', 'run-1'));
    store = recordPreRegistration(store, { ...prereg('p2', 'run-1'), supersedes: 'p1' });
    expect(getPreRegistration(store, 'p1')).toBeDefined();
    expect(getPreRegistration(store, 'p2')?.supersedes).toBe('p1');
    expect(() => recordPreRegistration(store, { ...prereg('p3', 'run-1'), supersedes: 'ghost' })).toThrow(PreregSchemaError);
    expect(() => recordPreRegistration(store, { ...prereg('p4', 'run-1'), expectations: [] })).toThrow(PreregSchemaError);
    expect(() =>
      recordPreRegistration(store, {
        ...prereg('p5', 'run-1'),
        expectations: [{ ...expectation, expectedDrawbackClass: 'unsupported_citation' }],
      })
    ).toThrow(PreregSchemaError);
  });
});
