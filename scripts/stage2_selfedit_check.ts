// Session 35 (REPOSITORY_INGESTION_REPORT.md §5e): the stage-2
// self-edit harness CLI. Two modes over the pure checker in
// src/benchmarks/selfedit/check.ts:
//
//   --pre       refresh-before-use gate: target entities exist and are
//               uncontested (including their attached ACTION edges) and
//               the named files' substrate documents are present.
//   (default)   post-run verification of the named failure mode
//               "graph-misdirected editing": exactly the named files
//               changed under the edit root, and the run's recorded
//               evidence edge is present, uncontested, and cites only
//               hashes live in the CURRENT version of a document that
//               bridges to a named file. Since Session 37 the post-run
//               mode also runs the parse gate (§5f): every named file
//               with a wired parser (.py via the configured
//               interpreter, .ts/.js via a TypeScript single-file
//               parse) must still parse — the Session 36 run-1 escape
//               (a syntax-broken named file) is a typed finding now,
//               not a human catch. Since Session 39 the post-run mode
//               also runs the comment-class diff gate (§5g) for files
//               the increment DECLARED comment-class via
//               --comment-class: every changed line in the named
//               file's diff (removed and added sides both) must be
//               blank or a line comment — the Session 37 run-2 escape
//               (a comment splice that dropped a parseable executable
//               neighbor) is a typed finding now, not a human catch.
//
// Read-only everywhere: the git surface is exactly `git status
// --porcelain` plus, for declared comment-class files, `git diff --
// <file>` (the toolkit itself never touches git — the harness merely
// reads the working-tree state the human will review), and both
// database clients issue reads only. Non-empty findings exit 1.
//
// Usage:
//   tsx scripts/stage2_selfedit_check.ts --pre \
//     --entity get_retrieved_addresses \
//     --named-file src/rlm/trellis_tools.py [--doc-prefix repo:trellis:]
//   tsx scripts/stage2_selfedit_check.ts \
//     --edit-root <checkout> --named-file src/rlm/trellis_agent.py \
//     --comment-class src/rlm/trellis_agent.py \
//     --subject trellis_agent --verb wires \
//     --object get_retrieved_addresses [--doc-prefix repo:trellis:]
import { execFile } from 'child_process';
import util from 'util';
import { neo4jDriver, pgPool } from '../src/config/db';
import { config } from '../src/config/index';
import {
  checkCommentClassDiff,
  checkEvidence,
  checkParseResults,
  commentMarkerForFile,
  evaluatePreCheck,
  EvidenceEdge,
  HashEvidence,
  parseGitStatusPorcelain,
  parseUnifiedDiffChangedLines,
  checkEditScope,
  SelfEditFinding,
  SelfEditPreState,
} from '../src/benchmarks/selfedit/check';
import { gatherParseResults } from '../src/benchmarks/selfedit/parse_gate';

const execFileAsync = util.promisify(execFile);

interface CliArgs {
  pre: boolean;
  editRoot?: string;
  namedFiles: string[];
  commentClassFiles: string[];
  entities: string[];
  subject?: string;
  verb?: string;
  object?: string;
  docPrefix: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    pre: false,
    namedFiles: [],
    commentClassFiles: [],
    entities: [],
    docPrefix: 'repo:trellis:',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      const v = argv[i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    if (a === '--pre') args.pre = true;
    else if (a === '--edit-root') args.editRoot = next();
    else if (a === '--named-file') args.namedFiles.push(next());
    else if (a === '--comment-class') args.commentClassFiles.push(next());
    else if (a === '--entity') args.entities.push(next());
    else if (a === '--subject') args.subject = next();
    else if (a === '--verb') args.verb = next();
    else if (a === '--object') args.object = next();
    else if (a === '--doc-prefix') args.docPrefix = next();
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

export async function gatherGitStatus(editRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-C', editRoot, 'status', '--porcelain'], {
    maxBuffer: 1024 * 1024,
  });
  return parseGitStatusPorcelain(stdout);
}

/** Read-only working-tree diff for one declared comment-class file —
 *  the Session 39 widening of the harness's git surface (§5g); the
 *  toolkit and the run still never touch git. */
export async function gatherGitDiff(editRoot: string, file: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', editRoot, 'diff', '--', file], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export async function gatherEvidenceEdge(
  subject: string,
  verb: string,
  object: string
): Promise<EvidenceEdge> {
  const session = neo4jDriver.session({ defaultAccessMode: 'READ' });
  try {
    const result = await session.run(
      `MATCH (s:Entity {name: $subject})-[r:DERIVED_INSIGHT {verb: $verb}]->(o:Entity {name: $object})
       RETURN coalesce(s.contested, false) AS subjectContested,
              coalesce(o.contested, false) AS objectContested,
              coalesce(r.contested, false) AS edgeContested,
              coalesce(r.sourceNodeIds, []) AS sourceNodeIds
       LIMIT 1`,
      { subject, verb, object }
    );
    if (result.records.length === 0) {
      return { found: false, subjectContested: false, objectContested: false, edgeContested: false, sourceNodeIds: [] };
    }
    const rec = result.records[0];
    return {
      found: true,
      subjectContested: rec.get('subjectContested') === true,
      objectContested: rec.get('objectContested') === true,
      edgeContested: rec.get('edgeContested') === true,
      sourceNodeIds: (rec.get('sourceNodeIds') as string[]).filter(h => typeof h === 'string'),
    };
  } finally {
    await session.close();
  }
}

