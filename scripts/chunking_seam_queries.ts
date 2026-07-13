import OpenAI from 'openai';
import { pgPool } from '../src/config/db';

// Session 38 (STRUCTURAL_CHUNKING.md §7 item 3): the seam-query
// retrieval measurement. Eight pre-stated kernel-surface queries (the
// Session 34 §5d.3 named-surfaces mold), each with the file that
// DEFINES the surface. A query scores when a block of its defining
// file's CURRENT version ranks in the vector-search top 3 — measured
// through the exact tool shape (text-embedding-3-small →
// search_ast_nodes(vector, 3)); the top 5 are printed for diagnosis.
// Run before and after the pilot; report the two tables together.
//
// The query set is PINNED here. Do not tune queries between the
// before and after runs — that would measure the queries, not the
// chunking.

const SEAM_QUERIES: ReadonlyArray<{ query: string; definingFile: string }> = [
  {
    // The increment-2 run-1 miss class (§5f.5): the research-mode
    // telemetry wiring lives in trellis_agent.py, but monolith-block
    // embeddings surfaced trellis_tools.py blocks instead.
    query: 'retrieved addresses telemetry count in research mode',
    definingFile: 'src/rlm/trellis_agent.py',
  },
  {
    query: 'write derived insight provenance hash verification before write',
    definingFile: 'src/rlm/trellis_tools.py',
  },
  {
    query: 'submit final answer by evaluating an expression in the REPL frame',
    definingFile: 'src/rlm/trellis_answer.py',
  },
  {
    query: 'retrieval discipline budget refusal for repeated fetches',
    definingFile: 'src/rlm/trellis_tools.py',
  },
  {
    query: 'MCP server allowlist checked before any connection is dialed',
    definingFile: 'src/rlm/trellis_mcp.py',
  },
  {
    query: 'workspace segment snapshot park and seed lineage',
    definingFile: 'src/rlm/trellis_workspace.py',
  },
  {
    query: 'hash-guarded splice write back stale file refusal',
    definingFile: 'src/rlm/trellis_textedit.py',
  },
  {
    query: 'ordered extraction blocks for a stored document root',
    definingFile: 'src/rlm/trellis_blocks.py',
  },
];

const TOP_N = 5;
const TOP_K = 3; // the criterion window — the tool's own match_count

async function docKeysForNode(nodeId: string): Promise<string[]> {
  // Documents whose CURRENT version contains the block; a hit from a
  // superseded version attributes to nothing (reported as such).
  const result = await pgPool.query(
    `SELECT DISTINCT d.doc_key
       FROM document_nodes dn
       JOIN documents d ON d.root_hash = dn.root_hash
       JOIN (
         SELECT doc_key, MAX(version) AS version
           FROM documents
          GROUP BY doc_key
       ) latest ON latest.doc_key = d.doc_key AND latest.version = d.version
      WHERE dn.node_id = $1
      ORDER BY d.doc_key`,
    [nodeId]
  );
  return result.rows.map((row: { doc_key: string }) => row.doc_key);
}

async function main(): Promise<number> {
  const openai = new OpenAI();
  let inTop3 = 0;
  let embeddingTokens = 0;

  for (const { query, definingFile } of SEAM_QUERIES) {
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    embeddingTokens += embedding.usage?.total_tokens ?? 0;
    const vector = JSON.stringify(embedding.data[0].embedding);
    const hits = await pgPool.query(
      'SELECT id, content FROM search_ast_nodes($1::vector, $2)',
      [vector, TOP_N]
    );

    const definingKey = `repo:trellis:${definingFile}`;
    let rank: number | null = null;
    console.log(`\nQUERY: ${query}`);
    console.log(`  defining file: ${definingKey}`);
    for (let i = 0; i < hits.rows.length; i++) {
      const keys = await docKeysForNode(hits.rows[i].id);
      const label = keys.length > 0 ? keys.join(', ') : '(superseded or non-repo block)';
      const marker = keys.includes(definingKey) ? ' <-- defining file' : '';
      console.log(`  ${i + 1}. ${hits.rows[i].id.slice(0, 12)}…  ${label}${marker}`);
      if (rank === null && keys.includes(definingKey)) rank = i + 1;
    }
    const hit = rank !== null && rank <= TOP_K;
    if (hit) inTop3 += 1;
    console.log(`  => rank ${rank ?? `>${TOP_N}`} — ${hit ? 'IN top 3' : 'NOT in top 3'}`);
  }

  console.log(`\nSeam-query summary: ${inTop3}/${SEAM_QUERIES.length} defining files in top 3`);
  console.log(`Embedding spend: ${SEAM_QUERIES.length} calls, ${embeddingTokens} tokens (text-embedding-3-small)`);
  return 0;
}

main()
  .then(async code => {
    await pgPool.end().catch(() => {});
    process.exit(code);
  })
  .catch(async error => {
    console.error(`seam-query measurement failed: ${error instanceof Error ? error.stack : error}`);
    await pgPool.end().catch(() => {});
    process.exit(1);
  });
