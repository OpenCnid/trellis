import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pgPool } from '../src/config/db';
import { config, pgDsn } from '../src/config/index';
import { parseMarkdownToAST, type ASTNode } from '../src/core/ast/parser';
import { collectExtractionBlocks, nodeText } from '../src/core/ast/traverse';
import { ingestDocument, type IngestDeps } from '../src/core/ingestion/ingest_document';
import { PRICE_PER_M_INPUT, PRICE_PER_M_OUTPUT } from '../src/benchmarks/oolong/scoring';
import { extractIterations } from '../src/benchmarks/oolong/rlm_client';
import {
  answerContainsSentence,
  boundaryPreservedReconstruction,
  classifyLocalizationMethod,
  countOccurrences,
  extractAnswerInteger,
  extractAnswerSection,
  extractAnswerSectionBy,
  lineAnchoredHeadingLabels,
  normalizeWhitespace,
  replaceUniqueLine,
  sectionContaining,
  sectionContainingBy,
  sentenceContaining,
} from '../src/benchmarks/effective_context/ground_truth';
import {
  chronicleAnomalyPhrase,
  generateLedgers,
  parseLedgerRecords,
  topPortForMaterial,
  totalForCaptainMaterial,
  type LedgerDoc,
  type LedgerRecord,
} from '../src/benchmarks/effective_context/synthetic_corpus';
import {
  RELATIONAL_HOUSE_COUNT,
  RELATIONAL_LEDGER_KEY_PREFIX,
  RELATIONAL_REGISTRY_DOC_KEY,
  RELATIONAL_TARIFF_DOC_KEY,
  allRelationalDocs,
  buildGuildIndex,
  buildTariffIndex,
  generateRelationalCorpus,
  guildProfile,
  parseRegistryRecords,
  parseTariffRecords,
  tariffIntoPort,
  topGuildByTariff,
  topGuildForMaterial,
  type RelationalCorpus,
  type RelationalDoc,
} from '../src/benchmarks/effective_context/relational_corpus';
import { loggerFor } from '../src/core/observability/logger';

// The effective-context probe (Sessions 21-23; pillar §6.3 of
// docs/architecture/CODE_MEDIATED_TEXT.md). PAID in its run mode; the
// --ingest mode is zero-paid setup. Extends the paired-run series
// (WORKSPACE_PROBE_REPORT.md, WORKSPACE_LINEAGE_PROBE_REPORT.md,
// exp_citation_ab.ts). Report:
// docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md.
//
// ROUND 2 (Session 22) adds four suites over the round-1 machinery:
//   frank     — the round-1 questions over the committed
//               data/frankenstein.txt (memorized corpus; the baseline).
//   chronicle — the same question kinds over the committed
//               data/synthetic_chronicle.txt, a seeded synthetic corpus
//               that exists nowhere outside this repository: quote and
//               locate answers CANNOT come from parametric memory, so
//               this suite isolates read-fidelity through the REPL.
//   ledger    — 40 deterministically generated shipping ledgers
//               (ingested as 40 documents); every answer requires
//               filtering/aggregating ACROSS documents — the multi-file
//               regime where pillar §7 says a DataFrame earns its
//               place. Whether the model reaches for pandas is measured
//               (usedPandas), not required: plain loops that stay cheap
//               are a finding, not a failure.
//   edit      — the "never copy" half: locate → splice → hash-guarded
//               write_back through the Session 20 trellis_textedit
//               toolkit against a per-run scratch TRELLIS_EDIT_ROOT.
//               Ground truth is the expected post-edit BYTES, computed
//               from the inputs (replaceUniqueLine); the answer channel
//               is scored too, so the edit-tally task is the measured
//               end-to-end regression of the Session 21 55->47
//               transcription bug (fixed by trellis_answer this
//               session — answer_submits per run is recorded).
//
// ROUND 3 (Session 23) closes the threads round 2 left open:
//   relational — a genuine multi-table corpus (100 season-two ledgers,
//               ~6,900 records, plus a captain->guild registry and a
//               (port, material)->silver tariff schedule; ~583 KB, more
//               bytes than the Frankenstein corpus). Every question
//               needs a JOIN across document kinds — the regime where
//               pillar §7 says a structured frame earns its keep.
//               usedPandas/usedPolars are measured, never required.
//   localization — two MORE chronicle locate anomalies join the suite,
//               and every locate run's method is classified from its
//               log (line-anchored vs shape-based vs unknown) — the
//               round-2 misses were all line-anchored regexes broken by
//               the glued reconstruction. --ingest additionally prints
//               the zero-paid boundary quantification (how many
//               own-line headings the naive method sees over today's
//               glued reconstruction vs a boundary-preserving one).
//   disclosure — the chronicle and ledger preambles now carry the
//               frank preamble's "paragraph boundaries are unmarked"
//               clause verbatim (the recorded round-2 question-design
//               gap; round-2 vs round-3 localization numbers must be
//               read with this change in mind).
//
// --repeats N runs every selected question N times per arm; aggregates
// report medians WITH min/max spread (n stays small — the report owes
// the honest caveat either way).
//
// Ground truth is COMPUTED from committed or deterministically generated
// bytes at run time (the ground_truth/synthetic_corpus/relational_corpus
// helpers, unit-pinned) — never hand-typed, never persisted as positions.
//
// Arms (paired; identical kernel-fixed questions, identical addressing):
//   on  = today's default composed prompt — the pinned kernel
//         (COMPOSED_SYSTEM_PROMPT_SHA256, test:modules [4]).
//   off = the same run with TRELLIS_EXP_OMIT_CMT=1 in the spawn env:
//         exactly the §6.2 CODE-MEDIATED TEXT block absent (test:modules
//         [7] pins the omitted composition). The flag exists only here:
//         no default, worker, or Compose configuration sets it, and
//         buildAgentEnv strips it (rlm_job.test.ts).
//
//   tsx scripts/exp_effective_context.ts --ingest        (zero-paid setup + verify)
//   tsx scripts/exp_effective_context.ts                 (plan + estimate only)
//   tsx scripts/exp_effective_context.ts --confirm-paid  (the paid probe)
//   flags: --suites frank,chronicle,ledger,edit,relational  --arms on,off
//          --repeats N  --questions id1,id2  --max-iterations N
//          --max-spend-usd N

const FRANK_DOC_KEY = 'book:gutenberg-84:frankenstein';
const FRANK_CORPUS_PATH = path.resolve('data', 'frankenstein.txt');
const CHRONICLE_DOC_KEY = 'book:synthetic:ninth-circuit-chronicle';
const CHRONICLE_CORPUS_PATH = path.resolve('data', 'synthetic_chronicle.txt');
const LEDGER_KEY_PREFIX = 'ledger:synthetic:house-';
// Read-load-compute-answer fits comfortably; matches exp_citation_ab.
const MAX_ITERATIONS_DEFAULT = 8;
// The standing per-run spend ceiling (operator policy, July 9, 2026).
const DEFAULT_MAX_SPEND_USD = 5;

type Arm = 'on' | 'off';
type Suite = 'frank' | 'chronicle' | 'ledger' | 'edit' | 'relational';
const ALL_SUITES: Suite[] = ['frank', 'chronicle', 'ledger', 'edit', 'relational'];
// Round 3's default selection: the new measurement. Every earlier suite
// stays selectable for focused repeats (the round-3 localization and
// higher-n invocations select chronicle/frank questions explicitly).
const DEFAULT_SUITES: Suite[] = ['relational'];

