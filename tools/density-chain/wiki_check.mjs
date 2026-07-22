#!/usr/bin/env node
// Density-trellis staleness checker — the living-wiki gate.
//
// The map is a description of the repository. When the repository moves and the
// map does not, the map becomes a confident lie, which is worse than no map.
// This script computes WHICH BRANCHES of the map a change touched, so a session
// can update one branch per affected class instead of re-reading the system.
//
// NOTHING IS STORED. Both halves of the question are derived, and that is the
// design, not an optimisation:
//
// 1. ROUTING IS DERIVED FROM THE MAP. The self-index table in DENSITY-CHAIN.md
//    declares, per branch, the paths that branch covers. This script parses that
//    table at run time. There is no committed routing table, so the map and the
//    router cannot disagree. (They did once: the self-index said C8 owned
//    `src/config/index.ts` while an authored table routed it to C11, under a
//    sentence claiming the two were the same data.) Only the residue the map
//    deliberately does not describe is authored, in routing-residue.json.
//
// 2. VERIFICATION IS DERIVED FROM GIT. A branch is current when the last commit
//    that changed its section is at or after the last commit that changed any
//    code it covers. No pin is recorded anywhere. An earlier edition stored a
//    per-class `verified_at` commit, and storing it was the mistake: a stored
//    pin is a claim about a commit that may not survive a squash merge or a
//    rebase, and this repository squashes. When the pin evaporated the class
//    failed stale — correct — and the only way out, a re-stamp, was refused
//    because the section was unedited — also correct. The two right answers
//    composed into a permanent deadlock. Deriving from git removes the pin, the
//    write mode, the hollow-stamp problem, and the deadlock together.
//
// Satisfaction, in order: an uncommitted edit of the branch's own section (you
// are doing the work now); else uncommitted changes to code it covers make it
// stale; else the committed comparison above. Not a sibling section, not a
// sibling file — an editor artifact is not maintenance.
//
// Modes, split by what each can honestly enforce:
//
//   --verify   THE CI HALF. Invariants that hold at any history depth: every
//              visible path routes, every class declares something, every
//              declared glob matches something, the roster agrees three ways, no
//              residue rule shadows a declaration. Exit 0 / 1. Safe to gate on.
//
//   (default)  THE SESSION HALF. Per-class staleness. Needs history, and an
//              in-progress change is legitimately stale, so this reports rather
//              than gates in CI. Exit 0 fresh, 1 stale, 2 error.
//
//   --json / --hook / --list-classes / --explain <path>
//   --print-sections          section ranges and normalized hashes
//   --emit-class-map          the derived routing table, for review
//   --negative-control        plants conditions the gate must detect; healthy = exit 3
//
// Reachability (hard rule 15): non-test callers are `npm run wiki:check`, the
// `--verify` step in .github/workflows/ci.yml, and the Stop/SessionStart hooks in
// .claude/settings.json.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const RESIDUE_PATH = join(HERE, 'routing-residue.json');
const INDEX_PATH = join(REPO_ROOT, 'docs', 'density-chain', 'index.json');
const CHAIN_PATH = 'docs/density-chain/DENSITY-CHAIN.md';
const SELF_INDEX_HEADING = '## The self-index — where each class lives';
const SCHEMA_VERSION = 3;

// ---------------------------------------------------------------- git + glob

function git(args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    // Capture stderr rather than inheriting it: a probing `cat-file -e` that
    // fails is expected control flow, not something to leak into hook output.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitOk(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

/** `a/{b,c}/d` -> ['a/b/d', 'a/c/d']. Non-nested, which is all the map uses. */
function expandBraces(glob) {
  const match = /\{([^{}]*)\}/.exec(glob);
  if (!match) return [glob];
  const [whole, inner] = match;
  return inner.split(',').flatMap((option) => expandBraces(glob.replace(whole, option.trim())));
}

/** Glob subset: `**` (any depth), `*` (one segment), literal else. */
function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`${out}$`);
}

