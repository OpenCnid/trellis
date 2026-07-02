import { runRlmQuery } from '../src/benchmarks/oolong/rlm_client';

// Task 2b: REPL Error-Trapping Feedback Routing.
//
// Sends the RLM a query that FORCES a genuinely invalid Cypher execution
// first (syntax error — note that merely matching a non-existent label
// would NOT throw in Neo4j, it just returns 0 rows). The database
// exception must surface as a Python traceback inside the REPL, be routed
// back into the agent's conversation, and the agent must self-correct and
// produce a valid FINAL_ANSWER within its iteration budget (max 5).

const BROKEN_CYPHER = "MATCH (q:Question WHERE q.category = 'LOC' RETRUN count(q AS n";

const ADVERSARIAL_QUERY =
  `Step 1: Execute EXACTLY this Cypher string first, verbatim and unmodified, using trellis_neo4j.run_cypher: ` +
  `${BROKEN_CYPHER} ` +
  `Step 2: After observing what happens, figure out the correct query and determine how many ` +
  `Question nodes with category 'LOC' exist in the graph. Reply with FINAL_ANSWER: <integer>.`;

const EXPECTED_LOC_COUNT = 50;

async function main(): Promise<void> {
  console.log('======================================================');
  console.log('Task 2b: REPL Error-Trapping Feedback Routing');
  console.log('======================================================');
  console.log('Adversarial query dispatched to /api/rlm-stream ...\n');

  const result = await runRlmQuery(ADVERSARIAL_QUERY, { echo: true, timeoutMs: 10 * 60 * 1000 });

  console.log('\n------------------------------------------------------');
  console.log('Verification checks:');

  const combined = result.stdout + result.stderr;

  // 1. The intentionally broken query actually threw a database exception.
  //    'Neo4jError while executing Cypher' is the exact marker raised by
  //    trellis_tools.run_cypher — it cannot come from the prompt echo.
  const sawDbError = combined.includes('Neo4jError while executing Cypher');
  console.log(`  [${sawDbError ? 'PASS' : 'FAIL'}] Database exception raised and surfaced in REPL output.`);

  // 2. The agent kept going and produced a final answer
  const hasFinal = result.finalAnswer !== null;
  console.log(`  [${hasFinal ? 'PASS' : 'FAIL'}] Agent produced a FINAL_ANSWER after the failure (self-correction).`);

  // 3. The corrected query reached the real data
  const answerInt = hasFinal ? parseInt(result.finalAnswer!.replace(/[^\d-]/g, ''), 10) : NaN;
  const correct = answerInt === EXPECTED_LOC_COUNT;
  console.log(`  [${correct ? 'PASS' : 'FAIL'}] Corrected query returned the true LOC count (expected ${EXPECTED_LOC_COUNT}, got ${Number.isNaN(answerInt) ? 'n/a' : answerInt}).`);

  // 4. Within the iteration budget, with telemetry for the runner
  const iters = result.iterations;
  const withinBudget = iters !== null && iters <= 5;
  console.log(`  [${withinBudget ? 'PASS' : 'FAIL'}] Self-correction completed within the iteration budget (${iters ?? 'n/a'}/5 iterations).`);
  const hasTelemetry = result.telemetry !== null;
  console.log(`  [${hasTelemetry ? 'PASS' : 'FAIL'}] TRELLIS_TELEMETRY payload emitted (tokens: ${result.telemetry ? result.telemetry.input_tokens + result.telemetry.output_tokens : 'n/a'}, subcalls: ${result.telemetry?.subcall_count ?? 'n/a'}).`);

  if (!(sawDbError && hasFinal && correct && withinBudget && hasTelemetry)) {
    throw new Error('Task 2b verification failed — see checks above.');
  }
  console.log('\n✅ VERIFIED: exception capture -> feedback injection -> self-correction loop works end to end.');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(`\nTASK 2b FAILED: ${err.message}`);
    process.exit(1);
  });
