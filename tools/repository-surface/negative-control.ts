// The falsifier's fixture — one planted break per issue code the checker
// can emit (AGENTS.md rule 19(c): a check earns the name `verification`
// by having been seen to fail).
//
// The fixture lives here rather than in `cli.ts` because two callers need
// the same plants: the operator-facing `--negative-control` run, and the
// unit battery that carries the control into `npm test` and therefore CI.
// Two copies would drift, and the drifted one would still pass.
//
// Every row of `expected` is asserted BY PATH, not only by code. A code
// firing somewhere is weaker evidence than a code firing on the file the
// plant was buried in: the first tolerates a checker that reports the
// right kind of problem about the wrong file.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RootContract, SurfaceIssueCode } from './check.js';

export interface PlantedBreak {
  readonly code: SurfaceIssueCode;
  readonly path: string;
}

export interface NegativeControlFixture {
  readonly contract: RootContract;
  /** The tracked-file listing `checkRepositorySurface` is given, standing
   *  in for `git ls-files` against the fixture. */
  readonly files: string[];
  readonly expected: readonly PlantedBreak[];
}

/** Key an issue or a plant the same way, so the two sets can be compared
 *  in both directions: nothing planted went undetected, and nothing
 *  detected went unplanted. */
export function breakKey(planted: { code: string; path: string }): string {
  return `${planted.code}@${planted.path}`;
}

/**
 * Build an isolated repository surface in `fixtureRoot` that is broken in
 * exactly eleven ways, and return the contract to check it against.
 */
export function plantNegativeControl(fixtureRoot: string): NegativeControlFixture {
  mkdirSync(path.join(fixtureRoot, 'docs'), { recursive: true });
  mkdirSync(path.join(fixtureRoot, 'src', 'config'), { recursive: true });
  mkdirSync(path.join(fixtureRoot, 'tools'), { recursive: true });

  // oversized_root_file (22 bytes against a 1-byte cap) and
  // broken_markdown_link (the target is never written).
  writeFileSync(path.join(fixtureRoot, 'README.md'), '[missing](missing.md)\n');

  // environment_example_missing: REQUIRED_KEY is declared by the schema
  // below and absent here. environment_example_extra: UNDECLARED_KEY is
  // in neither the schema nor the allowlist. EXTRA_KEY is allowlisted and
  // must stay SILENT — without it the fixture could not tell a working
  // allowlist from an ignored one.
  writeFileSync(path.join(fixtureRoot, '.env.example'), 'EXTRA_KEY=1\nUNDECLARED_KEY=1\n');
  writeFileSync(
    path.join(fixtureRoot, 'src', 'config', 'index.ts'),
    'const EnvSchema = z.object({\n  REQUIRED_KEY: z.string(),\n});\n',
  );

  // unexpected_root_file: present at root, in no contract row.
  writeFileSync(path.join(fixtureRoot, 'unexpected.txt'), 'planted\n');

  // forbidden_root_file, and deliberately LEFT OUT of `files`: the drill
  // dumps this rule exists to catch are gitignored, so the branch that
  // matters is the on-disk one rather than the tracked-set one.
  writeFileSync(path.join(fixtureRoot, 'benchmark_results.json'), '{}\n');

  // unexpected_root_directory: `tools/` is on disk and tracked, and no
  // contracted directory admits it.
  writeFileSync(path.join(fixtureRoot, 'tools', 'orphan.ts'), 'export {};\n');

  // oversized_document: a contracted documentUpsum row, far over its cap,
  // and carrying `##` sections so the headroom report has a real ranking
  // to compute rather than a shape refusal to swallow.
  writeFileSync(
    path.join(fixtureRoot, 'docs', 'OVERSIZE.md'),
    ['# Oversize', '', '## Heavy', 'y'.repeat(400), '', '## Light', 'z', ''].join('\n'),
  );

  // deprecated_marker_missing: the file EXISTS, so only reading its bytes
  // catches the absent marker. A fixture that simply omitted the file
  // would leave the content branch unproven.
  writeFileSync(path.join(fixtureRoot, 'docs', 'LEGACY.md'), '# Legacy\n\nno marker here\n');

  const contract: RootContract = {
    version: 1,
    rootFiles: [
      { path: '.env.example', class: 'entrypoint', maxBytes: 1024 },
      { path: 'README.md', class: 'entrypoint', maxBytes: 1 },
      // missing_root_file: contracted, never written.
      { path: 'LICENSE', class: 'metadata', maxBytes: 1024 },
    ],
    // missing_root_directory: `reports` is contracted and never created.
    rootDirectories: ['docs', 'reports', 'src'],
    markdownLinks: { excludePrefixes: [] },
    environment: {
      schemaPath: 'src/config/index.ts',
      examplePath: '.env.example',
      allowedExampleOnly: ['EXTRA_KEY'],
    },
    deprecatedSurfaces: [{ path: 'docs/LEGACY.md', requiredText: 'Status: DEPRECATED' }],
    forbiddenRootFiles: ['benchmark_results.json'],
    documentUpsum: {
      defaultMaxBytes: 32768,
      nearBudgetRatio: 0.1,
      paths: [{ path: 'docs/OVERSIZE.md', maxBytes: 16 }],
    },
  };

  const files = [
    '.env.example',
    'README.md',
    'docs/LEGACY.md',
    'docs/OVERSIZE.md',
    'src/config/index.ts',
    'tools/orphan.ts',
    'unexpected.txt',
  ];

  const expected: PlantedBreak[] = [
    { code: 'broken_markdown_link', path: 'README.md:1' },
    { code: 'deprecated_marker_missing', path: 'docs/LEGACY.md' },
    { code: 'environment_example_extra', path: '.env.example' },
    { code: 'environment_example_missing', path: '.env.example' },
    { code: 'forbidden_root_file', path: 'benchmark_results.json' },
    { code: 'missing_root_directory', path: 'reports' },
    { code: 'missing_root_file', path: 'LICENSE' },
    { code: 'oversized_document', path: 'docs/OVERSIZE.md' },
    { code: 'oversized_root_file', path: 'README.md' },
    { code: 'unexpected_root_directory', path: 'tools' },
    { code: 'unexpected_root_file', path: 'unexpected.txt' },
  ];

  return { contract, files, expected };
}