function specificity(glob) {
  return glob.replace(/[*?]/g, '').length;
}

// ------------------------------------------------------- the map declaration

function readMapText() {
  const abs = join(REPO_ROOT, CHAIN_PATH);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/**
 * Split the map into `#### C{n} …` sections. Keyed on the class id ONLY, never
 * on the title: the heading text and the class title are already different
 * strings, so keying on the title would make every rewording look like a
 * delete-plus-add. The heading line IS included in the hashed body, because a
 * retitle is a genuine edit of that branch.
 */
function extractSections(text) {
  const out = new Map();
  if (text === null) return out;
  const lines = text.split(/\r?\n/);
  const spans = new Map();
  let current = null;
  let start = 0;
  const close = (endExclusive) => {
    if (current) spans.set(current, { start, end: endExclusive });
  };
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^#{4}\s+(C\d{1,2})(?=\s|$)/.exec(lines[i]);
    if (heading) {
      close(i);
      current = heading[1];
      start = i;
      continue;
    }
    if (current && /^#{1,4}\s/.test(lines[i])) {
      close(i);
      current = null;
    }
  }
  close(lines.length);
  for (const [id, s] of spans) {
    const body = lines.slice(s.start, s.end).join('\n');
    out.set(id, {
      startLine: s.start + 1,
      endLine: s.end,
      // Collapse whitespace before hashing. NOT cosmetic: core.autocrlf=true
      // means the working tree holds CRLF while `git show` returns LF, so a raw
      // byte hash would read "edited" forever and the gate would report
      // permanently fresh — a total silent failure.
      sha256: createHash('sha256').update(body.replace(/\s+/g, ' ').trim()).digest('hex'),
    });
  }
  return out;
}

function extractRoster(text) {
  if (text === null) return [];
  const roster = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^#{4}\s+(C\d{1,2})\s*[—-]\s*(.+?)\s*$/.exec(line);
    if (m) roster.push({ id: m[1], heading: m[2] });
  }
  return roster;
}

/**
 * Parse the self-index table's `Declares` column. Only backticked spans are
 * read, so the prose around a glob is ignored by construction; `*(none)*`
 * declares nothing.
 */
