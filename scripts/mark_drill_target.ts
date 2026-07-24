import os from 'os';
import { pgPool, neo4jDriver } from '../src/config/db';
import {
  clearNeo4jMarker,
  clearPostgresMarker,
  describeTargets,
  readNeo4jMarker,
  readPostgresMarker,
  writeNeo4jMarker,
  writePostgresMarker,
  type DrillTargetMarker,
} from '../src/core/runtime/drill_target';

// Declares a pair of databases expendable, so drill and benchmark
// scripts will write to them (src/core/runtime/drill_target.ts).
//
//   npm run drill:mark-target                              (status)
//   npm run drill:mark-target -- --purpose "<why>" --confirm-mark
//   npm run drill:mark-target -- --unmark --confirm-mark
//
// This is THE operator gate on the drill path. Marking is the one act
// that makes a database drillable, so it is deliberately a separate,
// deliberate command rather than a flag on any drill: an operator who
// mistypes a host here has to type a purpose and a confirmation for a
// target the echo just printed back to them.
//
// Unmarking is how a database leaves the drill set — run it on any
// store that has outgrown its scratch phase.
//
// Flags:
//   --purpose <text>   required to mark; the operator's own words for
//                      what this database is, read back by every drill
//   --marked-by <who>  attribution (default: OS user @ hostname)
//   --unmark           remove the markers instead of writing them
//   --confirm-mark     required acknowledgement for either direction

interface CliArgs {
  purpose?: string;
  markedBy?: string;
  unmark: boolean;
  confirmMark: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { unmark: false, confirmMark: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    switch (flag) {
      case '--purpose': args.purpose = value(); break;
      case '--marked-by': args.markedBy = value(); break;
      case '--unmark': args.unmark = true; break;
      case '--confirm-mark': args.confirmMark = true; break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

async function printStatus(): Promise<void> {
  const targets = describeTargets();
  const [neo4jMarker, postgresMarker] = await Promise.all([
    readNeo4jMarker(neo4jDriver),
    readPostgresMarker(pgPool),
  ]);
  console.log('Drill-target status:');
  for (const [store, target, marker] of [
    ['neo4j', targets.neo4j, neo4jMarker],
    ['postgres', targets.postgres, postgresMarker],
  ] as const) {
    console.log(`\n  ${store}: ${target}`);
    if (marker) {
      console.log(`    MARKED — "${marker.purpose}"`);
      console.log(`    by ${marker.markedBy} at ${marker.markedAt}`);
    } else {
      console.log('    unmarked — drills will refuse this store');
    }
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const targets = describeTargets();

  if (!args.purpose && !args.unmark) {
    await printStatus();
    console.log('\nTo declare these databases expendable:');
    console.log('  npm run drill:mark-target -- --purpose "<what this database is for>" --confirm-mark');
    return 0;
  }

  // Echo the exact targets before either direction of the write. An
  // operator marking the wrong host sees the wrong host here.
  console.log(args.unmark ? 'Removing the drill-target marker from:' : 'Declaring these databases expendable for drills:');
  console.log(`  neo4j     ${targets.neo4j}`);
  console.log(`  postgres  ${targets.postgres}`);

  if (args.unmark) {
    if (!args.confirmMark) {
      console.error(
        '\nREFUSED: unmarking makes every drill refuse these stores.\n'
        + '  Nothing was changed. Re-run with --confirm-mark once the targets above read correctly.'
      );
      return 2;
    }
    const [neo4jCleared, postgresCleared] = await Promise.all([
      clearNeo4jMarker(neo4jDriver),
      clearPostgresMarker(pgPool),
    ]);
    console.log(`\nUnmarked: neo4j ${neo4jCleared}, postgres ${postgresCleared}.`);
    console.log('Drills will now refuse both stores.');
    return 0;
  }

  const marker: DrillTargetMarker = {
    purpose: args.purpose as string,
    markedAt: new Date().toISOString(),
    markedBy: args.markedBy ?? `${os.userInfo().username}@${os.hostname()}`,
  };
  console.log(`  purpose   "${marker.purpose}"`);
  console.log(`  marked by ${marker.markedBy}`);

  if (!args.confirmMark) {
    console.error(
      '\nREFUSED: marking authorizes every drill to write, flip cached beliefs,\n'
      + '  and run unscoped deletes against these two databases.\n'
      + '  Nothing was written. Re-run with --confirm-mark once the targets above\n'
      + '  read correctly.'
    );
    return 2;
  }

  await Promise.all([
    writeNeo4jMarker(neo4jDriver, marker),
    writePostgresMarker(pgPool, marker),
  ]);
  console.log('\nMarked. Drill and benchmark scripts will now accept these databases.');
  console.log('Revoke with: npm run drill:mark-target -- --unmark --confirm-mark');
  return 0;
}

main()
  .then(async code => {
    await Promise.allSettled([pgPool.end(), neo4jDriver.close()]);
    process.exit(code);
  })
  .catch(async error => {
    console.error(`\nMarking failed: ${error instanceof Error ? error.message : error}`);
    await Promise.allSettled([pgPool.end(), neo4jDriver.close()]);
    process.exit(1);
  });
