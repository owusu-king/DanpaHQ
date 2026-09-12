# Authorization

Every protected action is decided on the backend using:

```text
live session + account state + capability
+ organization membership + property assignment/occupancy
+ resource state + current verification
```

Authentication answers who the person is. Intent records what they currently
want to do. Organization membership, assignment and occupancy determine the
resources they may use. Intent and client navigation never grant object access.

Authentication is a phone number and a password (ADR 0019). The number is the
identifier; the password is the credential. An OTP proves a number during
registration and authorises a password reset — it does not open a session on a
finished account, because controlling a SIM is not the same as owning the
account it reaches.

An account is usable only once `registration_state` is `complete` — phone
proved, account type chosen, name given, password set. Before then the row
exists so registration has somewhere to write, and the authentication layer
refuses it everywhere except reading its own state, finishing itself, refreshing
and signing out.

| Resource | Backend rule |
|---|---|
| public listing | readable only when explicitly public and `ACTIVE` |
| private property/building/unit/bed/draft listing | active private workspace claim/membership and assignment; verification is not required |
| Portfolio (backend organization) | accepted active membership; pending/declined/revoked/expired invitations grant nothing; Team administration requires owner/admin |
| Portfolio Property assignment | owner/admin see all; manager/staff manage assigned Properties; accountant receives assigned financial access but no general Property management |
| listing draft | current property-management authority |
| listing publish | management authority + current phone/identity/provider standing/property authority + staff-approved listing |
| private Unit access / tenancy-request approval | current phone, identity, provider standing and Property authority; direct invitations are retired |
| lease creation/activation | private access + current phone, identity and provider standing, rechecked at activation |
| provider workspace | an approved account-level provider verification, or an active membership of somebody's Portfolio; read live, never a role name |
| provider-side payment record/confirmation | lease access + current identity/authority + verified receiving account |
| internal expense record | scoped private property access; records a cost but never transfers money |
| occupancy | occupant or authorized property actor |
| application/viewing/lease/rent | recorded party or authorized property actor |
| verification evidence | subject and authorized reviewer; file permissions still apply |

The global tenant, landlord and agent grants are coarse navigation hints only.
They are not sufficient property authorization, and since ADR 0019 they are not
self-grantable either: `tenant` may be added directly because everything behind
it needs the other party's agreement, while the provider roles are granted by
the backend when provider verification is approved and revoked when it ends.
Management Portal permissions and Django Super Admin remain separate
authentication/authorization systems.

## Account capabilities

`GET /me/` returns a `capabilities` object, and clients render from it rather
than deriving access from `account_type` or a role name:

| Key | Meaning |
| --- | --- |
| `account_type` | what the person chose at registration; seeds the initial workspace, never a grant |
| `registration_state` | how far through account creation they are |
| `active_workspace` | which experience they are currently in: `discovery`, `tenant` or `provider` |
| `available_workspaces` | which experiences they may enter, derived from the capabilities below |
| `provider.exists` | they have declared as a provider or started a provider verification. A Team member has not, and never needs to |
| `provider.verification_status` | `not_started`, `pending`, `needs_more_info`, `approved`, `rejected`, `revoked`, `expired`; `null` for somebody who only belongs to a Portfolio |
| `provider.workspace_access` | an approved provider verification is current, **or** an active Portfolio membership exists. This — not `exists` — is what decides whether the provider experience opens |
| `provider.private_inventory_access` | may build private buildings and units while a review is outstanding |
| `tenant.workspace_access` | holds the tenant capability |

Provider standing and property authority are independent, so one account can
legitimately read: provider approved, property A approved, property B pending,
property C rejected.

## Workspace context

`active_workspace` is where someone is; the capability blocks are what they may
do there. `POST /me/workspace/` moves between them and is defined by what it
does not do — it never touches verification, never revokes a capability, never
ends the session, never creates a second account (ADR 0020). Entry routing reads
the chosen workspace first, so a tenant who asks for the provider journey lands
on provider verification rather than being returned to tenant space.

### Client surfaces

Both clients render from `capabilities` and route from `entry_routes`. Neither
recomputes access; the only thing a client decides for itself is which
organization or tenancy to view *within* an experience the backend has allowed.

