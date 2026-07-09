import crypto from 'crypto';
import path from 'path';
import { pgPool, neo4jDriver } from '../src/config/db';
import {
  listModuleNames,
  readModuleManifest,
  type ModuleManifest,
} from '../src/config/modules';
import {
  describeMissingHashes,
  fetchModuleEntityStates,
  findMissingAstHashes,
  moduleEntityName,
  planModuleRegistrations,
  registerModuleEntities,
} from '../src/core/graph/module_registration';

// Module registration CLI (Session 18, design record §9.4 / §11 step 6).
//
//   npm run modules:register                                  (register)
//   npm run modules:register -- --module <name>       (scope to modules)
//   npm run modules:verify                       (read-only state report)
//
// THE operator gate on capability provenance: research-bearing module
// manifests become graph entities (:Entity {kind: 'module_manifest'},
// name 'module:<name>') citing their research sourceNodeIds, so the
// EXISTING invalidation sweep contests a module when the promoted
// sources under it change. It is a human running this command — no API
// endpoint registers modules, no model output triggers it, and it is
// never part of worker startup.
//
// The existence gate runs before ANY write: every cited research hash
// must exist in ast_nodes (the Session 14 write-path discipline applied
// to capability provenance). A manifest citing unknown hashes refuses
// the whole invocation with a bounded listing; nothing is registered.
//
// Registration is idempotent (MERGE; re-running changes nothing) and
// mirrors the provenance state machine: re-registering a module whose
// entity was contested by the sweep is the RECOVERY transition — which
// is why manifests with status contested/retired are skipped, not
// registered: recovery must follow re-review, not precede it.
//
// Flags:
//   --modules-dir <dir>   registry root (default: ./modules)
//   --module <name>       scope to this module (repeatable; default: all)
//   --verify              read-only report of registered entity state

interface CliArgs {
  modulesDir: string;
  moduleNames: string[];
  verify: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { modulesDir: path.resolve('modules'), moduleNames: [], verify: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    switch (flag) {
      case '--modules-dir': args.modulesDir = path.resolve(value()); break;
      case '--module': args.moduleNames.push(value()); break;
      case '--verify': args.verify = true; break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

const ORPHAN_LISTING_MAX = 10;

function formatTimestamp(epochMs: number | null): string {
  return epochMs === null ? '-' : new Date(epochMs).toISOString();
}

async function verifyMode(args: CliArgs): Promise<number> {
  const states = await fetchModuleEntityStates(neo4jDriver);
  const scoped = args.moduleNames.length > 0
    ? states.filter(s => args.moduleNames.some(name => s.entityName === moduleEntityName(name)))
    : states;
  console.log(`Registered module entities: ${scoped.length}`);
  let contestedCount = 0;
  for (const state of scoped) {
    const moduleName = state.entityName.replace(/^module:/, '');
    let diskStatus = 'not on disk';
    try {
      diskStatus = `status ${readModuleManifest(moduleName, args.modulesDir).status}`;
    } catch {
      // A registered entity whose manifest is gone or unreadable is
      // still reportable — the graph is the audit ledger.
    }
    console.log(`\n  ${state.entityName} (version ${state.moduleVersion ?? '-'}; manifest: ${diskStatus})`);
    console.log(`    contested:   ${state.contested}${state.contested ? `  (since ${formatTimestamp(state.contestedAt)})` : ''}`);
    console.log(`    live research hashes:     ${state.sourceNodeIds.length}`);
    console.log(`    orphaned research hashes: ${state.orphanedSourceIds.length}`);
    if (state.orphanedSourceIds.length > 0) {
      const shown = state.orphanedSourceIds.slice(0, ORPHAN_LISTING_MAX);
      const suffix = state.orphanedSourceIds.length > shown.length
        ? `, +${state.orphanedSourceIds.length - shown.length} more` : '';
      console.log(`      ${shown.join('\n      ')}${suffix}`);
    }
    if (state.rederivedAt !== null) {
      console.log(`    recovered:   ${formatTimestamp(state.rederivedAt)}`);
    }
    if (state.contested) {
      contestedCount++;
      console.log(
        `    ACTION: the research basis of this module changed. Re-review it; set `
        + `"status": "contested" in ${path.join(args.modulesDir, moduleName, 'module.json')} to `
        + `exclude it from composition until the review lands, then update its research `
        + `provenance and re-register to recover.`
      );
    }
  }
  if (contestedCount > 0) {
    console.log(`\n${contestedCount} module(s) contested — capability re-review required.`);
  } else if (scoped.length > 0) {
    console.log('\nAll registered module entities are uncontested.');
  }
  return 0;
}

async function registerMode(args: CliArgs): Promise<number> {
  const names = args.moduleNames.length > 0 ? args.moduleNames : listModuleNames(args.modulesDir);
  if (names.length === 0) {
    console.log(`No modules found under ${args.modulesDir}; nothing to register.`);
    return 0;
  }
  // Shape validation is fail-fast for the whole invocation: a registry
  // holding an invalid manifest is an operator problem to fix, not skip.
  const manifests: ModuleManifest[] = names.map(name => readModuleManifest(name, args.modulesDir));

  const plan = planModuleRegistrations(manifests);
  for (const skip of plan.skipped) {
    console.log(`Skipping '${skip.moduleName}': ${skip.message}`);
  }
  if (plan.registrations.length === 0) {
    console.log('No research-bearing active modules to register.');
    return 0;
  }

  // The existence gate — before ANY write session opens.
  const citedHashes = plan.registrations.flatMap(reg => reg.sourceNodeIds);
  const missing = await findMissingAstHashes(pgPool, citedHashes);
  if (missing.length > 0) {
    const missingSet = new Set(missing);
    const offenders = plan.registrations
      .filter(reg => reg.sourceNodeIds.some(h => missingSet.has(h)))
      .map(reg => reg.moduleName);
    console.error(`Registration refused: ${describeMissingHashes(missing)}`);
    console.error(`Module(s) citing unknown research: ${offenders.join(', ')}`);
    console.error(
      'Research provenance must be verified substrate — promote the source segments first '
      + '(npm run promote) and cite the printed block hashes. Nothing was registered.'
    );
    return 1;
  }

  // Echo the plan, then merge everything in one transaction.
  console.log('Registering module manifests as graph entities:');
  for (const reg of plan.registrations) {
    console.log(`  ${reg.entityName}  (version ${reg.version}, ${reg.sourceNodeIds.length} research hash(es))`);
  }
  const merged = await registerModuleEntities(
    neo4jDriver,
    plan.registrations,
    () => crypto.randomUUID()
  );
  console.log(`\nRegistered ${merged.length} module entit${merged.length === 1 ? 'y' : 'ies'} (idempotent MERGE).`);
  console.log('The invalidation sweep now reaches these modules: a re-promotion that orphans');
  console.log('a cited research hash contests the module entity. Inspect with: npm run modules:verify');
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  return args.verify ? verifyMode(args) : registerMode(args);
}

main()
  .then(async code => {
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(code);
  })
  .catch(async error => {
    console.error(`\nModule registration failed: ${error instanceof Error ? error.message : error}`);
    console.error('Nothing was registered.');
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(1);
  });
