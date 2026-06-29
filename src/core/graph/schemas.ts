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
