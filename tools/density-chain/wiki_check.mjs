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
//              residue rule shadows a declaration, and every inline <script> in
//              the HTML render compiles. Exit 0 / 1. Safe to gate on.
//
//   (default)  THE SESSION HALF. Per-class staleness. Needs history, and an
//              in-progress change is legitimately stale, so this reports rather
//              than gates in CI. Exit 0 fresh, 1 stale, 2 error.
//
//   --json / --hook / --list-classes / --explain <path>
//   --check-html              the render's inline <script> gate, on its own
//   --print-sections          section ranges and normalized hashes
//   --emit-class-map          the derived routing table, for review
//   --negative-control        plants conditions the gate must detect; healthy = exit 3
//
// Reachability (hard rule 15): non-test callers are `npm run wiki:check`, the
// `--verify` step in .github/workflows/ci.yml, and the Stop/SessionStart hooks in
// .claude/settings.json.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Script } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const RESIDUE_PATH = join(HERE, 'routing-residue.json');
const INDEX_PATH = join(REPO_ROOT, 'docs', 'density-chain', 'index.json');
const CHAIN_PATH = 'docs/density-chain/DENSITY-CHAIN.md';
const RENDER_PATH = 'docs/density-chain/DENSITY-CHAIN.html';
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
 * Split each `#### C{n}` section into its `- **T{k} — label.**` tier bullets.
 *
 * A tier runs from its own bullet to the next tier bullet, the first `*Status
 * ledger:*`-style italic footer, or the next heading — whichever comes first.
 *
 * The counting convention is fixed HERE rather than left to the caller, and
 * that is the whole point of this function. Three separate readers counting
 * one tier by eye returned 799, 803 and 844 words for the same bytes, because
 * each made a different call on the bullet label and on code spans. A budget
 * measured three ways is not a budget. The convention: drop the
 * `- **T{k} — label.**` prefix, then count whitespace-separated tokens on what
 * remains. Markdown punctuation counts as part of the token it is attached to,
 * which is what a human counting words does.
 */
function extractTiers(text) {
  const out = new Map();
  if (text === null) return out;
  const lines = text.split(/\r?\n/);
  const isTier = (l) => /^-\s+\*\*(T\d)\s*[—-]/.exec(l);
  const closes = (l) => /^\*\S/.test(l) || /^#{1,4}\s/.test(l) || isTier(l);
  let cls = null;
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^#{4}\s+(C\d{1,2})(?=\s|$)/.exec(lines[i]);
    if (heading) {
      cls = heading[1];
      if (!out.has(cls)) out.set(cls, []);
      continue;
    }
    if (cls === null) continue;
    const t = isTier(lines[i]);
    if (!t) continue;
    const body = [lines[i].replace(/^-\s+\*\*T\d\s*[—-][^*]*\*\*/, '')];
    for (let j = i + 1; j < lines.length && !closes(lines[j]); j += 1) body.push(lines[j]);
    out.get(cls).push({
      tier: t[1],
      startLine: i + 1,
      words: body.join(' ').split(/\s+/).filter(Boolean).length,
    });
  }
  return out;
}

/**
 * The three clauses that make a declared tier budget mean something, as pure
 * predicates over already-counted tiers so the suite can drive them without a
 * repository.
 *
 * Clause 2 is the one that is easy to leave out and is load-bearing. A ceiling
 * with no floor is satisfiable by a tier that never approaches the budget, and
 * a tier under its budget has no compression pressure on it at all — which is
 * the forcing function the whole method rests on (Adams et al. 2023,
 * arXiv:2309.04269 §2). Clause 3 exists because the source study's own chain
 * lands step 1 and step 5 at an identical 72 tokens; endpoints that are not
 * length-matched make a density claim across them unreadable.
 */
