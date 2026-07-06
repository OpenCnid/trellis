import { parseMarkdownToAST, ASTNode } from '../../core/ast/parser';
import { nodeText, flattenAST } from '../../core/ast/traverse';
import { OolongPassage, OolongRecord } from './schema';

// Traversal helpers moved to src/core/ast/traverse.ts (shared with the
// API server); re-exported here so existing imports keep working.
export { nodeText, flattenAST };

// Binds a dataset record to the physical AST nodes the parser derived
// for it. All hashes come from parseMarkdownToAST — never computed here
// (Golden Rule of the AST).
export interface BoundRecord {
  record: OolongRecord;
  // The standalone markdown snippet for this record. Re-parsing it must
  // reproduce the exact same block-node hashes (content addressing makes
  // block IDs context-free).
  markdown: string;
  heading: ASTNode;
  paragraph: ASTNode;
}

// v2: a distractor prose passage bound to its physical blocks, the
// same heading + paragraph shape as a question record.
export interface BoundPassage {
  passage: OolongPassage;
  markdown: string;
  heading: ASTNode;
  paragraph: ASTNode;
}

export interface OolongCorpus {
  documentId: string; // Merkle root hash of the full corpus document
  root: ASTNode;
  bound: BoundRecord[];
  // Empty for v1 datasets (no passages).
  boundPassages: BoundPassage[];
}

export function recordToMarkdown(record: Pick<OolongRecord, 'id' | 'text'>): string {
  return `# ${record.id}\n\n${record.text}`;
}

// Parses the entire corpus as one markdown document (a flat sequence of
// heading + paragraph blocks under a single root) and binds each pair of
// blocks back to its source record, validating the round trip. v2
// distractor passages follow the question records in the document and
// bind through the identical heading + paragraph round trip.
export function buildCorpus(records: OolongRecord[], passages: OolongPassage[] = []): OolongCorpus {
  const items: Array<{ id: string; text: string }> = [...records, ...passages];
  const fullMarkdown = items.map(recordToMarkdown).join('\n\n');
  const root = parseMarkdownToAST(fullMarkdown);

  const blocks = root.children ?? [];
  if (blocks.length !== items.length * 2) {
    throw new Error(
      `Corpus binding failure: expected ${items.length * 2} block nodes ` +
      `(heading + paragraph per record), parser produced ${blocks.length}.`
    );
  }

  const bindAt = (i: number, id: string, text: string): { heading: ASTNode; paragraph: ASTNode } => {
    const heading = blocks[i * 2];
    const paragraph = blocks[i * 2 + 1];
    if (heading.type !== 'heading' || nodeText(heading) !== id) {
      throw new Error(`Corpus binding failure at record ${id}: heading mismatch (got ${heading.type} "${nodeText(heading)}").`);
    }
    if (paragraph.type !== 'paragraph' || nodeText(paragraph) !== text) {
      throw new Error(`Corpus binding failure at record ${id}: paragraph mismatch (got ${paragraph.type} "${nodeText(paragraph)}").`);
    }
    return { heading, paragraph };
  };

  const bound: BoundRecord[] = records.map((record, i) => ({
    record,
    markdown: recordToMarkdown(record),
    ...bindAt(i, record.id, record.text)
  }));

  const boundPassages: BoundPassage[] = passages.map((passage, j) => ({
    passage,
    markdown: recordToMarkdown(passage),
    ...bindAt(records.length + j, passage.id, passage.text)
  }));

  return { documentId: root.id, root, bound, boundPassages };
}
