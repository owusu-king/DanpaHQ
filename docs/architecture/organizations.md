# Organizations and property authority

Organizations remain the backend business and delegation boundary for property operations.
They do not replace a person's account and they do not grant platform-wide
roles.

Provider-facing clients call this a **Portfolio** for individual/professional
ownership and a **property business** where company or hostel language fits.
“Organization” is an implementation term, not a setup step every provider must
understand.

```text
User -> OrganizationMembership -> Organization
                                  -> OrganizationPropertyRelationship -> Property
OrganizationMembership -> PropertyAssignment -> Property
OrganizationInvitation -> acceptance -> OrganizationMembership
```

An organization may be an individual owner, property company, property
management company or hostel operator. Residential, commercial and hostel
activities are independent, so one Portfolio may perform several. Clients use
the activities to prioritize the relevant Property categories; they are not an
authorization grant or a category allow-list. `GET /property-types/` remains the
canonical list of categories a provider may choose. Creating a valid Property
also adds that activity to the Portfolio when it was not already recorded, so
activities describe the work the Portfolio actually contains.

## One Portfolio per provider, provisioned by Danpa HQ

**Every provider owns exactly one Danpa HQ Portfolio, and Danpa HQ makes it.**
Nobody creates a Portfolio — not a provider, not a tenant, not a client with a
crafted request. Belonging to more than one Portfolio is normal and stays
normal: every Portfolio beyond your own arrived as somebody's invitation.

```text
provider access APPROVED
  -> organization.services.provision_provider_portfolio(user=…)
     -> exactly one owned Portfolio, with its owner membership and Free plan
```

Provisioning happens inside the reviewer's decision (`identity.services.apply_provider_decision`,
called by `trust.services.decide`), so a provider who is let into the workspace
finds it furnished. It is idempotent because approval is decided more than once
over an account's life — standing lapses and is reviewed again — and because it
is also the repair path for accounts approved before any of this existed: if a
Portfolio is already owned, that Portfolio is returned and nothing is written.
The account row is locked for the check, so two decisions arriving together
resolve to one Portfolio rather than racing to make two.

The name is a starting point, not a question anybody is asked:

| The account says | The Portfolio is called | and is typed |
| --- | --- | --- |
| a company (`LandlordProfile.is_company` with a name) | that company name | `property_company` |
| an agency (`AgentProfile.agency_name`) | that agency name | `property_manager` |
| neither | `{First name}'s Portfolio` | `individual_owner` |

The owner edits the name, the type and the activities afterwards in Portfolio
settings (`PATCH /organizations/:id/`, Team on both clients) — which is exactly
why nothing has to be asked up front. Renaming is an edit of the Portfolio they
have; it never makes another.

**One owned Portfolio is enforced in the service, not in the screen.**
`create_organization` refuses a second for an account that already owns one
(409, `portfolio_already_provisioned`) and there is no endpoint in front of it:
`/organizations/` is read-only. `ensure_personal_organization`, which the
Property flows call, now defers to the same provisioning — it used to look only
for an `individual_owner` Portfolio, so an owner whose Portfolio was a company
got a second, personal one the first time they added a Property of their own.

Accounts that already owned more than one Portfolio when this rule arrived keep
them: this change stops new ones being made and deletes nobody's records. That
is why the rule is a service guard rather than a database constraint.

An approved provider may still create their first Property without any setup
screen — the Property is filed into the Portfolio they already have, and its
category is recorded as one of that Portfolio's activities.

Membership roles are `OWNER`, `ADMIN`, `PROPERTY_MANAGER`, `ACCOUNTANT` and
`STAFF`. Memberships and assignments are time-bounded. Owners and
administrators can manage the organization; other members see only the
properties explicitly assigned to them. All authorization is rechecked on the
backend.

