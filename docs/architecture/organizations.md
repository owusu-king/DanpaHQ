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

An approved individual provider may create a first Property without a separate
Portfolio setup screen. The same transaction creates or reuses a personal
Portfolio, grants the creator `OWNER`, records the activity, and relates the new
Property to it. Full setup remains for companies, hostel operators, professional
managers and people deliberately starting with collaboration. The full
Organization creation endpoint requires the same approved-provider creation
capability; it is not a tenant-side shortcut into provider setup.

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

Existing Rooomly users receive an in-app invitation. An unregistered phone
receives a deduplicated SMS handoff through the configured provider. Acceptance
still requires signing in or registering with that same verified phone and a
valid secure invitation token.

Only owners and administrators manage the Portfolio. Only an owner may grant or
alter another owner role, and a Portfolio cannot lose its last owner. Owners and
administrators have Portfolio-wide Property access. `PROPERTY_MANAGER` and
`STAFF` can manage only assigned Properties. `ACCOUNTANT` can read assigned
financial scope but is excluded from general Property management and high-trust
Property actions.

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
transactional outbox. Accepted memberships appear in `/me/.contexts`; web and
mobile show the current Portfolio and let a provider switch among active ones.