interface CliArgs {
  ingest: boolean;
  confirmPaid: boolean;
  arms: Arm[];
  suites: Suite[];
  repeats: number;
  questionIds: string[] | null;
  maxIterations: number;
  maxSpendUsd: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    ingest: false,
    confirmPaid: false,
    arms: ['on', 'off'],
    suites: [...DEFAULT_SUITES],
    repeats: 1,
    questionIds: null,
    maxIterations: MAX_ITERATIONS_DEFAULT,
    maxSpendUsd: DEFAULT_MAX_SPEND_USD,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    switch (flag) {
      case '--ingest': args.ingest = true; break;
      case '--confirm-paid': args.confirmPaid = true; break;
      case '--arms':
        args.arms = value().split(',').map(a => {
          const arm = a.trim();
          if (arm !== 'on' && arm !== 'off') throw new Error(`Unknown arm: ${arm}`);
          return arm;
        });
        break;
      case '--suites':
        args.suites = value().split(',').map(s => {
          const suite = s.trim() as Suite;
          if (!ALL_SUITES.includes(suite)) throw new Error(`Unknown suite: ${s}`);
          return suite;
        });
        break;
      case '--repeats': {
        const parsed = Number(value());
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
          throw new Error('--repeats must be an integer in [1, 5]');
        }
        args.repeats = parsed;
        break;
      }
      case '--questions':
        args.questionIds = value().split(',').map(q => q.trim()).filter(Boolean);
        break;
      case '--max-iterations': args.maxIterations = Number(value()); break;
      case '--max-spend-usd': {
        const parsed = Number(value());
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('--max-spend-usd must be a positive number');
        }
        args.maxSpendUsd = parsed;
        break;
      }
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

// --- The kernel-fixed question sets (Guardrail 5: never env-tunable) --------

interface EditSpec {
  /** relative path -> seed bytes, written into a fresh scratch root per run. */
  seedFiles: Record<string, string>;
  /** relative path -> expected post-edit bytes (computed, never hand-typed). */
  expectedFiles: Record<string, string>;
}

interface ProbeQuestion {
  id: string;
  suite: Suite;
  kind: 'count' | 'quote' | 'locate' | 'aggregate' | 'edit';
  question: string;
  expected: string;
  isCorrect(answer: string): boolean;
  edit?: EditSpec;
  /** locate questions only: the heading kinds the method classifier scans for. */
  locateKinds?: readonly string[];
}

// frank (round 1, unchanged): the memorized-corpus baseline.
const COUNT_NEEDLES = ['Justine', 'Ingolstadt'] as const;
const QUOTE_PHRASES = ['the beauty of the dream vanished', 'borne away by the waves'] as const;
const LOCATE_PHRASES = [
  'It was on a dreary night of November',
  'apparently of gigantic stature',
] as const;

// chronicle: needles and planted-anomaly indexes (0-based; anomaly i
// lives in Entry i+1, but every expected answer is still computed from
// the committed bytes below). Indexes 5 and 42 are the round-2
// questions kept for comparability; 23 and 36 join in round 3 (the
// localization arm — chosen clear of the quote anomalies 11/30 and the
// edit anomaly 17).
const CHRONICLE_COUNT_NEEDLES = ['Kelvorin', 'Torulf'] as const;
const CHRONICLE_QUOTE_ANOMALIES = [11, 30] as const;
const CHRONICLE_LOCATE_ANOMALIES = [5, 42, 23, 36] as const;

// ledger: the cross-document aggregation targets.
const LEDGER_TOP_MATERIAL = 'cinderpith';
const LEDGER_CAPTAIN = 'Corvath Gorsted';
const LEDGER_CAPTAIN_MATERIAL = 'veldspar';
const LEDGER_HOUSES_MATERIAL = 'wyrmsilk';
const LEDGER_HOUSES_PORT = 'Port Veleth';

// relational (round 3): the join-question targets. Chosen so each
// question's answer is a DIFFERENT guild/number (tie-freedom and
// well-posedness are enforced loudly by the helpers and unit-pinned in
// relational_corpus.test.ts).
const REL_TOP_MATERIAL = 'mirrowax';
const REL_TARIFF_PORT = 'Port Galeholt';
const REL_PROFILE_GUILD = 'Farwater';

// edit: the round-trip anchors (distinct from the chronicle suite's so
// neither contaminates the other), and the seed file.
const EDIT_QUOTE_ANOMALY = 17;
const EDIT_TALLY_NEEDLE = 'Jalmyra';
const EDIT_NOTES_PATH = 'notes.txt';
const EDIT_QUOTE_MARKER = '<<AWAITING QUOTE>>';
const EDIT_TALLY_MARKER = '<<AWAITING TALLY>>';
const EDIT_NOTES_SEED = [
  'FIELD NOTES - Ninth Circuit archive review',
  '',
  'Reviewer notes pending.',
  '',
  `QUOTE OF RECORD: ${EDIT_QUOTE_MARKER}`,
  '',
  `TALLY OF MENTIONS: ${EDIT_TALLY_MARKER}`,
  '',
  'End of notes.',
  '',
].join('\n');

function buildFrankQuestions(corpus: string, rootHash: string): ProbeQuestion[] {
  const preamble =
    `The 1831 text of the novel "Frankenstein; or, The Modern Prometheus" is stored in the `
    + `AST database as one document (doc key ${FRANK_DOC_KEY}). The hash of its root AST node is `
    + `${rootHash}. Calling trellis_postgres.get_ast_texts with that hash returns the full `
    + `document text, reconstructed by concatenating its paragraph blocks in order (paragraph `
    + `boundaries are unmarked; line breaks inside paragraphs are preserved). `;

  const questions: ProbeQuestion[] = [];
  for (const needle of COUNT_NEEDLES) {
    const expected = String(countOccurrences(corpus, needle));
    questions.push({
      id: `count-${needle.toLowerCase()}`,
      suite: 'frank',
      kind: 'count',
      question:
        `${preamble}QUESTION: How many times does the exact character sequence "${needle}" `
        + `occur in the document text? Count case-sensitively; every occurrence counts, `
        + `including inside possessives. Output FINAL_ANSWER: <integer>.`,
      expected,
      isCorrect: answer => extractAnswerInteger(answer) === Number(expected),
    });
  }
  for (const phrase of QUOTE_PHRASES) {
    const expected = sentenceContaining(corpus, phrase);
    questions.push({
      id: `quote-${phrase.split(' ').slice(-1)[0]}`,
      suite: 'frank',
      kind: 'quote',
      question:
        `${preamble}QUESTION: Quote the single complete sentence of the document that contains `
        + `the phrase "${phrase}", exactly as it appears in the document text. `
        + `Output FINAL_ANSWER: <the sentence>.`,
      expected,
      isCorrect: answer => answerContainsSentence(answer, expected),
    });
  }
  for (const phrase of LOCATE_PHRASES) {
    const expected = sectionContaining(corpus, phrase);
    questions.push({
      id: `locate-${phrase.split(' ').slice(-1)[0]}`,
      suite: 'frank',
      kind: 'locate',
      question:
        `${preamble}QUESTION: The document is structured as sections introduced by the headings `
        + `"Letter 1" through "Letter 4" and then "Chapter 1" through "Chapter 24" (a table of `
        + `contents near the start of the text also lists them). In which section does the `
        + `phrase "${phrase}" appear? Output FINAL_ANSWER: <Letter N or Chapter N>.`,
      expected,
      isCorrect: answer => extractAnswerSection(answer) === expected,
      locateKinds: ['Letter', 'Chapter'],
    });
  }
  return questions;
}

