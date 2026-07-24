// Per-module acceptance drill — the target of a manifest's
// `acceptance.zeroPaid` ("npm run test:module -- <name>"). Its sibling
// scripts/test_modules.ts pins the cross-language registry CONTRACT and
// would pass unchanged if a module's addendum were replaced with lorem
// ipsum; this one asks whether one named module is a distinct, reachable
// artifact. Zero paid work, no databases, no network.
//
// Everything loadModule already enforces (active status, addendum
// present, addendumMaxBytes, brace-freedom, LF normalization) is left to
// loadModule — this drill calls it and lets its throws surface rather
// than keeping a second copy of those rules in sync.
import fs from 'fs';
import path from 'path';
import { listModuleNames, loadModules, readModuleManifest } from '../src/config/modules';

const MODULES_DIR = path.resolve('modules');

let passed = 0;
let failed = 0;
let skipped = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (ok) passed++;
  else failed++;
}

function skip(label: string, why: string): void {
  console.log(`  [SKIP] ${label} — ${why}`);
  skipped++;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Composition-free addendum read, used only to compare one module's text
// against every other module's. loadModule is the right reader for the
// module under test, but contested/retired modules are refused by design
// (Session 18) and they are still real registrations a duplicate could
// hide behind — so the comparison set is read straight off disk with the
// same LF normalization loadModule applies, and nothing is validated here.
function addendumTextOnDisk(name: string): string | null {
  const manifest = readModuleManifest(name, MODULES_DIR);
  const addendumPath = path.join(MODULES_DIR, name, manifest.addendum);
  if (!fs.existsSync(addendumPath)) return null;
  return fs.readFileSync(addendumPath, 'utf-8').replace(/\r\n/g, '\n');
}

const name = process.argv[2];
if (!name) {
  console.error('Usage: npm run test:module -- <name>');
  console.error(`Registered modules: ${listModuleNames(MODULES_DIR).join(', ') || '(none)'}`);
  process.exit(2);
}

console.log(`Module acceptance drill: ${name}`);

// 1. The manifest reads and shape-validates. Every later check reads
//    fields off it, so a failure here is terminal rather than counted.
let manifest;
try {
  manifest = readModuleManifest(name, MODULES_DIR);
  check(`manifest reads and validates (v${manifest.version}, status '${manifest.status}')`, true);
} catch (err) {
  check('manifest reads and validates', false, errText(err));
  console.log(`Summary: ${name} — ${passed} passed, ${failed} failed, ${skipped} skipped.`);
  process.exit(1);
}

// 2. The acceptance criterion names this module. The manifest schema
//    pins this too; it is repeated here so the drill still discriminates
//    when run standalone against a checkout whose schema has drifted.
//    A criterion identical across every module discriminates nothing.
const zeroPaid = manifest.acceptance?.zeroPaid;
check(
  'acceptance.zeroPaid references this module by name',
  typeof zeroPaid === 'string' && zeroPaid.includes(manifest.name),
  zeroPaid === undefined
    ? 'manifest declares no acceptance criterion'
    : `'${zeroPaid}' does not contain '${manifest.name}'`
);

if (manifest.status !== 'active') {
  // Not a defect: loadModule refuses non-active modules on purpose, so
  // the two composition checks have nothing observable to run against.
  const why = `status '${manifest.status}' — composition is refused by design, not by defect`;
  skip('reachable through a selection (with omitted-arm control)', why);
  skip('addendum is distinct from every other module on disk', why);
} else {
  // 3. Reachability, both arms. The selected arm alone would pass even
  //    if loadModules ignored its argument and returned everything, so
  //    the omitted arm — nothing selected, nothing composed — is what
  //    makes the presence claim mean anything.
  let loadedText: string | null = null;
  try {
    const selected = loadModules([name], MODULES_DIR);
    const omitted = loadModules([], MODULES_DIR);
    const one = selected.length === 1 && selected[0].name === manifest.name;
    const nonEmpty = one && selected[0].addendumText.trim().length > 0;
    if (nonEmpty) loadedText = selected[0].addendumText;
    check(
      'selected arm: composes exactly this module, addendum non-empty',
      nonEmpty,
      one
        ? 'addendum text is empty or whitespace-only'
        : `expected 1 module named '${manifest.name}', got [${selected.map(m => m.name).join(', ')}]`
    );
    check(
      'omitted arm: selecting nothing composes nothing',
      omitted.length === 0,
      `expected 0 modules, got [${omitted.map(m => m.name).join(', ')}]`
    );
  } catch (err) {
    check('reachable through a selection (with omitted-arm control)', false, errText(err));
  }

  // 4. Distinctness. Two modules carrying byte-identical addendum text
  //    are one module registered twice — the registry would show two
  //    entries and the composed prompt would gain nothing from the
  //    second. Compared against every other registration regardless of
  //    status, since a retired twin is still a twin.
  if (loadedText === null) {
    skip('addendum is distinct from every other module on disk', 'this module did not compose');
  } else {
    const twins: string[] = [];
    const unreadable: string[] = [];
    for (const other of listModuleNames(MODULES_DIR)) {
      if (other === manifest.name) continue;
      try {
        const otherText = addendumTextOnDisk(other);
        if (otherText === null) unreadable.push(other);
        else if (otherText === loadedText) twins.push(other);
      } catch {
        // Another module's manifest being broken is that module's drill
        // to fail, not this one's; it just leaves the pair uncompared.
        unreadable.push(other);
      }
    }
    check(
      'addendum is distinct from every other module on disk',
      twins.length === 0,
      `byte-identical to ${twins.join(', ')}`
    );
    if (unreadable.length > 0) {
      console.log(`         note: not compared against ${unreadable.join(', ')} (manifest or addendum unreadable)`);
    }
  }
}

// 5. Provenance ids are unique. The schema pins their 64-hex shape but
//    not their multiplicity, and a repeated id inflates the apparent
//    research support behind a module without adding a source.
const ids = manifest.research.sourceNodeIds;
const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
check(
  `research.sourceNodeIds are unique (${ids.length} declared)`,
  duplicates.length === 0,
  `repeated: ${duplicates.join(', ')}`
);

console.log(`Summary: ${name} — ${passed} passed, ${failed} failed, ${skipped} skipped.`);
process.exit(failed > 0 ? 1 : 0);
