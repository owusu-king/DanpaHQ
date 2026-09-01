# Bounded contexts

Contexts, their ownership and the phase that builds them. A context owns its
tables; nothing else writes to them.

| Context | Owns | Talks to others by | Phase |
|---|---|---|---|
| **Identity** | users, roles, sessions, devices | `user.registered.v1`, `user.role_granted.v1` | 0–1 |
| **Trust** | verifications, evidence, reviewer decisions | `verification.decided.v1` | 1 |
| **Property** | properties, units, ownership claims | `property.published.v1` | 2 |
| **Listing** | listings, media, pricing, availability | `listing.published.v1`, `listing.withdrawn.v1` | 2 |
| **Search** | read models and indexes over listings | consumes listing events | 2 |
| **Rental** | viewing requests, applications | `application.submitted.v1` | 3 |
| **Lease** | leases, parties, terms, rent schedule | `lease.signed.v1`, `rent.due.v1` | 3 |
| **Operations** | maintenance, inspections, tickets | `maintenance.raised.v1` | 4 |
| **Reputation** | reviews, ratings, disputes | `dispute.opened.v1` | 4 |
| **Payments** | payment intents, provider events | `payment.settled.v1` | 5 |
| **Wallet** | accounts, ledger entries, balances | `ledger.posted.v1` | 6 |
| **Digital services** | airtime, data, utilities, TV | `service.purchased.v1` | 7 |
| **Financial services** | credit profiles, financing, insurance | — | 8 |
| **Intelligence** | recommendations, fraud signals, pricing | consumes everything, owns nothing | 9 |
| **Notifications** | delivery across SMS, push, in-app | consumes events | 1+ |
| **Audit** | the record of who did what | consumes everything | 0 |

## Rules

- A context reads another's data through a service function or a published
  event, never by importing its models.
- An event name is a contract: `context.thing_happened.vN`. Adding a field is a
  minor change; removing or repurposing one needs a new version, published
  alongside the old until consumers move.
- Read models may duplicate data across contexts. Search holding a copy of a
  listing's rent is correct; Search writing to `listing` is not.
- **Intelligence owns no source data.** Every model it builds is derived and
  reproducible from events, so a bad model is rolled back rather than migrated.
