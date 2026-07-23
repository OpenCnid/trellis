# Retrieval standing

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
