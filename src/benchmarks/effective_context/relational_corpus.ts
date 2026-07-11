// Session 23 (pillar §6.3 round 3): the relational corpus — the regime
// where pillar §7 claims a structured frame earns its keep.
//
// Round 2's 40 single-table ledgers (2,209 records) produced the pandas
// null result: plain dict/regex loops answered every aggregation
// correctly and cheaply, so the structure choice did not matter at that
// scale. This corpus raises both axes the §7 claim is actually about:
//
//   SCALE     — 100 season-two ledgers, ~7,000 records (3.2x round 2;
//               ~600 KB, larger than the Frankenstein corpus).
//   RELATION  — two companion tables, so every probe question needs a
//               genuine JOIN across document kinds, not just a filter:
//                 registry:  captain -> guild        (36 captains, 8 guilds)
//                 tariff:    (port, material) -> silver per crate (9x12)
//               "Which guild paid the most tariff silver" is a
//               three-table join/group-by; nothing in any single
//               document answers it.
//
// Same posture as synthetic_corpus.ts: pure, seeded (mulberry32),
// ASCII-only, byte-stable (concat sha pinned by the unit test), and the
// probe's ground truth is COMPUTED from the rendered text by the parse
// helpers below — the generator's own bookkeeping never becomes an
// expected answer. Ledger records reuse round 2's exact canonical shape,
// so parseLedgerRecords (shape-based, glue-tolerant) parses them
// unchanged; the registry and tariff parsers follow the same
// shape-not-lines discipline (the AST reconstruction concatenates
// paragraph blocks with unmarked boundaries).

import {
  Rng,
  parseLedgerRecords,
  VOCABULARY_POOLS,
  type LedgerRecord,
} from './synthetic_corpus';

const { PERSONS, MATERIALS, PORTS } = VOCABULARY_POOLS;

// Invented guild names (ASCII, checked mutually substring-free against
// every other vocabulary pool by the unit test).
export const GUILDS = [
  'Amberfall', 'Brackenrose', 'Duskhollow', 'Farwater',
  'Glasswind', 'Hollowmere', 'Larkspur', 'Mossgate',
] as const;

export const RELATIONAL_SEED = 0x23a11e5;
export const RELATIONAL_HOUSE_COUNT = 100;
export const RELATIONAL_CAPTAIN_COUNT = 36;
export const RELATIONAL_LEDGER_KEY_PREFIX = 'ledger:synthetic:s2-house-';
export const RELATIONAL_REGISTRY_DOC_KEY = 'registry:synthetic:captains';
export const RELATIONAL_TARIFF_DOC_KEY = 'tariff:synthetic:port-schedule';

export interface RelationalDoc {
  docKey: string;
  text: string;
}

export interface RelationalCorpus {
  registry: RelationalDoc;
  tariff: RelationalDoc;
  ledgers: RelationalDoc[];
}

export interface RegistryRecord {
  captain: string;
  guild: string;
}

export interface TariffRecord {
  port: string;
  material: string;
  silverPerCrate: number;
}

/** Every document of the corpus in its canonical order (sha-pin input). */
export function allRelationalDocs(corpus: RelationalCorpus): RelationalDoc[] {
  return [corpus.registry, corpus.tariff, ...corpus.ledgers];
}

/** Blank line every ~6 records keeps blocks parser-friendly (round-2 shape). */
function paragraphed(header: string, recordLines: string[]): string {
  const lines: string[] = [header, ''];
  recordLines.forEach((line, i) => {
    lines.push(line);
    if ((i + 1) % 6 === 0 && i + 1 < recordLines.length) lines.push('');
  });
  return lines.join('\n') + '\n';
}

/**
 * Generates the full relational corpus deterministically (one seed, one
 * pass; consumption order is part of the byte contract the sha pin
 * freezes). Captains are unique full names shared across every ledger;
 * every captain has exactly one registry line, and every (port,
 * material) pair has exactly one tariff line — so the join truths below
 * are total by construction, and the helpers still verify totality
 * loudly at parse time rather than trusting it.
 */
