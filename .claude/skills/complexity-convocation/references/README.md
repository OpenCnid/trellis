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
| `FOUR_JUDGE_BASIC_MODEL.md` | `docs/product/epistemic-support/FOUR_JUDGE_BASIC_MODEL.md` | 9,467 | `986bd635870533ef6c62c4fb48f0d53bf5f0bd26e236dd7f40c7add226b7b8b8` |
| `FOUR_JUDGE_DESIGN.md` | `docs/product/epistemic-support/FOUR_JUDGE_DESIGN.md` | 20,170 | `c944586e345668cc93a75faa431a0632e23484b5a705fa5991dd693fbb344fa0` |
| `JUDGE_COMPOSITION_CEREMONY.md` | `docs/product/epistemic-support/JUDGE_COMPOSITION_CEREMONY.md` | 14,828 | `f5a54786d014222992687ab6b51f983e37af4226afdf7c26501ee04d3037e3c1` |
| `JUDGE_COMPOSITION_GAME.md` | `docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md` | 29,004 | `0e3ef78b8ffd9f0c62b022b7a9db10515873e18550d02cc412971587dfe34574` |
| `JUDGE_CONTRACT_TEMPLATE.md` | `docs/product/epistemic-support/JUDGE_CONTRACT_TEMPLATE.md` | 14,667 | `e15bf7a30db8d88e7b377da3f1e8e49e396af6f126156128c6feb5b6c65fa020` |
| `JUDGE_INTAKE_DESIGN.md` | `docs/product/epistemic-support/JUDGE_INTAKE_DESIGN.md` | 24,436 | `b6fd8adbcdcac56d4d2d57f063011f26cd85b5f2ef7242bb7ed5a1f946622a46` |
| `RECONCILIATION.md` | `docs/product/epistemic-support/RECONCILIATION.md` | 46,647 | `a88c9539e88033825a2f65b70a4634c4cf0dd1d4c2e4966fc9021234f298e14d` |
| `STANDING_MODEL.md` | `docs/product/epistemic-support/STANDING_MODEL.md` | 8,825 | `484fc3c860e834a8afaed6dff6741c585ec3464c7466b09ad3d8421932904cfd` |

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
