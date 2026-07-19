/**
 * The spawn boundary: the ONLY module in the judge-convocation feature
 * permitted to construct a model call.
 *
 * Normative specification:
 *   docs/product/epistemic-support/JUDGE_CONVOCATION_DESIGN.md §3.3,
 *   under R-27 (model coupling is a refusal, not a convention) and the
 *   Session 32 judge discipline (an infrastructure failure is an
 *   error, never a verdict).
 *
 * The composed ComposedJudgePrompt bytes ARE the interface: the
 * request is exactly `renderPrompt(composed)` as the single user
 * message — no system message, no wrapper text, no appended
 * instruction. `promptHash` is re-verified against a fresh render
 * immediately before any send (`parseComposedPrompt`); a mismatch
 * refuses before any network I/O. Any wrapper byte would be a new
 * prompt channel and a composed-prompt change (Guardrail 15 + a §3.2a
 * dated amendment — deliberately expensive).
 *
 * The model supplies ONLY what the §3.2a output schema names:
 * {verdict, drawback, abstainReason}. Every other verdict-record field
 * (judgeId, role, beliefId, atMs, weight) is constructed engine-side;
 * WEIGHT IS AN ENGINE CONSTANT (config twin SUPPORT_VERDICT_WEIGHT),
 * never model-supplied — a model-supplied weight would be a
 * count-shaped self-report (AB-5's origin triple).
 *
 * The live constructor is triple-gated at the runner (operator flag +
 * the owner's dated paid-queue re-opening + per-run approval under the
 * ≤$5 cap); this module's own gates are the R-27 identity refusal and
 * the transport re-verification. The oracle twin is the zero-model
 * path every drill drives; the `openai` import is dynamic and lives
 * only inside the live judge (the entailment_detection.ts mold), so
 * the default path never touches it.
 *
 * STRUCTURAL INVARIANT (rule 11 at the new surface, drill-pinned):
 * this module never imports `judge_prereg.ts` or the convocation
 * store — the spawn cannot see expectations, so no forecast can share
 * bytes with any transport.
 */

import { z } from 'zod';
import {
  parseComposedPrompt,
  renderPrompt,
  type ComposedJudgePrompt,
} from './judge_intake_prompt';
import { parseJudgeVerdict, type JudgeManifest, type JudgeVerdict, type PanelRole } from './judge_panel';

// ---------------------------------------------------------------------------
// The model's response surface (§3.2a output schema — nothing else)
// ---------------------------------------------------------------------------

export const judgeResponseSchema = z.strictObject({
  verdict: z.enum(['clean', 'drawback', 'abstain']),
  drawback: z.string().min(1).nullable(),
  abstainReason: z.enum(['evidence', 'jurisdiction']).optional(),
});

export type JudgeResponse = z.infer<typeof judgeResponseSchema>;

export class ModelIdentityMismatchError extends Error {
  constructor(judgeId: string, manifestModel: string, configuredModel: string) {
    super(
      `Spawn refused for judge "${judgeId}": configured model "${configuredModel}" is not the ` +
      `manifest's targetModelIdentity "${manifestModel}" (R-27) — a migration contests the judge, ` +
      `it never silently retargets the spawn.`
    );
  }
}

export class SpawnResponseError extends Error {}

// ---------------------------------------------------------------------------
// Transport: exactly the rendered bytes, verified immediately pre-send
// ---------------------------------------------------------------------------

export interface SpawnRequest {
  /** The single user message — byte-equal to renderPrompt(composed), drill-pinned. */
  content: string;
  promptHash: string;
}

/** Re-verifies the composed prompt (re-render + hash) and yields the exact transport bytes. */
export function buildSpawnRequest(composed: ComposedJudgePrompt): SpawnRequest {
  const verified = parseComposedPrompt(composed);
  return { content: renderPrompt(verified), promptHash: verified.promptHash };
}

// ---------------------------------------------------------------------------
// The judge function shape and its two constructors
// ---------------------------------------------------------------------------

/** null = the judge declined the pair (oracle miss) — skipped, counted, never a verdict. */
export type ConvocationJudge = (
  composed: ComposedJudgePrompt,
  pairKey: string
) => Promise<JudgeResponse | null>;

/**
 * Deterministic pairKey -> response map for zero-model drills and
 * rehearsals (the makeOracleEntailmentJudge mold). Absent keys are
 * declined. Responses are validated through the SAME strict schema the
 * live path uses — the oracle cannot be a laxer boundary.
 */
export function makeOracleJudge(truth: Readonly<Record<string, unknown>>): ConvocationJudge {
  return async (_composed, pairKey) => {
    const raw = truth[pairKey];
    if (raw === undefined) return null;
    const parsed = judgeResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SpawnResponseError(
        `Oracle response for pair "${pairKey}" refused: ${parsed.error.issues[0]?.message}.`
      );
    }
    return parsed.data;
  };
}

/**
 * The live constructor — the feature's single paid surface. The R-27
 * identity check refuses BEFORE anything else (no import, no client,
 * no I/O); the transport is built through buildSpawnRequest so the
 * bytes are verified at the boundary; the response validates through
 * the strict schema and any failure throws (never a verdict — the
 * sweep's judge-all-then-write atomicity turns it into zero writes).
 */
export function makeLiveJudge(manifest: JudgeManifest, configuredModel: string): ConvocationJudge {
  if (configuredModel !== manifest.targetModelIdentity) {
    throw new ModelIdentityMismatchError(manifest.judgeId, manifest.targetModelIdentity, configuredModel);
  }
  return async (composed, pairKey) => {
    const request = buildSpawnRequest(composed);
    const OpenAI = (await import('openai')).default;
    const { zodResponseFormat } = await import('openai/helpers/zod');
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: configuredModel,
      messages: [{ role: 'user', content: request.content }],
      response_format: zodResponseFormat(judgeResponseSchema, 'judge_verdict'),
      temperature: 0,
    });
    const raw = completion.choices[0]?.message.content;
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new SpawnResponseError(`Judge "${manifest.judgeId}" returned no content for pair "${pairKey}".`);
    }
    const parsed = judgeResponseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new SpawnResponseError(
        `Judge "${manifest.judgeId}" response refused for pair "${pairKey}": ${parsed.error.issues[0]?.message}.`
      );
    }
    return parsed.data;
  };
}

// ---------------------------------------------------------------------------
// Engine-side verdict construction (the model holds no other field)
// ---------------------------------------------------------------------------

export function buildEngineVerdict(input: {
  judgeId: string;
  role: PanelRole;
  beliefId: string;
  response: JudgeResponse;
  atMs: number;
  weight: number;
}): JudgeVerdict {
  return parseJudgeVerdict({
    judgeId: input.judgeId,
    role: input.role,
    beliefId: input.beliefId,
    verdict: input.response.verdict,
    drawback: input.response.drawback,
    ...(input.response.abstainReason !== undefined ? { abstainReason: input.response.abstainReason } : {}),
    atMs: input.atMs,
    weight: input.weight,
  });
}
