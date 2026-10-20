import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const exists = (relative) => existsSync(resolve(root, relative));

// Comments explain; they must never be what satisfies an assertion.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("provider web exposes Portfolio Team, settings, invitations and assignments", () => {
  const settingsIndex = read("web/app/settings/layout.tsx");
  const team = read("web/app/settings/team/page.tsx");
  const invitations = read("web/app/portfolio-invitations/page.tsx");
  const profile = read("web/app/settings/page.tsx");

  // Team is a Settings panel, not a rail item: a provider decides who may
  // operate the business, they do not go there daily.
  assert.match(settingsIndex, /href="\/settings\/team"/);
  assert.match(team, /invitePortfolioMember/);
  assert.match(team, /changePortfolioMemberRole/);
  assert.match(team, /assignPortfolioProperty/);
  assert.match(team, /unassignPortfolioProperty/);
  assert.match(team, /removePortfolioMember/);
  assert.match(invitations, /respondToPortfolioInvitation/);

  // An invitee may not be a provider, so the way in cannot sit behind a
  // provider-only panel. It appears on Profile only while one is waiting.
  assert.match(profile, /listMyPortfolioInvitations/);
  assert.match(profile, /\/portfolio-invitations/);

  // Switching is the header's job, so the Team page no longer carries a select
  // above the roster somebody came there to read.
  assert.doesNotMatch(team, /setActiveContext/);
  assert.doesNotMatch(team, /<select/);
});

test("the Portfolio switcher is the header's navigation context", () => {
  const switcher = code(read("web/src/components/portal/PortfolioMenu.tsx"));
  const shell = code(read("web/src/components/portal/PortalShell.tsx"));
  const css = read("web/src/styles/portal.css");

  // Portfolio context comes first, then the actions, with a mark when there is
  // somewhere else to be — never a count, which would read as unread work.
  assert.match(shell, /<PortfolioMenu me=\{me\} context \/>[\s\S]*portal-header-actions/);
  assert.match(switcher, /portal-context-copy/);
  assert.match(switcher, /portal-header-dot/);
  assert.match(switcher, /title="Switch portfolio"/);

  // Name, what the Portfolio is, and the role held in it: the three things
  // somebody needs to pick the right one at a glance.
  assert.match(switcher, /portfolio-row-name/);
  assert.match(switcher, /portfolio-row-meta/);
  assert.match(switcher, /aria-checked=\{isCurrent\}/);
  // A search box for three Portfolios is furniture; it appears when a list is
  // long enough that reading it beats scanning it.
  assert.match(switcher, /portfolios\.length >= SEARCHABLE_FROM/);

  // Settling a Portfolio's affairs is not switching between them.
  assert.match(switcher, /portfolio-menu-foot/);
  assert.match(switcher, /Portfolio settings/);
  // And creating one is not an option anywhere: an account is provisioned its
  // one Portfolio, and the others on this list are somebody's invitation.
  assert.doesNotMatch(switcher, /Create Portfolio/);

  // Switching remounts the page, so the Portfolio just left cannot be on screen
  // while the next one loads.
  assert.match(shell, /key=\{activeContext \?\? "no-context"\}/);

  // One switcher, in the chrome. A page that keeps a Portfolio select of its
  // own is a second answer to "which Portfolio am I in", and the two disagree
  // the moment somebody uses either one.
  for (const page of ["web/app/settings/team/page.tsx", "web/app/tenants/page.tsx"]) {
    assert.doesNotMatch(
      code(read(page)),
      /setActiveContext/,
      `${page} still switches Portfolio from inside the page`,
    );
  }
  // Tenants follows the header rather than remembering a Portfolio of its own.
  assert.match(code(read("web/app/tenants/page.tsx")), /rows\.find\(\(row\) => row\.id === preferred\)\?\.id \?\? rows\[0\]\?\.id/);

  // Hover, press, focus and selected are all drawn, not left to the browser.
  for (const state of [":hover", ":active", ":focus-visible", '\\[data-active="true"\\]']) {
    assert.match(css, new RegExp(`\\.portfolio-row${state}`), `no ${state} state on a Portfolio row`);
  }
});

