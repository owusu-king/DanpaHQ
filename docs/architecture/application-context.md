# Application context

`/me/.contexts` is the canonical list of detailed workspaces available to the
authenticated account:

- `discovery`
- `occupancy:<occupancy-id>`
- `organization:<organization-id>`

Each context includes an id, kind, label and context-specific metadata. The
backend also returns `default_context_id`. Clients store a selected context
locally, validate it against the current response on every restore, and fall
back to the backend default when it is stale.

Changing context changes navigation, labels and task emphasis. It does not
change the session or grant access. Organization and occupancy contexts are
derived from current database relationships and disappear when those
relationships end.

`available_contexts` and `default_context` continue to expose legacy coarse
role strings for older clients during migration. New code must use `contexts`
and `default_context_id`.

Canonical entry routing prefers an incomplete setup requested by the user's
intent, then an active occupancy or organization context, and finally public
discovery. Mobile and web may retain different valid active contexts for the
same account.
