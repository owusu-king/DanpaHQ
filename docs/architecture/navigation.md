# Navigation and entry routing

The backend decides where a person lands and returns it in `/me/`'s
`entry_routes`. Clients render that answer; they do not re-derive it.

They used to. Routing read role names, which meant a role an account had granted
itself sent it to the provider console — and a stored `discovery` context could
override the backend's answer entirely, dropping providers into the tenant tabs.
Both are fixed by keying on the capability payload (ADR 0020).

## Where each state lands

| State | Mobile | Web |
|---|---|---|
| signed out, browsing | `(app)/(tabs)`, `(app)/listing` | `/rentals` |
| holding a registration ticket | `(auth)/register` | `/register` |
| account restricted | `(app)/restricted` | `/restricted` |
| tenant workspace | `(app)/(tabs)` | `/home` |
| provider, not approved | `(app)/provider` | `/provider` |
| provider, approved | `(app)/(provider-tabs)` | `/home` |

Web lands on `/home` for every open workspace. The portal's home is role-aware,
so the destination is the same question for both roles — what is going on, and
what should I do next — rather than a list of properties for one and the public
rentals page for the other. The route still comes from the backend.

## Workspace and context

`active_workspace` is which experience someone is in: `discovery`, `tenant` or
`provider`. `POST /me/workspace/` moves between them and is defined by what it
does not do — it touches no verification, revokes no capability, ends no
session, creates no second account.

A **context** (one organization, one tenancy) is a choice *within* an
experience. The client may refine the destination with one, but only when the
context belongs to the active workspace. Applying that unconditionally was the
provider-into-tenant-tabs bug: `contexts` always contains `discovery`, whose
route is the tenant shell, and the stored context id outlived the session.

## Client rule

Read `capabilities` and `entry_routes`. Never infer access from `account_type`,
a role name, or a route parameter. Hiding a tab is a courtesy; the backend
refuses the request regardless.

Tenant-facing surfaces never expose “Create workspace.” If a signed-in tenant
also has provider capability, “Switch to provider experience” calls
`POST /me/workspace/` and follows the returned provider entry route. An approved
individual provider then starts with **Add first Property**; that mutation
creates the personal Portfolio when needed. Explicit property-business setup is
kept under Team for companies, hostel operators, professional managers and
collaborative Portfolios.

## The web portal

Signed-in web users are inside an application shell, not the public site. One
`PortalShell` serves both roles; `capabilities` decides what is in the
navigation, never whether there is navigation. `src/lib/portalNav.ts` is the
whole model and is unit-tested, because a wrong answer there is wrong on every
screen.

| Section | Tenant | Provider |
|---|---|---|
| Home | `/home` | `/home` |
| Renting | `/rentals`, `/saved`, `/applications`, `/viewings` | — |
| Portfolio | — | `/properties`, `/units`, `/tenants`, `/leases`, `/payments` |
| Requests | — | `/applications`, `/viewings` |
| You | `/updates`, `/settings` | `/updates`, `/settings` |

`/tenants` owns the provider's private acquisition and active-tenancy workflow:
Unit access codes, access-code tenancy requests, lease preparation and the
active tenancy/rent portfolio. Property and Unit pages describe inventory and
link into that workflow instead of duplicating its controls.

`/units` finds any Unit in the Portfolio without knowing its Property first,
reading `GET /organizations/<id>/units/` — the collection read that made a
portfolio-wide screen possible, scoped to the member the same way the summary is.
Property → Units keeps managing one building's spaces; both open the same Unit.
Global Add Unit picks a Property and hands over to the existing creation flow,
which Property → Add Unit enters directly. Mobile reaches Units from More rather
than spending a sixth tab.

`/settings/team` owns members, invitations, roles and Property assignments within
the Portfolio you are in. There is no Portfolio page: it was built, moved into
Settings, then removed on user review. Switching Portfolio lives on Team and is
rendered only when the account belongs to more than one; an invitation waiting for
this account appears on Settings → Profile while it is pending, because an invitee
may not be a provider. Portfolio identity — name, kind, activities — has no UI;
`updateOrganization` remains on the API. Team reads as a roster; everything that changes one person's
access — role, Property scope, removal — lives behind opening that person, on
web in a dialog and on mobile at `team-member`. Listing members is owner/admin
only, so a scoped role is told why the roster is absent rather than shown an
empty one, and no surface may turn that refusal into a member count. `/portfolio-invitations` remains account-scoped so an
invitee can review and respond from a secure link before membership exists; it
is the deep-link target, and `/portfolio` surfaces the same pending invitations
in place.

Team is not in the rail: a provider changes it rarely, and primary navigation is
for what they open in the course of the work.

The account menu holds three things — Settings, the workspace crossing, Sign out
— and no destinations of its own. Operational pages follow the active
context rather than offering their own control, which is the competing-menus
problem the shell exists to avoid. A pending invitation is deliberately absent
from the switcher — nothing is switchable until membership exists.

The rail section holding the operational areas is titled with the active
Portfolio's name, falling back to "Portfolio", so "what am I managing" is
answered on every screen without opening a menu.

`/settings` owns the account product area: Profile, Security, Notifications and
Verification, plus Team and Archive for providers. The avatar menu is
its only web entry; on mobile both provider More and the tenant profile lead to
the same index rather than each listing part of it.

`/updates` is a log of what happened, not a second attention queue: Home derives
what is outstanding from live domain state, while a notification only knows
whether it has been read. Updates marks the ones that asked for a reply and
leaves the rest chronological. `notificationMeaning` decides both — shared
classification, per-platform destinations — and its mirror test checks every
target type the backend emits has somewhere to land on both clients.

`portalNav.ts` ships; `portalNav.compiled.mjs` is a hand-written mirror the
tests import. `portalNav.mirror.test.mjs` holds the two to the same declared
items and route prefixes — without it the pair drifted, and the navigation
suite spent a while proving things about a copy nobody shipped.

`/applications`, `/viewings` and `/leases` are one route each, read from the
side the account is on: a tenant sees what they sent, a provider what they
received. The two never overlap and the backend scopes each to the caller, so
the branch is presentation rather than permission.

`/rentals` and `/listings/*` belong to whichever chrome the visitor is already
in — public site for a stranger, Explore for a signed-in tenant — decided from
the session rather than the path. One listing implementation serves both, which
is why there is no "public mode" flag anywhere for the two to disagree about.

## Client surfaces

| State | Web | Mobile |
|---|---|---|
| sign in | `/sign-in?workspace=…` | `(auth)/sign-in` |
| register | `/register` | `(auth)/phone` → `code` → `register` |
| forgot password | `/forgot-password` | `(auth)/forgot-password` |
| provider standing | `/provider` | `(app)/provider` |
| account | `/settings` | `(app)/settings` |

The welcome screen's tenant and provider choices carry a `workspace` parameter
into sign-in, posted to `/me/workspace/` immediately after authentication and
**before** the entry route is read. That ordering is what puts someone in the
experience they asked for.
