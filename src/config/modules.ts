import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// The module registry (Session 15; design record §9). A module is a
// versioned document-plus-assets artifact under `modules/<name>/`:
// a `module.json` manifest plus a brace-free addendum text file that
// the Python agent composes into the RLM system prompt. This kernel
// edition supports PROTOCOL MODULES only — manifests declaring tools
// are rejected (tool-bearing modules are a later class with their own
// landing gate, §9.3).
//
// Selection is operator-owned (Guardrail 5): TRELLIS_MODULES is unset
// (the default selection — module #0, byte-identical composed prompt)
// or a JSON array of registered names; [] composes no modules. The
// Node side validates fail-fast at startup so a process that cannot
// know its prompt surface never runs; the Python twin
// (src/rlm/trellis_modules.py) re-validates defensively with identical
// bounds and performs the actual composition.

export const MODULE_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
export const MODULES_MAX_PER_RUN = 4;
export const MODULE_ADDENDUM_MAX_BYTES_CAP = 16 * 1024;
export const MODULE_ADDENDUM_MAX_BYTES_DEFAULT = 8 * 1024;
export const DEFAULT_MODULE_SELECTION = ['spatial-flywheel'] as const;

// Addendum files carry no literal braces (the rlms .format() contract);
// rubric text enters through this token only, substituted Python-side
// with the escape-doubled rubric.
export const MODULE_RUBRIC_TOKEN = '<<TRELLIS_RUBRIC>>';

/**
 * The one command that accepts a module, derived from its name.
 *
 * Exported so the schema's equality check, the authoring assembler, the
 * lifecycle drill's fixtures, and the drill itself all read the string from
 * one place. A criterion restated in several files is the defect this whole
 * guard exists to close, one level up: an invariant stated twice can drift.
 */
export function moduleAcceptanceCommand(name: string): string {
  return `npm run test:module -- ${name}`;
}

const ModuleNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(MODULE_NAME_PATTERN, `module names must match ${MODULE_NAME_PATTERN}`);

const ModuleManifestSchema = z
  .object({
    name: ModuleNameSchema,
    version: z.number().int().positive(),
    purpose: z.string().min(1).max(512),
    research: z.object({
      sourceNodeIds: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
    }),
    addendum: z
      .string()
      .min(1)
      .refine(
        value => !value.includes('/') && !value.includes('\\') && !value.includes('..'),
        'addendum must be a bare filename inside the module directory'
      ),
    tools: z
      .array(z.never())
      .max(0, 'tool-bearing modules are not supported by this kernel edition'),
    bounds: z
      .object({
        addendumMaxBytes: z
          .number()
          .int()
          .positive()
          .max(MODULE_ADDENDUM_MAX_BYTES_CAP)
          .default(MODULE_ADDENDUM_MAX_BYTES_DEFAULT),
      })
      .default({ addendumMaxBytes: MODULE_ADDENDUM_MAX_BYTES_DEFAULT }),
    acceptance: z.object({ zeroPaid: z.string().min(1) }),
    status: z.enum(['active', 'contested', 'retired']),
    kernelCompat: z.literal(1),
  })
  .strict()
  // A criterion every module shares discriminates nothing: all four modules on
  // disk declared the same `npm run test:modules`, which pins the
  // cross-language loader contract and would pass unchanged if a module's
  // addendum were lorem ipsum. So the drill has to name the module it accepts.
  // The check reads a sibling field (`name`), hence a whole-object refinement
  // rather than a rule inside the `acceptance` sub-schema; it sits in the
  // schema rather than the registration CLI because it must hold zero-paid
  // with no databases, and readModuleManifest is the single seam every path —
  // composition, authoring, registration, the per-module drill — goes through.
  //
  // Equality, not containment. Containment left two holes: a module named
  // `test` satisfied it with the very constant this rule exists to reject,
  // and any command naming the module passed even when no such script exists
  // (`npm run bogus -- <name>`). Equality against the one command the drill
  // actually answers to closes both, and makes the recorded criterion
  // copy-pasteable — what the manifest says is what runs.
  .superRefine((manifest, ctx) => {
    const zeroPaid = manifest.acceptance?.zeroPaid;
    const expected = moduleAcceptanceCommand(manifest.name);
    if (typeof zeroPaid === 'string' && zeroPaid !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['acceptance', 'zeroPaid'],
        message:
          `acceptance.zeroPaid must be the drill that accepts this module: expected ` +
          `${JSON.stringify(expected)}, got ${JSON.stringify(zeroPaid)}.`,
      });
    }
  });

export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

