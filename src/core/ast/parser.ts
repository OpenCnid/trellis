import * as crypto from 'crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

export interface ASTNode {
  id: string; // SHA-256
  type: string;
  content?: string;
  children?: ASTNode[];
}

function generateHash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function processNode(node: any): ASTNode {
  if (!node.children || node.children.length === 0) {
    const content = node.value || '';
    const hashData = `${node.type}:${content}`;
    return { id: generateHash(hashData), type: node.type, content };
  }
  const children = node.children.map(processNode);
  const childrenHashes = children.map((c: ASTNode) => c.id).join('');
  const hashData = `${node.type}:${childrenHashes}`;
  return { id: generateHash(hashData), type: node.type, children };
}

export function parseMarkdownToAST(markdown: string): ASTNode {
  const processor = unified().use(remarkParse);
  const tree = processor.parse(markdown);
  return processNode(tree);
}
