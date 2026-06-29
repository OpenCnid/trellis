import * as crypto from 'crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

export interface ASTNode {
  id: string; // SHA-256
  type: string;
  content?: string;
  metadata?: {
    page_number?: number;
    bounding_box?: number[][];
  };
  children?: ASTNode[];
}

function generateHash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function createASTNode(type: string, content?: string, children?: ASTNode[], metadata?: ASTNode['metadata']): ASTNode {
  let hashData = type;
  if (content) {
    hashData += `:${content}`;
  }
  if (metadata) {
    hashData += `:${JSON.stringify(metadata)}`;
  }
  if (children && children.length > 0) {
    const childrenHashes = children.map(c => c.id).join('');
    hashData += `:${childrenHashes}`;
  }
  
  return {
    id: generateHash(hashData),
    type,
    ...(content && { content }),
    ...(children && children.length > 0 && { children }),
    ...(metadata && { metadata })
  };
}

function processMarkdownNode(node: any): ASTNode {
  if (!node.children || node.children.length === 0) {
    const content = node.value || '';
    return createASTNode(node.type, content);
  }
  const children = node.children.map(processMarkdownNode);
  return createASTNode(node.type, undefined, children);
}

export function parseMarkdownToAST(markdown: string): ASTNode {
  const processor = unified().use(remarkParse);
  const tree = processor.parse(markdown);
  return processMarkdownNode(tree);
}

export function parseUnstructuredJSONToAST(elements: any[]): ASTNode {
  const children: ASTNode[] = elements.map(el => {
    const type = el.type || 'Element';
    const content = el.text || '';
    const metadata: ASTNode['metadata'] = {};
    
    if (el.metadata) {
      if (typeof el.metadata.page_number === 'number') {
        metadata.page_number = el.metadata.page_number;
      }
      if (el.metadata.coordinates && el.metadata.coordinates.points) {
        metadata.bounding_box = el.metadata.coordinates.points;
      }
    }
    
    // Only pass metadata if it has keys
    const finalMetadata = Object.keys(metadata).length > 0 ? metadata : undefined;
    
    return createASTNode(type, content, undefined, finalMetadata);
  });
  
  return createASTNode('root', undefined, children);
}
