# Reference material

The records this skill cites, mirrored **byte-for-byte** from the Trellis
repository so the skill travels intact: lift this skill's directory out of the
repo and every document it cites comes with it.

## How to read these

Pull the cited section; leave the rest on disk. Several of these run past 40 KB,
and loading one whole spends the context the skill exists to spend well.

```
Grep "{Section_Number_Or_Exact_Heading}" references/{Mirrored_File} -A 40
```

The skill body names the section it wants at each step. That name is the read
instruction — follow it to the section, not to the file.

## These are mirrors, not the record

The canonical copy is the source path in the table below. On any divergence
**the record wins and the mirror is replaced from source**. A mirror is never
edited in place, and never cited as authority against the record it came from.

Nothing is appended inside the mirrored files. Byte-identity to the source is
what makes a mirror checkable, and a provenance header written into the file
would be the first thing to destroy it — so provenance lives here instead.

No sync check is installed. These are portability snapshots taken at one commit;
the hashes below are what a reader verifies a mirror against, with or without
the Trellis repository present.

## Provenance

Mirrored from the Trellis repository at commit `65fdb1f`, dated 2026-07-25.

| File | Canonical source | Bytes | SHA-256 |
|---|---|---|---|
| `DOUBTS_WORKSPACE.md` | `docs/architecture/DOUBTS_WORKSPACE.md` | 37,859 | `aec7483652bc6f369f003674c8f3491df5136fd38e0dd98605531397c2663bda` |
| `HARNESS_SELF_MODEL.md` | `docs/architecture/HARNESS_SELF_MODEL.md` | 29,930 | `07519aee20d56519127dd57fbdb4ca272254e59eb60985518bdee3012c5b1be7` |
| `RECONCILIATION.md` | `docs/product/epistemic-support/RECONCILIATION.md` | 46,647 | `a88c9539e88033825a2f65b70a4634c4cf0dd1d4c2e4966fc9021234f298e14d` |
| `STANDING_MODEL.md` | `docs/product/epistemic-support/STANDING_MODEL.md` | 8,825 | `484fc3c860e834a8afaed6dff6741c585ec3464c7466b09ad3d8421932904cfd` |
| `TEST_TIME_TRAINING.md` | `docs/architecture/TEST_TIME_TRAINING.md` | 64,208 | `9fd170da66d4d5f57213057ab9bf12a9131346283dd5a304ee79049cb42d5302` |

Verify a mirror against a checked-out Trellis repository by hashing both working
files, so both get that checkout's line-ending treatment and a content match
hashes equal on any platform:

```
sha256sum references/{Mirrored_File} {Trellis_Repo_Path}/{Canonical_Source_Path}
```

The column above records the mirrored bytes as committed, which carry CRLF. A
checkout that normalizes line endings hashes differently without any content
having changed — so compare mirror against source, and read the column as the
snapshot's own fingerprint rather than as a cross-platform constant.
