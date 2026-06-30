import express from 'express';
import { parseMarkdownToAST, parseUnstructuredJSONToAST, ASTNode } from '../core/ast/parser.js';
import { pgPool, neo4jDriver } from '../config/db.js';
import { extractionQueue } from '../workers/queue.js';
import multer from 'multer';
import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import OpenAI from 'openai';

const execFileAsync = util.promisify(execFile);
const upload = multer({ dest: 'uploads/' });

const app = express();
// Only accept raw text/markdown if content-type is text/*
app.use(express.text({ type: ['text/*', 'application/json', 'application/x-www-form-urlencoded'] }));

// Helper to recursively flatten the AST
function flattenAST(node: ASTNode, acc: ASTNode[] = []): ASTNode[] {
  acc.push(node);
  if (node.children) {
    for (const child of node.children) {
      flattenAST(child, acc);
    }
  }
  return acc;
}

app.post('/ingest', upload.single('file'), async (req, res) => {
  try {
    let rootNode: ASTNode;
    
    if (req.file) {
      // PDF File Upload Path
      const pythonScript = path.resolve('scripts/parse_pdf.py');
      const { stdout } = await execFileAsync('python', [pythonScript, req.file.path], {
        maxBuffer: 1024 * 1024 * 50 // 50MB buffer for large JSON outputs
      });
      
      const elements = JSON.parse(stdout);
      if (elements.error) {
        throw new Error(`Python script error: ${elements.error}\n${elements.traceback || ''}`);
      }
      
      rootNode = parseUnstructuredJSONToAST(elements);
    } else {
      // Raw Markdown String Path
      const markdown = req.body;
      if (!markdown || typeof markdown !== 'string') {
        return res.status(400).send('Expected raw Markdown string in body or a file upload');
      }
      rootNode = parseMarkdownToAST(markdown);
    }
    
    // Flatten AST
    const allNodes = flattenAST(rootNode);

    // 2. Persist AST to PostgreSQL
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      for (const node of allNodes) {
        await client.query(`
          INSERT INTO ast_nodes (id, document_id, data)
          VALUES ($1, $2, $3)
          ON CONFLICT (id) DO NOTHING
        `, [node.id, rootNode.id, JSON.stringify(node)]);
      }
      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    // 3. Fan Out to BullMQ for leaf nodes
    const leafNodes = allNodes.filter(n => n.content && typeof n.content === 'string');
    for (const leaf of leafNodes) {
      await extractionQueue.add('extract', {
        astNodeId: leaf.id,
        text: leaf.content
      });
    }

    // 4. Respond with 202 Accepted and the Root AST Node ID
    res.status(202).json({
      message: 'Accepted',
      rootId: rootNode.id,
      totalNodes: allNodes.length,
      leafNodesQueued: leafNodes.length
    });
  } catch (error: any) {
    console.error("Error during ingestion:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/retrieve', async (req, res) => {
  const entityName = req.query.entity;
  if (!entityName || typeof entityName !== 'string') {
    return res.status(400).send('Expected entity query parameter');
  }

  const session = neo4jDriver.session();
  let sourceNodeIds = new Set<string>();
  let graphData: any[] = [];
  try {
    const neoRes = await session.run(`
      MATCH (e:Entity)-[r:ACTION]-(neighbor:Entity)
      WHERE e.name = toLower($entityName)
      RETURN e, r, neighbor
    `, { entityName });

    for (const record of neoRes.records) {
      const e = record.get('e').properties;
      const r = record.get('r').properties;
      const neighbor = record.get('neighbor').properties;
      graphData.push({ e, r, neighbor });

      e.sourceNodeIds?.forEach((id: string) => sourceNodeIds.add(id));
      r.sourceNodeIds?.forEach((id: string) => sourceNodeIds.add(id));
      neighbor.sourceNodeIds?.forEach((id: string) => sourceNodeIds.add(id));
    }
  } catch (error) {
    console.error("Neo4j retrieve error:", error);
    return res.status(500).json({ error: 'Neo4j retrieve error' });
  } finally {
    await session.close();
  }

  const idsArray = Array.from(sourceNodeIds);
  const pgClient = await pgPool.connect();
  let provenance: any[] = [];
  let fallback_active = false;

  try {
    if (idsArray.length === 0) {
      console.log(`[Retrieve] No graph matches for '${entityName}'. Triggering Vector Fallback.`);
      fallback_active = true;
      const openai = new OpenAI();
      const embedRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: entityName,
      });
      const queryEmbedding = embedRes.data[0].embedding;

      const pgRes = await pgClient.query(`
        SELECT id, data->>'content' as content 
        FROM ast_nodes 
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1 
        LIMIT 3;
      `, [JSON.stringify(queryEmbedding)]);
      provenance = pgRes.rows;
    } else {
      const pgRes = await pgClient.query(`
        SELECT id, data->>'content' as content 
        FROM ast_nodes 
        WHERE id = ANY($1);
      `, [idsArray]);
      provenance = pgRes.rows;
    }
  } catch (error) {
    console.error("Postgres retrieve error:", error);
    return res.status(500).json({ error: 'Postgres retrieve error' });
  } finally {
    pgClient.release();
  }

  return res.json({
    graph: graphData,
    provenance,
    fallback_active
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Trellis API Server running on port ${PORT}`);
});
