export const DEFAULT_SCALE_SEED = 20260706;
export const DEFAULT_SCALE_DOCUMENTS = 300;
export const DEFAULT_SCALE_BLOCKS_PER_DOCUMENT = 20;
export const DEFAULT_SCALE_ENTITY_POOL_SIZE = 96;
export const DEFAULT_SCALE_ZIPF_EXPONENT = 0.8;
export const DEFAULT_SCALE_NAMESPACE = 'trellis-scale';

export interface ScaleCorpusOptions {
  seed?: number;
  documentCount?: number;
  blocksPerDocument?: number;
  entityPoolSize?: number;
  zipfExponent?: number;
  namespace?: string;
}

export interface ScaleBlock {
  index: number;
  subjectName: string;
  detailName: string;
  verb: 'references';
  text: string;
}

export interface ScaleDocument {
  index: number;
  docKey: string;
  markdown: string;
  blocks: ScaleBlock[];
}

export interface ScaleCorpus {
  seed: number;
  namespace: string;
  entityPool: string[];
  documents: ScaleDocument[];
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

/** Small seeded PRNG with stable 32-bit arithmetic across JS runtimes. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weighted sampling without replacement. One entity can be cited at most
 * once per document, matching the realistic hub pattern in the roadmap:
 * commonly referenced entities accrue roughly one source hash per document,
 * while the long tail appears only occasionally.
 */
function sampleEntityIndexes(
  random: () => number,
  poolSize: number,
  count: number,
  exponent: number
): number[] {
  const candidates = Array.from({ length: poolSize }, (_, index) => ({
    index,
    weight: 1 / Math.pow(index + 1, exponent),
  }));
  const selected: number[] = [];
  for (let draw = 0; draw < count; draw++) {
    const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let cursor = random() * total;
    let selectedAt = candidates.length - 1;
    for (let i = 0; i < candidates.length; i++) {
      cursor -= candidates[i].weight;
      if (cursor < 0) {
        selectedAt = i;
        break;
      }
    }
    selected.push(candidates[selectedAt].index);
    candidates.splice(selectedAt, 1);
  }
  return selected;
}

export function buildScaleCorpus(options: ScaleCorpusOptions = {}): ScaleCorpus {
  const seed = options.seed ?? DEFAULT_SCALE_SEED;
  const documentCount = positiveInteger(
    options.documentCount ?? DEFAULT_SCALE_DOCUMENTS,
    'documentCount'
  );
  const blocksPerDocument = positiveInteger(
    options.blocksPerDocument ?? DEFAULT_SCALE_BLOCKS_PER_DOCUMENT,
    'blocksPerDocument'
  );
  const entityPoolSize = positiveInteger(
    options.entityPoolSize ?? DEFAULT_SCALE_ENTITY_POOL_SIZE,
    'entityPoolSize'
  );
  const zipfExponent = options.zipfExponent ?? DEFAULT_SCALE_ZIPF_EXPONENT;
  const namespace = options.namespace ?? DEFAULT_SCALE_NAMESPACE;
  if (blocksPerDocument > entityPoolSize) {
    throw new Error('blocksPerDocument cannot exceed entityPoolSize');
  }
  if (!Number.isFinite(zipfExponent) || zipfExponent <= 0) {
    throw new Error('zipfExponent must be greater than zero');
  }
  if (!namespace.trim()) throw new Error('namespace cannot be empty');

  const random = mulberry32(seed);
  const entityPool = Array.from(
    { length: entityPoolSize },
    (_, index) => `${namespace}-entity-${String(index + 1).padStart(3, '0')}`
  );
  const documents: ScaleDocument[] = [];

  for (let documentIndex = 0; documentIndex < documentCount; documentIndex++) {
    const number = String(documentIndex + 1).padStart(4, '0');
    const entityIndexes = sampleEntityIndexes(
      random,
      entityPoolSize,
      blocksPerDocument,
      zipfExponent
    );
    const blocks = entityIndexes.map((entityIndex, blockIndex): ScaleBlock => {
      const subjectName = entityPool[entityIndex];
      const detailName =
        `${namespace}-detail-${number}-${String(blockIndex + 1).padStart(2, '0')}`;
      return {
        index: blockIndex,
        subjectName,
        detailName,
        verb: 'references',
        text:
          `${subjectName} references ${detailName} in deterministic provenance `
          + `document ${number}, block ${String(blockIndex + 1).padStart(2, '0')}.`,
      };
    });
    documents.push({
      index: documentIndex,
      docKey: `${namespace}-document-${number}`,
      markdown: blocks.map(block => block.text).join('\n\n'),
      blocks,
    });
  }

  return { seed, namespace, entityPool, documents };
}

export function documentMentionCounts(corpus: ScaleCorpus): Map<string, number> {
  const counts = new Map(corpus.entityPool.map(name => [name, 0]));
  for (const document of corpus.documents) {
    for (const name of new Set(document.blocks.map(block => block.subjectName))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}