export interface TrellisModule {
  name: string;
  version: number;
  purpose: string;
  /** LF-normalized addendum text (pre-substitution, brace-free). */
  addendumText: string;
}

/**
 * Parses the operator's module selection. Unset means the DEFAULT
 * selection (module #0 loaded — the composed prompt stays
 * byte-identical to the pre-Session-15 monolith); a JSON array means
 * exactly that selection ([] composes no modules).
 */
export function parseModuleSelection(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [...DEFAULT_MODULE_SELECTION];
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`TRELLIS_MODULES is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error('Invalid TRELLIS_MODULES: expected a JSON array of module names.');
  }
  if (data.length > MODULES_MAX_PER_RUN) {
    throw new Error(`Invalid TRELLIS_MODULES: at most ${MODULES_MAX_PER_RUN} modules per run.`);
  }
  const seen = new Set<string>();
  for (const name of data) {
    const parsed = ModuleNameSchema.safeParse(name);
    if (!parsed.success) {
      throw new Error(
        `Invalid TRELLIS_MODULES: module name ${JSON.stringify(name)} must match ${MODULE_NAME_PATTERN} (max 64 chars).`
      );
    }
    if (seen.has(parsed.data)) {
      throw new Error(`Invalid TRELLIS_MODULES: duplicate module name '${parsed.data}'.`);
    }
    seen.add(parsed.data);
  }
  return data as string[];
}

/** Canonical serialization forwarded to the spawned agent. */
export function serializeModuleSelection(selection: string[]): string {
  return JSON.stringify(selection);
}

/**
 * Reads and shape-validates one module manifest WITHOUT the composition
 * gates (active status, addendum checks). Session 18: the registration
 * CLI needs to read contested/retired manifests — their graph entities
 * still exist and their verify report still matters — while composition
 * (loadModule below) keeps refusing them.
 */
export function readModuleManifest(name: string, modulesDir: string = path.resolve('modules')): ModuleManifest {
  const manifestPath = path.join(modulesDir, name, 'module.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Module '${name}' is not registered: missing ${manifestPath}.`);
  }
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Module '${name}' manifest is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = ModuleManifestSchema.safeParse(manifestRaw);
  if (!parsed.success) {
    throw new Error(`Module '${name}' manifest is invalid: ${z.prettifyError(parsed.error)}`);
  }
  const manifest = parsed.data;
  if (manifest.name !== name) {
    throw new Error(`Module '${name}' manifest name '${manifest.name}' must equal its directory name.`);
  }
  return manifest;
}

/**
 * Lists every registered module name (directories under modulesDir that
 * carry a module.json), sorted for stable operator output.
 */
export function listModuleNames(modulesDir: string = path.resolve('modules')): string[] {
  if (!fs.existsSync(modulesDir)) return [];
  return fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(modulesDir, entry.name, 'module.json')))
    .map(entry => entry.name)
    .sort();
}

/**
 * Loads and validates one registered module — manifest shape, active
 * status, addendum existence, size bound, and brace-freedom. Line
 * endings are normalized to LF so the composed prompt is byte-stable
 * across checkout conventions (the Python loader's universal-newline
 * read does the same).
 */
export function loadModule(name: string, modulesDir: string = path.resolve('modules')): TrellisModule {
  const manifest = readModuleManifest(name, modulesDir);
  if (manifest.status !== 'active') {
    throw new Error(`Module '${name}' has status '${manifest.status}' and cannot be composed (only active modules load).`);
  }

  const addendumPath = path.join(modulesDir, name, manifest.addendum);
  if (!fs.existsSync(addendumPath)) {
    throw new Error(`Module '${name}' addendum file '${manifest.addendum}' is missing.`);
  }
  const addendumText = fs.readFileSync(addendumPath, 'utf-8').replace(/\r\n/g, '\n');
  if (Buffer.byteLength(addendumText, 'utf-8') > manifest.bounds.addendumMaxBytes) {
    throw new Error(
      `Module '${name}' addendum exceeds its addendumMaxBytes bound (${manifest.bounds.addendumMaxBytes}).`
    );
  }
  if (addendumText.includes('{') || addendumText.includes('}')) {
    throw new Error(
      `Module '${name}' addendum contains literal braces; rlms .format() forbids them ` +
        `(use the ${MODULE_RUBRIC_TOKEN} substitution token for rubric text).`
    );
  }

  return {
    name: manifest.name,
    version: manifest.version,
    purpose: manifest.purpose,
    addendumText,
  };
}

export function loadModules(selection: string[], modulesDir?: string): TrellisModule[] {
  return selection.map(name => loadModule(name, modulesDir));
}