export async function gatherHashEvidence(hash: string): Promise<HashEvidence> {
  const exists = await pgPool.query('SELECT 1 FROM ast_nodes WHERE id = $1', [hash]);
  if (exists.rowCount === 0) {
    return { hash, existsInAstNodes: false, liveDocKeys: [] };
  }
  const live = await pgPool.query(
    `SELECT d.doc_key
       FROM documents d
       JOIN (SELECT doc_key, MAX(version) AS v FROM documents GROUP BY doc_key) cur
         ON cur.doc_key = d.doc_key AND cur.v = d.version
       JOIN document_nodes dn ON dn.root_hash = d.root_hash
      WHERE dn.node_id = $1
      ORDER BY d.doc_key`,
    [hash]
  );
  return {
    hash,
    existsInAstNodes: true,
    liveDocKeys: live.rows.map(r => r.doc_key as string),
  };
}

export async function gatherPreState(
  entities: string[],
  namedFiles: string[],
  docPrefix: string
): Promise<SelfEditPreState> {
  const session = neo4jDriver.session({ defaultAccessMode: 'READ' });
  const entityStates: SelfEditPreState['entities'] = [];
  try {
    for (const name of entities) {
      const result = await session.run(
        `MATCH (e:Entity {name: $name})
         OPTIONAL MATCH (e)-[r:ACTION]-()
         RETURN coalesce(e.contested, false) AS contested,
                size([x IN collect(r) WHERE coalesce(x.contested, false)]) AS contestedEdges`,
        { name }
      );
      if (result.records.length === 0) {
        entityStates.push({ name, found: false, contested: false, contestedEdges: 0 });
      } else {
        const rec = result.records[0];
        const contestedEdgesRaw = rec.get('contestedEdges');
        entityStates.push({
          name,
          found: true,
          contested: rec.get('contested') === true,
          contestedEdges:
            typeof contestedEdgesRaw === 'number' ? contestedEdgesRaw : Number(contestedEdgesRaw),
        });
      }
    }
  } finally {
    await session.close();
  }
  const docs: SelfEditPreState['docs'] = [];
  for (const f of namedFiles) {
    const docKey = docPrefix + f.replace(/\\/g, '/');
    const res = await pgPool.query('SELECT 1 FROM documents WHERE doc_key = $1 LIMIT 1', [docKey]);
    docs.push({ namedFile: f, docKey, present: (res.rowCount ?? 0) > 0 });
  }
  return { entities: entityStates, docs };
}

function report(findings: SelfEditFinding[]): number {
  if (findings.length === 0) {
    console.log('PASS: zero findings.');
    return 0;
  }
  for (const f of findings) {
    console.log(`FLAG [${f.code}] ${f.detail}`);
  }
  console.log(`${findings.length} finding(s).`);
  return 1;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.namedFiles.length === 0) throw new Error('--named-file is required');

  if (args.pre) {
    if (args.entities.length === 0) throw new Error('--pre requires at least one --entity');
    if (args.commentClassFiles.length > 0) {
      throw new Error('--comment-class is a post-run declaration; it has no --pre meaning');
    }
    const state = await gatherPreState(args.entities, args.namedFiles, args.docPrefix);
    return report(evaluatePreCheck(state));
  }

  if (!args.editRoot) throw new Error('--edit-root is required for the post-run check');
  if (!args.subject || !args.verb || !args.object) {
    throw new Error('--subject, --verb, and --object are required for the post-run check');
  }
  // Declared comment-class files validate BEFORE any I/O: each must be
  // a named file (the diff gate only ever narrows a named file's
  // allowed diff) and must have a wired line-comment marker (a
  // declared gate that checks nothing would be worse than no gate).
  const named = new Set(args.namedFiles.map(f => f.replace(/\\/g, '/')));
  for (const f of args.commentClassFiles) {
    if (!named.has(f.replace(/\\/g, '/'))) {
      throw new Error(`--comment-class file is not a --named-file: ${f}`);
    }
    if (commentMarkerForFile(f) === null) {
      throw new Error(`--comment-class file has no wired line-comment marker: ${f}`);
    }
  }
  const changedPaths = await gatherGitStatus(args.editRoot);
  const edge = await gatherEvidenceEdge(args.subject, args.verb, args.object);
  const hashes: HashEvidence[] = [];
  for (const h of edge.sourceNodeIds) {
    hashes.push(await gatherHashEvidence(h));
  }
  const parseResults = await gatherParseResults(args.editRoot, args.namedFiles, config.python.executable);
  const commentClassFindings: SelfEditFinding[] = [];
  for (const f of args.commentClassFiles) {
    const marker = commentMarkerForFile(f);
    if (marker === null) continue; // unreachable: validated above
    const diffText = await gatherGitDiff(args.editRoot, f);
    commentClassFindings.push(...checkCommentClassDiff(f, marker, parseUnifiedDiffChangedLines(diffText)));
  }
  const findings = [
    ...checkEditScope(changedPaths, args.namedFiles),
    ...checkEvidence({
      changedPaths,
      namedFiles: args.namedFiles,
      docKeyPrefix: args.docPrefix,
      edge,
      hashes,
    }),
    ...checkParseResults(parseResults),
    ...commentClassFindings,
  ];
  return report(findings);
}

// Only run as a CLI; the drill imports the gatherers directly.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('stage2_selfedit_check.ts')) {
  main()
    .then(code => process.exit(code))
    .catch(err => {
      console.error(`stage2_selfedit_check failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    });
}
