import type { Driver } from 'neo4j-driver';

// Phase 5 Milestone 2: entity namespace separation.
//
// The flat :Entity namespace keys question ids, cities, and TREC labels
// by lowercased name alone — "paris" the city and "Paris" a person
// collide at scale, and the verifier needs to find classification
// beliefs structurally (kind = 'question' subjects of has_category
// edges), not by regex-matching names. Going forward the Python write
// tools stamp `kind` on every write; this module is the one-shot
// migration that stamps the graph written before kinds existed.
//
// Rules (applied in priority order, never overwriting an existing kind):
//   1. name matches q_<digits>                      -> 'question'
//   2. name is one of the six TREC labels           -> 'category_label'
//   3. name matches a known :Concept node's name    -> 'concept'
//   4. everything else                              -> 'generic'

export const TREC_LABELS = ['abbr', 'enty', 'desc', 'hum', 'loc', 'num'];
const QUESTION_ID_PATTERN = 'q_\\d+'; // Cypher =~ is a full-string match

export interface KindMigrationResult {
  question: number;
  category_label: number;
  concept: number;
  generic: number;
}

export interface KindAudit {
  counts: Record<string, number>;
  unstamped: number;
  total: number;
}

export async function migrateEntityKinds(driver: Driver): Promise<KindMigrationResult> {
  const session = driver.session();
  try {
    const question = await session.executeWrite(tx =>
      tx.run(
        `MATCH (n:Entity) WHERE n.kind IS NULL AND n.name =~ $pattern
         SET n.kind = 'question' RETURN count(n) AS c`,
        { pattern: QUESTION_ID_PATTERN }
      )
    );
    const categoryLabel = await session.executeWrite(tx =>
      tx.run(
        `MATCH (n:Entity) WHERE n.kind IS NULL AND n.name IN $labels
         SET n.kind = 'category_label' RETURN count(n) AS c`,
        { labels: TREC_LABELS }
      )
    );
    const concept = await session.executeWrite(tx =>
      tx.run(
        `MATCH (c:Concept) WITH collect(DISTINCT toLower(c.name)) AS conceptNames
         MATCH (n:Entity) WHERE n.kind IS NULL AND n.name IN conceptNames
         SET n.kind = 'concept' RETURN count(n) AS c`
      )
    );
    const generic = await session.executeWrite(tx =>
      tx.run(`MATCH (n:Entity) WHERE n.kind IS NULL SET n.kind = 'generic' RETURN count(n) AS c`)
    );
    return {
      question: question.records[0].get('c').toNumber(),
      category_label: categoryLabel.records[0].get('c').toNumber(),
      concept: concept.records[0].get('c').toNumber(),
      generic: generic.records[0].get('c').toNumber()
    };
  } finally {
    await session.close();
  }
}

// Read-back audit: kind distribution over the whole :Entity namespace.
// A successful migration leaves zero unstamped entities.
export async function auditEntityKinds(driver: Driver): Promise<KindAudit> {
  const session = driver.session();
  try {
    const res = await session.executeRead(tx =>
      tx.run(
        `MATCH (n:Entity)
         RETURN coalesce(n.kind, '__unstamped__') AS kind, count(n) AS c
         ORDER BY kind`
      )
    );
    const counts: Record<string, number> = {};
    let unstamped = 0;
    let total = 0;
    for (const rec of res.records) {
      const kind = rec.get('kind') as string;
      const c = rec.get('c').toNumber();
      total += c;
      if (kind === '__unstamped__') unstamped = c;
      else counts[kind] = c;
    }
    return { counts, unstamped, total };
  } finally {
    await session.close();
  }
}