| State | Web | Mobile |
| --- | --- | --- |
| anonymous browsing | `/rentals` | `(app)/(tabs)`, `(app)/listing` |
| sign in | `/sign-in?workspace=…` | `(auth)/sign-in` |
| register | `/register` | `(auth)/phone` → `(auth)/code` → `(auth)/register` |
| forgot password | `/forgot-password` | `(auth)/forgot-password` |
| provider standing | `/provider` | `(app)/provider` |
| provider workspace | `/properties` | `(app)/(provider-tabs)` |

The welcome screen's tenant and provider choices carry a `workspace` parameter
into sign-in, which is posted to `/me/workspace/` immediately after
authentication and before the entry route is read. That ordering is what makes
rule 10 work: an existing tenant who asked for the provider journey is in the
provider workspace by the time anyone asks where to send them.

The two sides acquire differently, on purpose:

- **tenant** capability is granted on request, and by the acts that constitute
  being a tenant — applying for a place, asking to view one. Everything behind
  it needs the other party's agreement, so on-demand acquisition costs nobody
  anything; what matters is that it is a recorded grant and not an assumption.
- **provider** capability is granted by an approved verification and by nothing
  else. Choosing the provider workspace puts a person in front of that review,
  never past it.

`/me/.permissions` and `/me/.contexts` are presentation hints. A forged client
context, hidden button or direct API request cannot bypass service-level checks.
Sensitive membership, authority, moderation and occupancy decisions are written
to the audit/outbox boundary.

Team membership is additive to, never a substitute for, the trust gates below.
An assigned manager still needs their own current phone and identity, plus the
Property's current authority, before tenant access, lease, publication or
payment-sensitive actions can proceed. What they do *not* need is a provider
verification of their own: standing is the Portfolio's, held by an active owner
whose provider verification is current, and a member operates on it. That is the
whole of what being invited into a Portfolio means, and the reason the missing
requirement is named `portfolio_standing` for a member and `provider_standing`
for somebody whose own review is the thing to finish. Selecting a Portfolio
context changes navigation and query scope only.

Portfolio-wide authority is stricter than an assigned role, and it is checked
live rather than at the door: Team administration and creating Properties for the
business require a current identity verification, so a lapsed check suspends them
(`pending_verification`) without disturbing the member's scope. Ending somebody's
access is deliberately exempt — stopping a person must never wait on paperwork.
Ownership is not a role the Team grants at all; it transfers through its own
workflow. See [organizations](organizations.md) for the states and abilities each
membership carries.

> Not yet closed: billing administration and payout-destination changes read
> `role in {owner, admin}` inside `apps.billing` and `apps.payments`, so a role
> whose identity verification has *lapsed* still passes them. Nobody can obtain
> the role unverified — acceptance and promotion both refuse — and those modules
> should adopt `organization.services.elevated_authority_missing` when they are
> next open for change.

## Progressive property capabilities

Every property response includes actor-specific capability states rather than a
global `property.verified` boolean:

- `private_inventory`
- `tenant_access`
- `leases`
- `payment_collection`
- `publication`

Each state is `enabled`, `verification_required` or `not_authorized`, with the
missing checks named. `created_by`, a legacy owner column, or an unreviewed
organization/property claim can enable only private inventory. High-trust
services recompute their capability from current verification records at the
moment of action.

Two independent verification bases feed those states, and neither substitutes
for the other (ADR 0018):

| Capability | Requires |
| --- | --- |
| `private_inventory` | property access only |
| `tenant_access` | account verification — current phone + identity |
| `leases` | account verification |
| `publication` | account verification + this property's authority |
| `payment_collection` | the above + a current receiving account |

Account verification answers who the actor is and is earned once for all their
properties. Property authority answers whether they control one specific
address, and is what anything public or financial waits for. So private
management opens as soon as we know who someone is, while advertising and rent
collection wait for the property's own reviewed evidence.

Approving a property's authority grants only the option to advertise. Nothing
becomes public until someone publishes a listing for one of its units and
listing moderation approves it.
