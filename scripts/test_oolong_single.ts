import { z } from 'zod';
import { parseMarkdownToAST, ASTNode } from '../src/core/ast/parser';

// ============================================================
// Task 1a: Single Sample Record Parser
// ============================================================

// Architecture Invariant 3: validation strictly at the boundary.
// Raw JSON never travels deeper than this Zod schema.
const TREC_COARSE_CATEGORIES = ['ABBR', 'ENTY', 'DESC', 'HUM', 'LOC', 'NUM'] as const;

const OolongRecordSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  category: z.enum(TREC_COARSE_CATEGORIES)
});

type OolongRecord = z.infer<typeof OolongRecordSchema>;

const rawJsonEntry = `{
  "id": "q_104",
  "text": "What is the capital of France?",
  "category": "LOC"
}`;

function parseOolongRecord(rawJson: string): OolongRecord {
  return OolongRecordSchema.parse(JSON.parse(rawJson));
}

console.log('======================================================');
console.log('Task 1a: Single Sample Record Parser');
console.log('======================================================');

const record = parseOolongRecord(rawJsonEntry);

console.log(`  id:       ${record.id}`);
console.log(`  text:     ${record.text}`);
console.log(`  category: ${record.category} (TREC coarse label)`);
console.log('  ✅ Schema adherence verified via Zod.');

// ============================================================
// Task 1b: Single Record Merkle Hash Verification
// ============================================================

console.log('\n======================================================');
console.log('Task 1b: Single Record Merkle Hash Verification');
console.log('======================================================');

function recordToMarkdown(rec: OolongRecord): string {
  return `# ${rec.id}\n\n${rec.text}`;
}

const markdown = recordToMarkdown(record);
console.log('  Markdown representation:');
for (const line of markdown.split('\n')) {
  console.log(`  | ${line}`);
}

const referenceNode: ASTNode = parseMarkdownToAST(markdown);
const referenceHash = referenceNode.id;

// Idempotency assertion: the Merkle math invariant demands that the
// same content always derives the same SHA-256 ID.
const RUNS = 10;
for (let i = 1; i <= RUNS; i++) {
  const node = parseMarkdownToAST(recordToMarkdown(record));
  if (node.id !== referenceHash) {
    console.error(`  ❌ IDEMPOTENCY FAILURE on run ${i}: ${node.id} !== ${referenceHash}`);
    process.exit(1);
  }
  console.log(`  Run ${String(i).padStart(2)}/${RUNS}: ${node.id} ✓`);
}

console.log(`\n  ✅ Idempotency verified: ${RUNS}/${RUNS} runs produced an identical Merkle hash.`);
console.log('\n======================================================');
console.log('Deterministic physical hash of the first OOLONG AST node:');
console.log(`  ${referenceHash}`);
console.log('======================================================');
