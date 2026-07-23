# Dedupe-ceremony fixtures

Test data for the self-play run that grades `.claude/ceremonies/dedupe.md`
against the ceremonious-versus-superfluous rule.

Each fixture is a document with repetition planted at known locations. The
answer key lives in `key.json` and stays out of the player's context: a blind
agent runs the ceremony against the document alone, and a scorer compares what
it reported to the key.

## What each fixture tests

| Fixture | Plants | Correct outcome |
|---|---|---|
| `superfluous_log.md` | A block pasted mid-document with both seams broken | Find it, rehome or drop it |
| `ceremonious_manual.md` | Repetition carrying labels, transitions, and live seams | **No edits** |
| `mixed_source.py` | A docstring pasted into three functions; one occurrence anchored by its own contract line | Find two, keep one |
| `clean_record.md` | Nothing planted | **No edits** |

`ceremonious_manual.md` and `clean_record.md` are the positive controls, and
they are the ones that matter. A ceremony that always finds work manufactures
it, so a run that returns edits against either of those has told you its
findings elsewhere carry no information.

## Grading

A run scores on four counts, and the middle two are the ones that discriminate:

1. **Found** — planted superfluous spans it located.
2. **Missed** — planted superfluous spans it walked past.
3. **Invented** — spans it flagged that the key marks ceremonious. *An invented
   finding costs more than a miss:* a missed dupe survives to the next firing,
   while an invented one deletes text a human put there on purpose.
4. **Held** — ceremonious spans it left whole and said so.

Report all four. A ceremony with zero misses and three inventions is worse than
one with three misses and zero inventions, and a single number hides that.

## Regenerating

    python fixtures/dedupe_ceremony/build.py

The generator plants from real repository prose so the fixtures read like the
documents the ceremony actually meets. It writes both the fixtures and the key,
so the key never drifts from what was planted.
