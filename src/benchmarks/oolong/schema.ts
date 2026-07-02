import { z } from 'zod';

// Architecture Invariant 3: validation strictly at the boundary.
// Every OOLONG dataset file must pass through these schemas before
// touching the ingestion pipeline.

export const TREC_COARSE_CATEGORIES = ['ABBR', 'ENTY', 'DESC', 'HUM', 'LOC', 'NUM'] as const;

export const OolongRecordSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  category: z.enum(TREC_COARSE_CATEGORIES),
  // Normalized lowercase concept names annotated on the record
  // (e.g. the city a question mentions). Used to build deterministic
  // (:Question)-[:REFERENCES]->(:Concept) edges without LLM extraction.
  concepts: z.array(z.string().min(1))
});

export const OolongDatasetSchema = z.object({
  name: z.string(),
  seed: z.number().int(),
  records: z.array(OolongRecordSchema).min(1),
  ground_truth: z.object({
    // Unordered pairs [LOC question id, HUM question id] that share
    // at least one concept. This is the answer key for OOLONG-Pairs.
    loc_hum_shared_concept_pairs: z.array(z.tuple([z.string(), z.string()]))
  })
});

export type OolongRecord = z.infer<typeof OolongRecordSchema>;
export type OolongDataset = z.infer<typeof OolongDatasetSchema>;
