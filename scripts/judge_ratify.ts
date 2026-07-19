import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pgPool } from '../src/config/db';
import { collectExtractionBlocks, nodeText } from '../src/core/ast/traverse';
import type { ASTNode } from '../src/core/ast/parser';
import {
  buildAddressSpace,
  buildRatificationRequest,
  buildSelection,
  type AddressSpaceEntry,
} from '../src/core/graph/judge_intake';
import { CLAIM_MODES } from '../src/core/graph/judge_prereg';
import {
  appendThroughLaw,
  createPgConvocationStore,
  replayConvocationRecords,
  type RatificationPayload,
} from '../src/core/graph/judge_convocation_store';

// The ratification queue (JUDGE_CONVOCATION_DESIGN.md §3.4; the
// WORKSPACE §6 promotion-ceremony mold, one boundary earlier).
//
//   npm run judge:ratify -- list   --selections <file>
//   npm run judge:ratify -- show   <selectionId> --selections <file> [--space <file>]
//   npm run judge:ratify -- record <selectionId> --selections <file> [--space <file>]
//                                  --confirm --claim-mode <mode>
//
// An OPERATOR surface, never model-reachable: a human runs this
// command. `show` prints the buildRatificationRequest payload VERBATIM
// — the exact bytes WITH their engine-computed neighbors, so the cut is
// visible at the moment of approval (rule 17). `record` takes the
// user's recorded flags as the ONLY source of Y and claimMode
// (rule 15): both flags are required, there is no default, and a
// decline simply records nothing — an unratified selection is already
// structurally unreachable (the slice-1 [ratification-gate] pin).
//
// Capture is mechanical: Tier-1 block addresses resolve ENGINE-SIDE —
// the block's current document is found in Postgres, the root walk
// (collectExtractionBlocks, the TS authority) yields ordinal adjacency,
// and nodeText yields the bytes; the operator never types claim bytes.
// Workspace segment entries arrive via --space <file>, the engine's own
// park serialization (capture was mechanical at park time, WORKSPACE
// §4.1/§4.2). The recorded payload carries the ratified selection AND
// the confirmed entries, so the sweep judges exactly the bytes the user
// confirmed (record §4).
//
// Selections file shape:
//   { "selections": [ { "selectionId": "...", "addresses": ["..."],
//     "selectedAtMs": 0 }, ... ] }

interface SelectionInput { selectionId: string; addresses: string[]; selectedAtMs: number }

