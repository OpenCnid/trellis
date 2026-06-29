import * as crypto from 'crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { z } from 'zod';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';

const openai = new OpenAI();

// --- AST HASHING ---

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

// --- SCHEMAS ---

const EntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  sourceNodeIds: z.array(z.string())
});

const ActionSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  verb: z.string(),
  objectId: z.string(),
  sourceNodeIds: z.array(z.string())
});

const GraphSchema = z.object({
  entities: z.array(EntitySchema),
  actions: z.array(ActionSchema)
});

type Graph = z.infer<typeof GraphSchema>;

// --- EXECUTION ---

async function runScalingPoC() {
  // 1. Realistic Dense Text (Disney-Fox merger)
  const markdown = `On December 14, 2017, The Walt Disney Company announced a definitive agreement to acquire 21st Century Fox for $52.4 billion in stock. The acquisition included the 20th Century Fox film and television studios, U.S. cable networks such as FX and National Geographic, and international networks like Star India.

Before the acquisition closed, Comcast made an all-cash offer of $65 billion for the Fox assets, initiating a bidding war. Disney ultimately increased its bid to $71.3 billion, heavily outbidding Comcast, which subsequently dropped out to focus on acquiring Sky plc.

The deal officially closed on March 20, 2019. Fox Corporation was spun off as a standalone company to retain assets like Fox News, Fox Sports, and the Fox network, which Disney could not legally own due to antitrust regulations and FCC ownership rules.`;

  const processor = unified().use(remarkParse);
  const tree = processor.parse(markdown);
  const ast = processNode(tree);

  // Filter out just the paragraph nodes for our sample
  const paragraphs = ast.children!.filter(c => c.type === 'paragraph');
  const totalNodes = paragraphs.length;

  // We explicitly guide the LLM to avoid graph bloat
  let promptData = "Extract the entities and actions from the following texts. You must map the provided AST Node IDs to the 'sourceNodeIds' array. Extract ONLY the most critical, macro-level business entities and relationships. Do not extract trivial details, adjectives, or granular properties. Be extremely sparse to avoid graph bloat.\n\n";
  
  paragraphs.forEach((p, idx) => {
    promptData += `--- Text ${idx + 1} ---\nContent: ${p.children![0].content}\nAST Node ID: ${p.id}\n\n`;
  });

  console.log("Sending dense enterprise text to LLM...");

  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini-2026-03-17",
    messages: [
      { role: "system", content: "You are an expert GraphRAG extraction engine that strictly outputs sparse, high-level business logic graphs." },
      { role: "user", content: promptData }
    ],
    response_format: zodResponseFormat(GraphSchema, "graph_extraction"),
    temperature: 0.1,
  });

  const rawContent = completion.choices[0].message.content!;
  const graph: Graph = JSON.parse(rawContent);

  // 2. Extract Telemetry
  const promptTokens = completion.usage?.prompt_tokens || 0;
  const completionTokens = completion.usage?.completion_tokens || 0;
  
  const totalEntities = graph.entities.length;
  const totalEdges = graph.actions.length;

  const entityDensity = (totalEntities / promptTokens) * 100;
  const edgeDensity = (totalEdges / promptTokens) * 100;

  console.log("\n--- Telemetry Metrics ---");
  console.log(`1. Total AST Nodes Processed: ${totalNodes}`);
  console.log(`2. Total Prompt Tokens: ${promptTokens}`);
  console.log(`3. Total Entities Extracted: ${totalEntities}`);
  console.log(`4. Total Edges (Actions) Extracted: ${totalEdges}`);
  console.log(`5. Entity Density: ${entityDensity.toFixed(2)} entities per 100 tokens`);
  console.log(`6. Edge Density: ${edgeDensity.toFixed(2)} edges per 100 tokens`);

  if (edgeDensity < 5) {
    console.log("\n[BLOAT CHECK PASSED] Edge density is well under 5 edges per 100 tokens.");
  } else {
    console.log("\n[BLOAT CHECK FAILED] Graph is too dense!");
  }

  // 3. Extrapolation
  console.log("\n--- The 1-Million Node Extrapolation ---");
  const TARGET_NODES = 1_000_000;
  const multiplier = TARGET_NODES / totalNodes;
  
  const projectedPromptTokens = promptTokens * multiplier;
  const projectedCompletionTokens = completionTokens * multiplier;
  const projectedEdges = totalEdges * multiplier;
  const projectedEntities = totalEntities * multiplier;

  const inputCost = (projectedPromptTokens / 1_000_000) * 0.15;
  const outputCost = (projectedCompletionTokens / 1_000_000) * 0.60;
  const totalCost = inputCost + outputCost;

  console.log(`If we process a corpus of 1,000,000 AST Nodes:`);
  console.log(`- Projected Database Edges: ${projectedEdges.toLocaleString()}`);
  console.log(`- Projected Database Entities: ${projectedEntities.toLocaleString()}`);
  console.log(`- Projected Input Tokens: ${projectedPromptTokens.toLocaleString()}`);
  console.log(`- Projected Output Tokens: ${projectedCompletionTokens.toLocaleString()}`);
  console.log(`- Projected LLM Compute Cost: $${totalCost.toFixed(2)} USD`);
}

runScalingPoC().catch(console.error);