test("the provider header is context on the left, Enquiries and Updates on the right", () => {
  const shell = code(read("web/src/components/portal/PortalShell.tsx"));
  const switcher = code(read("web/src/components/portal/PortfolioMenu.tsx"));
  const icons = read("web/src/components/portal/icons.tsx");
  const css = read("web/src/styles/portal.css");

  assert.match(shell, /className=\{`portal-header\$\{isProviderSpace \? " is-provider" : ""\}`\}/);
  // Two zones. Enquiries comes before the bell; the
  // account stays at the foot of the rail rather than in the bar.
  assert.match(shell, /<div className="portal-header-actions">[\s\S]*portal-header-support[\s\S]*portal-header-updates/);
  assert.match(css, /\.portal-header \{[^}]*justify-content: space-between;/);
  assert.match(css, /\.portal-header-support \{[^}]*height: 2\.75rem;/);
  // There is no global search in the bar; each workspace searches its own list.
  assert.doesNotMatch(shell, /PortalSearch/);
  assert.doesNotMatch(css, /\.portal-search\b/);

  // Provider chrome does not repeat the page's heading; the title remains only
  // for the tenant shell, which has no Portfolio context.
  assert.match(shell, /isProviderSpace \? <PortfolioMenu[\s\S]*: \(\s*<span className="portal-header-title">/);

  // A stack of workspaces, not the building that already means Properties.
  assert.match(switcher, /<Icon name="portfolio" \/>/);
  assert.doesNotMatch(switcher, /<Icon name="properties"/);
  assert.match(icons, /portfolio: \(/);

  // The bell carries a mark, not a figure to do arithmetic on; the exact number
  // stays in the accessible name.
  assert.match(shell, /unread > 9 \? "9\+" : unread/);
  assert.match(shell, /\`Updates, \$\{unread\} unread\`/);
});

test("accepting an invitation takes the person into the Portfolio it granted", () => {
  const page = code(read("web/app/portfolio-invitations/page.tsx"));

  // The three moves that make a new membership usable, in the order that makes
  // them stick: be in the provider experience, re-read the account so the
  // Portfolio is a context at all, then select it. Selecting first did nothing
  // at all — the id did not yet exist — which is how somebody accepted an
  // invitation and stayed exactly where they were.
  assert.match(page, /await chooseWorkspace\("provider"\);\s*await refresh\(member\.context_id\);/);
  assert.match(page, /setJoined\(member\)/);
  // The confirmation names what was joined and opens it.
  assert.match(page, /Open \{member\.portfolio\.name\}/);
  assert.match(page, /scopeSentence/);
});

test("an invitation link says what it is, in every state it can be in", () => {
  const page = code(read("web/app/portfolio-invitations/page.tsx"));
  const api = code(read("web/src/lib/console.ts"));

  // A link outlives the pending state, so the page reads the invitation the
  // link names rather than hoping it is still in the waiting list.
  assert.match(api, /\/portfolio-invitations\/\$\{invitationId\}\/\?token=/);
  assert.match(page, /getPortfolioInvitation\(linkedId, linkedToken\)/);
  assert.match(page, /listMyPortfolioInvitations\(\{ history: true \}\)/);
  for (const ending of ["accepted", "declined", "revoked", "expired"]) {
    assert.ok(page.includes(`${ending}:`), `an invitation that is ${ending} has nothing to say`);
  }
  // Two things a list of pending invitations could never tell somebody.
  assert.match(page, /invitation\.addressed_to_you/);
  assert.match(page, /invitation\.requirements\[0\]/);
});

test("the Team roster never hands out ownership, and grants only once verified", () => {
  const team = code(read("web/app/settings/team/page.tsx"));

  assert.match(team, /const GRANTABLE_ROLES = ROLES\.filter\(\(\[value\]\) => value !== "owner"\)/);
  assert.match(team, /options=\{GRANTABLE_ROLES\}/);
  assert.doesNotMatch(team, /options=\{ROLES\}/);
  // Granting access waits on the backend's own answer about this person;
  // ending it deliberately does not.
  assert.match(team, /access \? access\.can\.manage_team : canManageTeam/);
  assert.match(team, /\{canGrant \? <Button onClick=\{\(\) => setInviting\(true\)\}/);
  assert.match(team, /Remove from this Portfolio/);
});

test("the Provider Properties page is one Portfolio at a time", () => {
  const page = code(read("web/app/properties/page.tsx"));
  const api = code(read("web/src/lib/console.ts"));
  const view = read("backend/apps/property/views.py");

  // The Portfolio travels in the request and the backend decides the scope from
  // the membership behind it. A filter applied after the fact would still have
  // asked for everything, and everything is what mixed a personal Portfolio's
  // houses into a company's roster.
  assert.match(api, /query\.set\("organization", scope\.organization\)/);
  assert.match(view, /properties_in_scope\(/);
  assert.match(page, /listProperties\(\{ organization: scope\.id \}\)/);
  assert.doesNotMatch(page, /listProperties\(\)/);

  // The scope is the shared session context, so switching Portfolio anywhere
  // switches this page too…
  assert.match(page, /const preferred = activeContext\?\.startsWith\("organization:"\)/);
  assert.match(page, /\}, \[preferred\]\);/);
  // …and the Portfolio being left takes its Properties off the screen with it.
  assert.match(page, /setProperties\(null\);/);

  // Adding a Property files it into the Portfolio being operated. Defaulting to
  // whichever Portfolio came back first is the same mixing, one step later:
  // the house lands in a roster its provider was not looking at.
  const form = code(read("web/src/components/property/PropertyWizard.tsx"));
  assert.match(form, /rows\.find\(\(row\) => row\.id === preferred\)\?\.id \|\| rows\[0\]\?\.id/);
  assert.match(form, /\}, \[activeContext\]\);/);
});

test("every provider list is about the Portfolio on screen", () => {
  const services = read("backend/apps/organization/services.py");
  const hook = code(read("web/src/lib/useProviderRequests.ts"));
  const leases = code(read("web/src/components/documents/LeasesView.tsx"));
  const viewings = code(read("web/app/viewings/page.tsx"));
  const home = code(read("web/app/home/page.tsx"));

  // Properties, agreements, viewing requests and tenancy requests all hang off
  // Properties, so they scope through one service rather than four opinions.
  assert.match(services, /def properties_in_scope\(\*, user, organization=None\)/);
  for (const app of ["property", "lease", "viewing", "application"]) {
    assert.match(
      read(`backend/apps/${app}/views.py`),
      /properties_in_scope\(/,
      `${app} still answers a provider list without a Portfolio`,
    );
  }

  // Tenancy requests used to be every Portfolio's, flattened into one list.
  assert.doesNotMatch(hook, /organizations\.map\(\(organization\) => getOrganizationPortfolio/);
  assert.match(hook, /getOrganizationPortfolio\(scope\.id\)/);
  assert.match(hook, /listReceivedApplications\(false, \{ organization: scope\.id \}\)/);
  assert.match(hook, /\}, \[preferred\]\);/);

  assert.match(leases, /listGrantedLeases\(organizationId \? \{ organization: organizationId \} : undefined\)/);
  assert.match(viewings, /listHostViewings\(false, preferred \? \{ organization: preferred \} : undefined\)/);

  // Home asked for everything and sifted it by Unit id — and viewings by
  // Property *title*, which two Properties can share.
  assert.match(home, /listReceivedApplications\(true, scope\)/);
  assert.match(home, /listHostViewings\(true, scope\)/);
  assert.doesNotMatch(home, /propertyTitles/);
});

test("an individual web provider creates a first Property without setup detour", () => {
  const property = read("web/src/components/property/PropertyWizard.tsx");
  const next = read("web/src/lib/providerSetup.ts");
  const home = read("web/app/home/page.tsx");
  const tenants = read("web/app/tenants/page.tsx");

  assert.match(property, /createPersonalPortfolioProperty/);
  // The Property is filed into the Portfolio the account already has, and the
  // form says so. It no longer promises to create one, because approval did.
  assert.match(property, /This goes into your Danpa HQ Portfolio/);
  assert.doesNotMatch(property, /will be created/);
  assert.doesNotMatch(property, /propertyTypes\.filter/);
  assert.match(next, /href: "\/record\/property-new"/);
  assert.doesNotMatch(next, /label: "Create workspace"/);
  assert.doesNotMatch(home, /Set up your workspace first/);
  assert.doesNotMatch(tenants, /organization\/setup/);
});

test("provider Home is a control center that only states what it can calculate", () => {
  const home = read("web/app/home/page.tsx");
  const chart = read("web/src/components/home/ProviderFinanceChart.tsx");
  const providerHome = home.slice(home.indexOf("function ProviderHome"));

  // One composition: the hero is the overview (occupancy, counts, what is
  // owed); a reading column (collection, what is coming up, activity) beside an
  // acting column (attention, enquiries, the Properties). The leasing pipeline
  // and the readiness tiles stay off Home — each has a workspace. "Coming up"
  // is not the old viewings panel: it is one dated agenda across viewings, rent
  // due and leases ending, built only from what the backend has dated.
  assert.match(providerHome, /label="Properties"/);
  assert.match(providerHome, /className="home-hero"/);
  assert.match(providerHome, /Coming up/);
  assert.match(providerHome, /function agendaOf\(viewings: Viewing\[\], tenants: ProviderTenant\[\]\)/);
  assert.match(providerHome, /viewing\.status !== "confirmed" \|\| !viewing\.confirmed_starts_at/);
  // Enquiries are read only where the role operates Properties, and open over
  // the page rather than leaving it.
  assert.match(providerHome, /readsEnquiries \? listEnquiries\("seller"\)/);
  assert.match(providerHome, /openEnquiries\(\{ id: row\.id, side: "seller" \}\)/);
  assert.match(providerHome, /<OccupancyRing/);
  assert.match(providerHome, /<ProviderFinanceChart/);
  assert.match(providerHome, /home-attention-panel/);
  assert.match(providerHome, /Recent activity/);
  assert.match(providerHome, /propertiesNeedingAction/);
  assert.doesNotMatch(providerHome, /Upcoming viewings|Agreement flow|Ready for online rent collection/);
  assert.match(chart, /href="\/payments"/);

  // Money that would be a lie. Period aggregation now comes from the backend's
  // dated payment and obligation records; revenue and wallet claims remain out.
  const rendered = providerHome.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(rendered, /\brevenue\b/i);
  assert.doesNotMatch(rendered, /collected this (month|week|year)/i);
  assert.doesNotMatch(rendered, /available balance/i);
  // The all-time and settlement figures moved off Home with the summary tiles.
  // What remains must still be an amount the backend dated and confirmed, so
  // assert the source rather than the removed labels: the chart reads
  // `rent_collection`, which is built from confirmed payments and open charges.
  assert.match(providerHome, /rent_collection/);
  // A failed or reversed settlement still reaches the provider — it moved from
  // a summary tile into the attention list, which is where it belonged.
  assert.match(providerHome, /settlement_attention_minor/);
  assert.doesNotMatch(rendered, /wallet|payout balance/i);

  // Maintenance is not enabled, so it is absent rather than shown at zero.
  assert.doesNotMatch(providerHome, /maintenance/i);
});

test("provider Home uses an authoritative interactive collection series", () => {
  const home = read("web/app/home/page.tsx");
  const css = read("web/src/styles/home-workspace.css");
  const chart = read("web/src/components/home/ProviderFinanceChart.tsx");
  const api = read("web/src/lib/console.ts");

  assert.match(home, /function OccupancyRing/);
  assert.match(home, /role="img"/);
  assert.match(css, /\.home-pulse\s*\{/);
  assert.match(css, /\.home-finance-chart\s*\{/);
  assert.match(css, /data-tone="danger"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(chart, /Monthly/);
  assert.match(chart, /Yearly/);
  assert.match(chart, /home-chart-crosshair/);
  assert.match(chart, /home-chart-tooltip/);
  // A period column is something you point at, not something you press. It
  // reads out on hover and on keyboard focus; a click latching a pressed state
  // put a focus box across the plot and implied an action that does not exist.
  assert.match(chart, /onPointerEnter/);
  assert.match(chart, /onFocus/);
  const column = chart.slice(chart.indexOf('className="home-chart-hit"'));
  assert.doesNotMatch(column.slice(0, 900), /aria-pressed|onClick/);
  assert.match(api, /rent_collection/);
  assert.doesNotMatch(home, /sparkline|this month/i);
});

test("provider Home has a real Property highlight and no search of its own", () => {
  const home = read("web/app/home/page.tsx");
  const shell = read("web/src/components/portal/PortalShell.tsx");

  // The global search left the bar; Home does not take it back. Each workspace
  // (Properties, Units, Tenants, Payments, Viewings) searches its own list.
  assert.doesNotMatch(home, /Search Properties/);

  // The provider dashboard carries no page-level call to action at all. Adding
  // a Property is reachable from the rail and from Properties itself, and the
  // dashboard's job is to report, not to sell the reader a next step. The one
  // exception is the empty state, where there is nothing to report yet and the
  // action is the whole point.
  //
  // Bounded to the provider half, because the tenant's Home above it does keep
  // one action — joining a home — and matching that here would pass this
  // assertion for the wrong reason.
  const providerAt = home.indexOf("/* --- provider ---");
  assert.notEqual(providerAt, -1, "the provider half is missing");
  const providerHalf = home.slice(providerAt);
  assert.doesNotMatch(providerHalf, /home-primary-action/);
  assert.doesNotMatch(providerHalf, /function ProviderTopBar/);
  assert.match(providerHalf, /Your Portfolio starts here/);
  // One bell on the page. The portal header already carries updates, and a
  // second copy on Home was two badges counting the same thing.
  assert.doesNotMatch(home, /className="home-notification"/);
  assert.match(home, /function PropertyHighlight/);
  assert.match(home, /property\.cover_url/);
  assert.match(shell, /pathname === "\/home" \? " is-dashboard"/);
});

test("a Portfolio with nothing in it gets a beginning, not a wall of zeroes", () => {
  const home = read("web/app/home/page.tsx");
  const providerHome = home.slice(home.indexOf("function ProviderHome"));

  assert.match(providerHome, /properties\.length === 0/);
  assert.match(providerHome, /Your Portfolio starts here/);
  // The empty state returns before the figures, so none of them render at zero.
  const empty = providerHome.indexOf("Your Portfolio starts here");
  const figures = providerHome.indexOf('label="Properties"');
  assert.ok(empty < figures, "the figures render before the empty state returns");
});

test("provider Payments is first-class navigation and an actionable destination", () => {
  const nav = read("web/src/lib/portalNav.ts");
  const payments = read("web/app/payments/page.tsx");

  assert.match(nav, /href: "\/payments", label: "Payments", icon: "payments"/);
  assert.match(payments, /getOrganizationPortfolio/);
  assert.match(payments, /recent_payments/);
  assert.match(payments, /money\.overdue_minor/);
  assert.match(payments, /listPropertyExpenses/);
  assert.match(payments, /recordPropertyExpense/);
  assert.match(payments, /Search tenant, Property or Unit/);
  // The rent account is reachable from here, but it is no longer *here*: it
  // stopped being a dialog over this page and became `/payments/<leaseId>`.
  // What matters to this contract is that a row still opens one.
  assert.match(payments, /href=\{`\/record\/payment\?leaseId=\$\{tenant\.lease_id\}`/);
  assert.match(read("web/app/record/payment/page.tsx"), /getLeaseLedger/);
});

test("nothing in the web console creates a Portfolio", () => {
  // Every provider owns exactly one Portfolio and Danpa HQ provisions it when
  // provider access is approved. There is no setup route, no API wrapper to
  // call one, and no control that offers it — the owner renames what they were
  // given, and joins anything else by invitation.
  assert.equal(exists("web/app/organization/setup/page.tsx"), false);
  assert.equal(exists("web/app/organization"), false);
  assert.doesNotMatch(read("web/src/lib/console.ts"), /createOrganization/);
  for (const page of [
    "web/src/components/portal/PortfolioMenu.tsx",
    "web/app/settings/team/page.tsx",
    "web/app/choose-role/page.tsx",
    "web/app/record/property-new/page.tsx",
    "web/app/home/page.tsx",
    "web/app/tenants/page.tsx",
  ]) {
    assert.doesNotMatch(read(page), /organization\/setup/, `${page} still points at Portfolio setup`);
  }

  // The Portfolio an owner was given is theirs to name and to describe.
  const team = read("web/app/settings/team/page.tsx");
  assert.match(team, /updateOrganization/);
});

test("web Property and Unit pages keep one operational hierarchy", () => {
  const property = read("web/app/record/property/page.tsx");
  const unit = read("web/app/record/space/page.tsx");
  const lifecycle = read("web/src/components/property/PropertyLifecycle.tsx");
  const patterns = read("web/src/components/property/WorkspacePatterns.tsx");
  const workspaceCss = read("web/src/styles/property-workspace.css");
  const shell = read("web/src/components/portal/PortalShell.tsx");

  assert.match(property, /<PropertyLifecycle[^>]+compact/);
  assert.match(property, /lifecycleOwnsPrimary/);
  assert.doesNotMatch(property, /label: "Continue setup"/);
  assert.doesNotMatch(property, /action=\{canAddUnit/);
  assert.match(property, /Manage tenant access and tenancies/);
  assert.match(unit, /Manage this Unit/);
  assert.match(unit, /Verification and publication details/);
  // The Unit's own access code is managed on the Unit; the link beside it is
  // about tenancy work, which is not the same thing.
  assert.match(unit, /<UnitPrivateAccess/);
  assert.match(unit, /Tenancy requests and tenancies/);
  assert.equal((unit.match(/View public listing/g) ?? []).length, 1);
  assert.match(unit, /Danpa HQ will not accept new requests while someone lives here/);
  assert.match(lifecycle, /With our review team/);
  assert.match(lifecycle, /This returns the submission to you/);
  assert.match(lifecycle, /reviewState === "changes_required"[\s\S]*"What to update"/);
  assert.match(patterns, /mobileLabel\?: string/);
  assert.match(workspaceCss, /\.quiet-link\s*\{[^}]*min-height:\s*var\(--target-min\)/s);
  assert.match(workspaceCss, /data-mobile-back="true"/);
  assert.match(shell, /aria-modal="true"/);
  assert.match(shell, /inert=\{drawerOpen \? true : undefined\}/);
});