function chroniclePreamble(rootHash: string): string {
  // Round 3 (the recorded round-2 question-design fix): the disclosure
  // clause below is verbatim from the frank preamble — round 2 scored
  // chronicle runs on a representation quirk the preamble never
  // disclosed.
  return (
    `A season chronicle ("The Chronicle of the Ninth Circuit Archive") is stored in the `
    + `AST database as one document (doc key ${CHRONICLE_DOC_KEY}). The hash of its root AST `
    + `node is ${rootHash}. Calling trellis_postgres.get_ast_texts with that hash returns the `
    + `full document text, reconstructed by concatenating its paragraph blocks in order `
    + `(paragraph boundaries are unmarked; line breaks inside paragraphs are preserved). `
  );
}

function buildChronicleQuestions(corpus: string, rootHash: string): ProbeQuestion[] {
  const preamble = chroniclePreamble(rootHash);
  const questions: ProbeQuestion[] = [];
  for (const needle of CHRONICLE_COUNT_NEEDLES) {
    const expected = String(countOccurrences(corpus, needle));
    questions.push({
      id: `syn-count-${needle.toLowerCase()}`,
      suite: 'chronicle',
      kind: 'count',
      question:
        `${preamble}QUESTION: How many times does the exact character sequence "${needle}" `
        + `occur in the document text? Count case-sensitively. `
        + `Output FINAL_ANSWER: <integer>.`,
      expected,
      isCorrect: answer => extractAnswerInteger(answer) === Number(expected),
    });
  }
  for (const anomaly of CHRONICLE_QUOTE_ANOMALIES) {
    const phrase = chronicleAnomalyPhrase(anomaly);
    const expected = sentenceContaining(corpus, phrase);
    questions.push({
      id: `syn-quote-${phrase.split(' ').slice(-1)[0].toLowerCase()}`,
      suite: 'chronicle',
      kind: 'quote',
      question:
        `${preamble}QUESTION: Quote the single complete sentence of the document that contains `
        + `the phrase "${phrase}", exactly as it appears in the document text. `
        + `Output FINAL_ANSWER: <the sentence>.`,
      expected,
      isCorrect: answer => answerContainsSentence(answer, expected),
    });
  }
  for (const anomaly of CHRONICLE_LOCATE_ANOMALIES) {
    const phrase = chronicleAnomalyPhrase(anomaly);
    const expected = sectionContainingBy(corpus, phrase, ['Entry']);
    questions.push({
      id: `syn-locate-${phrase.split(' ').slice(-1)[0].toLowerCase()}`,
      suite: 'chronicle',
      kind: 'locate',
      question:
        `${preamble}QUESTION: The document is structured as sections introduced by the `
        + `own-line headings "Entry 1" through "Entry 48". In which entry does the phrase `
        + `"${phrase}" appear? Output FINAL_ANSWER: Entry <N>.`,
      expected,
      isCorrect: answer => extractAnswerSectionBy(answer, ['Entry']) === expected,
      locateKinds: ['Entry'],
    });
  }
  return questions;
}

function buildLedgerQuestions(
  docs: LedgerDoc[],
  roots: Map<string, string>
): ProbeQuestion[] {
  const records: LedgerRecord[] = docs.flatMap(d => parseLedgerRecords(d.text));
  const keyList = docs
    .map(d => `${d.docKey}: ${roots.get(d.docKey)}`)
    .join('; ');
  const preamble =
    `${docs.length} shipping ledgers are stored in the AST database as ${docs.length} separate `
    + `documents. Every record line has the exact shape "On day D, Captain <First> <Last> `
    + `shipped N crates of <material> to Port <Name>." Calling trellis_postgres.get_ast_texts `
    + `with a LIST of root hashes returns the full text of each ledger keyed by hash `
    + `(paragraph boundaries are unmarked; line breaks inside paragraphs are preserved — `
    + `parse records by their shape, not by line breaks). `
    + `The documents and their root AST hashes are: ${keyList}. `;

  const top = topPortForMaterial(records, LEDGER_TOP_MATERIAL);
  const captainTotal = totalForCaptainMaterial(records, LEDGER_CAPTAIN, LEDGER_CAPTAIN_MATERIAL);
  const housesWith = docs.filter(d =>
    parseLedgerRecords(d.text).some(
      r => r.material === LEDGER_HOUSES_MATERIAL && r.port === LEDGER_HOUSES_PORT
    )
  ).length;

  return [
    {
      id: 'led-top-port',
      suite: 'ledger',
      kind: 'aggregate',
      question:
        `${preamble}QUESTION: Across ALL ${docs.length} ledgers combined, which port received `
        + `the largest total number of crates of ${LEDGER_TOP_MATERIAL}, and how many crates `
        + `was that total? Output FINAL_ANSWER: <Port name>, <integer>.`,
      expected: `${top.port}, ${top.total}`,
      // The distinctive token: port names are "Port <Word>" with unique
      // words, and answers legitimately come back as "Galeholt, 1679"
      // (found live in Session 22's first scored runs — requiring the
      // "Port " prefix falsely failed correct answers).
      isCorrect: answer =>
        normalizeWhitespace(answer).toLowerCase()
          .includes(top.port.replace(/^Port /, '').toLowerCase())
        && extractAnswerInteger(answer.replace(/day \d+/gi, '')) === top.total,
    },
    {
      id: 'led-captain-total',
      suite: 'ledger',
      kind: 'aggregate',
      question:
        `${preamble}QUESTION: How many crates of ${LEDGER_CAPTAIN_MATERIAL} in total did `
        + `Captain ${LEDGER_CAPTAIN} ship across ALL ${docs.length} ledgers combined? `
        + `Output FINAL_ANSWER: <integer>.`,
      expected: String(captainTotal),
      isCorrect: answer => extractAnswerInteger(answer) === captainTotal,
    },
    {
      id: 'led-houses-with',
      suite: 'ledger',
      kind: 'aggregate',
      question:
        `${preamble}QUESTION: How many of the ${docs.length} ledgers record at least one `
        + `shipment of ${LEDGER_HOUSES_MATERIAL} to ${LEDGER_HOUSES_PORT}? `
        + `Output FINAL_ANSWER: <integer>.`,
      expected: String(housesWith),
      isCorrect: answer => extractAnswerInteger(answer) === housesWith,
    },
  ];
}

/** An integer appears in the answer as its own token (commas tolerated). */
function answerHasInteger(answer: string, value: number): boolean {
  return new RegExp(`\\b${value}\\b`).test(answer.replace(/,(?=\d)/g, ''));
}