interface CliArgs {
  command: 'list' | 'show' | 'record';
  selectionId?: string;
  selectionsFile?: string;
  spaceFile?: string;
  confirm: boolean;
  claimMode?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (command !== 'list' && command !== 'show' && command !== 'record') {
    throw new Error('Usage: judge_ratify <list|show|record> [selectionId] --selections <file> ...');
  }
  const args: CliArgs = { command, confirm: false };
  let i = 0;
  if ((command === 'show' || command === 'record') && rest[0] && !rest[0].startsWith('--')) {
    args.selectionId = rest[0];
    i = 1;
  }
  for (; i < rest.length; i++) {
    const flag = rest[i];
    const value = () => {
      const next = rest[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    switch (flag) {
      case '--selections': args.selectionsFile = resolve(value()); break;
      case '--space': args.spaceFile = resolve(value()); break;
      case '--confirm': args.confirm = true; break;
      case '--claim-mode': args.claimMode = value(); break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

const AST_BLOCK_ID = /^[0-9a-f]{64}$/;

/**
 * Engine-side capture for a Tier-1 block address: current document,
 * ordered root walk, the addressed block plus its ordinal neighbors.
 */
async function exportAstEntries(address: string): Promise<AddressSpaceEntry[]> {
  const doc = await pgPool.query(
    `SELECT d.root_hash
     FROM document_nodes dn
     JOIN documents d ON d.root_hash = dn.root_hash
     JOIN (SELECT doc_key, MAX(version) AS version FROM documents GROUP BY doc_key) latest
       ON latest.doc_key = d.doc_key AND latest.version = d.version
     WHERE dn.node_id = $1
     LIMIT 1`,
    [address]
  );
  if (doc.rows.length === 0) {
    throw new Error(`Address "${address}" is not a member of any current document — nothing to capture at it.`);
  }
  const rootHash = doc.rows[0].root_hash as string;
  const root = await pgPool.query('SELECT data FROM ast_nodes WHERE id = $1', [rootHash]);
  const rootData = (typeof root.rows[0].data === 'string' ? JSON.parse(root.rows[0].data) : root.rows[0].data) as ASTNode;
  const blocks = collectExtractionBlocks(rootData);
  const index = blocks.findIndex((b) => b.id === address);
  if (index < 0) {
    throw new Error(`Address "${address}" is not an extraction block of its current document root ${rootHash}.`);
  }
  const entryAt = (i: number): AddressSpaceEntry => ({
    address: blocks[i].id,
    containerId: rootHash,
    ordinal: i,
    content: nodeText(blocks[i]),
  });
  const entries: AddressSpaceEntry[] = [entryAt(index)];
  if (index > 0) entries.push(entryAt(index - 1));
  if (index < blocks.length - 1) entries.push(entryAt(index + 1));
  return entries;
}

async function buildSpaceEntries(addresses: readonly string[], spaceFile?: string): Promise<AddressSpaceEntry[]> {
  const byAddress = new Map<string, AddressSpaceEntry>();
  const supplied: AddressSpaceEntry[] = spaceFile
    ? (JSON.parse(readFileSync(spaceFile, 'utf8')) as { entries: AddressSpaceEntry[] }).entries
    : [];
  for (const entry of supplied) byAddress.set(entry.address, entry);
  for (const address of addresses) {
    if (byAddress.has(address)) continue;
    if (AST_BLOCK_ID.test(address)) {
      for (const entry of await exportAstEntries(address)) {
        if (!byAddress.has(entry.address)) byAddress.set(entry.address, entry);
      }
    } else {
      throw new Error(
        `Address "${address}" is a workspace segment with no supplied entry — pass the park export via --space <file> ` +
        `(the engine's own serialization; the queue never types bytes).`
      );
    }
  }
  return [...byAddress.values()];
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.selectionsFile) {
    console.error('Refused: --selections <file> is required.');
    return 1;
  }
  const selections = (JSON.parse(readFileSync(args.selectionsFile, 'utf8')) as { selections: SelectionInput[] }).selections;
  const store = createPgConvocationStore(pgPool);
  const state = replayConvocationRecords(await store.loadAll());

  if (args.command === 'list') {
    console.log(`Selections: ${selections.length}`);
    for (const s of selections) {
      const ratified = state.ratifications.get(s.selectionId);
      console.log(`  ${s.selectionId}  (${s.addresses.length} address(es))  ${ratified ? `RATIFIED as ${ratified.record.claimMode}` : 'pending'}`);
    }
    return 0;
  }

  const input = selections.find((s) => s.selectionId === args.selectionId);
  if (!input) {
    console.error(`Refused: selection "${args.selectionId}" is not in ${args.selectionsFile}.`);
    return 1;
  }
  const entries = await buildSpaceEntries(input.addresses, args.spaceFile);
  const space = buildAddressSpace(entries);
  const selection = buildSelection(space, input);
  const request = buildRatificationRequest(space, selection);

  if (args.command === 'show') {
    // Rule 17: the payload verbatim — the exact bytes WITH the cut's
    // engine-computed neighbors. Nothing is summarized or paraphrased.
    console.log(JSON.stringify(request, null, 2));
    console.log(
      '\nApprove with: npm run judge:ratify -- record ' +
      `${input.selectionId} --selections <file> --confirm --claim-mode <${CLAIM_MODES.join('|')}>`
    );
    console.log('Declining records nothing — an unratified selection is structurally unreachable.');
    return 0;
  }

  // record: the user's recorded flags are the only source (rule 15).
  if (!args.confirm) {
    console.error('Refused: ratification requires the explicit --confirm flag — the recorded Y is the user\'s, never a default.');
    return 1;
  }
  if (!args.claimMode || !(CLAIM_MODES as readonly string[]).includes(args.claimMode)) {
    console.error(`Refused: --claim-mode <${CLAIM_MODES.join('|')}> is required — the mode is chosen by the user at confirmation, never inferred.`);
    return 1;
  }
  const payload: RatificationPayload = {
    record: { selectionId: input.selectionId, claimMode: args.claimMode, confirmedAtMs: Date.now() },
    selection: { selectionId: input.selectionId, addresses: [...input.addresses], selectedAtMs: input.selectedAtMs },
    entries,
  };
  await appendThroughLaw(store, state.prereg, { kind: 'ratification', key: input.selectionId, payload });
  console.log(`Ratification recorded: ${input.selectionId} as ${args.claimMode} (write-once; the first record survives).`);
  return 0;
}

main()
  .then(async (code) => {
    await pgPool.end().catch(() => {});
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(`\nRatification queue failed: ${error instanceof Error ? error.message : error}`);
    console.error('Nothing was recorded.');
    await pgPool.end().catch(() => {});
    process.exit(1);
  });
