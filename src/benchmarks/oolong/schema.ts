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
  concepts: z.array(z.string().min(1)),
  // v2 (optional, absent in v1): the surface text through which each
  // annotated concept appears in `text`, aligned index-for-index with
  // `concepts`. A paraphrased record's surface form ("the French
  // capital") deliberately does not contain the canonical token.
  surface_forms: z.array(z.string().min(1)).optional(),
  // v2 (optional): canonical concept names whose surface form appears
  // in `text` WITHOUT being annotated — near-miss distractor mentions
  // that a substring-scanning agent would wrongly attribute.
  distractor_mentions: z.array(z.string().min(1)).optional()
});

// v2: non-question prose that shares the corpus and mentions city
// surface forms but is never a valid pair member. Kept out of
// `records` so every records consumer (classification seeding, drills,
// scoring) stays question-only without filtering.
export const OolongPassageSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  // Canonical concept names whose surface forms the prose contains.
  surface_forms: z.array(z.string().min(1))
});

export const OolongDatasetSchema = z.object({
  name: z.string(),
  seed: z.number().int(),
  records: z.array(OolongRecordSchema).min(1),
  // v2 (optional, absent in v1): distractor prose paragraphs.
  distractor_passages: z.array(OolongPassageSchema).optional(),
  ground_truth: z.object({
    // Unordered pairs [LOC question id, HUM question id] that share
    // at least one concept. This is the answer key for OOLONG-Pairs.
    loc_hum_shared_concept_pairs: z.array(z.tuple([z.string(), z.string()]))
  })
});

export type OolongRecord = z.infer<typeof OolongRecordSchema>;
export type OolongPassage = z.infer<typeof OolongPassageSchema>;
export type OolongDataset = z.infer<typeof OolongDatasetSchema>;
