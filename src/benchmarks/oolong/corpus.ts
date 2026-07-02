import { parseMarkdownToAST, ASTNode } from '../../core/ast/parser';
import { OolongRecord } from './schema';

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

export interface OolongCorpus {
  documentId: string; // Merkle root hash of the full corpus document
  root: ASTNode;
  bound: BoundRecord[];
}

export function recordToMarkdown(record: OolongRecord): string {
  return `# ${record.id}\n\n${record.text}`;
}

export function nodeText(node: ASTNode): string {
  if (node.content !== undefined) return node.content;
  return (node.children ?? []).map(nodeText).join('');
}

export function flattenAST(node: ASTNode, acc: ASTNode[] = []): ASTNode[] {
  acc.push(node);
  for (const child of node.children ?? []) {
    flattenAST(child, acc);
  }
  return acc;
}

// Parses the entire corpus as one markdown document (a flat sequence of
// heading + paragraph blocks under a single root) and binds each pair of
// blocks back to its source record, validating the round trip.
export function buildCorpus(records: OolongRecord[]): OolongCorpus {
  const fullMarkdown = records.map(recordToMarkdown).join('\n\n');
  const root = parseMarkdownToAST(fullMarkdown);

  const blocks = root.children ?? [];
  if (blocks.length !== records.length * 2) {
    throw new Error(
      `Corpus binding failure: expected ${records.length * 2} block nodes ` +
      `(heading + paragraph per record), parser produced ${blocks.length}.`
    );
  }

  const bound: BoundRecord[] = records.map((record, i) => {
    const heading = blocks[i * 2];
    const paragraph = blocks[i * 2 + 1];

    if (heading.type !== 'heading' || nodeText(heading) !== record.id) {
      throw new Error(`Corpus binding failure at record ${record.id}: heading mismatch (got ${heading.type} "${nodeText(heading)}").`);
    }
    if (paragraph.type !== 'paragraph' || nodeText(paragraph) !== record.text) {
      throw new Error(`Corpus binding failure at record ${record.id}: paragraph mismatch (got ${paragraph.type} "${nodeText(paragraph)}").`);
    }

    return { record, markdown: recordToMarkdown(record), heading, paragraph };
  });

  return { documentId: root.id, root, bound };
}
