import { COMPUTED_MATERIAL_PRODUCERS, type ComputedMaterialProducer } from './requirements.js';

/**
 * The two static checks EL-11 adds, as pure functions over supplied bytes.
 *
 * Pure on purpose: a check that reads the filesystem itself can only be tested
 * against the real repository, so the only way to see it fail is to break the
 * real repository. These take their inputs as arguments, so the suite can hand
 * them a fixture that is missing a row or a caller and watch them go red — which
 * is the difference between a check and an assertion nobody has ever tested.
 *
 * Both close the same disease. `statusAuthority` rotted for four features because
 * it lived in prose with no requirement, no conformance row, and no test that
 * could fail. The seeder shipped unreachable because no test asserted that a
 * non-test caller existed. The steady-state write path was never built because
 * record 9.6 described it and no row required it. Prose that describes required
 * behavior and carries no failing test is behavior that does not get built.
 */

export const CONFORMANCE_MATRIX_SECTION = '## 18. Conformance matrix';
const SECTION_AFTER_MATRIX = '## 19.';

export interface DeclaredRequirement {
  id: string;
  line: number;
}

export interface MappedRequirement {
  id: string;
  line: number;
  owningFeature: string;
  catalogAcceptance: string;
  plannedClass: string;
}

export interface ConformanceLinkage {
  declared: readonly DeclaredRequirement[];
  mapped: readonly MappedRequirement[];
  /** Declared with no conformance row: `EL-01-A2`'s exact failure. */
  unmapped: readonly string[];
  /** A row for a requirement no section declares: a mapping to nothing. */
  undeclared: readonly string[];
  duplicateDeclarations: readonly string[];
  duplicateRows: readonly string[];
}

/**
 * The first cell of a table row, when that cell is a requirement identifier.
 *
 * Deliberately says nothing about the rest of the line. `EL-REQ-STATE-010`'s text
 * begins with a backtick rather than a capital (its subject is the literal
 * `accepted`), and a pattern that assumed a capital would report it as an orphan
 * — a false alarm that costs a session more than the check saves.
 */
const REQUIREMENT_ROW = /^\|\s*`(EL-REQ-[A-Z]+-\d+)`\s*\|/;

