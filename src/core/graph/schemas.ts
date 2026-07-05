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
