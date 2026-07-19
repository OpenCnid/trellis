/**
 * Clean-context judge prompt assembly: composed prompts, the
 * address/content split, and the pure deterministic renderer.
 *
 * Normative specification:
 *   docs/product/epistemic-support/JUDGE_INTAKE_DESIGN.md §3.2, under
 *   JUDGE_COMPOSITION_GAME.md §6 rules 6 and 16 and the §9 shape notes
 *   (binding program law, ratified July 18, 2026 — cited by number,
 *   never restated). Authored under the Prompt-Engineering and
 *   Hypershot protocols (HANDOFF Guardrail 15): the render grammar is
 *   a fixed structural frame over engine-supplied variables; the only
 *   invariant prose is definition rigor and the output contract, and
 *   the format line carries spread-style slots, never exemplar content.
 *
 * STRUCTURAL INVARIANTS (drill-pinned):
 *   - `PromptSection` is a CLOSED discriminated union with NO task-text
 *     member — no field exists for a highlighted question, a named
 *     drawback class to look for, or an embedded expectation (F1/F6
 *     unrepresentable).
 *   - Evidence is built only through `assembleJudgeContext`, so role
 *     blindness cannot be bypassed on this path.
 *   - The candidate input schema is STRICT and carries claim CONTENT
 *     only — no address, partition, or origin field exists, so
 *     attribution (an address-space property) cannot reach a judge
 *     (rule 6). `judge_intake.ts` owns the address→content split.
 *   - This module imports NOTHING from `judge_prereg.ts` (rule 11):
 *     forecasts never share bytes with prompts.
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import {
  ROLE_DEFINITIONS,
  assembleJudgeContext,
  type ClaimMode,
  type PanelRole,
} from './judge_panel';

// ---------------------------------------------------------------------------
// Value-level enums (compile-pinned against the panel's types)
// ---------------------------------------------------------------------------

const PANEL_ROLE_VALUES = ['J1_GROUNDING', 'J2_COHERENCE', 'J3_CORROBORATION', 'J4_AUDIT'] as const;
const CLAIM_MODE_VALUES = ['fact', 'inference', 'prediction', 'value', 'belief', 'experience'] as const;

/** Compile-time drift pin: `never` here means a value list fell out of sync with `judge_panel.ts`. */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const PROMPT_ROLE_PARITY: MutuallyAssignable<(typeof PANEL_ROLE_VALUES)[number], PanelRole> = true;
export const PROMPT_CLAIM_MODE_PARITY: MutuallyAssignable<(typeof CLAIM_MODE_VALUES)[number], ClaimMode> = true;

// ---------------------------------------------------------------------------
// The closed section union (no task-text member — the absence IS the design)
// ---------------------------------------------------------------------------

const identitySection = z.strictObject({
  kind: z.literal('identity'),
  role: z.enum(PANEL_ROLE_VALUES),
  judgeId: z.string().min(1),
});

const definitionSection = z.strictObject({
  kind: z.literal('definition'),
  role: z.enum(PANEL_ROLE_VALUES),
  claimModes: z.array(z.enum(CLAIM_MODE_VALUES)),
  qualifiedParameters: z.array(z.string().min(1)).min(1),
  taxonomy: z.record(z.string().min(1), z.string().min(1)),
  requiredAssumptions: z.array(z.string().min(1)),
});

const evidenceSection = z.strictObject({
  kind: z.literal('evidence'),
  /** Exactly `assembleJudgeContext` output — allowlisted keys only. */
  context: z.record(z.string().min(1), z.unknown()),
});

const outputSchemaSection = z.strictObject({
  kind: z.literal('output_schema'),
  verdicts: z.tuple([z.literal('clean'), z.literal('drawback'), z.literal('abstain')]),
  drawbackClasses: z.array(z.string().min(1)).min(1),
  abstainReasons: z.tuple([z.literal('evidence'), z.literal('jurisdiction')]),
});

export const promptSectionSchema = z.discriminatedUnion('kind', [
  identitySection,
  definitionSection,
  evidenceSection,
  outputSchemaSection,
]);

export type PromptSection = z.infer<typeof promptSectionSchema>;

const SECTION_ORDER = ['identity', 'definition', 'evidence', 'output_schema'] as const;