function buildRelationalQuestions(
  corpus: RelationalCorpus,
  roots: Map<string, string>
): ProbeQuestion[] {
  const registry = parseRegistryRecords(corpus.registry.text);
  const tariffs = parseTariffRecords(corpus.tariff.text);
  const records = corpus.ledgers.flatMap(d => parseLedgerRecords(d.text));
  const guildIndex = buildGuildIndex(registry);
  const tariffIndex = buildTariffIndex(tariffs);

  const rootOf = (docKey: string): string => {
    const hash = roots.get(docKey);
    if (!hash) throw new Error(`Missing relational document ${docKey}. Run --ingest.`);
    return hash;
  };
  const ledgerList = corpus.ledgers.map(d => `${d.docKey}: ${rootOf(d.docKey)}`).join('; ');
  const preamble =
    `A season-two trading corpus is stored in the AST database as `
    + `${corpus.ledgers.length + 2} separate documents of three kinds. (1) One captain `
    + `registry whose record lines have the exact shape "Captain <First> <Last> sails under `
    + `the banner of the <Guild> Guild." (2) One port tariff schedule whose record lines have `
    + `the exact shape "Port <Name> levies a tariff of T silver per crate of <material>." `
    + `(3) ${corpus.ledgers.length} shipping ledgers whose record lines have the exact shape `
    + `"On day D, Captain <First> <Last> shipped N crates of <material> to Port <Name>." `
    + `Calling trellis_postgres.get_ast_texts with a LIST of root hashes returns the full `
    + `text of each document keyed by hash (paragraph boundaries are unmarked; line breaks `
    + `inside paragraphs are preserved — parse records by their shape, not by line breaks). `
    + `The documents and their root AST hashes are: `
    + `registry ${corpus.registry.docKey}: ${rootOf(corpus.registry.docKey)}; `
    + `tariff schedule ${corpus.tariff.docKey}: ${rootOf(corpus.tariff.docKey)}; `
    + `ledgers ${ledgerList}. `;

  const topGuild = topGuildForMaterial(records, guildIndex, REL_TOP_MATERIAL);
  const portTariff = tariffIntoPort(records, tariffIndex, REL_TARIFF_PORT);
  const topTariff = topGuildByTariff(records, guildIndex, tariffIndex);
  const profile = guildProfile(records, guildIndex, REL_PROFILE_GUILD);

  // Guild names are single distinctive words; integers are matched as
  // whole tokens (the led-top-port precedent: never demand a prefix or
  // ordering the question did not fix).
  return [
    {
      id: 'rel-top-guild',
      suite: 'relational',
      kind: 'aggregate',
      question:
        `${preamble}QUESTION: Across ALL ${corpus.ledgers.length} ledgers combined, the `
        + `captains of which guild shipped the largest total number of crates of `
        + `${REL_TOP_MATERIAL}, and how many crates was that total? (A captain's guild is `
        + `given by the registry.) Output FINAL_ANSWER: <Guild name>, <integer>.`,
      expected: `${topGuild.guild}, ${topGuild.total}`,
      isCorrect: answer =>
        normalizeWhitespace(answer).toLowerCase().includes(topGuild.guild.toLowerCase())
        && answerHasInteger(answer, topGuild.total),
    },
    {
      id: 'rel-port-tariff',
      suite: 'relational',
      kind: 'aggregate',
      question:
        `${preamble}QUESTION: How much tariff silver in total was levied on all shipments `
        + `into ${REL_TARIFF_PORT} across ALL ${corpus.ledgers.length} ledgers combined? `
        + `(Each shipment pays its crate count times that port's per-crate tariff for the `
        + `shipped material, per the tariff schedule.) Output FINAL_ANSWER: <integer>.`,
      expected: String(portTariff),
      isCorrect: answer => extractAnswerInteger(answer) === portTariff,
    },
    {
      id: 'rel-guild-tariff',
      suite: 'relational',
      kind: 'aggregate',
      question:
        `${preamble}QUESTION: The shipments of which guild's captains incurred the largest `
        + `total tariff silver across ALL ledgers, ports, and materials combined, and how `
        + `much silver was that total? (Join all three document kinds: a captain's guild is `
        + `given by the registry; each shipment pays its crate count times the per-crate `
        + `tariff for its port and material.) Output FINAL_ANSWER: <Guild name>, <integer>.`,
      expected: `${topTariff.guild}, ${topTariff.silver}`,
      isCorrect: answer =>
        normalizeWhitespace(answer).toLowerCase().includes(topTariff.guild.toLowerCase())
        && answerHasInteger(answer, topTariff.silver),
    },
    {
      // The answer-channel stress companion: a computed MULTI-PART value
      // (two integers and a port name interpolated in code) through
      // trellis_answer — round 2 covered single ints/sentences.
      id: 'rel-guild-profile',
      suite: 'relational',
      kind: 'aggregate',
      question:
        `${preamble}QUESTION: For the ${REL_PROFILE_GUILD} Guild only, across ALL ledgers `
        + `combined: how many crates in total did its captains ship (all materials), how many `
        + `distinct captains of that guild appear shipping, and which port received the most `
        + `${REL_PROFILE_GUILD} shipments counted by number of records? `
        + `Output FINAL_ANSWER: <total crates>, <distinct captains>, <Port name>.`,
      expected: `${profile.crates}, ${profile.captainCount}, ${profile.topPort}`,
      isCorrect: answer =>
        answerHasInteger(answer, profile.crates)
        && answerHasInteger(answer, profile.captainCount)
        && normalizeWhitespace(answer).toLowerCase()
          .includes(profile.topPort.replace(/^Port /, '').toLowerCase()),
    },
  ];
}

function buildEditQuestions(chronicle: string, chronicleRoot: string): ProbeQuestion[] {
  const preamble = chroniclePreamble(chronicleRoot);
  const editPreamble =
    `${preamble}Your operator has also configured the trellis_textedit toolkit with an edit `
    + `root containing the file ${EDIT_NOTES_PATH}. Perform the edit with the toolkit's `
    + `discipline: load the file, locate the target line by query, splice a replacement at the `
    + `computed address, and write_back (hash-guarded). Never retype file content by hand and `
    + `never write the file any other way. `;

  const quotePhrase = chronicleAnomalyPhrase(EDIT_QUOTE_ANOMALY);
  const quoteSentence = sentenceContaining(chronicle, quotePhrase);
  const quoteLine = `QUOTE OF RECORD: ${quoteSentence}`;
  const tallyCount = countOccurrences(chronicle, EDIT_TALLY_NEEDLE);
  const tallyLine = `TALLY OF MENTIONS: ${tallyCount}`;

  return [
    {
      id: 'edit-quote',
      suite: 'edit',
      kind: 'edit',
      question:
        `${editPreamble}TASK: Fetch the chronicle text from the database IN CODE and extract `
        + `the single complete sentence containing the phrase "${quotePhrase}" (build the `
        + `sentence in code from the fetched text — do not retype it). In ${EDIT_NOTES_PATH}, `
        + `replace the whole line containing the placeholder ${EDIT_QUOTE_MARKER} with the `
        + `line "QUOTE OF RECORD: " followed by that exact sentence. Leave every other line `
        + `untouched, write_back, then answer with the extracted sentence. `
        + `Output FINAL_ANSWER: <the sentence>.`,
      expected: quoteSentence,
      isCorrect: answer => answerContainsSentence(answer, quoteSentence),
      edit: {
        seedFiles: { [EDIT_NOTES_PATH]: EDIT_NOTES_SEED },
        expectedFiles: {
          [EDIT_NOTES_PATH]: replaceUniqueLine(EDIT_NOTES_SEED, EDIT_QUOTE_MARKER, quoteLine),
        },
      },
    },
    {
      id: 'edit-tally',
      suite: 'edit',
      kind: 'edit',
      question:
        `${editPreamble}TASK: Count IN CODE how many times the exact character sequence `
        + `"${EDIT_TALLY_NEEDLE}" occurs in the chronicle text (case-sensitive). In `
        + `${EDIT_NOTES_PATH}, replace the whole line containing the placeholder `
        + `${EDIT_TALLY_MARKER} with the line "TALLY OF MENTIONS: " followed by that count, `
        + `interpolating the computed value in code. Leave every other line untouched, `
        + `write_back, then answer with the count. Output FINAL_ANSWER: <integer>.`,
      expected: String(tallyCount),
      isCorrect: answer => extractAnswerInteger(answer) === tallyCount,
      edit: {
        seedFiles: { [EDIT_NOTES_PATH]: EDIT_NOTES_SEED },
        expectedFiles: {
          [EDIT_NOTES_PATH]: replaceUniqueLine(EDIT_NOTES_SEED, EDIT_TALLY_MARKER, tallyLine),
        },
      },
    },
  ];
}

// --- Corpus plumbing --------------------------------------------------------