export function generateRelationalCorpus(): RelationalCorpus {
  const rng = new Rng(RELATIONAL_SEED);

  // Captains: unique "First Last" pairs from the person pool (first and
  // last always differ; full names deduped).
  const captains: string[] = [];
  const seen = new Set<string>();
  while (captains.length < RELATIONAL_CAPTAIN_COUNT) {
    const first = rng.pick(PERSONS);
    let last = first;
    while (last === first) last = rng.pick(PERSONS);
    const name = `${first} ${last}`;
    if (!seen.has(name)) {
      seen.add(name);
      captains.push(name);
    }
  }

  // The registry: captain -> guild, one line per captain. Guilds are
  // assigned round-robin over the rng-ordered captains (4-5 captains
  // each): an rng.pick here skews the memberships badly enough that one
  // large guild tops EVERY aggregate, which degenerates the join
  // questions (answering one would answer them all).
  const registryLines = captains.map(
    (captain, i) =>
      `Captain ${captain} sails under the banner of the ${GUILDS[i % GUILDS.length]} Guild.`
  );
  const registry: RelationalDoc = {
    docKey: RELATIONAL_REGISTRY_DOC_KEY,
    text: paragraphed(
      'Captain registry of the Ninth Circuit trading houses, season two.',
      registryLines
    ),
  };

  // The tariff schedule: one line per (port, material) pair.
  const tariffLines: string[] = [];
  for (const port of PORTS) {
    for (const material of MATERIALS) {
      tariffLines.push(
        `${port} levies a tariff of ${rng.int(2, 19)} silver per crate of ${material}.`
      );
    }
  }
  const tariff: RelationalDoc = {
    docKey: RELATIONAL_TARIFF_DOC_KEY,
    text: paragraphed(
      'Port tariff schedule of the Ninth Circuit, season two.',
      tariffLines
    ),
  };

  // The ledgers: round 2's exact record shape, season-two volume.
  const ledgers: RelationalDoc[] = [];
  for (let h = 1; h <= RELATIONAL_HOUSE_COUNT; h++) {
    const house = String(h).padStart(3, '0');
    const recordCount = rng.int(55, 85);
    const records: LedgerRecord[] = [];
    for (let i = 0; i < recordCount; i++) {
      records.push({
        day: rng.int(1, 90),
        captain: rng.pick(captains),
        crates: rng.int(5, 99),
        material: rng.pick(MATERIALS),
        port: rng.pick(PORTS),
      });
    }
    records.sort((a, b) => a.day - b.day || a.captain.localeCompare(b.captain));
    ledgers.push({
      docKey: `${RELATIONAL_LEDGER_KEY_PREFIX}${house}`,
      text: paragraphed(
        `Season two shipping ledger ${house} of the Ninth Circuit trading houses.`,
        records.map(
          r => `On day ${r.day}, Captain ${r.captain} shipped ${r.crates} crates of ${r.material} to ${r.port}.`
        )
      ),
    });
  }

  return { registry, tariff, ledgers };
}

// --- Shape-based parsers (representation-invariant under block gluing) -------

const REGISTRY_SHAPE =
  /Captain ([A-Za-z]+ [A-Za-z]+) sails under the banner of the ([A-Za-z]+) Guild\./g;
const REGISTRY_MARKER = 'sails under the banner of the ';

const TARIFF_SHAPE =
  /(Port [A-Za-z]+) levies a tariff of (\d+) silver per crate of ([a-z]+)\./g;
const TARIFF_MARKER = ' levies a tariff of ';

function countMarker(text: string, marker: string): number {
  let count = 0;
  let index = text.indexOf(marker);
  while (index !== -1) {
    count++;
    index = text.indexOf(marker, index + marker.length);
  }
  return count;
}

/** Parses registry lines back out of text; every marker must be well-formed. */
export function parseRegistryRecords(text: string): RegistryRecord[] {
  const matches = [...text.matchAll(REGISTRY_SHAPE)];
  const attempts = countMarker(text, REGISTRY_MARKER);
  if (matches.length !== attempts) {
    throw new Error(
      `Malformed registry record: ${attempts} marker(s) but only `
      + `${matches.length} well-formed record(s).`
    );
  }
  return matches.map(match => ({ captain: match[1], guild: match[2] }));
}

/** Parses tariff lines back out of text; every marker must be well-formed. */
export function parseTariffRecords(text: string): TariffRecord[] {
  const matches = [...text.matchAll(TARIFF_SHAPE)];
  const attempts = countMarker(text, TARIFF_MARKER);
  if (matches.length !== attempts) {
    throw new Error(
      `Malformed tariff record: ${attempts} marker(s) but only `
      + `${matches.length} well-formed record(s).`
    );
  }
  return matches.map(match => ({
    port: match[1],
    silverPerCrate: Number(match[2]),
    material: match[3],
  }));
}

/** Round 2's ledger parse, re-exported so the probe imports one module. */
export { parseLedgerRecords };

// --- Join truths (pure; unknown keys and ties are LOUD design errors) --------

