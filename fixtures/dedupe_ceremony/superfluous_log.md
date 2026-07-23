# Ingest run log — 2026-07-18

Started the ingest at 09:14. The queue held 220 records and the worker claimed
them in one batch, which is the shape the drill expects.

At 09:31 the Merkle diff reported 23 added and 23 orphaned. That ratio matches
the mutation manifest, so the invalidation sweep was scoped correctly and the
run continued without intervention.

The retrieval surface reads LIVE blocks only: members of some
document's current version. Superseded content is reachable by explicit address,
when a caller deliberately asks for history.

By 09:52 the sweep had retired every orphan and the cache audit came back clean.
Total spend for the run was $0.7263, against a rebuild baseline of $0.8002.

The operator signed off at 10:05.
