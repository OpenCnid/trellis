# Governed documents

`AGENTS.md` rules 22 and 23, carried for work that edits a byte-budgeted
governed document — any path in
`tools/repository-surface/root-contract.json`'s `rootFiles` or
`documentUpsum.paths`, or the navigation map inside one. A governed
document states claims about the repository and lives under a measured
`maxBytes` ceiling that `npm run check:repo-surface` refuses past. Rule 22
keeps those claims true as the repository moves; rule 23 keeps an edit's
own reach evidenced. The two numbers are new here and append-only, cited
from the restructure. Rules 12, 18 and 19 keep their own text in
`AGENTS.md` and apply to this work too; editing `AGENTS.md` itself writes
prompt bytes, so rule 16 binds that edit.

## 22. The document's claims about the repository

The session updates every claim the document makes about the repository,
in the commit that falsifies it. A claim the code has moved past reads
exactly as authoritative as one still true, so the commit that falsifies
it is the one place the repair lands beside the change that needs it.

**(a) Counts.** The session recomputes every number the text states by a
named command, and repairs the whole set of sentences stating that
count — repository-wide, never only the file that owns the set. The count
is a value a command computes and the session receives, never one it
reads off by eye (rule 5); the same count is often asserted in several
documents at once, so the repair ranges over the sentences that state it,
not the file that holds one of them.

**(b) Addresses.** The session follows every section, rule, or heading
identifier it adds, moves, renames, or retires to every citation of it —
bare section references, link fragments, and citations in code comments
and tests included. Section and rule numbers are append-only precisely
because they are cited from code and from other records, so an identifier
that moves without its citations leaves a live reference resolving to the
wrong target or to none.

**(c) Rows.** Each index, table, registry, and contract carries a row for
exactly the entities its membership rule admits; the session creating or
retiring an entity settles every such rule, since the surfaces it already
opened are never the set. The failure this forecloses: `AGENTS.md`'s
navigation map, `root-contract.json`'s paths arrays, and other
enumerations take a row by hand and silently omit members —
named-implies-exists is what `check:repo-surface` proves,
exists-implies-named is not, so the session settles the enumeration's
membership rule rather than the rows it happened to touch.

## 23. The edit's claims about itself

The session evidences what its own edit did. For every directive it
rewrote, the session names one case the original foreclosed and the
rewrite still forecloses. A green suite, a met byte budget, and intact
numbering all held while rule 19(c) once shipped as its own converse — so
those establish the edit's shape, and the named foreclosed case is what
establishes that its meaning held.

## Byte discipline — grow only into measured headroom

A session grows a governed document only into headroom it has measured,
and an edit that would cross the ceiling rewrites the document's
LEAST-DECISIVE prose rather than appending past the bound. Ranked section
bytes are the evidence (`npm run upsum -- <path>`, which prints size
against the contracted budget and ranks sections largest-first);
decisiveness is the criterion for what to cut. Least-decisive is not
heaviest: the heaviest section is often the most load-bearing, so ranked
bytes locate the candidates and decisiveness chooses among them
(`docs/architecture/RLM_HARNESS_SCAFFOLDING.md` §7.3, *The size bound is a
code-checked constant, not a model estimate*; the same criterion prints
from `tools/document-upsum/upsum.ts`).
