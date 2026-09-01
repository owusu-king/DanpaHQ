import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile provider Team supports the same membership lifecycle", () => {
  const more = read("mobile/app/(app)/(provider-tabs)/more.tsx");
  const team = read("mobile/app/(app)/team.tsx");
  const invitations = read("mobile/app/(app)/portfolio-invitations.tsx");

  // More is the provider's index and reaches Team directly. A tenant has no
  // Team, so their index does not list one.
  assert.match(more, /label="Team"/);
  assert.match(more, /\/\(app\)\/team"/);
  // The roster invites; changing one person's access belongs to that person's
  // own screen rather than to controls inside every row.
  const member = read("mobile/app/(app)/team-member.tsx");
  assert.match(team, /invitePortfolioMember/);
  assert.match(member, /changePortfolioMemberRole/);
  assert.match(member, /assignPortfolioProperty/);
  assert.match(member, /unassignPortfolioProperty/);
  assert.match(member, /removePortfolioMember/);
  assert.match(invitations, /respondToPortfolioInvitation/);
});

test("mobile first Property creates a personal Portfolio automatically", () => {
  const property = read("mobile/app/(app)/private-property.tsx");
  const properties = read("mobile/app/(app)/(provider-tabs)/properties.tsx");
  const providerHome = read("mobile/app/(app)/(provider-tabs)/index.tsx");

  assert.match(property, /createPersonalPortfolioProperty/);
  assert.match(property, /Your personal Portfolio starts here/);
  assert.doesNotMatch(property, /propertyTypes\s*\.filter/);
  assert.match(properties, /label="Add Property"/);
  assert.doesNotMatch(properties, /label=\{organizations\.length \? "Create property" : "Create workspace"\}/);
  assert.doesNotMatch(providerHome, /Create workspace/);
  assert.doesNotMatch(providerHome, /organization-setup/);
  assert.match(providerHome, /Your Portfolio starts here/);
  assert.match(providerHome, /label="Add first Property"/);
});