function tierBudgetIssues({ tiers, budget, tolerance, tierCount }) {
  const issues = [];
  if (!Number.isInteger(budget) || budget <= 0) {
    issues.push(`tier_budget_words must be a positive integer, got ${JSON.stringify(budget)}`);
    return issues;
  }
  const lo = Math.floor(budget * (1 - tolerance));
  const hi = Math.ceil(budget * (1 + tolerance));
  for (const [id, list] of tiers) {
    if (Number.isInteger(tierCount) && list.length !== tierCount) {
      issues.push(`${id}: ${list.length} tier(s), expected ${tierCount}`);
      continue;
    }
    for (const t of list) {
      if (t.words > hi) issues.push(`${id} ${t.tier}: ${t.words} words over ceiling ${hi} (line ${t.startLine})`);
      else if (t.words < lo) issues.push(`${id} ${t.tier}: ${t.words} words under floor ${lo} (line ${t.startLine})`);
    }
    const first = list[0];
    const last = list[list.length - 1];
    if (first && last && last !== first && last.words > first.words) {
      issues.push(`${id}: ${last.tier} (${last.words}w) is longer than ${first.tier} (${first.words}w) — densest tier must not be the longest`);
    }
  }
  return issues;
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

// ------------------------------------------------------- the rendered artifact
//
// DENSITY-CHAIN.html carries the same map as the Markdown, but its data lives in
// an inline <script> as JS array literals, so the render is only as good as that
// block's syntax. A straight apostrophe inside a single-quoted string literal
// ('S4's paid half') closed the string early, turned the whole block into one
// SyntaxError, and blanked the interactive table on master. It went unnoticed
// twice over: a browser reports a script that failed to compile only to its
// console, and the gate above validates the OTHER file. Thirteen `charter:`
// fields still hold single-quoted prose, so the class is live, not historical.
//
// Note what the failure was NOT. It was not an encoding problem: the file is
// UTF-8, was always UTF-8, and U+2019 (’) in that same position would have been
// harmless — a multi-byte character is not a delimiter. It was a collision in
// the JS grammar, so the instrument that detects it has to be a JS parser.
// Nothing short of one generalises: the next break will be a stray backtick, an
// unbalanced brace, or a trailing comma somewhere no rule anticipated.

const JS_TYPE = /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/i;
const JSON_TYPE = /^(?:importmap|speculationrules|(?:text|application)\/(?:[\w.-]+\+)?json)$/i;

/** The value of one HTML attribute, quoted either way or bare. */
function attrValue(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

/**
 * Every `<script>` element in an HTML document, with the line its body starts on.
 *
 * A scanner, not a parser, and that is fidelity rather than laziness: the
 * browser's own rule for classic script content is that the first literal
 * `</script` ends the element even mid-string-literal. Matching it byte for byte
 * means what this extracts is what the browser compiles. A cleverer reader that
 * kept going past an embedded `</script>` would be checking source no engine
 * ever sees, which is the same shape of mistake as checking the Markdown and
 * calling the HTML verified.
 */
function extractScriptBlocks(html) {
  const blocks = [];
  const open = /<script\b([^>]*)>/gi;
  let m;
  while ((m = open.exec(html)) !== null) {
    const bodyStart = m.index + m[0].length;
    const close = /<\/script\b/i.exec(html.slice(bodyStart));
    const source = html.slice(bodyStart, close ? bodyStart + close.index : html.length);
    const type = attrValue(m[1], 'type');
    blocks.push({
      index: blocks.length + 1,
      type,
      src: attrValue(m[1], 'src'),
      source,
      // Body line 1 is the remainder of the `<script>` line itself, so the
      // offset that maps a compiler's line number back onto the HTML is the
      // count of newlines before the body.
      startLine: (html.slice(0, bodyStart).match(/\n/g) ?? []).length + 1,
      closed: Boolean(close),
    });
    open.lastIndex = close ? bodyStart + close.index : html.length;
  }
  return blocks;
}

/** `{ line, message, snippet }` from a V8 compile-error stack or `--check` output. */
function describeCompileFailure(text, extraOffset = 0) {
  const lines = String(text).split(/\r?\n/);
  const head = /:(\d+)$/.exec(lines[0] ?? '');
  const messageAt = lines.findIndex((l) => /^\w*Error: /.test(l));
  return {
    line: head ? Number(head[1]) + extraOffset : null,
    message: messageAt === -1
      ? (lines.find((l) => l.trim()) ?? 'unparsed compile failure').trim()
      : lines[messageAt].replace(/^\w*Error: /, '').trim(),
    snippet: (lines[1] ?? '').trim(),
  };
}

/**
 * Compile without running. `vm.Script` is the instrument for classic scripts:
 * in-process, no temp file, and `lineOffset` makes it report the line number of
 * the HTML file rather than of the extracted fragment. It cannot accept
 * `import`/`export`, so a `type="module"` block goes through `node --check` on a
 * temp `.mjs` instead — Node picks the goal symbol from the extension. Handling
 * the case costs ten lines and buys the promise that a block this gate SAYS it
 * checked was checked under the grammar the browser would use.
 */
function findSyntaxError(source, { module = false, lineOffset = 0 } = {}) {
  if (!module) {
    try {
      new Script(source, { filename: 'density-chain-inline-script', lineOffset });
      return null;
    } catch (err) {
      return describeCompileFailure(err.stack ?? `Error: ${err.message}`);
    }
  }
  const file = join(tmpdir(), `density-chain-script-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(file, source, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return null;
  } catch (err) {
    return describeCompileFailure(err.stderr || err.stdout || err.message, lineOffset);
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* a leftover temp file is not a verification result */
    }
  }
}

/**
 * Parse every inline `<script>` in an HTML document.
 *
 * Two rules here exist because of how the original break hid rather than because
 * of the break itself:
 *
 *  - A block whose `type` this does not recognise is a PROBLEM, not a quiet
 *    skip. Silently declining to check something is precisely the state that let
 *    a blank table sit on master, and the remedy — name the type in the table
 *    above — is one line.
 *  - Checking zero blocks is a problem in its own right. A gate that passes
 *    because it found nothing to test reports the same word as a gate that
 *    passed on the merits, and only one of them means anything.
 *
 * An external `src=` script has no inline body and is genuinely nothing to
 * parse; that one is a real skip.
 */
function checkHtmlScripts(html, { label = RENDER_PATH } = {}) {
  const blocks = extractScriptBlocks(html);
  const checked = [];
  const skipped = [];
  const problems = [];

  for (const block of blocks) {
    if (!block.closed) {
      problems.push({ block: block.index, line: block.startLine, kind: 'unterminated',
        message: 'the <script> element is never closed', snippet: '' });
      continue;
    }
    if (block.src && !block.source.trim()) {
      skipped.push({ block: block.index, reason: 'external', detail: block.src });
      continue;
    }
    const type = block.type ?? '';
    if (JSON_TYPE.test(type)) {
      try {
        JSON.parse(block.source);
        checked.push({ block: block.index, kind: 'json', startLine: block.startLine });
      } catch (err) {
        problems.push({ block: block.index, line: block.startLine, kind: 'json',
          message: err.message, snippet: '' });
      }
      continue;
    }
    const module = type.toLowerCase() === 'module';
    if (type !== '' && !module && !JS_TYPE.test(type)) {
      problems.push({ block: block.index, line: block.startLine, kind: 'unknown-type',
        message: `type="${type}" is not a type this gate knows how to parse; `
          + 'add it to JS_TYPE/JSON_TYPE, or give it a `src`',
        snippet: '' });
      continue;
    }
    const failure = findSyntaxError(block.source, { module, lineOffset: block.startLine - 1 });
    if (failure) {
      problems.push({ block: block.index, kind: module ? 'module' : 'script', ...failure });
    } else {
      checked.push({ block: block.index, kind: module ? 'module' : 'script', startLine: block.startLine });
    }
  }

  // Only when nothing else already failed: a gate that just reported a broken
  // block has plainly done its job, and saying "nothing was checked" underneath
  // it would bury the line the author actually needs. The invariant being
  // defended is narrower — this must never PASS on an empty check.
  if (checked.length === 0 && problems.length === 0) {
    problems.push({ block: 0, line: null, kind: 'nothing-checked', snippet: '',
      message: `no inline script block in ${label} was parsed, so a passing result here `
        + 'would carry no information (hard rule 19c)' });
  }
  return { blocks: blocks.length, checked, skipped, problems };
}

/** One line, anchored to the HTML file so an editor can jump straight to it. */
function formatScriptProblem(problem, label = RENDER_PATH) {
  const at = problem.line === null ? label : `${label}:${problem.line}`;
  const snippet = problem.snippet ? `  |  ${problem.snippet}` : '';
  return `${at} — inline <script> #${problem.block} does not parse: ${problem.message}${snippet}`;
}

// -------------------------------------------------------------------- verify

function runVerify() {
  const mapText = readMapText();
  const problems = [];
  let budgetSummary = { enforced: false, issues: [] };
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
    // The budget field is READ here, which is the point. Before this,
    // `tier_budget_words` occurred exactly once in the repository — its own
    // declaration — so the map could and did drift to tiers nine times the
    // stated figure while every gate stayed green. A declared constant with no
    // reader is a comment.
    //
    // Reading it always, gating on it only when `tier_budget_enforced` is true:
    // the branches as shipped violate the band, and a gate that reddens CI on
    // day one is a gate someone switches off (the same reasoning that keeps
    // staleness out of `--verify`). The measurement is unconditional so the
    // drift is visible; the flag is the operator's, and flipping it is a
    // behaviour change to put to the collaborator rather than to assume.
    const cfg = index.notes?.[0] ?? {};
    const budgetIssues = tierBudgetIssues({
      tiers: extractTiers(mapText),
      budget: cfg.tier_budget_words,
      tolerance: typeof cfg.tier_budget_tolerance === 'number' ? cfg.tier_budget_tolerance : 0.05,
      tierCount: cfg.tier_count,
    });
    budgetSummary = { enforced: cfg.tier_budget_enforced === true, issues: budgetIssues };
    if (budgetSummary.enforced) problems.push(...budgetIssues);
  }
  if ([...router.declarations.keys()].join(',') !== router.roster.join(',')) {
    problems.push('self-index roster ≠ map headings');
  }
  const sections = extractSections(mapText);
  for (const id of router.roster) {
    if (!sections.has(id)) problems.push(`class ${id} has no \`#### ${id}\` section in the map`);
  }

  // The render is the other half of the same map, and it fails silently.
  const renderAbs = join(REPO_ROOT, RENDER_PATH);
  let scripts = null;
  if (!existsSync(renderAbs)) {
    problems.push(`${RENDER_PATH} is missing; the interactive render has no source`);
  } else {
    scripts = checkHtmlScripts(readFileSync(renderAbs, 'utf8'));
    for (const p of scripts.problems) problems.push(formatScriptProblem(p));
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
      `no stored pins; ${scripts.checked.length} inline script block(s) in the render compile; ` +
      `tier budget ${budgetSummary.enforced ? 'enforced' : 'measured only'}, ${budgetSummary.issues.length} breach(es))\n`,
  );
  if (!budgetSummary.enforced && budgetSummary.issues.length) {
    process.stdout.write(
      `  tier budget: ${budgetSummary.issues.length} breach(es), not gating. ` +
        `Run \`npm run wiki:check -- --budget\` for the per-tier table, or set ` +
        `\`tier_budget_enforced: true\` in docs/density-chain/index.json to make these fail this check.\n`,
    );
  }
  return 0;
}

/**
 * `--budget`: the tier-length gate on its own. Exit 0 clean, 1 on any breach,
 * regardless of `tier_budget_enforced` — the flag governs whether `--verify`
 * fails, never whether the measurement runs.
 */
function runBudget() {
  const mapText = readMapText();
  if (mapText === null) {
    process.stderr.write(`${CHAIN_PATH} is missing\n`);
    return 1;
  }
  const cfg = loadIndex()?.notes?.[0] ?? {};
  const tolerance = typeof cfg.tier_budget_tolerance === 'number' ? cfg.tier_budget_tolerance : 0.05;
  const tiers = extractTiers(mapText);
  const issues = tierBudgetIssues({ tiers, budget: cfg.tier_budget_words, tolerance, tierCount: cfg.tier_count });

  const budget = cfg.tier_budget_words;
  const lo = Math.floor(budget * (1 - tolerance));
  const hi = Math.ceil(budget * (1 + tolerance));
  process.stdout.write(`tier budget ${budget} words, band ${lo}-${hi} (±${Math.round(tolerance * 100)}%)\n\n`);
  const cols = [...tiers.values()][0]?.map((t) => t.tier) ?? [];
  process.stdout.write(`class  ${cols.map((c) => c.padStart(6)).join('')}   verdict\n`);
  for (const [id, list] of tiers) {
    const cells = list.map((t) => (t.words > hi || t.words < lo ? `${t.words}!` : `${t.words}`).padStart(6)).join('');
    const bad = list.some((t) => t.words > hi || t.words < lo)
      || (list.length > 1 && list[list.length - 1].words > list[0].words);
    process.stdout.write(`${id.padEnd(6)} ${cells}   ${bad ? 'BREACH' : 'ok'}\n`);
  }
  if (issues.length) {
    process.stdout.write(`\ntier budget: FAIL (${issues.length} breach(es))\n`);
    for (const i of issues) process.stdout.write(`- ${i}\n`);
    return 1;
  }
  process.stdout.write(`\ntier budget: PASS (${[...tiers.values()].flat().length} tiers within band; no class ends longer than it starts)\n`);
  return 0;
}

/** `--check-html`: the render's script gate on its own, for a quick local loop. */
function runCheckHtml() {
  const abs = join(REPO_ROOT, RENDER_PATH);
  if (!existsSync(abs)) {
    process.stderr.write(`${RENDER_PATH} is missing\n`);
    return 1;
  }
  const r = checkHtmlScripts(readFileSync(abs, 'utf8'));
  if (r.problems.length) {
    process.stdout.write(`${RENDER_PATH}: FAIL (${r.problems.length} issue(s))\n`);
    for (const p of r.problems) process.stdout.write(`- ${formatScriptProblem(p)}\n`);
    return 1;
  }
  process.stdout.write(
    `${RENDER_PATH}: PASS (${r.checked.length} of ${r.blocks} <script> block(s) compiled`
      + `${r.skipped.length ? `, ${r.skipped.length} external` : ''})\n`,
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

  // The tier-budget gate. The positive control fires first: if the shipped map
  // yields no tiers at all, every "we caught the breach" below is a check
  // passing on an empty set.
  const shippedTiers = extractTiers(mapText);
  const shippedTierCount = [...shippedTiers.values()].flat().length;
  if (shippedTiers.size > 0 && shippedTierCount === shippedTiers.size * 5) {
    planted.push('shipped_map_yields_five_tiers_per_class');
  }
  const bandCfg = { budget: 90, tolerance: 0.05, tierCount: 2 };
  const oneClass = (a, b) => new Map([['C1', [
    { tier: 'T1', startLine: 1, words: a }, { tier: 'T2', startLine: 2, words: b },
  ]]]);
  if (tierBudgetIssues({ tiers: oneClass(90, 800), ...bandCfg }).some((s) => s.includes('over ceiling'))) {
    planted.push('an_over_ceiling_tier_is_caught');
  }
  // The clause a ceiling-only rule cannot have: a tier well UNDER budget has no
  // compression pressure on it, which is the forcing function itself.
  if (tierBudgetIssues({ tiers: oneClass(90, 20), ...bandCfg }).some((s) => s.includes('under floor'))) {
    planted.push('an_under_floor_tier_is_caught');
  }
  // Both endpoints inside the band, yet the chain ends longer than it starts.
  if (tierBudgetIssues({ tiers: oneClass(86, 94), ...bandCfg }).some((s) => s.includes('longer than'))) {
    planted.push('a_chain_ending_longer_than_it_starts_is_caught');
  }
  if (tierBudgetIssues({ tiers: oneClass(90, 90), ...bandCfg }).length === 0) {
    planted.push('a_held_budget_passes');
  }
  if (tierBudgetIssues({ tiers: oneClass(90, 90), ...bandCfg, tierCount: 5 }).some((s) => s.includes('expected 5'))) {
    planted.push('a_short_chain_is_caught');
  }
  if (tierBudgetIssues({ tiers: oneClass(90, 90), ...bandCfg, budget: 0 }).some((s) => s.includes('positive integer'))) {
    planted.push('a_missing_budget_is_caught');
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

  // The render's script gate, driven against the SHIPPED file rather than a
  // fixture, so a control cannot stay green while the real artifact goes
  // unparsed. The positive control fires first: if the file as committed does
  // NOT compile, every "we detected the break" below is meaningless.
  const renderAbs = join(REPO_ROOT, RENDER_PATH);
  if (existsSync(renderAbs)) {
    const html = readFileSync(renderAbs, 'utf8');
    const shipped = checkHtmlScripts(html);
    if (shipped.problems.length === 0 && shipped.checked.length > 0) {
      planted.push('render_as_shipped_compiles');
    }

    // The exact break that blanked the table: an apostrophe inside single quotes.
    const wounded = html.replace(/charter: '/, "charter: 'S4's ");
    const apostrophe = checkHtmlScripts(wounded);
    if (apostrophe.problems.length > 0) planted.push('apostrophe_in_single_quotes_is_caught');
    // …reported at a line a human can open, not merely "somewhere in the file".
    const woundedLine = wounded.slice(0, wounded.indexOf("charter: 'S4's ")).split('\n').length;
    if (apostrophe.problems.some((p) => p.line === woundedLine)) {
      planted.push('the_offending_line_is_named');
    }
    // The general case the parser buys beyond this one break.
    if (checkHtmlScripts(html.replace('const TIER_COLORS = [', 'const TIER_COLORS = [ {')).problems.length > 0) {
      planted.push('unbalanced_bracket_is_caught');
    }
    // Blindness, in the two shapes that make a pass meaningless.
    if (checkHtmlScripts('<p>no scripts here</p>').problems.some((p) => p.kind === 'nothing-checked')) {
      planted.push('a_render_with_nothing_to_check_fails');
    }
    if (checkHtmlScripts(html.replace('<script>', '<script type="text/x-template">'))
      .problems.some((p) => p.kind === 'unknown-type')) {
      planted.push('an_unparseable_type_is_not_silently_skipped');
    }
  }
  // A JSON data block is validated as JSON, not merely tolerated — the shape the
  // render would take if its data ever moved out of executable source.
  if (checkHtmlScripts('<script type="application/json">{"a": 1,}</script>').problems
    .some((p) => p.kind === 'json')) {
    planted.push('a_malformed_json_block_is_caught');
  }

  const expected = [
    'render_as_shipped_compiles', 'apostrophe_in_single_quotes_is_caught',
    'the_offending_line_is_named', 'unbalanced_bracket_is_caught',
    'a_render_with_nothing_to_check_fails', 'an_unparseable_type_is_not_silently_skipped',
    'a_malformed_json_block_is_caught',
    'declaration_drives_routing', 'c8_owns_its_declared_config_file', 'ignores_the_map_itself',
    'flags_a_fallback_route', 'unmapped_path_has_no_route', 'deleted_declaration_drops_its_route',
    'new_heading_extends_the_roster', 'sections_extract_per_class', 'crlf_is_not_an_edit',
    'reflow_is_not_an_edit', 'branch_after_code_is_current', 'code_after_branch_is_stale',
    'working_tree_section_edit_satisfies', 'uncommitted_code_change_is_stale',
    'missing_section_is_orphaned', 'never_committed_branch_is_stale', 'shallow_clone_does_not_gate',
    'no_unresolvable_pin_state_exists',
    'shipped_map_yields_five_tiers_per_class', 'an_over_ceiling_tier_is_caught',
    'an_under_floor_tier_is_caught', 'a_chain_ending_longer_than_it_starts_is_caught',
    'a_held_budget_passes', 'a_short_chain_is_caught', 'a_missing_budget_is_caught',
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
  if (argv.includes('--check-html')) return runCheckHtml();
  if (argv.includes('--budget')) return runBudget();
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
  extractSections, extractRoster, extractDeclarations, extractTiers, tierBudgetIssues,
  buildRouter, route, classify,
  sectionVerdict, classVerdicts, lastCodeCommitByClass, report,
  extractScriptBlocks, findSyntaxError, checkHtmlScripts, formatScriptProblem,
};