Membership is never created from an administrator entering a user id. An owner
or administrator creates an expiring invitation for a Ghanaian phone number and
role, optionally preselecting Properties for a scoped role. The signed-in account
for that exact normalized number accepts or declines using a signed invitation
token. Only acceptance creates the active membership and materializes its
Property assignments. Invitations are revocable and expire after seven days;
pending, declined, revoked and expired invitations grant nothing and never
appear as active contexts.

Existing Danpa HQ users receive an in-app invitation. An unregistered phone
receives a deduplicated SMS handoff through the configured provider. Acceptance
still requires signing in or registering with that same verified phone and a
valid secure invitation token.

Only owners and administrators manage the Portfolio. Owners and administrators
have Portfolio-wide Property access. `PROPERTY_MANAGER` and `STAFF` can manage
only assigned Properties. `ACCOUNTANT` can read assigned financial scope but is
excluded from general Property management and high-trust Property actions.

## Ownership does not travel through the Team

`OWNER` is not an invitable role and not a role the roster may grant. An owner
carries the Portfolio's standing to operate, its subscription and the account its
rent settles into, so ownership moves through its own deliberate transfer.
`INVITABLE_ROLES` is the allow-list, enforced in `create_invitation`, in
`change_membership_role`, and again at acceptance for any invitation written
before the rule existed. A Portfolio still cannot lose its last owner.

## Joining a Team is not becoming a provider

A person invited into a Portfolio uses their ordinary Danpa HQ account. They may
be a tenant elsewhere on the platform, and they are never asked to register a
second account or to open an independent provider verification of their own:

```text
Owner/Admin invites a phone number
  → the recipient signs in, or registers that number normally
  → accepting creates the OrganizationMembership and its Property assignments
  → the Portfolio appears in /me/.contexts and the provider workspace opens
  → role + assignments + verification decide what they can do inside it
```

The workspace opens because of the membership. `operates_through_membership`
answers "may this account enter the provider experience" for every role except
`OWNER`, whose own provider verification is the Portfolio's standing; `identity`
capabilities, entry routing and `choose_workspace` all read it. Acceptance is
idempotent: pressing accept twice returns the membership the first press created
rather than an error about a membership the person already holds.

**Portfolio standing** (`has_portfolio_standing`) is the Portfolio's own right to
operate: at least one active owner with a current `PROVIDER` verification. A
member's tenant-facing work rests on it, so nobody is asked to become the
business that hired them, and it closes for the whole Team when the Portfolio's
own standing lapses.

## What a membership reaches

`membership_access` is the single answer, returned on the roster, on the accepted
membership and on every Portfolio context in `/me/`. It carries a state, the
requirements behind it, the Property scope, and the abilities clients build
navigation from (`operate_properties`, `create_properties`, `view_finances`,
`view_billing`, `manage_team`).

| State | Meaning |
| --- | --- |
| `active` | the role is whole |
| `limited` | in, with named capabilities waiting — the ordinary first state of a new member |
| `pending_verification` | a Portfolio-wide role whose holder is not currently identified; scope stays, elevated acts wait |
| `revoked` | the membership has ended and reaches nothing |

Elevated authority — Team administration and creating Properties for the business
— requires a current identity verification (`elevated_authority_missing`), which
an approved provider verification already contains. Accepting an `ADMIN`
invitation is refused until the invitee has one, and promoting somebody to
`ADMIN` is refused until they do: no unidentified account ever holds
Portfolio-wide authority. Granting access (invite, role change, Property
assignment) waits on that check; *ending* access — revoking an invitation,
removing a member, unassigning a Property — deliberately does not, because
stopping somebody must never queue behind paperwork.

## One Portfolio at a time

Switching Portfolio changes the provider's operational context, so a Portfolio
view shows that Portfolio and nothing else. Properties from two Portfolios are
never merged into one list: a personal Portfolio's houses do not appear inside a
company's roster, and the reverse is not possible either.

`organization.services.properties_in_scope` is the single answer, and every
provider list that hangs off Properties asks it: the Properties themselves, the
agreements granted on their Units, the viewing requests against their listings,
and the tenancy requests to move into them.