export interface ComposedJudgePrompt {
  role: PanelRole;
  judgeId: string;
  /** Exactly one section per kind, in `SECTION_ORDER` — repetition is not a channel either. */
  sections: readonly PromptSection[];
  /** Engine-computed SHA-256 over the rendered bytes. */
  promptHash: string;
}

// ---------------------------------------------------------------------------
// Candidate input: claim content only, strict — no address field exists
// ---------------------------------------------------------------------------

const candidateInputSchema = z.strictObject({
  selectionId: z.string().min(1),
  /** Carried from the ratification for engine-side applicability gating; never rendered as evidence. */
  claimMode: z.enum(CLAIM_MODE_VALUES),
  /** Engine-copied bytes, one entry per selected address, address stripped upstream. */
  claimContent: z.array(z.string().min(1)).min(1),
});

export type JudgeCandidateInput = z.infer<typeof candidateInputSchema>;

// ---------------------------------------------------------------------------
// Typed refusals
// ---------------------------------------------------------------------------

export class PromptSchemaError extends Error {}

export class ClaimChannelError extends Error {
  constructor(role: PanelRole) {
    super(
      `Prompt composition refused for ${role}: provided context carries a "claim" key — claim bytes ` +
      `reach a judge only as engine-copied candidate content, never through a caller-supplied channel.`
    );
  }
}

// ---------------------------------------------------------------------------
// Deterministic rendering (pure; byte-pinned by the drill)
// ---------------------------------------------------------------------------

/** Canonical JSON: recursively key-sorted, no whitespace — deterministic bytes for any evidence value. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const out = JSON.stringify(value);
    if (out === undefined) {
      throw new PromptSchemaError(`Evidence value of type "${typeof value}" has no canonical JSON form.`);
    }
    return out;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}

const csv = (items: readonly string[]): string => (items.length === 0 ? '(none)' : items.join(', '));

function renderSection(section: PromptSection): string {
  switch (section.kind) {
    case 'identity':
      return `<identity>\nrole: ${section.role}\njudge: ${section.judgeId}\n</identity>`;
    case 'definition': {
      const taxonomyLines = Object.keys(section.taxonomy)
        .sort()
        .map((cls) => `  ${cls} -> ${section.taxonomy[cls]}`)
        .join('\n');
      return (
        `<definition>\n` +
        `claim_modes: ${csv(section.claimModes)}\n` +
        `qualified_parameters: ${csv(section.qualifiedParameters)}\n` +
        `taxonomy:\n${taxonomyLines}\n` +
        `required_assumptions: ${csv(section.requiredAssumptions)}\n` +
        `verdict_rule: Judge only through this definition — restrict every finding to the qualified ` +
        `parameters above, name any drawback from the closed taxonomy, and abstain with a reason when ` +
        `jurisdiction or evidence is absent.\n` +
        `</definition>`
      );
    }
    case 'evidence': {
      const keys = Object.keys(section.context).sort();
      const body = keys.map((k) => `${k}:\n${canonicalJson(section.context[k])}`).join('\n');
      return `<evidence>\n${body}\n</evidence>`;
    }
    case 'output_schema':
      return (
        `<output_schema>\n` +
        `verdict: ${section.verdicts.join(' | ')}\n` +
        `drawback: ${section.drawbackClasses.join(' | ')} | null\n` +
        `abstain_reason: ${section.abstainReasons.join(' | ')}\n` +
        `format: one JSON object {"verdict": "...", "drawback": "..." | null, "abstainReason": "..."}\n` +
        `</output_schema>`
      );
  }
}

function renderSections(role: PanelRole, judgeId: string, sections: readonly PromptSection[]): string {
  const body = sections.map(renderSection).join('\n\n');
  return `<judge_prompt role="${role}" judge="${judgeId}">\n\n${body}\n\n</judge_prompt>\n`;
}

/** Pure and deterministic: same composed prompt, same bytes, every time. */
export function renderPrompt(composed: ComposedJudgePrompt): string {
  return renderSections(composed.role, composed.judgeId, composed.sections);
}

// ---------------------------------------------------------------------------
// Composition (the only evidence path is assembleJudgeContext)
// ---------------------------------------------------------------------------