function extractDeclarations(text) {
  if (text === null) throw new Error(`${CHAIN_PATH} is missing; cannot derive routing`);
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === SELF_INDEX_HEADING);
  if (at === -1) throw new Error(`self-index heading not found in ${CHAIN_PATH}`);
  const declarations = new Map();
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^#{1,3}\s/.test(lines[i])) break;
    const row = /^\|\s*\*\*(C\d{1,2})\*\*\s*\|([^|]*)\|/.exec(lines[i]);
    if (!row) continue;
    declarations.set(
      row[1],
      [...row[2].matchAll(/`([^`]+)`/g)]
        .flatMap((m) => expandBraces(m[1].trim()))
        .filter((g) => g && !g.includes(' ')),
    );
  }
  if (declarations.size === 0) throw new Error(`self-index table parsed to zero declarations`);
  return declarations;
}

// ------------------------------------------------------------ derived router

function loadResidue() {
  return JSON.parse(readFileSync(RESIDUE_PATH, 'utf8'));
}

function buildRouter(mapText) {
  const roster = extractRoster(mapText);
  const declarations = extractDeclarations(mapText);
  const residue = loadResidue();
  const classes = {};
  for (const { id, heading } of roster) classes[id] = heading;

  const compile = (entries) => entries.map((e) => ({ ...e, re: globToRegExp(e.glob) }));

  const merged = new Map();
  for (const [id, globs] of declarations) {
    for (const glob of globs) {
      const existing = merged.get(glob);
      if (existing) existing.classes.push(id);
      else merged.set(glob, { glob, classes: [id], origin: 'declaration', declaredBy: id });
    }
  }
  const declared = compile([...merged.values()]).sort(
    (a, b) => specificity(b.glob) - specificity(a.glob),
  );

  return {
    classes,
    roster: roster.map((r) => r.id),
    declarations,
    declared,
    ignore: compile((residue.ignore ?? []).map((e) => ({ ...e, origin: 'ignore', classes: ['ignore'] }))),
    heuristic: compile((residue.heuristic ?? []).map((e) => ({ ...e, origin: 'heuristic' }))),
    fallback: compile((residue.fallback ?? []).map((e) => ({ ...e, origin: 'fallback' }))),
    residue,
  };
}

/**
 * Route one path. `ignore` wins outright; declared globs UNION (if two branches
 * declare a path, both cover it — making one win would be the router deciding
 * something the map already answered); then heuristics, then fallbacks.
 */
function route(path, router) {
  const ignored = router.ignore.find((r) => r.re.test(path));
  if (ignored) return { classes: ['ignore'], origin: 'ignore', rule: ignored };

  const hits = router.declared.filter((r) => r.re.test(path));
  if (hits.length) {
    return { classes: [...new Set(hits.flatMap((h) => h.classes))], origin: 'declaration', rule: hits[0] };
  }
  const heuristic = router.heuristic.find((r) => r.re.test(path));
  if (heuristic) return { classes: heuristic.classes, origin: 'heuristic', rule: heuristic };

  const fallback = router.fallback.find((r) => r.re.test(path));
  if (fallback) return { classes: fallback.classes, origin: 'fallback', rule: fallback };

  return null;
}

function classify(paths, router) {
  const byClass = new Map();
  const fallback = [];
  const unmapped = [];
  for (const path of paths) {
    const hit = route(path, router);
    if (!hit) {
      unmapped.push(path);
      continue;
    }
    if (hit.origin === 'fallback') fallback.push({ path, glob: hit.rule.glob, classes: hit.classes });
    for (const cls of hit.classes) {
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls).push(path);
    }
  }
  return { byClass, fallback, unmapped };
}

// ----------------------------------------------------------------- git state

function workingTreePaths() {
  const paths = new Set();
  const fields = git([
    '-c', 'core.quotePath=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=all',
  ]).split('\0');
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (path) paths.add(path);
    // Under -z a rename/copy emits the ORIGIN path as the next field.
    if ('RC'.includes(status[0]) || 'RC'.includes(status[1])) {
      i += 1;
      if (fields[i]) paths.add(fields[i]);
    }
  }
  return [...paths].sort();
}

/**
 * The most recent commit that changed any path routing to each class.
 *
 * One history walk, routing each commit's own paths — NOT one pathspec query per
 * class. A pathspec cannot express "matches the broad fallback but not any
 * narrower declaration", so `:(glob)src/**` would attribute a substrate file to
 * the class that merely backstops `src/`. Routing per commit gets it right.
 * Walks newest-first and stops as soon as every class has an answer.
 */
function lastCodeCommitByClass(router) {
  const found = new Map();
  const wanted = new Set(router.roster);
  const raw = git(['log', '--format=%x01%H', '--name-only', '--no-renames']);
  for (const block of raw.split('\x01')) {
    if (!block.trim() || wanted.size === 0) continue;
    const [sha, ...rest] = block.split('\n');
    for (const path of rest) {
      const p = path.trim();
      if (!p) continue;
      const hit = route(p, router);
      if (!hit) continue;
      for (const cls of hit.classes) {
        if (cls === 'ignore' || found.has(cls)) continue;
        found.set(cls, sha.trim());
        wanted.delete(cls);
      }
    }
  }
  return found;
}

/** The most recent commit that changed a given line range of the map. */
function lastSectionCommit(startLine, endLine) {
  try {
    const out = git(['log', '-L', `${startLine},${endLine}:${CHAIN_PATH}`, '--format=%H', '-s']);
    const first = out.split('\n').find((l) => /^[0-9a-f]{40}$/.test(l.trim()));
    return first ? first.trim() : null;
  } catch {
    return null;
  }
}

const isAncestor = (a, b) => gitOk(['merge-base', '--is-ancestor', a, b]);
const isShallow = () => git(['rev-parse', '--is-shallow-repository']).trim() === 'true';

// --------------------------------------------------------------- the verdict

/**
 * THE per-class predicate. PURE — every git fact is injected, so the falsifier
 * exercises this function rather than a re-implementation of it. A control that
 * asserts against a copy can stay green while the shipped gate goes blind, which
 * is the failure hard rule 19c names.
 */
function sectionVerdict({
  sectionPresent,
  sectionEditedNow,
  routedWorkingPaths,
  lastCode,
  lastSection,
  codeIsAncestorOfSection,
  mapCommitted,
  shallow,
}) {
  if (!sectionPresent) return { verified: false, reason: 'orphaned_section' };
  // You are doing the work right now. This comes first deliberately: a session
  // that edits code and its branch together is the ideal case, not a conflict.
  if (sectionEditedNow) return { verified: true, reason: null };
  if (routedWorkingPaths.length) return { verified: false, reason: 'uncommitted_paths_moved' };
  // An unknown window must not gate. Report it and move on.
  if (shallow) return { verified: true, reason: null, unknown: 'shallow_clone' };
  if (!mapCommitted) return { verified: true, reason: null, unknown: 'map_not_committed' };
  if (!lastCode) return { verified: true, reason: null };
  if (!lastSection) return { verified: false, reason: 'branch_never_committed' };
  // A commit is its own ancestor, so a section edited in the SAME commit as the
  // code it describes reads fresh — which is exactly the behaviour to reward.
  if (codeIsAncestorOfSection) return { verified: true, reason: null };
  return { verified: false, reason: 'code_newer_than_branch' };
}

function classVerdicts({ router, workingPaths, nowSections, headSections, gitFacts }) {
  return router.roster.map((id) => {
    const now = nowSections.get(id);
    const head = headSections.get(id);
    const routedWorkingPaths = workingPaths.filter((p) => (route(p, router)?.classes ?? []).includes(id));
    const facts = gitFacts.get(id) ?? {};
    const v = sectionVerdict({
      sectionPresent: Boolean(now),
      sectionEditedNow: Boolean(now) && (!head || head.sha256 !== now.sha256),
      routedWorkingPaths,
      lastCode: facts.lastCode ?? null,
      lastSection: facts.lastSection ?? null,
      codeIsAncestorOfSection: facts.codeIsAncestorOfSection ?? false,
      mapCommitted: gitFacts.mapCommitted ?? false,
      shallow: gitFacts.shallow ?? false,
    });
    return {
      id,
      title: router.classes[id] ?? '(unnamed)',
      ...v,
      last_code: facts.lastCode ? facts.lastCode.slice(0, 7) : null,
      last_section: facts.lastSection ? facts.lastSection.slice(0, 7) : null,
      routed: routedWorkingPaths,
      routed_count: routedWorkingPaths.length,
    };
  });
}

function gatherGitFacts(router, nowSections, mapCommitted, shallow) {
  const facts = new Map();
  facts.mapCommitted = mapCommitted;
  facts.shallow = shallow;
  if (shallow || !mapCommitted) return facts;
  const lastCode = lastCodeCommitByClass(router);
  for (const id of router.roster) {
    const section = nowSections.get(id);
    const ls = section ? lastSectionCommit(section.startLine, section.endLine) : null;
    const lc = lastCode.get(id) ?? null;
    facts.set(id, {
      lastCode: lc,
      lastSection: ls,
      codeIsAncestorOfSection: Boolean(lc && ls && isAncestor(lc, ls)),
    });
  }
  return facts;
}

function loadIndex() {
  return existsSync(INDEX_PATH) ? JSON.parse(readFileSync(INDEX_PATH, 'utf8')) : null;
}

function report() {
  const mapText = readMapText();
  const router = buildRouter(mapText);
  const workingPaths = workingTreePaths();
  const nowSections = extractSections(mapText);
  const mapCommitted = gitOk(['cat-file', '-e', `HEAD:${CHAIN_PATH}`]);
  const headSections = mapCommitted ? extractSections(git(['show', `HEAD:${CHAIN_PATH}`])) : new Map();
  const shallow = isShallow();

  const gitFacts = gatherGitFacts(router, nowSections, mapCommitted, shallow);
  const verdicts = classVerdicts({ router, workingPaths, nowSections, headSections, gitFacts });
  const { fallback, unmapped } = classify(workingPaths, router);
  const stale = verdicts.filter((v) => !v.verified);

  return {
    schema_version: SCHEMA_VERSION,
    head: git(['rev-parse', '--short', 'HEAD']).trim(),
    map_committed: mapCommitted,
    shallow,
    working_path_count: workingPaths.length,
    stale: stale.length > 0 || unmapped.length > 0,
    stale_classes: stale.map((v) => ({
      id: v.id, title: v.title, reason: v.reason,
      last_code: v.last_code, last_section: v.last_section,
      path_count: v.routed_count, paths: v.routed.slice(0, 10),
    })),
    verified_classes: verdicts.filter((v) => v.verified).map((v) => v.id),
    unknown: verdicts.find((v) => v.unknown)?.unknown ?? null,
    needs_rule: unmapped.length > 0,
    fallback_routed: fallback.slice(0, 20),
    unmapped_paths: unmapped.slice(0, 20),
  };
}

function humanReport(r) {
  const lines = [];
  lines.push(`density-trellis  HEAD ${r.head}  (verification derived from git, no stored pins)`);
  if (r.unknown === 'shallow_clone') lines.push('note: shallow clone — the committed window is unknowable here; not gating on it.');
  if (r.unknown === 'map_not_committed') lines.push('note: the map is not committed at HEAD yet; every section reads as new.');
  lines.push(
    `${r.working_path_count} uncommitted path(s); ` +
      `${r.verified_classes.length} class(es) current, ${r.stale_classes.length} stale`,
  );
  for (const c of r.stale_classes) {
    lines.push(`  ${c.id}  ${c.title}`);
    lines.push(`      ${c.reason}${c.last_code ? ` · code ${c.last_code} > branch ${c.last_section ?? 'never'}` : ''}`);
    for (const p of c.paths) lines.push(`      - ${p}`);
  }
  if (r.fallback_routed.length) {
    lines.push('routed by FALLBACK only (a new subsystem may need its own declaration):');
    for (const f of r.fallback_routed) lines.push(`      ${f.path}   [${f.glob} -> ${f.classes.join(',')}]`);
  }
  if (r.unmapped_paths.length) {
    lines.push('NEEDS A RULE - these paths match nothing, so no branch describes them:');
    for (const p of r.unmapped_paths) lines.push(`      ${p}`);
  }
  lines.push(r.stale ? 'STALE - the map does not yet describe these changes.' : 'CURRENT');
  return lines.join('\n');
}

// -------------------------------------------------------------------- verify

function runVerify() {
  const mapText = readMapText();
  const problems = [];
  let router;
  try {
    router = buildRouter(mapText);
  } catch (err) {
    process.stdout.write(`density-trellis contract: FAIL (1 issue)\n- ${err.message}\n`);
    return 1;
  }

  const visible = git([
    '-c', 'core.quotePath=false',
    'ls-files', '--cached', '--others', '--exclude-standard', '-z',
  ]).split('\0').filter(Boolean).filter((p) => existsSync(join(REPO_ROOT, p)));

  const { unmapped } = classify(visible, router);
  if (unmapped.length) {
    problems.push(`${unmapped.length} path(s) match no rule: ${unmapped.slice(0, 8).join(', ')}${unmapped.length > 8 ? ' …' : ''}`);
  }
  for (const rule of router.declared) {
    if (!visible.some((p) => rule.re.test(p))) {
      problems.push(`declared glob matches nothing: \`${rule.glob}\` (declared by ${rule.classes.join(',')})`);
    }
  }
  for (const id of router.roster) {
    if (!(router.declarations.get(id) ?? []).length) problems.push(`class ${id} declares no paths in the self-index`);
  }
  const declaredGlobs = new Set(router.declared.map((r) => r.glob));
  for (const kind of ['ignore', 'heuristic', 'fallback']) {
    for (const entry of router.residue[kind] ?? []) {
      if (!entry.why) problems.push(`${kind} rule \`${entry.glob}\` has no \`why\``);
      if (declaredGlobs.has(entry.glob)) problems.push(`${kind} rule \`${entry.glob}\` duplicates a declared glob`);
    }
  }

  const index = loadIndex();
  if (!index) problems.push('docs/density-chain/index.json is missing');
  else {
    if (index.schema_version !== SCHEMA_VERSION) {
      problems.push(`index.json schema_version is ${index.schema_version}, expected ${SCHEMA_VERSION}`);
    }
    const fromIndex = (index.notes?.[0]?.branches ?? []).map((b) => b.id);
    if (fromIndex.join(',') !== router.roster.join(',')) {
      problems.push(`index.json roster ≠ map headings (index: ${fromIndex.join(',')} | map: ${router.roster.join(',')})`);
    }
    // The pin fields are gone; verification is git-derived. A leftover pin would
    // read as authoritative to a human while binding nothing.
    for (const b of index.notes?.[0]?.branches ?? []) {
      for (const dead of ['verified_at', 'section_sha256', 'verified_by', 'verified_on']) {
        if (dead in b) problems.push(`${b.id}: stale field \`${dead}\` — verification is derived from git, not stored`);
      }
    }
  }
  if ([...router.declarations.keys()].join(',') !== router.roster.join(',')) {
    problems.push('self-index roster ≠ map headings');
  }
  const sections = extractSections(mapText);
  for (const id of router.roster) {
    if (!sections.has(id)) problems.push(`class ${id} has no \`#### ${id}\` section in the map`);
  }

  if (problems.length) {
    process.stdout.write(`density-trellis contract: FAIL (${problems.length} issue(s))\n`);
    for (const p of problems) process.stdout.write(`- ${p}\n`);
    return 1;
  }
  process.stdout.write(
    `density-trellis contract: PASS (${visible.length} paths routed; ${router.roster.length} branch classes, ` +
      `roster agrees three ways; ${router.declared.length} declared globs, ` +
      `${(router.residue.heuristic ?? []).length} heuristics, ${(router.residue.fallback ?? []).length} fallbacks; ` +
      `no stored pins)\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------- hook

function markerPath(sessionId) {
  if (!sessionId) return null;
  const repoKey = createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 12);
  const dir = join(tmpdir(), 'trellis-density-chain');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${repoKey}-${String(sessionId).replace(/[^\w.-]/g, '_')}.fired`);
}

function hookMode() {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    payload = {};
  }
  const event = payload.hook_event_name ?? 'Stop';
  let r;
  try {
    r = report();
  } catch (err) {
    process.stdout.write(JSON.stringify({ suppressOutput: true, systemMessage: `density-trellis check skipped: ${err.message}` }));
    return 0;
  }
  if (!r.stale) {
    process.stdout.write(JSON.stringify({ suppressOutput: true }));
    return 0;
  }

  const roster = r.stale_classes.map((c) => `${c.id} (${c.reason})`).join(', ');
  // A REMINDER, not a guarantee. The detection above is tooling shape; the
  // dispatch below is a sentence, and nothing enforces it (hard rule 8).
  const brief =
    `The density-trellis at ${CHAIN_PATH} is stale in ${r.stale_classes.length} branch class(es): ${roster}. ` +
    `The detection is enforced; what follows is a reminder, not a gate. House practice: spawn one ` +
    `read-only updating sub-agent PER STALE CLASS, have each return a densified replacement for its ` +
    `branch section at the held tier budget, and apply them. Nothing needs stamping — a branch counts ` +
    `as current once its section is edited, and committing the section alongside the code it describes ` +
    `keeps it current permanently. Densify, never append. See docs/density-chain/README.md.`;

  if (event === 'SessionStart') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief },
      systemMessage: `density-trellis: ${r.stale_classes.length} branch class(es) stale`,
    }));
    return 0;
  }

  let marker = null;
  try {
    marker = markerPath(payload.session_id);
    if (marker && existsSync(marker)) {
      process.stdout.write(JSON.stringify({ systemMessage: `density-trellis still stale: ${roster}` }));
      return 0;
    }
    if (marker) writeFileSync(marker, new Date().toISOString(), 'utf8');
  } catch {
    marker = null;
  }
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: brief,
    systemMessage: `density-trellis stale -> ${r.stale_classes.length} branch class(es): ${roster}`,
  }));
  return 0;
}

