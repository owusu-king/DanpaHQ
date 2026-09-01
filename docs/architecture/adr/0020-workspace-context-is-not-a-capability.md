# ADR 0020: Workspace context is not a capability

**Status:** accepted, 17 August 2026. Completes
[ADR 0019](0019-password-authentication-and-provider-standing.md).

## Context

ADR 0019 made provider access follow an approved verification and nothing else.
It left one thing unfixed, and it was the thing users would actually hit.

Entry routing had no idea which journey someone had chosen. It ran down a list
of role names and intents and picked a destination. So a person with
`tenant = ACTIVE, provider = NONE` who tapped **I own or manage property** fell
through every branch and landed in `/rentals` — sent to tenant space, which is
the one place they had just said they did not want to be. There was no way to
express "I am a tenant and I would like to look at becoming a provider", and no
way back either: no notion of a current experience, so nothing to switch.

Underneath was a missing state. The only route to `provider.exists` was
submitting identity documents, so "has entered the provider journey, hasn't
submitted anything yet" could not be represented — and that is exactly the state
an existing tenant needs to be put into.

## Decision

Three ideas that had been collapsed into "roles" are separated:

* **Which experience someone is in** — `active_workspace`, one of `discovery`,
  `tenant`, `provider`. A navigation fact. Changed by asking. Grants nothing.
* **Which experiences they may enter** — `available_workspaces`, derived from
  the capabilities below.
* **What they may do there** — the per-side capability blocks, decided by
  verification as before.

`POST /me/workspace/` moves between experiences. It is the whole of what the
welcome screen's choice does after sign-in, and it is defined by what it does
not do: it never touches provider verification, in progress or decided; never
revokes a capability; never ends the session; never creates a second account.
Tests assert each of those, including that a switch to the tenant side leaves a
pending provider review sitting at `pending`.

Entering the provider journey — by registering as one, by choosing that
workspace, or by having any verification on file — sets `provider.exists`. With
no verification submitted that reads `not_started`, which is the onboarding
stage: enough to route someone to the verification screen, not remotely enough
to let them operate. An existing tenant who chooses the provider journey lands
there, with their tenant capability untouched and still available to switch back
to.

### The asymmetry between the two capabilities

Choosing the **tenant** workspace grants tenant capability outright. Applying for
a place and asking to view one also establish it, at the moment of the action.
This is deliberate: the product's main road is an anonymous browser who signs in
precisely when they want to apply, and stopping them there for want of a
capability they are in the act of acquiring would be a wall across it. Nothing
behind tenant capability can happen without the other party agreeing, so
granting it on demand costs nobody anything — what matters is that it is a
recorded, backend-owned grant rather than an assumption.

Choosing the **provider** workspace grants nothing at any price. It puts a
person in front of the verification, not past it. The two sides are treated
differently because the risks are different, and pretending they are symmetric
is what produced the original hole.

## Consequences

The welcome screen becomes what it should always have been: a context choice
that the backend honours, carrying no authorization weight. Clients render from
`active_workspace` and `available_workspaces` and offer "switch to tenant
experience" only when the switch is real.

`account_type` recedes further into being a registration record. It seeds the
initial workspace and is otherwise inert; a person who registered as a tenant
and later runs a portfolio needs no new account and no conversion, and one who
registered as a provider can rent a flat without one either.

The cost is a second source for "where does this person go", since intent rows
now drive routing. That is contained: `active_workspace` is computed in one
function, routing reads only that and the capability blocks, and there is no
longer any role-name branch anywhere in the path.