export function composeJudgePrompt(
  role: PanelRole,
  judgeId: string,
  rawCandidate: unknown,
  providedContext: Readonly<Record<string, unknown>>
): ComposedJudgePrompt {
  if (!(role in ROLE_DEFINITIONS)) {
    throw new PromptSchemaError(`Unknown panel role "${String(role)}".`);
  }
  if (typeof judgeId !== 'string' || judgeId.length === 0) {
    throw new PromptSchemaError('Prompt composition requires a non-empty judgeId.');
  }
  const parsed = candidateInputSchema.safeParse(rawCandidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') || 'candidate';
    throw new PromptSchemaError(`Candidate input refused at "${path}": ${issue?.message}.`);
  }
  const candidate = parsed.data;
  if (Object.prototype.hasOwnProperty.call(providedContext, 'claim')) {
    throw new ClaimChannelError(role);
  }

  // Blindness is enforced HERE, before any would-be model boundary: a
  // forbidden key in providedContext raises BlindnessViolationError
  // from the panel's own allowlist mechanism.
  const claim = candidate.claimContent.join('\n');
  const context = assembleJudgeContext(role, { ...providedContext, claim });

  const def = ROLE_DEFINITIONS[role];
  const sections: PromptSection[] = [
    { kind: 'identity', role, judgeId },
    {
      kind: 'definition',
      role,
      claimModes: [...def.claimModes],
      qualifiedParameters: [...def.qualifiedParameters],
      taxonomy: { ...def.taxonomy },
      requiredAssumptions: [...def.requiredAssumptions],
    },
    { kind: 'evidence', context },
    {
      kind: 'output_schema',
      verdicts: ['clean', 'drawback', 'abstain'],
      drawbackClasses: Object.keys(def.taxonomy).sort(),
      abstainReasons: ['evidence', 'jurisdiction'],
    },
  ];

  const promptHash = createHash('sha256').update(renderSections(role, judgeId, sections), 'utf8').digest('hex');
  return { role, judgeId, sections, promptHash };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Boundary validation for a stored/transported composed prompt:
 * exactly one section per kind in the fixed order, coherent role and
 * judge identity, and a promptHash that matches the re-rendered bytes.
 */
export function parseComposedPrompt(raw: unknown): ComposedJudgePrompt {
  const outer = z
    .strictObject({
      role: z.enum(PANEL_ROLE_VALUES),
      judgeId: z.string().min(1),
      sections: z.array(promptSectionSchema),
      promptHash: z.string().regex(SHA256_HEX),
    })
    .safeParse(raw);
  if (!outer.success) {
    const issue = outer.error.issues[0];
    const path = issue?.path.join('.') || 'prompt';
    throw new PromptSchemaError(`Composed prompt refused at "${path}": ${issue?.message}.`);
  }
  const prompt = outer.data;
  const kinds = prompt.sections.map((s) => s.kind);
  if (kinds.length !== SECTION_ORDER.length || SECTION_ORDER.some((k, i) => kinds[i] !== k)) {
    throw new PromptSchemaError(
      `Composed prompt refused: sections must be exactly [${SECTION_ORDER.join(', ')}] — observed [${kinds.join(', ')}].`
    );
  }
  for (const s of prompt.sections) {
    if ((s.kind === 'identity' || s.kind === 'definition') && s.role !== prompt.role) {
      throw new PromptSchemaError(
        `Composed prompt refused: ${s.kind} section names role ${s.role} but the prompt is for ${prompt.role}.`
      );
    }
    if (s.kind === 'identity' && s.judgeId !== prompt.judgeId) {
      throw new PromptSchemaError(
        `Composed prompt refused: identity section names judge "${s.judgeId}" but the prompt is for "${prompt.judgeId}".`
      );
    }
  }
  const rendered = renderSections(prompt.role, prompt.judgeId, prompt.sections);
  const observedHash = createHash('sha256').update(rendered, 'utf8').digest('hex');
  if (observedHash !== prompt.promptHash) {
    throw new PromptSchemaError(
      `Composed prompt refused: promptHash ${prompt.promptHash} does not match the re-rendered bytes (${observedHash}).`
    );
  }
  return prompt;
}
