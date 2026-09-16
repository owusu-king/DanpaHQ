import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

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

  // Switching belongs to the one surface that still knows which Portfolio you
  // are looking at, and only when there is more than one.
  assert.match(team, /organizations\.length > 1/);
  // The picker is the shared listbox now, which hands back the chosen value
  // rather than a change event — so what is pinned here is that choosing a
  // Portfolio sets the active context, not which object the callback is given.
  assert.match(team, /setActiveContext\(`organization:\$\{\w+\}`\)/);
});

test("an individual web provider creates a first Property without setup detour", () => {
  const property = read("web/app/properties/new/page.tsx");
  const next = read("web/src/lib/providerSetup.ts");
  const home = read("web/app/home/page.tsx");
  const tenants = read("web/app/tenants/page.tsx");

  assert.match(property, /createPersonalPortfolioProperty/);
  // The rule is that the individual path says a personal Portfolio comes
  // with the Property; the sentence carrying it got shorter, not removed.
  assert.match(property, /personal Portfolio will be created with it/);
  assert.doesNotMatch(property, /propertyTypes\.filter/);
  assert.match(next, /href: "\/properties\/new"/);
  assert.doesNotMatch(next, /label: "Create workspace"/);
  assert.doesNotMatch(home, /Set up your workspace first/);
  assert.doesNotMatch(tenants, /href="\/organization\/setup"[^>]*>Set up workspace/);
});

test("provider Home is a control center that only states what it can calculate", () => {
  const home = read("web/app/home/page.tsx");
  const chart = read("web/src/components/home/ProviderFinanceChart.tsx");
  const providerHome = home.slice(home.indexOf("function ProviderHome"));

  // Five things, in this order: overview, attention, collection, activity,
  // one Property. The leasing pipeline, the viewings panel and the readiness
  // tiles were removed from Home on purpose — each already has a workspace, and
  // a dashboard that restates every one of them stops having a shape.
  assert.match(providerHome, /label="Properties"/);
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

test("provider Home has Portfolio search and a real Property highlight", () => {
  const home = read("web/app/home/page.tsx");
  const shell = read("web/src/components/portal/PortalShell.tsx");

  // Search is a way of getting anywhere, so it belongs to the shell beside the
  // navigation rather than to one page.
  const search = read("web/src/components/portal/PortalSearch.tsx");
  // Four things a provider goes looking for by name.
  assert.match(search, /Search Properties, Units, tenants or agreements/);
  assert.match(search, /listPortfolioUnits/);
  assert.match(search, /getOrganizationPortfolio/);
  assert.match(search, /listGrantedLeases/);
  assert.match(shell, /<PortalSearch/);
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
  assert.match(payments, /href=\{`\/payments\/\$\{tenant\.lease_id\}`/);
  assert.match(read("web/app/payments/[leaseId]/page.tsx"), /getLeaseLedger/);
});

test("full web Portfolio setup is explicit business setup without a Residential default", () => {
  const setup = read("web/app/organization/setup/page.tsx");
  const team = read("web/app/settings/team/page.tsx");

  assert.match(setup, /Set up a property business/);
  assert.match(setup, /useState<Organization\["activities"\]>\(\[\]\)/);
  assert.doesNotMatch(setup, /useState<Organization\["activities"\]>\(\["residential"\]\)/);
  assert.match(team, /href="\/organization\/setup"/);
});

test("web Property and Unit pages keep one operational hierarchy", () => {
  const property = read("web/app/properties/[id]/page.tsx");
  const unit = read("web/app/properties/[id]/spaces/[spaceId]/page.tsx");
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
  assert.match(unit, /Rooomly will not accept new requests while someone lives here/);
  assert.match(lifecycle, /With our review team/);
  assert.match(lifecycle, /This returns the submission to you/);
  assert.match(lifecycle, /reviewState === "changes_required"[\s\S]*"What to update"/);
  assert.match(patterns, /mobileLabel\?: string/);
  assert.match(workspaceCss, /\.quiet-link\s*\{[^}]*min-height:\s*var\(--target-min\)/s);
  assert.match(workspaceCss, /data-mobile-back="true"/);
  assert.match(shell, /aria-modal="true"/);
  assert.match(shell, /inert=\{drawerOpen \? true : undefined\}/);
});
