import { z } from 'zod';

export const EntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  sourceNodeIds: z.array(z.string())
});

export const ActionSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  verb: z.string(),
  objectId: z.string(),
  sourceNodeIds: z.array(z.string())
});

export const GraphSchema = z.object({
  entities: z.array(EntitySchema),
  actions: z.array(ActionSchema)
});

export type Entity = z.infer<typeof EntitySchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Graph = z.infer<typeof GraphSchema>;

// The supervisor worker's contradiction-evaluation payload. Lives here
// (rather than in the worker) so the response boundary can validate against
// it and tests can exercise it without importing the worker's side effects.
export const ConflictEvaluationSchema = z.object({
  isContradiction: z.boolean(),
  reasoning: z.string(),
  resolutionType: z.enum(['COMPLEMENTARY', 'TEMPORAL_UPDATE', 'DIRECT_CONFLICT'])
});

export type ConflictEvaluation = z.infer<typeof ConflictEvaluationSchema>;

// Strict structured-output shape for one verification classifier batch.
// Array entries avoid dynamic JSON-schema keys and make every answer validate
// before the worker is allowed to update belief state.
export const VerificationResponseSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    label: z.string(),
    confidence: z.number().min(0).max(1),
  })),
});

export type VerificationResponse = z.infer<typeof VerificationResponseSchema>;

// Strict structured-output shape for one alias-adjudication batch
// (Session 5 entity resolution). One verdict per candidate pair, keyed by
// the canonical pairId the worker submitted, so every answer validates
// before any SAME_AS/DISTINCT_FROM edge is written. Reasoning length is
// bounded at edge-write time (buildVerdictParams), not here — a schema
// max() would turn a verbose-but-correct completion into a retry.
export const AliasAdjudicationSchema = z.object({
  results: z.array(z.object({
    pairId: z.string(),
    sameEntity: z.boolean(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  })),
});

export type AliasAdjudication = z.infer<typeof AliasAdjudicationSchema>;

// Strict structured-output shape for one entailment-judge verdict
// (Session 32, PROVENANCE_THREADING.md §5.4): one bounded completion per
// sampled (edge, cited-hash) pair; the verdict validates before any
// check stamp or flag is written.
export const EntailmentResponseSchema = z.object({
  supported: z.boolean(),
});

export type EntailmentResponse = z.infer<typeof EntailmentResponseSchema>;