function ingestDeps(): IngestDeps {
  return {
    pgPool,
    queues: {
      extraction: { addBulk: async () => { throw new Error('no extraction under policy none'); } },
      invalidation: { add: async () => undefined },
    },
    log: loggerFor({ component: 'exp_effective_context' }),
  };
}

async function currentRoot(docKey: string): Promise<{ rootHash: string; version: number }> {
  const res = await pgPool.query(
    'SELECT root_hash, version FROM documents WHERE doc_key = $1 ORDER BY version DESC LIMIT 1',
    [docKey]
  );
  if (res.rows.length === 0) {
    throw new Error(
      `No document under '${docKey}'. Run --ingest first (zero-paid) to load the corpora.`
    );
  }
  return { rootHash: res.rows[0].root_hash, version: res.rows[0].version };
}

async function currentRootsByPrefix(prefix: string): Promise<Map<string, string>> {
  const res = await pgPool.query(
    `SELECT DISTINCT ON (doc_key) doc_key, root_hash
       FROM documents WHERE doc_key LIKE $1 ORDER BY doc_key, version DESC`,
    [`${prefix}%`]
  );
  return new Map(res.rows.map((r: { doc_key: string; root_hash: string }) => [r.doc_key, r.root_hash]));
}

async function readRootNode(rootHash: string): Promise<ASTNode> {
  const res = await pgPool.query('SELECT data FROM ast_nodes WHERE id = $1', [rootHash]);
  if (res.rows.length === 0) throw new Error(`Root ${rootHash} missing from ast_nodes.`);
  return res.rows[0].data as ASTNode;
}

/**
 * The truth must be representation-invariant: the answers computed from
 * the committed/generated bytes must hold over the text the agent
 * actually reads back (the root reconstruction, which drops blank lines
 * between paragraphs). A mismatch is a question-design error and refuses
 * the probe — never something a run gets scored against.
 */
function assertPhraseInvariant(
  label: string,
  corpus: string,
  reconstruction: string,
  needles: readonly string[],
  phrases: readonly string[]
): void {
  for (const needle of needles) {
    const fromFile = countOccurrences(corpus, needle);
    const fromDb = countOccurrences(reconstruction, needle);
    if (fromFile !== fromDb) {
      throw new Error(
        `[${label}] Count truth for "${needle}" differs between the source bytes (${fromFile}) `
        + `and the stored reconstruction (${fromDb}); redesign the question.`
      );
    }
  }
  const normalized = normalizeWhitespace(reconstruction);
  for (const phrase of phrases) {
    const hits = countOccurrences(normalized, normalizeWhitespace(phrase));
    if (hits !== 1) {
      throw new Error(
        `[${label}] Phrase "${phrase}" occurs ${hits} time(s) in the stored reconstruction `
        + '(expected 1); redesign the question.'
      );
    }
  }
}

function assertFrankInvariant(corpus: string, reconstruction: string): void {
  assertPhraseInvariant('frank', corpus, reconstruction, COUNT_NEEDLES,
    [...QUOTE_PHRASES, ...LOCATE_PHRASES]);
}

function assertChronicleInvariant(corpus: string, reconstruction: string): void {
  assertPhraseInvariant(
    'chronicle', corpus, reconstruction,
    [...CHRONICLE_COUNT_NEEDLES, EDIT_TALLY_NEEDLE],
    [
      ...CHRONICLE_QUOTE_ANOMALIES.map(chronicleAnomalyPhrase),
      ...CHRONICLE_LOCATE_ANOMALIES.map(chronicleAnomalyPhrase),
      chronicleAnomalyPhrase(EDIT_QUOTE_ANOMALY),
    ]
  );
}

/** Ledger truths are parsed records; the reconstruction must parse identically. */
function assertLedgerInvariant(doc: LedgerDoc, reconstruction: string): void {
  const fromFile = JSON.stringify(parseLedgerRecords(doc.text));
  const fromDb = JSON.stringify(parseLedgerRecords(reconstruction));
  if (fromFile !== fromDb) {
    throw new Error(
      `[ledger] ${doc.docKey}: records parsed from the stored reconstruction differ from the `
      + 'generated bytes; redesign the corpus.'
    );
  }
}

/** Relational truths are parsed records too — one parser per document kind. */
function assertRelationalInvariant(doc: RelationalDoc, reconstruction: string): void {
  const parse =
    doc.docKey === RELATIONAL_REGISTRY_DOC_KEY ? parseRegistryRecords
    : doc.docKey === RELATIONAL_TARIFF_DOC_KEY ? parseTariffRecords
    : parseLedgerRecords;
  const fromFile = JSON.stringify(parse(doc.text));
  const fromDb = JSON.stringify(parse(reconstruction));
  if (fromFile !== fromDb) {
    throw new Error(
      `[relational] ${doc.docKey}: records parsed from the stored reconstruction differ from `
      + 'the generated bytes; redesign the corpus.'
    );
  }
}

// --- The zero-paid setup mode (--ingest) ------------------------------------

/** Spawns the REAL Python tool surface to read sampled blocks back. */
function readBlocksViaPythonTool(hashes: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const code =
      'import sys, json; sys.path.insert(0, sys.argv[1]); '
      + 'from trellis_tools import TrellisPostgres; '
      + 'tool = TrellisPostgres(); '
      + 'print("BLOCK_TEXTS: " + tool.get_ast_texts(json.loads(sys.argv[2]))); '
      + 'tool.close()';
    const child = spawn(
      config.python.executable,
      ['-c', code, path.resolve('src', 'rlm'), JSON.stringify(hashes)],
      {
        env: {
          ...process.env,
          ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
          PG_DSN: pgDsn(),
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (c: string) => { stdout += c; });
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (c: string) => { stderr += c; });
    child.on('error', reject);
    child.on('close', code_ => {
      const line = stdout.split('\n').find(l => l.startsWith('BLOCK_TEXTS: '));
      if (code_ !== 0 || !line) {
        reject(new Error(`python get_ast_texts probe failed (exit ${code_}): ${stderr.slice(0, 400)}`));
        return;
      }
      resolve(JSON.parse(line.slice('BLOCK_TEXTS: '.length)));
    });
  });
}

async function ingestOne(docKey: string, text: string): Promise<{ rootId: string }> {
  const root = parseMarkdownToAST(text);
  const result = await ingestDocument(ingestDeps(), {
    rootNode: root,
    docKey,
    extractionPolicy: { mode: 'none' },
  });
  console.log(
    `Ingested '${result.docKey}' version ${result.version}: root ${result.rootId}, `
    + `${result.totalNodes} nodes, ${result.blocksEligible} blocks, policy `
    + `${result.extractionPolicy} (0 queued)`
    + (result.diff
      ? `; diff added ${result.diff.added}, orphaned ${result.diff.orphaned}, retained `
        + `${result.diff.retained}${result.diff.added === 0 && result.diff.orphaned === 0
          ? ' — the auditable no-op.' : '.'}`
      : '; first version.')
  );
  return { rootId: result.rootId };
}

/** Read sampled blocks back through the REAL Python tool and byte-compare. */
async function verifyBlockReadback(label: string, rootId: string): Promise<void> {
  const storedRoot = await readRootNode(rootId);
  const blocks = collectExtractionBlocks(storedRoot).filter(b => nodeText(b).trim().length > 0);
  const samples = [blocks[0], blocks[Math.floor(blocks.length / 2)], blocks[blocks.length - 1]];
  const viaTool = await readBlocksViaPythonTool(samples.map(b => b.id));
  for (const block of samples) {
    const match = viaTool[block.id] === nodeText(block);
    console.log(
      `  [${label}] get_ast_texts(${block.id.slice(0, 12)}…): ${match ? 'OK' : 'MISMATCH'} `
      + `(${Buffer.byteLength(viaTool[block.id] ?? '', 'utf8')} bytes: `
      + `"${normalizeWhitespace(viaTool[block.id] ?? '').slice(0, 60)}…")`
    );
    if (!match) throw new Error(`get_ast_texts returned wrong bytes for ${block.id}`);
  }
}