const MATRIX_ROW = /^\|\s*`(EL-REQ-[A-Z]+-\d+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([a-z_]+)\s*\|\s*$/;

function duplicates(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated].sort();
}

/**
 * Splits SPEC bytes into the requirements its section tables declare and the rows
 * its conformance matrix maps, and reports every disagreement.
 *
 * `EL-01-A2` — "Every normative MUST maps to a feature and a planned conformance
 * test" — has been a catalog acceptance criterion since EL-01 and had never been
 * mechanized. `EL-REQ-APPROVAL-012` was declared with no row and 113 of 114
 * requirements mapped, and nothing failed, because nothing could.
 */
export function analyzeConformanceLinkage(specText: string): ConformanceLinkage {
  const lines = specText.split('\n');
  const matrixStart = lines.findIndex(line => line.startsWith(CONFORMANCE_MATRIX_SECTION));
  if (matrixStart < 0) throw new Error(`SPEC has no '${CONFORMANCE_MATRIX_SECTION}' section`);
  const afterMatrix = lines.findIndex((line, index) => index > matrixStart && line.startsWith(SECTION_AFTER_MATRIX));
  const matrixEnd = afterMatrix < 0 ? lines.length : afterMatrix;

  const declared: DeclaredRequirement[] = [];
  const mapped: MappedRequirement[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = REQUIREMENT_ROW.exec(lines[index]);
    if (match === null) continue;
    const inMatrix = index > matrixStart && index < matrixEnd;
    if (!inMatrix) {
      declared.push({ id: match[1], line: index + 1 });
      continue;
    }
    const row = MATRIX_ROW.exec(lines[index]);
    if (row === null) {
      throw new Error(`Conformance row at SPEC line ${index + 1} is malformed: ${lines[index].slice(0, 120)}`);
    }
    mapped.push({
      id: row[1],
      line: index + 1,
      owningFeature: row[2],
      catalogAcceptance: row[3],
      plannedClass: row[4],
    });
  }

  const declaredIds = declared.map(item => item.id);
  const mappedIds = mapped.map(item => item.id);
  const declaredSet = new Set(declaredIds);
  const mappedSet = new Set(mappedIds);
  return {
    declared,
    mapped,
    unmapped: declaredIds.filter(id => !mappedSet.has(id)).sort(),
    undeclared: mappedIds.filter(id => !declaredSet.has(id)).sort(),
    duplicateDeclarations: duplicates(declaredIds),
    duplicateRows: duplicates(mappedIds),
  };
}

export interface ProducerReachability extends ComputedMaterialProducer {
  reachable: boolean;
  /** The entrypoint-reachable modules that reference the builder, excluding its definer. */
  callers: readonly string[];
}

export interface ReachabilityReport {
  /** Modules a package script executes directly. */
  entrypoints: readonly string[];
  /** Every non-test module transitively imported from an entrypoint. */
  reachableModules: readonly string[];
  producers: readonly ProducerReachability[];
  /** Ceremonies whose authorizing material no principal can obtain. */
  unreachable: readonly ProducerReachability[];
}

/** A module's relative import specifiers, as written. */
function relativeImports(source: string): readonly string[] {
  return [...source.matchAll(/from\s+'(\.\/[^']+)'/g)].map(match => match[1]);
}

/** `./seed.js` as written in a TypeScript ESM import resolves to `seed.ts` on disk. */
function specifierToModule(specifier: string): string {
  return specifier.replace(/^\.\//, '').replace(/\.js$/, '.ts');
}

/**
 * Derives which modules a package script can actually execute, then which
 * producers those modules reach.
 *
 * Honest scope, stated rather than implied: reachability is resolved at module
 * granularity over static relative imports. A symbol defined in a module nothing
 * reaches is unreachable, which is the failure this check exists to catch. A
 * symbol sitting unused inside a module that *is* reached would be reported
 * reachable, so this is a lower bound on unreachability rather than a proof of
 * liveness. It is enough to catch a ceremony no entrypoint can invoke, which is
 * the defect that has now shipped twice.
 */
export function analyzeProducerReachability(input: {
  /** package.json `scripts`, name to command. */
  scripts: Record<string, string>;
  /** Module basename to source text, for every non-test module under src. */
  sources: Record<string, string>;
  /** The source root the scripts name, e.g. `tools/engineering-loop/src`. */
  sourceRoot: string;
  producers?: readonly ComputedMaterialProducer[];
}): ReachabilityReport {
  const producers = input.producers ?? COMPUTED_MATERIAL_PRODUCERS;

  const entrypoints: string[] = [];
  for (const command of Object.values(input.scripts)) {
    for (const match of command.matchAll(/[\w./-]+/g)) {
      const token = match[0];
      if (!token.startsWith(`${input.sourceRoot}/`)) continue;
      const module = token.slice(input.sourceRoot.length + 1);
      if (module in input.sources && !entrypoints.includes(module)) entrypoints.push(module);
    }
  }

  const reachableModules: string[] = [];
  const queue = [...entrypoints];
  while (queue.length > 0) {
    const module = queue.shift() as string;
    if (reachableModules.includes(module)) continue;
    reachableModules.push(module);
    const source = input.sources[module];
    if (source === undefined) continue;
    for (const specifier of relativeImports(source)) {
      const next = specifierToModule(specifier);
      if (next in input.sources && !reachableModules.includes(next)) queue.push(next);
    }
  }

  const resolved = producers.map(producer => {
    const callers = reachableModules
      .filter(module => module !== producer.module && (input.sources[module] ?? '').includes(producer.requestBuilder))
      .sort();
    return { ...producer, callers, reachable: callers.length > 0 };
  });

  return {
    entrypoints: [...entrypoints].sort(),
    reachableModules: [...reachableModules].sort(),
    producers: resolved,
    unreachable: resolved.filter(producer => !producer.reachable),
  };
}
