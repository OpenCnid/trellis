import * as crypto from 'crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { z } from 'zod';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';

const openai = new OpenAI();

// --- AST HASHING (From poc.ts) ---

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
  id: z.string().describe("A unique UUID for this entity"),
  name: z.string().describe("The extracted name of the entity"),
  type: z.string().describe("The type of entity"),
  sourceNodeIds: z.array(z.string()).describe("MUST contain all AST Node IDs where this entity was mentioned")
});

const ActionSchema = z.object({
  id: z.string().describe("A unique UUID for this action"),
  subjectId: z.string().describe("The UUID of the subject Entity"),
  verb: z.string().describe("The relationship or action verb"),
  objectId: z.string().describe("The UUID of the object Entity"),
  sourceNodeIds: z.array(z.string()).describe("MUST contain the AST Node ID where this action was mentioned")
});

const GraphSchema = z.object({
  entities: z.array(EntitySchema),
  actions: z.array(ActionSchema)
});

type Graph = z.infer<typeof GraphSchema>;

// --- TRAVERSAL ---

function findPath(startName: string, endName: string, graph: Graph) {
  const startNode = graph.entities.find(e => e.name.toLowerCase() === startName.toLowerCase());
  const endNode = graph.entities.find(e => e.name.toLowerCase() === endName.toLowerCase());

  if (!startNode || !endNode) {
    return { path: null, sources: [] };
  }

  // Breadth-First Search
  const queue: { currentId: string; path: any[]; sources: string[] }[] = [];
  queue.push({ 
    currentId: startNode.id, 
    path: [{ type: 'entity', entity: startNode }], 
    sources: [...startNode.sourceNodeIds] 
  });

  const visited = new Set<string>([startNode.id]);

  while (queue.length > 0) {
    const { currentId, path, sources } = queue.shift()!;

    if (currentId === endNode.id) {
      // Deduplicate sources
      return { path, sources: Array.from(new Set(sources)) };
    }

    // Find all outgoing actions
    const outgoingActions = graph.actions.filter(a => a.subjectId === currentId);
    
    for (const action of outgoingActions) {
      if (!visited.has(action.objectId)) {
        visited.add(action.objectId);
        const nextEntity = graph.entities.find(e => e.id === action.objectId)!;
        
        queue.push({
          currentId: action.objectId,
          path: [...path, { type: 'action', action }, { type: 'entity', entity: nextEntity }],
          sources: [...sources, ...action.sourceNodeIds, ...nextEntity.sourceNodeIds]
        });
      }
    }
  }

  return { path: null, sources: [] };
}

// --- MAIN EXECUTION ---

async function run() {
  // 1. Parse & Hash
  const markdown = "AlphaCorp acquired BetaTech.\n\nBetaTech owns GammaInc.";
  const processor = unified().use(remarkParse);
  const tree = processor.parse(markdown);
  const ast = processNode(tree);

  // ast.children[0] is paragraph 1, ast.children[1] is paragraph 2
  const p1 = ast.children![0];
  const p2 = ast.children![1];

  console.log("--- 1. Deterministic Hashing ---");
  console.log("Paragraph 1 Hash:", p1.id);
  console.log("Paragraph 2 Hash:", p2.id);

  // 2. Extract
  const prompt = `Extract the entities and actions from the following texts. You must map the provided AST Node IDs to the 'sourceNodeIds' array of every entity and action you extract. If an entity appears in multiple texts, merge it into a single entity and include all corresponding AST Node IDs in its 'sourceNodeIds' array.

Input Data:
---
Text: AlphaCorp acquired BetaTech.
AST Node ID: ${p1.id}
---
Text: BetaTech owns GammaInc.
AST Node ID: ${p2.id}
---`;

  console.log("\n--- 2. LLM Extraction ---");
  console.log("Extracting and mapping via LLM...");
  
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini-2026-03-17",
    messages: [
      { role: "system", content: "You are an expert GraphRAG extraction engine. You strictly follow schemas and precisely track source AST Node IDs." },
      { role: "user", content: prompt }
    ],
    response_format: zodResponseFormat(GraphSchema, "graph_extraction"),
    temperature: 0.1,
  });

  const rawContent = completion.choices[0].message.content;
  if (!rawContent) {
    console.error("No content from LLM");
    return;
  }
  const graph: Graph = JSON.parse(rawContent);

  console.log("Global In-Memory Graph:");
  console.log(JSON.stringify(graph, null, 2));

  // 3. Traverse
  console.log("\n--- 3. Deterministic Traversal ---");
  console.log("Query: What is the connection between AlphaCorp and GammaInc?");
  
  const result = findPath("AlphaCorp", "GammaInc", graph);

  if (result.path) {
    const pathStr = result.path.map((step: any) => {
      if (step.type === 'entity') return step.entity.name;
      if (step.type === 'action') return step.action.verb;
    }).join(" -> ");

    console.log("\nSuccess! Path found:");
    console.log(pathStr);
    console.log("\nUltimate Provenance Check (Source Node IDs involved in this reasoning chain):");
    result.sources.forEach(source => console.log("- " + source));
    
    // Additional validation check for BetaTech merging
    const betaTech = graph.entities.find(e => e.name.toLowerCase() === "betatech");
    if (betaTech && betaTech.sourceNodeIds.includes(p1.id) && betaTech.sourceNodeIds.includes(p2.id)) {
      console.log("\n[Validation PASSED] BetaTech successfully merged citations from both paragraphs.");
    } else {
      console.log("\n[Validation WARNING] BetaTech did NOT perfectly merge citations.");
    }

  } else {
    console.log("\nFailed to find path.");
  }
}

run().catch(console.error);
