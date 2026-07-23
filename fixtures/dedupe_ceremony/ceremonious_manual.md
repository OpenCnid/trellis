# Operator manual — retrieval

## 1. The rule you are working under

The retrieval surface reads LIVE blocks only: members of some
document's current version. Superseded content is reachable by explicit address,
when a caller deliberately asks for history.

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
