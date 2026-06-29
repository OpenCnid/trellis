import * as crypto from 'crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

interface ASTNode {
  id: string; // SHA-256
  type: string;
  content?: string;
  children?: ASTNode[];
}

function generateHash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function processNode(node: any): ASTNode {
  // If the node doesn't have children, it's a leaf node.
  if (!node.children || node.children.length === 0) {
    const content = node.value || '';
    const hashData = `${node.type}:${content}`;
    return {
      id: generateHash(hashData),
      type: node.type,
      content,
    };
  }

  // Branch node
  const children = node.children.map(processNode);
  // Merkle tree: Hash of the current node's type + concatenation of children hashes
  const childrenHashes = children.map((c: ASTNode) => c.id).join('');
  const hashData = `${node.type}:${childrenHashes}`;
  
  return {
    id: generateHash(hashData),
    type: node.type,
    children,
  };
}

const processor = unified().use(remarkParse);

const md1 = `
# Title

Paragraph 1

Paragraph 2
`;

const md2 = `
# Title

Paragraph 1 edited

Paragraph 2
`;

async function runTest() {
  console.log("--- TEST 1: Single Batch Parsing ---");
  const tree1 = processor.parse(md1.trim());
  const ast1 = processNode(tree1);
  console.log("Merkle Hash AST (3 Nodes + Root):\n", JSON.stringify(ast1, null, 2));

  console.log("\n--- TEST 2: O(1) Shift Validation ---");
  const tree2 = processor.parse(md2.trim());
  const ast2 = processNode(tree2);
  
  console.log("AST1 Root Hash:", ast1.id);
  console.log("AST2 Root Hash:", ast2.id);
  console.log("Root Hashes identical?", ast1.id === ast2.id); 
  
  // Both trees have a root node with 3 children: heading, paragraph, paragraph
  const headingEqual = ast1.children![0].id === ast2.children![0].id;
  const p1Equal = ast1.children![1].id === ast2.children![1].id;
  const p2Equal = ast1.children![2].id === ast2.children![2].id;
  
  console.log("\nSibling Hash Comparison (O(1) Shift Proof):");
  console.log(`- Heading hash remains identical: ${headingEqual} (${ast1.children![0].id})`);
  console.log(`- Paragraph 1 (edited) hash changes: ${!p1Equal}`);
  console.log(`  - AST1: ${ast1.children![1].id}`);
  console.log(`  - AST2: ${ast2.children![1].id}`);
  console.log(`- Paragraph 2 hash remains identical: ${p2Equal} (${ast1.children![2].id})`);
}

runTest().catch(console.error);