// --------------------------------------------------------- negative control

function runNegativeControl() {
  const mapText = readMapText();
  const router = buildRouter(mapText);
  const planted = [];
  const routes = (path, id) => (route(path, router)?.classes ?? []).includes(id);

  if (routes('src/core/graph/support.ts', 'C3')) planted.push('declaration_drives_routing');
  if (routes('src/config/index.ts', 'C8')) planted.push('c8_owns_its_declared_config_file');
  if (route(CHAIN_PATH, router)?.classes.join(',') === 'ignore') planted.push('ignores_the_map_itself');
  if (route('src/brand_new_subsystem/thing.ts', router)?.origin === 'fallback') planted.push('flags_a_fallback_route');
  if (route('services/brand-new/thing.go', router) === null) planted.push('unmapped_path_has_no_route');

  const withoutC12 = mapText.replace(/^\| \*\*C12\*\* \|.*$/m, '| **C12** | *(none)* | *(none)* |');
  if (!(route('docs/product/repl-sandbox/README.md', buildRouter(withoutC12))?.classes ?? []).includes('C12')) {
    planted.push('deleted_declaration_drops_its_route');
  }
  if (buildRouter(`${mapText}\n\n#### C14 — a synthetic class\n\n`).roster.includes('C14')) {
    planted.push('new_heading_extends_the_roster');
  }

  const sections = extractSections(mapText);
  if (sections.has('C5') && sections.has('C6')) planted.push('sections_extract_per_class');
  if (extractSections(mapText.replace(/\n/g, '\r\n')).get('C5')?.sha256 === sections.get('C5')?.sha256) {
    planted.push('crlf_is_not_an_edit');
  }
  if (extractSections(mapText.replace(/\. /g, '.  ')).get('C5')?.sha256 === sections.get('C5')?.sha256) {
    planted.push('reflow_is_not_an_edit');
  }

  // The SHIPPED predicate, on injected git facts.
  const base = {
    sectionPresent: true, sectionEditedNow: false, routedWorkingPaths: [],
    lastCode: 'code', lastSection: 'sect', codeIsAncestorOfSection: true,
    mapCommitted: true, shallow: false,
  };
  if (sectionVerdict(base).verified) planted.push('branch_after_code_is_current');
  if (sectionVerdict({ ...base, codeIsAncestorOfSection: false }).reason === 'code_newer_than_branch') {
    planted.push('code_after_branch_is_stale');
  }
  if (sectionVerdict({ ...base, codeIsAncestorOfSection: false, sectionEditedNow: true }).verified) {
    planted.push('working_tree_section_edit_satisfies');
  }
  if (sectionVerdict({ ...base, routedWorkingPaths: ['src/x.ts'] }).reason === 'uncommitted_paths_moved') {
    planted.push('uncommitted_code_change_is_stale');
  }
  if (sectionVerdict({ ...base, sectionPresent: false }).reason === 'orphaned_section') {
    planted.push('missing_section_is_orphaned');
  }
  if (sectionVerdict({ ...base, lastSection: null, codeIsAncestorOfSection: false }).reason === 'branch_never_committed') {
    planted.push('never_committed_branch_is_stale');
  }
  if (sectionVerdict({ ...base, shallow: true, codeIsAncestorOfSection: false }).unknown === 'shallow_clone') {
    planted.push('shallow_clone_does_not_gate');
  }
  // The deadlock the stored-pin edition had: no stored pin can become
  // unresolvable, so a squash merge cannot wedge a class.
  if (sectionVerdict({ ...base, codeIsAncestorOfSection: false, sectionEditedNow: true }).verified
      && sectionVerdict({ ...base, codeIsAncestorOfSection: true }).verified) {
    planted.push('no_unresolvable_pin_state_exists');
  }

  const expected = [
    'declaration_drives_routing', 'c8_owns_its_declared_config_file', 'ignores_the_map_itself',
    'flags_a_fallback_route', 'unmapped_path_has_no_route', 'deleted_declaration_drops_its_route',
    'new_heading_extends_the_roster', 'sections_extract_per_class', 'crlf_is_not_an_edit',
    'reflow_is_not_an_edit', 'branch_after_code_is_current', 'code_after_branch_is_stale',
    'working_tree_section_edit_satisfies', 'uncommitted_code_change_is_stale',
    'missing_section_is_orphaned', 'never_committed_branch_is_stale', 'shallow_clone_does_not_gate',
    'no_unresolvable_pin_state_exists',
  ];
  const missed = expected.filter((n) => !planted.includes(n));
  if (missed.length) {
    process.stderr.write(`negative-control BROKEN: the gate did not exhibit ${missed.join(', ')}.\n`);
    return 1;
  }
  process.stdout.write(`Negative control detected all ${expected.length} planted conditions: ${expected.join(', ')}\n`);
  return 3;
}