/** captain -> guild. Duplicate captains are a corpus-design error. */
export function buildGuildIndex(registry: readonly RegistryRecord[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const r of registry) {
    if (index.has(r.captain)) {
      throw new Error(`Duplicate registry entry for captain "${r.captain}".`);
    }
    index.set(r.captain, r.guild);
  }
  return index;
}

/** (port, material) -> silver per crate. Duplicates are a design error. */
export function buildTariffIndex(tariffs: readonly TariffRecord[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const t of tariffs) {
    const key = `${t.port}|${t.material}`;
    if (index.has(key)) {
      throw new Error(`Duplicate tariff entry for ${t.port} / ${t.material}.`);
    }
    index.set(key, t.silverPerCrate);
  }
  return index;
}

function guildOf(index: Map<string, string>, captain: string): string {
  const guild = index.get(captain);
  if (guild === undefined) {
    throw new Error(`Ledger captain "${captain}" is missing from the registry.`);
  }
  return guild;
}

function tariffOf(index: Map<string, number>, port: string, material: string): number {
  const silver = index.get(`${port}|${material}`);
  if (silver === undefined) {
    throw new Error(`No tariff for ${port} / ${material}.`);
  }
  return silver;
}

/** Total crates of one material per guild (ledger x registry join). */
export function totalsByGuildForMaterial(
  records: readonly LedgerRecord[],
  guildIndex: Map<string, string>,
  material: string
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of records) {
    if (r.material !== material) continue;
    const guild = guildOf(guildIndex, r.captain);
    totals.set(guild, (totals.get(guild) ?? 0) + r.crates);
  }
  return totals;
}

function topOf(totals: Map<string, number>, what: string): { key: string; total: number } {
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) throw new Error(`No records for ${what}.`);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
    throw new Error(
      `Tie for ${what} (${sorted[0][0]} and ${sorted[1][0]} at ${sorted[0][1]}); `
      + 'pick a different question target.'
    );
  }
  return { key: sorted[0][0], total: sorted[0][1] };
}

/** The single guild shipping the largest total of a material (tie-refused). */
export function topGuildForMaterial(
  records: readonly LedgerRecord[],
  guildIndex: Map<string, string>,
  material: string
): { guild: string; total: number } {
  const top = topOf(totalsByGuildForMaterial(records, guildIndex, material), `material "${material}"`);
  return { guild: top.key, total: top.total };
}

/** Total tariff silver collected at one port (ledger x tariff join). */
export function tariffIntoPort(
  records: readonly LedgerRecord[],
  tariffIndex: Map<string, number>,
  port: string
): number {
  return records
    .filter(r => r.port === port)
    .reduce((sum, r) => sum + r.crates * tariffOf(tariffIndex, r.port, r.material), 0);
}

/** Total tariff silver per guild (the three-table join/group-by). */
export function totalTariffByGuild(
  records: readonly LedgerRecord[],
  guildIndex: Map<string, string>,
  tariffIndex: Map<string, number>
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of records) {
    const guild = guildOf(guildIndex, r.captain);
    totals.set(guild, (totals.get(guild) ?? 0) + r.crates * tariffOf(tariffIndex, r.port, r.material));
  }
  return totals;
}

/** The single guild with the largest total tariff bill (tie-refused). */
export function topGuildByTariff(
  records: readonly LedgerRecord[],
  guildIndex: Map<string, string>,
  tariffIndex: Map<string, number>
): { guild: string; silver: number } {
  const top = topOf(totalTariffByGuild(records, guildIndex, tariffIndex), 'guild tariff totals');
  return { guild: top.key, silver: top.total };
}

/**
 * One guild's profile: total crates over all materials, distinct
 * captains observed shipping, and the port it shipped to most often by
 * record count (tie-refused) — the multi-part computed answer for the
 * round-3 answer-channel stress question.
 */
export function guildProfile(
  records: readonly LedgerRecord[],
  guildIndex: Map<string, string>,
  guild: string
): { crates: number; captainCount: number; topPort: string } {
  const own = records.filter(r => guildOf(guildIndex, r.captain) === guild);
  if (own.length === 0) throw new Error(`No ledger records for guild "${guild}".`);
  const portCounts = new Map<string, number>();
  for (const r of own) portCounts.set(r.port, (portCounts.get(r.port) ?? 0) + 1);
  const topPort = topOf(portCounts, `guild "${guild}" port frequencies`);
  return {
    crates: own.reduce((sum, r) => sum + r.crates, 0),
    captainCount: new Set(own.map(r => r.captain)).size,
    topPort: topPort.key,
  };
}
