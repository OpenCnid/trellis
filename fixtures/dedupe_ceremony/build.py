"""Build the dedupe-ceremony fixtures and their answer key, together.

The key is generated from the same plant operations that write the documents, so
the two agree by construction. A hand-maintained key drifts the first time
somebody edits a fixture, and a drifted key grades a correct run as wrong.

Run: python fixtures/dedupe_ceremony/build.py

What "planted" means here is deliberately narrow. A **superfluous** plant is a
span dropped between two paragraphs that already followed each other: the
lead-in refers to what the follow-on answers, so removing the span leaves the
document reading exactly as it did before. A **ceremonious** plant repeats the
same content with a label, a transition into it, and a follow-on that refers
back to it — the seams carry, and removing it breaks them.

The distinction is the whole rule under test, so both plant kinds reuse the same
source text. What separates them is attachment, never wording.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

#: One paragraph, reused by both plant kinds. Identical bytes, different seams —
#: which is what forces the grader to read attachment rather than similarity.
REPEATED = """The retrieval surface reads LIVE blocks only: members of some
document's current version. Superseded content is reachable by explicit address,
when a caller deliberately asks for history."""

CLEAN_BODY = """# Retrieval standing

## 1. What a default surface reads

The retrieval surface reads LIVE blocks only: members of some document's current
version. Superseded content is reachable by explicit address, when a caller
deliberately asks for history.

## 2. Why the join is an EXISTS

A default-discovery surface that returned every historical block would answer a
question nobody asked, at a cost that grows with the archive rather than with
the corpus. The EXISTS join bounds the read to current membership.

## 3. Operator note

Callers that genuinely want history pass a hash. That path stays open and is
audited like any other read.
"""


def superfluous_log() -> tuple[str, list[dict]]:
    """A span pasted where both seams break."""
    body = """# Ingest run log — 2026-07-18

Started the ingest at 09:14. The queue held 220 records and the worker claimed
them in one batch, which is the shape the drill expects.

At 09:31 the Merkle diff reported 23 added and 23 orphaned. That ratio matches
the mutation manifest, so the invalidation sweep was scoped correctly and the
run continued without intervention.

""" + REPEATED + """

By 09:52 the sweep had retired every orphan and the cache audit came back clean.
Total spend for the run was $0.7263, against a rebuild baseline of $0.8002.

The operator signed off at 10:05.
"""
    plants = [{
        "kind": "superfluous",
        "anchor": None,
        "why": "A standing fact about retrieval, dropped into a timestamped run "
               "log. The paragraph before it closes on the sweep and the one "
               "after opens on the sweep completing — the seams already met.",
    }]
    return body, plants


def ceremonious_manual() -> tuple[str, list[dict]]:
    """The same span, repeated with anchors and live seams."""
    body = """# Operator manual — retrieval

## 1. The rule you are working under

""" + REPEATED + """

Everything below assumes that rule, and the two procedures in §3 differ only in
how they address history.

## 2. Reading current state

Call the default surface. It resolves current membership and returns nothing
that a later version has replaced.

## 3. Reading history

**Restating the rule, because this is the procedure that depends on it:** the
retrieval surface reads LIVE blocks only, and superseded content is reachable by
explicit address. So pass the hash you want. A caller that omits it gets current
state, which is the behavior §2 describes and the reason these two procedures
stay separate.

## 4. Before you page an operator

Check §1. Most reports of "missing" content are a caller reading current state
and expecting history, which §3 resolves.
"""
    plants = [{
        "kind": "ceremonious",
        "anchor": "Labeled 'Restating the rule, because this is the procedure "
                  "that depends on it', with §1 leading in, §3 referring back, "
                  "and §4 routing readers to §1.",
        "why": "Both seams carry and the restatement is declared. Removing it "
               "breaks §3's dependency and §4's routing.",
    }]
    return body, plants


def mixed_source() -> tuple[str, list[dict]]:
    """Three copies of one docstring; exactly one is anchored."""
    body = '''"""Byte-ledger helpers for the metered materialisation path."""


def charge_outbound(cid: int, size: int) -> None:
    """Charge the outbound ledger.

    Bounds the rate of the residual the data-flow boundary leaves. This is
    defense-in-depth and is never the boundary itself.
    """
    _ledger(cid).outbound += size


def charge_inbound(cid: int, size: int) -> None:
    """Charge the inbound ledger.

    Bounds the rate of the residual the data-flow boundary leaves. This is
    defense-in-depth and is never the boundary itself.
    """
    _ledger(cid).inbound += size


def reset(cid: int) -> None:
    """Clear both ledgers for a closed session.

    Bounds the rate of the residual the data-flow boundary leaves. This is
    defense-in-depth and is never the boundary itself.
    """
    _LEDGERS.pop(cid, None)


class ByteLedger:
    """The two cumulative-byte ledgers.

    **Standing note, repeated at each charge site on purpose:** these bound the
    rate of the residual the data-flow boundary leaves, and are never the
    boundary itself. A reader who arrives at one charge function without the
    class docstring still needs it, which is why it appears there too.
    """
'''
    plants = [
        {"kind": "superfluous", "anchor": None,
         "why": "`reset` clears state and charges nothing, so the sentence "
                "about bounding a charge rate attaches to neither seam."},
        {"kind": "ceremonious", "anchor": "The class docstring declares the "
                                          "repetition and states its reason.",
         "why": "Two charge functions carry it because a reader arriving at "
                "either one needs it; the class docstring names that intent."},
    ]
    return body, plants


def clean_record() -> tuple[str, list[dict]]:
    return CLEAN_BODY, []


FIXTURES = {
    "superfluous_log.md": superfluous_log,
    "ceremonious_manual.md": ceremonious_manual,
    "mixed_source.py": mixed_source,
    "clean_record.md": clean_record,
}


def main() -> None:
    key: dict[str, object] = {
        "generated_by": "fixtures/dedupe_ceremony/build.py",
        "grading": ["found", "missed", "invented", "held"],
        "note": "An invented finding costs more than a miss: a missed dupe "
                "survives to the next firing, an invented one deletes text a "
                "human put there on purpose.",
        "fixtures": {},
    }
    for name, builder in FIXTURES.items():
        body, plants = builder()
        (HERE / name).write_text(body, encoding="utf-8", newline="\n")
        key["fixtures"][name] = {  # type: ignore[index]
            "expected_outcome": "No edits" if not any(
                p["kind"] == "superfluous" for p in plants
            ) else "edits",
            "plants": plants,
        }
        kinds = ", ".join(p["kind"] for p in plants) or "none"
        print(f"{name:<24} {len(body):>5} bytes   plants: {kinds}")
    (HERE / "key.json").write_text(
        json.dumps(key, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    print("\nkey.json written from the same plant operations that built the files")


if __name__ == "__main__":
    main()