/**
 * The zero-paid localization quantification (round 3, the design
 * finding): how many own-line headings can the naive line-anchored
 * method see over the STORED glued reconstruction, versus over a
 * boundary-preserving reconstruction of the same stored blocks? The
 * same numbers are unit-pinned from the committed bytes in
 * ground_truth.test.ts; this prints them from the database's actual
 * root nodes.
 */
async function printBoundaryQuantification(
  label: string,
  rootId: string,
  kinds: readonly string[],
  sourceCorpus: string
): Promise<void> {
  const root = await readRootNode(rootId);
  const glued = nodeText(root);
  const preserved = boundaryPreservedReconstruction(
    collectExtractionBlocks(root).map(b => nodeText(b))
  );
  const inSource = lineAnchoredHeadingLabels(sourceCorpus, kinds).length;
  const inGlued = lineAnchoredHeadingLabels(glued, kinds).length;
  const inPreserved = lineAnchoredHeadingLabels(preserved, kinds).length;
  console.log(
    `  [${label}] own-line "${kinds.join('/')}" headings visible to a line-anchored regex: `
    + `source ${inSource}, stored (glued) ${inGlued}, boundary-preserved ${inPreserved}`
  );
}

async function runIngest(): Promise<void> {
  // frank (the round-1 corpus; durable — re-ingest is the auditable no-op).
  const frank = fs.readFileSync(FRANK_CORPUS_PATH, 'utf-8');
  console.log(`Corpus: ${FRANK_CORPUS_PATH} (${Buffer.byteLength(frank, 'utf8')} bytes)`);
  const frankResult = await ingestOne(FRANK_DOC_KEY, frank);
  await verifyBlockReadback('frank', frankResult.rootId);
  assertFrankInvariant(frank, nodeText(await readRootNode(frankResult.rootId)));

  // chronicle (Session 22: the unmemorized corpus).
  const chronicle = fs.readFileSync(CHRONICLE_CORPUS_PATH, 'utf-8');
  console.log(`\nCorpus: ${CHRONICLE_CORPUS_PATH} (${Buffer.byteLength(chronicle, 'utf8')} bytes)`);
  const chronicleResult = await ingestOne(CHRONICLE_DOC_KEY, chronicle);
  await verifyBlockReadback('chronicle', chronicleResult.rootId);
  assertChronicleInvariant(chronicle, nodeText(await readRootNode(chronicleResult.rootId)));

  // ledgers (Session 22: the multi-document corpus — 40 verified ingests).
  const docs = generateLedgers();
  console.log(`\nLedger set: ${docs.length} generated documents`);
  const roots: string[] = [];
  for (const doc of docs) {
    const { rootId } = await ingestOne(doc.docKey, doc.text);
    roots.push(rootId);
    assertLedgerInvariant(doc, nodeText(await readRootNode(rootId)));
  }
  // Sampled Python read-back on one ledger (the same tool surface reads
  // them all; the per-doc record invariant above already covered content).
  await verifyBlockReadback('ledger', roots[0]);

  // relational (Session 23: the multi-table corpus — 102 verified ingests).
  const relational = generateRelationalCorpus();
  const relationalDocs = allRelationalDocs(relational);
  console.log(
    `\nRelational set: ${relationalDocs.length} generated documents `
    + `(${Buffer.byteLength(relationalDocs.map(d => d.text).join(''), 'utf8')} bytes)`
  );
  const relationalRoots: string[] = [];
  for (const doc of relationalDocs) {
    const { rootId } = await ingestOne(doc.docKey, doc.text);
    relationalRoots.push(rootId);
    assertRelationalInvariant(doc, nodeText(await readRootNode(rootId)));
  }
  // Sampled Python read-back on the registry and one ledger.
  await verifyBlockReadback('relational-registry', relationalRoots[0]);
  await verifyBlockReadback('relational-ledger', relationalRoots[2]);

  console.log('\nRepresentation invariants hold for all corpora: source truths = stored truths.');
  console.log('\nLocalization quantification (the round-3 design finding, zero-paid):');
  await printBoundaryQuantification('chronicle', chronicleResult.rootId, ['Entry'], chronicle);
  await printBoundaryQuantification('frank', frankResult.rootId, ['Letter', 'Chapter'], frank);
  console.log('Re-run --ingest to observe the auditable no-op (new version, empty diff, 0 queued).');
}

// --- The paid probe ---------------------------------------------------------

interface RunRow {
  suite: Suite;
  arm: Arm;
  questionId: string;
  kind: ProbeQuestion['kind'];
  repeat: number;
  status: string;
  correct: boolean;
  /** Edit suite only: post-edit bytes equal the computed expectation. */
  fileExact: boolean | null;
  inputTokens: number;
  outputTokens: number;
  iterations: number | null;
  subcalls: number;
  toolCalls: number;
  answerSubmits: number;
  usedPandas: boolean;
  usedPolars: boolean;
  /** locate questions only: how the run localized, where observable. */
  locMethod: string | null;
  costUsd: number;
  answer: string;
}

function extractLine(stdout: string, prefix: string): string | null {
  for (const line of stdout.split('\n')) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return null;
}

function safeJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * The spawn environment: exactly the pinned default kernel for the on
 * arm, plus TRELLIS_EXP_OMIT_CMT=1 for the off arm — and nothing else
 * that could move either prompt off its pinned bytes (no MCP servers,
 * no goal id / workspace, no citation instrumentation, the canonical
 * default module selection). The edit suite adds exactly the
 * operator-owned TRELLIS_EDIT_ROOT (the Session 20 gating mechanism,
 * pointed at this run's scratch root).
 */
function armEnv(arm: Arm, editRoot: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
    NEO4J_URI: config.neo4j.uri,
    NEO4J_USER: config.neo4j.user,
    NEO4J_PASSWORD: config.neo4j.password,
    PG_DSN: pgDsn(),
    TRELLIS_MODULES: JSON.stringify(['spatial-flywheel']),
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  delete env.TRELLIS_MCP_SERVERS;
  delete env.TRELLIS_EDIT_ROOT;
  delete env.TRELLIS_TEXTEDIT_MAX_FILE_BYTES;
  delete env.TRELLIS_TEXTEDIT_MAX_FILES;
  delete env.TRELLIS_CITATION_AUDIT;
  delete env.TRELLIS_CITATION_HINT;
  delete env.TRELLIS_CITATION_ENTAIL;
  delete env.TRELLIS_EXP_OMIT_CMT;
  if (arm === 'off') env.TRELLIS_EXP_OMIT_CMT = '1';
  if (editRoot) env.TRELLIS_EDIT_ROOT = editRoot;
  return env;
}

function spawnRun(
  arm: Arm,
  question: string,
  maxIterations: number,
  editRoot: string | null
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const script = path.resolve('src', 'rlm', 'trellis_agent.py');
    const child = spawn(
      config.python.executable,
      [script, '--query', question, '--max-iterations', String(maxIterations)],
      { env: armEnv(arm, editRoot) }
    );
    let stdout = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (c: string) => { stdout += c; });
    child.stderr.on('data', () => { /* suppressed; raw stdout is logged */ });
    child.on('error', reject);
    child.on('close', () => resolve({ stdout }));
  });
}

