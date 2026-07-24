import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RootContract, SurfaceIssue } from './check.js';

// Every SurfaceIssue code the fixture below plants, written as a table keyed
// by the code itself so that TypeScript refuses the literal when the union in
// `check.ts` and this fixture disagree — a missing key and an extra key are
// both compile errors, and `npm run build` runs in CI.
//
// The structural half matters more than the list. Seven of these eleven codes
// gated a merge without ever having been seen to fail, because the fixture
// contract set `deprecatedSurfaces`, `forbiddenRootFiles` and
// `documentUpsum.paths` to empty and those branches were therefore never
// entered. A twelfth code cannot now reach `check.ts` without either a plant
// here or a deliberate deletion of this table: the drift stopped being silent.
// AGENTS.md §4 rule 19(c) — a check earns the name `verification` by having
// been seen to fail.
const PLANTED_CODES: Record<SurfaceIssue['code'], true> = {
  broken_markdown_link: true,
  deprecated_marker_missing: true,
  environment_example_extra: true,
  environment_example_missing: true,
  forbidden_root_file: true,
  missing_root_directory: true,
  missing_root_file: true,
  oversized_document: true,
  oversized_root_file: true,
  unexpected_root_directory: true,
  unexpected_root_file: true,
};

export const NEGATIVE_CONTROL_CODES = (Object.keys(PLANTED_CODES) as SurfaceIssue['code'][]).sort();

export type FixtureMode = 'broken' | 'healthy';

export interface SurfaceFixture {
  contract: RootContract;
  files: string[];
}

// The contract is identical in both modes, and only the tree moves. That is
// the point: a positive control built by relaxing the contract proves nothing
// about the checker, whereas the same ratified surface over a repaired tree
// coming back silent is the only thing that makes a detection informative.
function fixtureContract(): RootContract {
  return {
    version: 1,
    rootFiles: [
      { path: '.env.example', class: 'entrypoint', maxBytes: 1024 },
      { path: 'LICENSE', class: 'metadata', maxBytes: 1024 },
      { path: 'README.md', class: 'entrypoint', maxBytes: 256 },
    ],
    rootDirectories: ['docs', 'modules', 'src'],
    markdownLinks: { excludePrefixes: ['docs/archive/'] },
    environment: {
      schemaPath: 'src/config/index.ts',
      examplePath: '.env.example',
      allowedExampleOnly: ['ALLOWED_ONLY_KEY'],
    },
    deprecatedSurfaces: [{ path: 'docs/DEPRECATED.md', requiredText: 'Status: DEPRECATED' }],
    forbiddenRootFiles: ['benchmark_results.json'],
    documentUpsum: {
      defaultMaxBytes: 32768,
      paths: [{ path: 'docs/GOVERNED.md', maxBytes: 256 }],
    },
  };
}

/**
 * Plant an isolated repository surface under `root`. In `broken` mode the tree
 * violates the contract in exactly eleven ways — one per SurfaceIssue code, at
 * one path each, so a code and a path can be pinned together. In `healthy`
 * mode the same contract meets a repaired tree and must yield nothing.
 */
export function plantSurfaceFixture(root: string, mode: FixtureMode): SurfaceFixture {
  const broken = mode === 'broken';
  mkdirSync(path.join(root, 'docs', 'archive'), { recursive: true });
  mkdirSync(path.join(root, 'src', 'config'), { recursive: true });

  // A dangling local link and a body past its byte cap, or a link that
  // resolves and a body inside it: `broken_markdown_link`, `oversized_root_file`.
  writeFileSync(
    path.join(root, 'README.md'),
    broken ? `[dangling](nowhere.md)\n\n${'x'.repeat(300)}\n` : '[governed](docs/GOVERNED.md)\n',
  );

  // EnvSchema declares REQUIRED_KEY. The example must carry it, may carry the
  // allowlisted key, and may carry nothing else: `environment_example_missing`
  // for the omission, `environment_example_extra` for STRAY_KEY. ALLOWED_ONLY_KEY
  // is in both trees and reported in neither — the allowlist is load-bearing.
  writeFileSync(
    path.join(root, 'src', 'config', 'index.ts'),
    'const EnvSchema = z.object({\n  REQUIRED_KEY: z.string(),\n});\n',
  );
  writeFileSync(
    path.join(root, '.env.example'),
    broken ? 'ALLOWED_ONLY_KEY=1\nSTRAY_KEY=1\n' : 'ALLOWED_ONLY_KEY=1\nREQUIRED_KEY=\n',
  );

  // A governed document against its contracted budget: `oversized_document`.
  // This is the only merge-gating enforcement the document-UPSUM byte budgets
  // in root-contract.json have, and it had never been observed to fire.
  writeFileSync(
    path.join(root, 'docs', 'GOVERNED.md'),
    broken ? `${'g'.repeat(300)}\n` : 'Inside budget.\n',
  );

  // A deprecated surface that lost its marker: `deprecated_marker_missing`.
  writeFileSync(
    path.join(root, 'docs', 'DEPRECATED.md'),
    broken ? 'Superseded, and silent about it.\n' : 'Status: DEPRECATED as an active authority.\n',
  );

  // Planted in BOTH trees and reported in neither. The archive exclusion is a
  // blindness the contract buys on purpose, so the healthy pass is only worth
  // reading if this link stays unreported while README's identical break does not.
  writeFileSync(path.join(root, 'docs', 'archive', 'OLD.md'), '[dangling](gone.md)\n');

  const files = [
    '.env.example',
    'README.md',
    'docs/DEPRECATED.md',
    'docs/GOVERNED.md',
    'docs/archive/OLD.md',
    'src/config/index.ts',
  ];

  if (broken) {
    // An uncontracted root file and an uncontracted top-level directory:
    // `unexpected_root_file`, `unexpected_root_directory`.
    writeFileSync(path.join(root, 'unexpected.txt'), 'planted\n');
    mkdirSync(path.join(root, 'stray'), { recursive: true });
    writeFileSync(path.join(root, 'stray', 'note.txt'), 'planted\n');
    files.push('unexpected.txt', 'stray/note.txt');

    // `forbidden_root_file`, deliberately absent from `files`. A result
    // artifact git never lists still has to trip, and `existsSync` is the only
    // branch that catches it; listing it here would prove the weaker half and
    // leave the branch that actually matters unexercised.
    writeFileSync(path.join(root, 'benchmark_results.json'), '{}\n');

    // LICENSE and modules/ are contracted and simply absent:
    // `missing_root_file`, `missing_root_directory`.
  } else {
    writeFileSync(path.join(root, 'LICENSE'), 'All rights reserved.\n');
    mkdirSync(path.join(root, 'modules'), { recursive: true });
    writeFileSync(path.join(root, 'modules', 'placeholder.ts'), 'export {};\n');
    files.push('LICENSE', 'modules/placeholder.ts');
  }

  return { contract: fixtureContract(), files };
}