test("full mobile Portfolio setup is a deliberate business path", () => {
  const setup = read("mobile/app/(app)/organization-setup.tsx");
  const team = read("mobile/app/(app)/team.tsx");

  assert.match(setup, /Set up a property business/);
  assert.match(setup, /useState<Organization\["activities"\]>\(\[\]\)/);
  assert.doesNotMatch(setup, /useState<Organization\["activities"\]>\(\["residential"/);
  assert.match(team, /Set up a property business/);
});

test("mobile Property and Unit screens mirror the operational hierarchy", () => {
  const property = read("mobile/app/(app)/provider-property.tsx");
  const unit = read("mobile/app/(app)/space.tsx");
  const lifecycle = read("mobile/src/components/property/PropertyLifecycle.tsx");
  const patterns = read("mobile/src/components/property/WorkspacePatterns.tsx");
  const primitives = read("mobile/src/components/ui.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");

  assert.match(property, /<PropertyLifecycle[^>]+compact/);
  assert.match(property, /<FlatList/);
  assert.match(property, /data=\{property && section === "units" \? units : \[\]\}/);
  assert.match(property, /function PropertyTabs/);
  assert.match(property, /label="Units"/);
  assert.match(property, /label="Details"/);
  assert.match(property, /function PropertyDetails/);
  assert.match(property, /Edit Property information/);
  assert.doesNotMatch(property, /units\.map/);
  // Was `function UnitRow` here. The row became a shared tile so that a
  // Unit looks the same whether it is reached through its Property or
  // through Units; the rule that this screen renders Units through a
  // component rather than inline is unchanged.
  assert.match(property, /<UnitTile/);
  assert.doesNotMatch(property, /function Unit(Row|Tile)/);
  assert.match(property, /Manage tenant access and tenancies/);
  assert.doesNotMatch(property, /function SpaceCard/);
  assert.match(unit, /<EntityHeader/);
  assert.match(unit, /Manage this Unit/);
  assert.match(unit, /Verification and publication details/);
  // The Unit's own access code is managed on the Unit. It used to be reachable
  // only through the Portfolio's tenant work, which a provider holding a
  // Property directly is not part of.
  assert.match(unit, /<UnitAccessCodeManagement/);
  assert.match(unit, /Tenancy requests and tenancies/);
  assert.match(unit, /property_type === "hostel" && unit\.space_type === "room"/);
  assert.match(unit, /Rooomly will not accept new requests while someone lives here/);
  assert.match(unit, /Alert\.alert\([\s\S]*Take this Unit out of Explore\?/);
  assert.match(unit, /style: destructiveConfirmStyle/);
  assert.match(lifecycle, /With our review team/);
  assert.match(lifecycle, /This returns the submission to you/);
  assert.match(patterns, /availability\.state === "occupied"/);
  assert.match(patterns, /publication\.state === "published" \? "Verified · Public · Available"/);
  assert.match(primitives, /paddingVertical: space\[3\]/);
  assert.match(primitives, /flexShrink: 1, textAlign: "center"/);
  assert.match(layout, /name="space" options=\{\{ title: "Unit" \}\}/);
});

test("mobile Home is a control center recomposed for a phone", () => {
  const home = read("mobile/app/(app)/(provider-tabs)/index.tsx");

  // One overview surface, not four KPI cards squeezed into a two-column wrap.
  assert.match(home, /<PortfolioOverview/);
  assert.match(home, /<Svg/);
  assert.match(home, /label="Properties"/);
  assert.match(home, /label="Tenancies"/);
  assert.match(home, /accessibilityLabel=\{`\$\{units\} Units`\}/);
  assert.match(home, /accessibilityLabel=\{`\$\{available\} Vacant Units`\}/);
  assert.match(home, /function PortfolioLedger/);
  assert.doesNotMatch(home, /function OverviewFigure/);
  assert.doesNotMatch(home, /function Figure/);
  // The card, the ground, the paper and the registration ticks are one
  // vocabulary shared with the tenant's Home rather than a copy per screen —
  // two palettes is how one of them ends up a shade whiter than the other.
  const plinth = read("mobile/src/components/home/plinth.tsx");
  assert.match(plinth, /export function PlinthCard/);
  assert.match(plinth, /export const ph = \{/);
  assert.match(home, /\} from "@\/components\/home\/plinth";/);
  assert.doesNotMatch(home, /const ph = \{/);
  assert.match(home, /function PortfolioHighlight/);
  assert.match(home, /right\.unit_count - left\.unit_count/);
  assert.match(home, /height: cardHeight/);
  assert.doesNotMatch(home, /minHeight: density\.compact \? 104 : 112/);
  assert.doesNotMatch(home, /function StreetElevation/);

  // Priority order for a phone: recognize the featured Property, understand
  // the Portfolio, see what needs action, then the money and current activity.
  const order = ["<PortfolioHighlight", "<PortfolioOverview", "<AttentionPanel", "<RentCollection", 'title="Upcoming viewings"', 'title="Recent activity"']
    .map((marker) => home.indexOf(marker));
  assert.ok(order.every((at) => at > -1), "a Home region is missing");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Home regions are out of priority order");

  assert.match(home, /pending_join_requests/);
  assert.match(home, /payment_records_awaiting_you/);
  assert.match(home, /occupied_units/);
  assert.match(home, /vacant_units/);

  // Money that would be a lie. Period figures are now shown, but only the ones
  // the server built from dated payments and open charges — the same
  // `rent_collection` the web dashboard charts. Nothing is aggregated here.
  const rendered = home.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(rendered, /\brevenue\b/i);
  assert.doesNotMatch(rendered, /available balance/i);
  assert.match(home, /summary\?\.rent_collection/);
  assert.match(home, /settlement_attention_minor/);
  assert.match(home, /key=\{`chart-touch-\$\{row\.period\}`\}/);
  assert.match(home, /onPress=\{\(\) => selectPoint\(index\)\}/);
  assert.match(home, /hapticsPolicy\.onSelection/);
  // Collected and outstanding are two questions, never netted into one.
  assert.doesNotMatch(rendered, /collected_minor\s*-\s*[^;]*outstanding_minor/);

  // Semantic state is not colour alone, and motion-sensitive native surfaces
  // keep immediate press feedback.
  assert.match(home, /"Act now" : "Soon"/);
  assert.match(home, /accessibilityLabel/);
  assert.match(home, /pressableFeedback/);
  // A phone cannot hover: the gauge reads out on press instead.
  assert.match(home, /onPressIn=\{\(\) => setShowCount\(true\)\}/);

  // Maintenance is not enabled, so it is absent rather than shown at zero.
  assert.doesNotMatch(home, /maintenance/i);
});

test("Home rows carry a destination, not an explanation", () => {
  const home = read("mobile/app/(app)/(provider-tabs)/index.tsx");

  // A row that says "3 viewing requests" and leads to Viewings needs no
  // sentence under it. Only the money qualifiers survive the copy budget.
  const captions = [...home.matchAll(/<Type variant="caption">([^<{][^<]*)</g)]
    .map((match) => match[1].trim())
    // Expressions are conditional labels, not prose; only literal text is copy.
    .filter((text) => text.length > 0 && !text.includes("{"));
  // The money qualifiers keep two figures from being false. The empty state is
  // an invitation to a provider with nothing yet, which the Home brief asked
  // for by name. Everything else must earn its place in under 40 characters.
  const allowed = ["Agreed by both sides, all time", "Rooomly records rent."];
  const isMoneyOrWelcome = (text) =>
    allowed.some((phrase) => text.startsWith(phrase))
    || text.startsWith("Add your first Property");
  for (const caption of captions) {
    assert.ok(
      isMoneyOrWelcome(caption) || caption.length <= 40,
      `Home caption is explanatory rather than a fact: "${caption}"`,
    );
  }
});

test("a mobile Portfolio with nothing in it gets a beginning", () => {
  const home = read("mobile/app/(app)/(provider-tabs)/index.tsx");

  assert.match(home, /Your Portfolio starts here/);
  assert.match(home, /label="Add first Property"/);
  assert.match(home, /!loading && !summary && !error/);
});

test("mobile separates tenancy requests from active tenant relationships", () => {
  const tenants = read("mobile/app/(app)/(provider-tabs)/tenants.tsx");
  const requests = read("mobile/app/(app)/provider-applications.tsx");
  const requestDetail = read("mobile/app/(app)/provider-application.tsx");
  const tenancy = read("mobile/app/(app)/provider-tenancy.tsx");
  const leaseActions = read("mobile/src/components/tenant/LeaseActions.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");
  const providerTabs = read("mobile/app/(app)/(provider-tabs)/_layout.tsx");

  assert.match(tenants, /type ViewName = "tenants" \| "access"/);
  assert.match(tenants, /Search tenants/);
  assert.match(tenants, /tenantNeedsAttention/);
  assert.match(tenants, /summary\.tenant_access/);
  assert.match(tenants, /provider-tenancy/);
  assert.doesNotMatch(tenants, /listUnits|listOrganizationProperties/);
  assert.doesNotMatch(tenants, /RequestLeaseActions|decidePropertyJoinRequest/);
  assert.match(requests, /summaries[\s\S]*flatMap\(\(summary\) => summary\.tenancy_requests/);
  assert.match(requests, /listReceivedApplications/);
  assert.match(requests, /label="Action"/);
  assert.match(requests, /label="Agreement"/);
  assert.match(requests, /label="History"/);
  assert.match(requestDetail, /decideApplication/);
  assert.match(requestDetail, /ApplicationLeaseActions/);
  assert.match(requestDetail, /RequestLeaseActions/);
  assert.match(tenancy, /Agreement and rent/);
  assert.match(tenancy, /provider-property/);
  assert.match(tenancy, /provider-tabs\)\/payments/);
  // Preparing an agreement is a destination, not a sheet over the list it was
  // opened from: it has several steps, it can be left and come back to, and a
  // modal makes leaving mean losing your place. Ending a tenancy stays a
  // confirmation, because it is one irreversible decision.
  assert.match(leaseActions, /pathname: "\/\(app\)\/lease-builder"/);
  assert.doesNotMatch(leaseActions, /presentationStyle=/);
  assert.match(leaseActions, /Alert\.alert/);
  assert.match(layout, /name="provider-tenancy"/);
  assert.match(layout, /name="provider-application"/);
  assert.match(providerTabs, /name="tenants"/);
  assert.match(providerTabs, /name="payments"/);
  assert.doesNotMatch(providerTabs, /name="messages"/);
});