async function runOne(
  arm: Arm,
  q: ProbeQuestion,
  repeat: number,
  maxIterations: number,
  logDir: string
): Promise<RunRow> {
  // Edit runs get a FRESH scratch root per run: seeds written before the
  // spawn, bytes scored after it, directory removed once captured.
  let editRoot: string | null = null;
  if (q.edit) {
    editRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-ecp-edit-'));
    for (const [rel, content] of Object.entries(q.edit.seedFiles)) {
      fs.writeFileSync(path.join(editRoot, rel), content, 'utf-8');
    }
  }

  const runTag = `${arm}-${q.id}-r${repeat}`;
  let fileExact: boolean | null = null;
  let stdout = '';
  try {
    ({ stdout } = await spawnRun(arm, q.question, maxIterations, editRoot));
    fs.writeFileSync(path.join(logDir, `${runTag}.log`), stdout);
    if (q.edit && editRoot) {
      fileExact = true;
      for (const [rel, expected] of Object.entries(q.edit.expectedFiles)) {
        const actualPath = path.join(editRoot, rel);
        const actual = fs.existsSync(actualPath) ? fs.readFileSync(actualPath, 'utf-8') : '';
        fs.writeFileSync(path.join(logDir, `${runTag}.${rel.replace(/[\\/]/g, '_')}`), actual);
        if (actual !== expected) fileExact = false;
      }
    }
  } finally {
    if (editRoot) fs.rmSync(editRoot, { recursive: true, force: true });
  }

  const result = safeJson(extractLine(stdout, 'TRELLIS_RESULT:'));
  const telemetry = safeJson(extractLine(stdout, 'TRELLIS_TELEMETRY:'));
  const inputTokens = (telemetry?.input_tokens as number) ?? 0;
  const outputTokens = (telemetry?.output_tokens as number) ?? 0;
  const answer = String(result?.answer ?? '');
  const answerOk = result?.status === 'ok' && q.isCorrect(answer);
  return {
    suite: q.suite,
    arm,
    questionId: q.id,
    kind: q.kind,
    repeat,
    status: (result?.status as string) ?? 'unknown',
    correct: q.edit ? answerOk && fileExact === true : answerOk,
    fileExact,
    inputTokens,
    outputTokens,
    iterations: extractIterations(stdout),
    subcalls: (telemetry?.subcall_count as number) ?? 0,
    toolCalls: (telemetry?.tool_calls as number) ?? 0,
    answerSubmits: (telemetry?.answer_submits as number) ?? 0,
    usedPandas: stdout.includes('import pandas') || stdout.includes('from pandas'),
    usedPolars: stdout.includes('import polars') || stdout.includes('from polars'),
    locMethod: q.locateKinds ? classifyLocalizationMethod(stdout, q.locateKinds) : null,
    costUsd: (inputTokens / 1e6) * PRICE_PER_M_INPUT + (outputTokens / 1e6) * PRICE_PER_M_OUTPUT,
    answer: normalizeWhitespace(answer).slice(0, 120),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function spread(values: number[]): string {
  if (values.length === 0) return '-';
  const sorted = [...values].sort((a, b) => a - b);
  return `${median(values)} [${sorted[0]}..${sorted[sorted.length - 1]}]`;
}

function printAggregate(rows: RunRow[], suites: Suite[], arms: Arm[]): void {
  console.log('\n==== AGGREGATE (per suite × arm: median [min..max]) ====');
  console.log(
    'suite      arm  runs  correct  inTok med[min..max]     outTok  iter  sub  db  submit  frames  totalCost'
  );
  for (const suite of suites) {
    for (const arm of arms) {
      const rs = rows.filter(r => r.suite === suite && r.arm === arm);
      if (rs.length === 0) continue;
      const correct = rs.filter(r => r.correct).length;
      const cost = rs.reduce((s, r) => s + r.costUsd, 0);
      const submits = rs.filter(r => r.answerSubmits > 0).length;
      const pandas = rs.filter(r => r.usedPandas || r.usedPolars).length;
      console.log(
        `${suite.padEnd(10)} ${arm.padEnd(4)} ${String(rs.length).padStart(4)}  `
        + `${String(correct).padStart(4)}/${rs.length}  `
        + `${spread(rs.map(r => r.inputTokens)).padEnd(22)}  `
        + `${String(median(rs.map(r => r.outputTokens))).padStart(5)}  `
        + `${String(median(rs.map(r => r.iterations ?? 0))).padStart(4)}  `
        + `${String(median(rs.map(r => r.subcalls))).padStart(3)}  `
        + `${String(median(rs.map(r => r.toolCalls))).padStart(2)}  `
        + `${String(submits).padStart(3)}/${rs.length}  `
        + `${String(pandas).padStart(3)}/${rs.length}  `
        + `$${cost.toFixed(4)}`
      );
    }
  }
}

/** The localization-method breakdown (locate rows only, where observable). */
function printLocalizationMethods(rows: RunRow[]): void {
  const locateRows = rows.filter(r => r.locMethod !== null);
  if (locateRows.length === 0) return;
  console.log('\n==== LOCALIZATION METHODS (locate runs; classified from run logs) ====');
  console.log('method         runs  correct');
  for (const method of ['line-anchored', 'shape', 'unknown']) {
    const rs = locateRows.filter(r => r.locMethod === method);
    if (rs.length === 0) continue;
    console.log(
      `${method.padEnd(13)} ${String(rs.length).padStart(5)}  `
      + `${String(rs.filter(r => r.correct).length).padStart(5)}/${rs.length}`
    );
  }
}

async function buildSelectedQuestions(suites: Suite[]): Promise<{
  questions: ProbeQuestion[];
  meta: Record<string, unknown>;
}> {
  const questions: ProbeQuestion[] = [];
  const meta: Record<string, unknown> = {};

  if (suites.includes('frank')) {
    const corpus = fs.readFileSync(FRANK_CORPUS_PATH, 'utf-8');
    const { rootHash, version } = await currentRoot(FRANK_DOC_KEY);
    assertFrankInvariant(corpus, nodeText(await readRootNode(rootHash)));
    questions.push(...buildFrankQuestions(corpus, rootHash));
    meta.frank = { docKey: FRANK_DOC_KEY, version, rootHash };
  }
  if (suites.includes('chronicle') || suites.includes('edit')) {
    const corpus = fs.readFileSync(CHRONICLE_CORPUS_PATH, 'utf-8');
    const { rootHash, version } = await currentRoot(CHRONICLE_DOC_KEY);
    assertChronicleInvariant(corpus, nodeText(await readRootNode(rootHash)));
    if (suites.includes('chronicle')) {
      questions.push(...buildChronicleQuestions(corpus, rootHash));
    }
    if (suites.includes('edit')) {
      questions.push(...buildEditQuestions(corpus, rootHash));
    }
    meta.chronicle = { docKey: CHRONICLE_DOC_KEY, version, rootHash };
  }
  if (suites.includes('ledger')) {
    const docs = generateLedgers();
    const roots = await currentRootsByPrefix(LEDGER_KEY_PREFIX);
    if (roots.size < docs.length) {
      throw new Error(
        `Only ${roots.size}/${docs.length} ledger documents found. Run --ingest first.`
      );
    }
    for (const doc of docs) {
      const rootHash = roots.get(doc.docKey);
      if (!rootHash) throw new Error(`Missing ledger document ${doc.docKey}. Run --ingest.`);
      assertLedgerInvariant(doc, nodeText(await readRootNode(rootHash)));
    }
    questions.push(...buildLedgerQuestions(docs, roots));
    meta.ledger = { prefix: LEDGER_KEY_PREFIX, count: docs.length };
  }
  if (suites.includes('relational')) {
    const corpus = generateRelationalCorpus();
    const docs = allRelationalDocs(corpus);
    const roots = await currentRootsByPrefix(RELATIONAL_LEDGER_KEY_PREFIX);
    for (const key of [RELATIONAL_REGISTRY_DOC_KEY, RELATIONAL_TARIFF_DOC_KEY]) {
      roots.set(key, (await currentRoot(key)).rootHash);
    }
    if (roots.size < docs.length) {
      throw new Error(
        `Only ${roots.size}/${docs.length} relational documents found. Run --ingest first.`
      );
    }
    for (const doc of docs) {
      const rootHash = roots.get(doc.docKey);
      if (!rootHash) throw new Error(`Missing relational document ${doc.docKey}. Run --ingest.`);
      assertRelationalInvariant(doc, nodeText(await readRootNode(rootHash)));
    }
    questions.push(...buildRelationalQuestions(corpus, roots));
    meta.relational = {
      prefix: RELATIONAL_LEDGER_KEY_PREFIX,
      houses: RELATIONAL_HOUSE_COUNT,
      registry: RELATIONAL_REGISTRY_DOC_KEY,
      tariff: RELATIONAL_TARIFF_DOC_KEY,
    };
  }
  return { questions, meta };
}

/** Corpus token size per suite — the worst-case attention cost driver. */
function suiteCorpusTokens(suite: Suite): number {
  switch (suite) {
    case 'frank':
      return Math.ceil(Buffer.byteLength(fs.readFileSync(FRANK_CORPUS_PATH, 'utf-8'), 'utf8') / 4);
    case 'chronicle':
    case 'edit':
      return Math.ceil(Buffer.byteLength(fs.readFileSync(CHRONICLE_CORPUS_PATH, 'utf-8'), 'utf8') / 4);
    case 'ledger':
      return Math.ceil(
        Buffer.byteLength(generateLedgers().map(d => d.text).join(''), 'utf8') / 4
      );
    case 'relational':
      return Math.ceil(
        Buffer.byteLength(
          allRelationalDocs(generateRelationalCorpus()).map(d => d.text).join(''),
          'utf8'
        ) / 4
      );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.ingest) {
    await runIngest();
    return;
  }

  const { questions: allQuestions, meta } = await buildSelectedQuestions(args.suites);
  const questions = args.questionIds
    ? allQuestions.filter(q => args.questionIds!.includes(q.id))
    : allQuestions;
  if (questions.length === 0) throw new Error('No questions selected.');

  const runCount = args.arms.length * questions.length * args.repeats;
  console.log('Effective-context probe plan (round 3):');
  console.log(`  suites:            ${args.suites.join(', ')}`);
  for (const [k, v] of Object.entries(meta)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  console.log(
    `  arms × questions × repeats: ${args.arms.join(',')} × ${questions.length} × `
    + `${args.repeats} = ${runCount} runs`
  );
  console.log(`  max iterations:    ${args.maxIterations} per run`);
  console.log('  questions (expected answers computed from the source bytes):');
  for (const q of questions) {
    console.log(
      `    ${q.id.padEnd(20)} [${q.suite}/${q.kind}]  expected: `
      + `${q.expected.slice(0, 60)}${q.expected.length > 60 ? '…' : ''}`
    );
  }
  // Pre-flight estimate (stated assumptions, conservative): a run that
  // keeps the corpus in REPL state re-feeds only queries and bounded
  // prints (round 1 medians: ~8k input tokens); a run that pulls the
  // whole corpus through attention re-feeds ≈corpus tokens on later
  // iterations. The cumulative abort below is the hard stop either way.
  const expectedPerRun = ((40_000 / 1e6) * PRICE_PER_M_INPUT) + ((2_000 / 1e6) * PRICE_PER_M_OUTPUT);
  const worstCorpusTokens = Math.max(...args.suites.map(suiteCorpusTokens));
  const worstPerRun = ((worstCorpusTokens * (args.maxIterations - 1)) / 1e6) * PRICE_PER_M_INPUT;
  console.log(
    `  estimate:          expected ≈$${expectedPerRun.toFixed(2)}/run (≤40k in / ≤2k out) `
    + `⇒ ≈$${(expectedPerRun * runCount).toFixed(2)} total; worst case ≈$${worstPerRun.toFixed(2)}/run `
    + `if the largest selected corpus (≈${worstCorpusTokens.toLocaleString()} tokens) re-feeds `
    + 'through attention every iteration'
  );
  console.log(`  hard stop:         cumulative spend > $${args.maxSpendUsd.toFixed(2)} aborts remaining runs`);

  if (!args.confirmPaid) {
    console.log(
      '\nPlan only — nothing spawned and nothing spent. Re-run with --confirm-paid to run the '
      + 'probe (owner-approved, per run).'
    );
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = path.join('benchmark_logs', `effective-context-${stamp}`);
  fs.mkdirSync(logDir, { recursive: true });
  console.log(`\nRaw run logs: ${logDir}${path.sep}<arm>-<question>-r<repeat>.log\n`);

  const rows: RunRow[] = [];
  let total = 0;
  let aborted = false;
  for (const arm of args.arms) {
    console.log(
      `--- arm: ${arm} (${arm === 'off'
        ? 'TRELLIS_EXP_OMIT_CMT=1 — the §6.2 block absent'
        : 'the pinned default kernel'}) ---`
    );
    for (const q of questions) {
      for (let repeat = 1; repeat <= args.repeats; repeat++) {
        if (total > args.maxSpendUsd) { aborted = true; break; }
        const row = await runOne(arm, q, repeat, args.maxIterations, logDir);
        rows.push(row);
        total += row.costUsd;
        console.log(
          `  ${q.id.padEnd(20)} r${repeat} ${row.status.padEnd(9)} `
          + `correct=${row.correct ? 'YES' : 'no '}`
          + `${row.fileExact === null ? '' : ` file=${row.fileExact ? 'exact' : 'DIFF '}`} `
          + `in=${String(row.inputTokens).padStart(7)} out=${String(row.outputTokens).padStart(6)} `
          + `iter=${row.iterations ?? '?'} sub=${row.subcalls} db=${row.toolCalls} `
          + `submit=${row.answerSubmits} pandas=${row.usedPandas ? 'Y' : 'n'}`
          + `${row.usedPolars ? ' polars=Y' : ''}`
          + `${row.locMethod ? ` loc=${row.locMethod}` : ''} `
          + `$${row.costUsd.toFixed(4)} | "${row.answer.slice(0, 60)}"`
        );
      }
      if (aborted) break;
    }
    if (aborted) break;
  }
  if (aborted) {
    console.log(
      `\n*** ABORTED: cumulative spend $${total.toFixed(4)} crossed the $${args.maxSpendUsd.toFixed(2)} `
      + 'ceiling; remaining runs skipped. Partial results below. ***'
    );
  }

  fs.writeFileSync(
    path.join(logDir, 'summary.json'),
    JSON.stringify({
      suites: args.suites,
      meta,
      maxIterations: args.maxIterations,
      repeats: args.repeats,
      aborted,
      rows,
    }, null, 2)
  );
  printAggregate(rows, args.suites, args.arms);
  printLocalizationMethods(rows);
  console.log(`\nTotal spend: $${total.toFixed(4)} across ${rows.length} run(s).`);
}

main()
  .then(async () => { await pgPool.end().catch(() => {}); process.exit(0); })
  .catch(async error => {
    console.error(`\nFailed: ${error instanceof Error ? error.stack ?? error.message : error}`);
    await pgPool.end().catch(() => {});
    process.exit(1);
  });