| List | Scoped read |
| --- | --- |
| Properties | `GET /properties/?organization=<id>` |
| Properties (per Portfolio) | `GET /organizations/<id>/properties/` |
| Agreements | `GET /me/granted-leases/?organization=<id>` |
| Viewing requests | `GET /me/viewing-requests/?organization=<id>` |
| Tenancy requests | `GET /me/received-applications/?organization=<id>` plus that Portfolio's own `tenancy_requests` |

The scope is decided on the backend — membership is required (a non-member gets
the same 404 a stranger gets, and so does a malformed id), and a role without
Portfolio-wide access sees only what is assigned to it. Without the parameter
those endpoints stay the account-wide lists: everything the person can reach,
across every Portfolio they belong to. That is a fair answer to "what do I have"
and it is not a Portfolio view — rendering it as one is what mixed owned and
managed Properties together, and what let one Portfolio's agreements and
requests sit on screen while another Portfolio was selected.

Clients keep the Portfolio in one place, the session's active context, and send
it with the request rather than filtering what comes back. Switching it re-reads
the Properties list and its counts, and decides which Portfolio a new Property
is filed into. Owned-versus-managed authority stays on the Property as metadata;
it is never a reason to merge two Portfolios' Properties into one view.

The switch lists the Portfolios this account can work in — the one it owns and
any it was invited into — and is one icon in the workspace chrome. It offers no
way to create one, because there is none. On web it shares a single bordered
control with Updates — both are utilities of the workspace rather than
of the page — sitting after Search and before the edge of the header; on mobile
it is at the head of the provider tabs. It opens a popover on
web and a bottom sheet on mobile listing each Portfolio with its type and the
role held in it, marking the one being operated, with Portfolio settings and
creating a Portfolio kept below a line rather than in the list being scanned. A
search box appears only once there are seven Portfolios to read through. No page
carries a Portfolio selector of its own — two controls for one question disagree
the moment either is used — and the icon carries a small mark, never a count,
when there is more than one Portfolio to be in.

Nothing of the Portfolio being left stays on screen while the next one loads.
The web console remounts the workspace beneath the header, keyed by the active
context. A tab navigator cannot remount without discarding which tab somebody is
on, so the mobile provider screens blank their Portfolio-scoped state through
`useBlankOnPortfolioSwitch` and reload instead. Returning to a tab is not a
switch: that data is still about the Portfolio on screen, so it refreshes in
place.

## Reading an invitation link

`GET /portfolio-invitations/<id>/?token=…` resolves one invitation in whatever
state it is now: pending, accepted, declined, revoked or expired, with
`addressed_to_you` and any `requirements` for the reader. The signature is
checked without an age limit — the invitation's status is what decides its
outcome — and a bad signature is a 404, so the endpoint cannot be used to
discover that an invitation exists. A reader who is not the invitee sees the
Portfolio and the role with the number masked, and is handed no token.
`GET /me/portfolio-invitations/` lists what is waiting; `?include=history` adds
the recently answered ones, so "nothing is waiting" is never the only thing a
recipient can be told.

An organization-property relationship records whether the organization is the
owner, manager or listing agent. That relationship is separate from a property
assignment: the first describes the organization's authority, while the second
describes which team member may exercise it.

`Property.owner`, `Property.managed_by` and direct property relationships remain
as migration compatibility fields. Reads accept both paths and existing data is
backfilled into a personal organization. New product flows use organizations;
removing the compatibility fields requires a later audited migration.

Organization authority is not verification. Publishing still requires current
identity verification, verified authority for the specific property and listing
approval.

Invitation creation/response/revocation, membership activation/removal, role
changes and Property assignment/unassignment write the append-only audit log and
transactional outbox. Accepted memberships appear in `/me/.contexts`, which is
what the header switcher lists: each context carries the Portfolio's name, type
and the member's role.