// ----------------------------------------------------------------------- CLI

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--hook')) return hookMode();
  if (argv.includes('--verify')) return runVerify();
  if (argv.includes('--negative-control')) return runNegativeControl();

  if (argv.includes('--list-classes')) {
    const router = buildRouter(readMapText());
    for (const id of router.roster) process.stdout.write(`${id}\t${router.classes[id]}\n`);
    return 0;
  }
  if (argv.includes('--print-sections')) {
    for (const [id, s] of extractSections(readMapText())) {
      process.stdout.write(`${id}\tlines ${s.startLine}-${s.endLine}\t${s.sha256}\n`);
    }
    return 0;
  }
  if (argv.includes('--emit-class-map')) {
    const router = buildRouter(readMapText());
    process.stdout.write(`${JSON.stringify({
      derived_at: new Date().toISOString().slice(0, 10),
      derived_from: { declaration: `${CHAIN_PATH}#the-self-index`, residue: 'tools/density-chain/routing-residue.json' },
      classes: router.classes,
      declared: router.declared.map((r) => ({ glob: r.glob, classes: r.classes, specificity: specificity(r.glob) })),
      heuristic: router.heuristic.map((r) => ({ glob: r.glob, classes: r.classes })),
      fallback: router.fallback.map((r) => ({ glob: r.glob, classes: r.classes })),
    }, null, 2)}\n`);
    return 0;
  }
  const explainAt = argv.indexOf('--explain');
  if (explainAt !== -1) {
    const target = argv[explainAt + 1];
    if (!target) {
      process.stderr.write('--explain needs a repo-relative path\n');
      return 2;
    }
    const router = buildRouter(readMapText());
    const hit = route(target, router);
    process.stdout.write(hit
      ? `${target}\t${hit.rule.glob}\t${hit.classes.join(',')}\t(${hit.origin}${hit.rule.declaredBy ? ` by ${hit.rule.declaredBy}` : ''})\n`
      : `${target}\t(no rule matched)\n`);
    return 0;
  }

  const r = report();
  process.stdout.write(`${argv.includes('--json') ? JSON.stringify(r, null, 2) : humanReport(r)}\n`);
  return r.stale ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`density-trellis check error: ${err.stack ?? err.message}\n`);
    process.exitCode = 2;
  }
}

export {
  globToRegExp, expandBraces, specificity,
  extractSections, extractRoster, extractDeclarations,
  buildRouter, route, classify,
  sectionVerdict, classVerdicts, lastCodeCommitByClass, report,
};
