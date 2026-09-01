# ADR 0003 — PostgreSQL choices: UUIDv7 keys, no PostGIS yet, enums as varchar

**Status:** accepted · 2026-08 · Phase 0

## UUIDv7 primary keys
Sequential integers leak volume and enumerate; UUIDv4 scatters index writes.
UUIDv7 embeds a millisecond timestamp, so inserts stay near the right edge of the
B-tree like a sequence while remaining opaque and safe to mint on a worker or a
client. Cost: 16 bytes instead of 8, and ids that are ordered but not dense.
Accepted.

## No PostGIS in Phase 0
Discovery needs "listings in this locality" and "listings near this point".
The first is a foreign key. The second is a bounding box plus a distance filter,
which a plain `(latitude, longitude)` index serves adequately at launch volumes.
PostGIS adds an extension to provision, back up and upgrade, and a query surface
the team must learn. It goes in when property search demonstrates it needs radius
or polygon queries — a Phase 2 decision, with its own ADR and a measured reason.

## Enums as varchar with application-level choices
PostgreSQL native enums require `ALTER TYPE ... ADD VALUE`, which takes a lock
and historically could not run inside a transaction alongside other DDL. Status
vocabularies in a young product change often. `varchar` plus Django `TextChoices`
gives the same validation at the edge with none of the migration pain, and a
`CHECK` constraint can be added later where a value set has stabilised.

## Transactions are explicit, not per-request
`ATOMIC_REQUESTS = False`. Wrapping every request in a transaction holds
connections open across slow external calls and hides where consistency is
actually required. Handlers open `transaction.atomic()` around the work that
needs it.
