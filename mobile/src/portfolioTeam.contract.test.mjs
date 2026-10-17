import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  assert.match(more, /label: "Team"/);
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

test("mobile accepting an invitation opens the Portfolio it granted", () => {
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const screen = code(read("mobile/app/(app)/portfolio-invitations.tsx"));
  const patterns = code(read("mobile/src/components/team/TeamPatterns.tsx"));
  const team = code(read("mobile/app/(app)/team.tsx"));

  // Be in the provider experience, re-read the account so the Portfolio is a
  // context at all, then select it. Any other order leaves the person where
  // they were, which is what an accepted invitation used to do.
  assert.match(
    screen,
    /await chooseWorkspace\("provider"\);\s*await refreshMe\(member\.context_id\);/,
  );
  assert.match(screen, /Open \$\{joined\.portfolio\.name\}/);
  assert.match(screen, /listMyPortfolioInvitations\(\{ history: true \}\)/);
  assert.match(screen, /invitation\.addressed_to_you/);
  assert.match(screen, /invitation\.requirements\[0\]/);

  // Ownership is not a role a Team screen hands out, and granting access waits
  // on the backend's own answer about the person doing it.
  assert.match(patterns, /GRANTABLE_ROLES = ROLES\.filter\(\(role\) => role\.value !== "owner"\)/);
  // The roster offers a role through the shared control, which is built from
  // that list — so a screen cannot reach past it to the full set of roles.
  assert.match(team, /<RoleChoice/);
  assert.match(patterns, /GRANTABLE_ROLES\.map\(\(role, index\) => \(/);
  assert.doesNotMatch(team, /GRANTABLE_ROLES/);
  assert.match(team, /access \? access\.can\.manage_team : canManage/);
});

test("the mobile Properties tab switches the whole context, not just its list", () => {
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const screen = code(read("mobile/app/(app)/(provider-tabs)/properties.tsx"));

  // The tab follows the shared context and no longer carries a switcher of its
  // own: one picker on one tab moved that tab alone, while Home, Payments and
  // Team stayed on the Portfolio the person believed they had left.
  assert.doesNotMatch(screen, /Switch Portfolio/);
  assert.doesNotMatch(screen, /setActiveContext/);
  // Scoped to that Portfolio by the endpoint that enforces membership.
  assert.match(screen, /listOrganizationProperties\(selected\)/);
  assert.match(screen, /\}, \[activeContext\]\);/);
});

test("the mobile Portfolio switcher is a header icon and a bottom sheet", () => {
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const switcher = code(read("mobile/src/components/portfolio/PortfolioSwitcher.tsx"));
  const layout = code(read("mobile/app/(app)/(provider-tabs)/_layout.tsx"));

  // Workspace identity on the left of the header, the create action on the
  // right, and the sheet comes up from the thumb.
  assert.match(layout, /headerLeft: \(\) => <PortfolioHeaderButton/);
  assert.match(switcher, /<Modal[\s\S]*animationType="slide"/);
  assert.match(switcher, /YOUR PORTFOLIOS/);

  // Name, type and role on every row; a tick on the one you are in.
  assert.match(switcher, /describe\(portfolio\)/);
  assert.match(switcher, /aria-selected=\{isCurrent\}/);
  assert.match(switcher, /name="checkmark"/);
  assert.match(switcher, /portfolios\.length >= SEARCHABLE_FROM/);

  // One tap switches the whole context; settings sit below a line, and there is
  // nothing to create — an account is provisioned its one Portfolio, and every
  // other one in this list arrived as somebody's invitation.
  assert.match(switcher, /await setActiveContext\(id\)/);
  assert.match(switcher, /Portfolio settings/);
  assert.doesNotMatch(switcher, /Create Portfolio/);
});

test("switching Portfolio leaves nothing of the last one on screen", () => {
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // Reloading is not the same as blanking: a reload takes a moment, and for
  // that moment the figures on screen are the ones the person just switched
  // away from, sitting under the new Portfolio's name.
  assert.match(code(read("mobile/src/portfolioScope.ts")), /export function useBlankOnPortfolioSwitch/);
  for (const screen of [
    "mobile/app/(app)/(provider-tabs)/index.tsx",
    "mobile/app/(app)/(provider-tabs)/properties.tsx",
    "mobile/app/(app)/provider-applications.tsx",
  ]) {
    assert.match(
      code(read(screen)),
      /useBlankOnPortfolioSwitch\(activeContext, \(\) => \{/,
      `${screen} holds the Portfolio it just left on screen`,
    );
  }
  // These two hold one list each and already empty it at the top of every load.
  for (const screen of ["mobile/app/(app)/provider-viewings.tsx", "mobile/src/components/agreements/ProviderAgreements.tsx"]) {
    assert.match(code(read(screen)), /setItems\(null\);/, `${screen} keeps its rows through a switch`);
  }
});

test("mobile provider lists are about the Portfolio on screen", () => {
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const requests = code(read("mobile/app/(app)/provider-applications.tsx"));
  const leases = code(read("mobile/src/components/agreements/ProviderAgreements.tsx"));
  const viewings = code(read("mobile/app/(app)/provider-viewings.tsx"));
  const home = code(read("mobile/app/(app)/(provider-tabs)/index.tsx"));

  // Tenancy requests were read from every Portfolio and flattened together, so
  // one Portfolio's request could be answered while another was on screen.
  assert.doesNotMatch(requests, /organizations\.map\(\(organization\) => getPortfolioSummary/);
  assert.match(requests, /listReceivedApplications\(false, scope\)/);
  assert.match(requests, /\}, \[activeContext\]\);/);

  assert.match(leases, /listGrantedLeases\(preferred \? \{ organization: preferred \} : undefined\)/);
  assert.match(viewings, /listReceivedViewings\(false, preferred \? \{ organization: preferred \} : undefined\)/);

  // Home counted viewings, tenancy requests and agreements from every
  // Portfolio against one Portfolio's Properties.
  assert.match(home, /listReceivedViewings\(true, scope\)/);
  assert.match(home, /listGrantedLeases\(scope\)/);
});

test("a mobile first Property files into the Portfolio the account already has", () => {
  const property = read("mobile/app/(app)/private-property.tsx");
  const properties = read("mobile/app/(app)/(provider-tabs)/properties.tsx");
  const providerHome = read("mobile/app/(app)/(provider-tabs)/index.tsx");

  assert.match(property, /createPersonalPortfolioProperty/);
  // The Portfolio is not created here. It was provisioned when this account's
  // provider access was approved, and the form says where the Property goes.
  assert.match(property, /This goes into your Danpa HQ Portfolio/);
  assert.doesNotMatch(property, /Portfolio starts here/);
  assert.doesNotMatch(property, /propertyTypes\s*\.filter/);
  assert.match(properties, /label="Add Property"/);
  assert.doesNotMatch(properties, /label=\{organizations\.length \? "Create property" : "Create workspace"\}/);
  assert.doesNotMatch(providerHome, /Create workspace/);
  assert.doesNotMatch(providerHome, /organization-setup/);
  assert.match(providerHome, /Your Portfolio starts here/);
  assert.match(providerHome, /label="Add first Property"/);
});

test("nothing in the mobile app creates a Portfolio", () => {
  // Every provider owns exactly one Portfolio and Danpa HQ provisions it when
  // provider access is approved. There is no setup screen, no API wrapper to
  // call one, and no control that offers it — the owner renames what they were
  // given, and joins anything else by invitation.
  assert.equal(existsSync(resolve(root, "mobile/app/(app)/organization-setup.tsx")), false);
  assert.doesNotMatch(read("mobile/src/organizations.ts"), /export function createOrganization/);
  for (const screen of [
    "mobile/app/(app)/_layout.tsx",
    "mobile/app/(app)/team.tsx",
    "mobile/app/(auth)/role.tsx",
    "mobile/src/components/portfolio/PortfolioSwitcher.tsx",
    "mobile/app/(app)/(provider-tabs)/index.tsx",
  ]) {
    assert.doesNotMatch(read(screen), /organization-setup/, `${screen} still points at Portfolio setup`);
  }

  // The Portfolio an owner was given is theirs to name and to describe, and
  // this is the only place that can be done.
  const team = read("mobile/app/(app)/team.tsx");
  assert.match(team, /updateOrganization\(organization\.id, \{/);
  assert.match(team, /label="Portfolio name"/);
  assert.match(team, /Edit Portfolio details/);
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

  // A Property *is* its Units, so they are the page. It used to carry a tab bar
  // of its own — Units and Details — inside a pushed detail screen, which
  // nothing else in the app does and which hid half the record behind a control
  // nobody expects to find there. Reference material opens from a row instead.
  assert.match(property, /data=\{units\}/);
  assert.doesNotMatch(property, /function PropertyTabs/, "a pushed record must not carry tabs");
  assert.doesNotMatch(property, /accessibilityRole="tablist"/);
  assert.match(property, /<BottomSheet/);
  assert.match(property, /label="Property information"/);
  assert.match(property, /label="Shared amenities"/);
  assert.match(property, /label="Buildings and blocks"/);
  assert.match(property, /Edit Property information/);
  assert.doesNotMatch(property, /units\.map/);
  // Was `function UnitRow` here. The row became a shared tile so that a
  // Unit looks the same whether it is reached through its Property or
  // through Units; the rule that this screen renders Units through a
  // component rather than inline is unchanged.
  assert.match(property, /<UnitTile/);
  assert.doesNotMatch(property, /function Unit(Row|Tile)/);
  assert.match(property, /label="Tenant access and tenancies"/);
  assert.doesNotMatch(property, /function SpaceCard/);
  // The Unit was five stacked disclosures under one heading — a settings page,
  // not a record. Each is its own piece of work, so each opens on the row that
  // names it, and the photograph leads because that is how a Unit is known.
  assert.match(unit, /<UnitFact label="Type"/);
  assert.match(unit, /<GroupLabel>Manage this Unit<\/GroupLabel>/);
  assert.match(unit, /label="Verification and publication"/);
  assert.match(unit, /<View style=\{styles\.hero\}>/);
  // Mid-page acts are a row in the page; the pinned bar drew a white slab there.
  assert.doesNotMatch(unit, /<ActionBar>/);
  assert.doesNotMatch(unit, /<Disclosure/, "a record does not stack disclosures");
  // The Unit's own access code is managed on the Unit. It used to be reachable
  // only through the Portfolio's tenant work, which a provider holding a
  // Property directly is not part of.
  assert.match(unit, /<UnitAccessCodeManagement/);
  assert.match(unit, /Tenancy requests and tenancies/);
  assert.match(unit, /property_type === "hostel" && unit\.space_type === "room"/);
  // Occupied: a card that says so and leads to Tenants, not a boxed notice with nothing to press.
  assert.match(unit, /<StandingLine tone="good" line="Someone lives here" \/>/);
  assert.match(unit, /<Pill label="Open Tenants" icon="people-outline"/);
  assert.match(unit, /Alert\.alert\([\s\S]*Take this Unit out of Explore\?/);
  assert.match(unit, /style: destructiveConfirmStyle/);
  // The setup tracker counts only steps to fill in — "Review" is the act of
  // finishing and is never ticked — names the next one, and draws a segment each.
  assert.match(lifecycle, /const required = steps\.filter\(\(step\) => !step\.optional && !step\.terminal\);/);
  assert.match(lifecycle, /<Segments total=\{required\.length\} done=\{complete\}/);
  assert.match(lifecycle, /<Type variant="bodyStrong" style=\{styles\.nextTitle\}>\{next\.title\}<\/Type>/);
  // A provider's Viewing offers a change only when the backend allows it.
  const providerViewing = read("mobile/app/(app)/provider-viewing.tsx");
  assert.match(providerViewing, /const canReschedule = viewing\.status === "confirmed" && Boolean\(viewing\.actions\.can_reschedule\);/);
  assert.match(providerViewing, /\{canCancel \? \(/);
  assert.doesNotMatch(providerViewing, /viewing\.actions\.can_cancel \|\| viewing\.status === "confirmed"/);
  assert.match(lifecycle, /With our review team/);
  assert.match(lifecycle, /This returns the submission to you/);
  assert.match(patterns, /availability\.state === "occupied"/);
  assert.match(patterns, /publication\.state === "published" \? "Verified · Public · Available"/);
  assert.match(primitives, /paddingVertical: space\[3\]/);
  assert.match(primitives, /flexShrink: 1, textAlign: "center"/);
  assert.match(layout, /name="space" options=\{\{ title: "Unit" \}\}/);
});

test("mobile Home leads with the next move, then one strong figure", () => {
  const home = read("mobile/app/(app)/(provider-tabs)/index.tsx");

  // The order a provider reads it in (owner, 2026-10-06).
  const order = [...home.matchAll(/<Section title="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["Your next move", "Overview", "Highlights", "Rent collection", "Coming up", "Recent activity"]);

  // Both Homes are built from one kit, so they cannot drift.
  const kit = read("mobile/src/components/home/DashboardParts.tsx");
  assert.match(home, /from "@\/components\/home\/DashboardParts";/);

  // One move leads with its verb as the page's one solid button; the rest are rows.
  const moves = kit.slice(kit.indexOf("export function NextMoves("), kit.indexOf("export function Ring("));
  assert.match(moves, /const \[lead, \.\.\.rest\] = moves;/);
  assert.match(moves, /<Act label=\{lead\.act\} primary onPress=\{lead\.onPress\} \/>/);
  assert.match(moves, /icon="checkmark-done-outline" title=\{calm\.title\}/);
  assert.match(home, /moves=\{moves\.map\(\(move\) => \(\{ \.\.\.move, onPress: \(\) => go\(move\.to\) \}\)\)\}/);
  assert.match(home, /calm=\{\{ title: "Nothing is waiting on you"/);

  // One overview surface with occupancy as its figure, and the counts behind it
  // each opening their list — not four KPI cards of equal weight.
  assert.match(home, /<PortfolioOverview/);
  assert.match(home, /<Cell label="Units" value=\{units\} onPress=\{onUnits\} \/>/);
  assert.match(home, /<Cell label="Vacant" value=\{available\} onPress=\{onUnits\} alert=\{available > 0\} \/>/);
  assert.match(home, /<Cell label="Properties" value=\{properties\} onPress=\{onProperties\} \/>/);
  assert.match(home, /<Cell label="Tenancies" value=\{tenants\} onPress=\{onTenants\} \/>/);
  assert.match(kit, /accessibilityLabel=\{`\$\{value\} \$\{label\}`\}/);
  // No Units, no percentage.
  assert.match(home, /No Units yet/);

  // Two rings, refined from the earlier Home's one (owner, 2026-10-06): what
  // is let and what of this month's rent is in, each done in green with the rest
  // as its own softer arc, and holding one shows the figures behind it.
  const overview = home.slice(home.indexOf("function PortfolioOverview("), home.indexOf("function shortMoney("));
  assert.match(overview, /<Ring\s+share=\{occupied \/ units\}\s+rest=\{RING_EMPTY\}/);
  assert.match(overview, /<Ring\s+share=\{month\.collected_minor \/ due\}\s+rest=\{RING_OWED\}/);
  assert.match(overview, /heldFigure=\{`\$\{occupied\}\/\$\{units\}`\}/);
  const ring = kit.slice(kit.indexOf("export function Ring("), kit.indexOf("export function Rings("));
  assert.match(ring, /onPressIn=\{\(\) => setShowCount\(true\)\}/);
  assert.match(ring, /\{showCount \? heldFigure : figure\}/);
  assert.match(ring, /stroke=\{rest\}/);
  assert.match(ring, /stroke=\{KOLA\}/);
  assert.match(home, /month=\{summary\?\.rent_collection\.monthly\.at\(-1\) \?\? null\}/);
  // With nothing due, the rent ring still stands beside occupancy, drawn as
  // nothing: a faint dashed outline, "None due", and nothing to hold for.
  assert.match(overview, /<Ring\s+share=\{null\}\s+rest=\{RING_OWED\}\s+figure="None"\s+unit="due"/);
  assert.match(overview, /line="No rent due yet"/);
  assert.match(ring, /disabled=\{empty\}/);
  assert.match(ring, /stroke=\{RING_NONE\} strokeWidth=\{2\} strokeDasharray="3 6"/);
  // And the four counts back on one straight line under them.
  assert.match(home, /<StatCells>\s*<Cell label="Units"/);
  assert.match(kit, /cells: \{\s*flexDirection: "row",/);
  // The template's drafting marks are gone: the ledger, ticks, gold register and highlight card.
  assert.doesNotMatch(home, /function PortfolioLedger|function PortfolioHighlight|<Ticks|PORTFOLIO HIGHLIGHT|ph\.gold/);
});

test("the tenant's Home is built from the same kit, and leads with what waits on them", async () => {
  const home = read("mobile/src/components/home/TenantHome.tsx");
  assert.match(home, /from "@\/components\/home\/DashboardParts";/);
  const order = [...home.matchAll(/<Section title="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["Your next move", "Overview", "Highlights", "Coming up", "Recent activity", "Find your home", "In progress"]);
  assert.match(home, /<Section title=\{tenancies\.length > 1 \? "My homes" : "My home"\}/);

  // What they owe stays the page's one big figure, summed in minor units, over the counts on one line.
  assert.match(home, /minor \+= rent\.outstanding_minor \?\? 0;/);
  assert.match(home, /<StatCells>\s*<Cell label=\{plural\(homes, "Home", "Homes"\)\}/);
  // Each home's amount still opens its own rent account.
  assert.match(home, /accessibilityLabel=\{`Rent account for \$\{unit\}\./);
  // Joining another home stays reachable whenever a tenant has one.
  assert.match(home, /<JoinAnother key="join" onJoin=\{onJoin\} \/>/);
  assert.doesNotMatch(home, /<Ticks|<Register|ph\.gold|PlinthCard/);

  const { moveTone, rankMoves, tenantHighlights, termProgress } = await import("./tenantHomeWork.ts");
  assert.deepEqual(["rent_overdue", "agreement_offered", "viewing", "application", "join_rejected"].map(moveTone), ["danger", "danger", "warning", "warning", "calm"]);
  assert.deepEqual(rankMoves([{ kind: "viewing" }, { kind: "agreement_offered" }, { kind: "rent_overdue" }]).map((row) => row.kind), ["rent_overdue", "agreement_offered", "viewing"]);

  const now = new Date("2026-10-06T12:00:00").getTime();
  const term = termProgress("2026-06-08", "2027-06-08", now);
  assert.deepEqual([term.month, term.months], [4, 12]);
  const rows = tenantHighlights({
    tenancies: [
      { id: "t1", status: "active", starts_on: "2026-06-08", ends_on: "2027-06-08", name: "Unit 3D" },
      { id: "t2", status: "active", starts_on: "2025-11-01", ends_on: "2026-11-01", name: "Room 4" },
    ],
    now,
    date: (iso) => iso,
  });
  assert.deepEqual(rows.map((row) => row.headline), ["Month 4 of 12 at Unit 3D", "Your agreement ends in 26 days"]);
  assert.deepEqual(rows.map((row) => row.tag), ["Tenancy", "Ending"]);

  // Never one card alone (owner, 2026-10-06): rent leads — late, coming or paid —
  // and every home says where it has got to, dates or not.
  const rent = (extra) => ({ tenancyId: "t1", name: "Unit 3D", amount: "GH₵4,500.00", dueOn: null, overdue: false, owedMinor: 0, ...extra });
  const one = { id: "t1", status: "active", starts_on: null, ends_on: null, name: "Unit 3D" };
  const highlightsFor = (input) => tenantHighlights({ tenancies: [one], now, date: (iso) => iso, ...input });
  assert.deepEqual(highlightsFor({ rent: rent({ dueOn: "2026-10-18" }) }).map((row) => row.headline), ["Rent due in 12 days", "Your home: Unit 3D"]);
  assert.deepEqual(highlightsFor({ rent: rent({ dueOn: "2026-10-03", overdue: true }) }).map((row) => [row.tag, row.to]), [["Overdue", "rent"], ["Tenancy", "tenancy"]]);
  assert.equal(highlightsFor({ rent: rent({}) })[0].headline, "You are paid up");
  assert.ok(highlightsFor({ rent: rent({}) }).length >= 2);
  assert.match(home, /if \(reading\.to === "rent" && tenancy\.lease\) onRentAccount\(tenancy\);/);

  // The applications half dial stays in the Overview, refined, and is not a highlight as well.
  assert.match(home, /\{applications \? <ApplicationDial total=\{applications\} accepted=\{accepted\} onPress=\{onApplications\} \/> : null\}\s*<StatCells>/);
  const dial = home.slice(home.indexOf("function ApplicationDial("), home.indexOf("function HomeRow("));
  assert.match(dial, /const angle = Math\.PI \+ share \* Math\.PI;/);
  assert.match(dial, /stroke=\{TONE\.kola\.ink\} strokeWidth=\{stroke\} strokeLinecap="round"/);
  assert.doesNotMatch(dial, /ph\.gold|strokeDasharray/);
  assert.doesNotMatch(read("mobile/src/tenantHomeWork.ts"), /applications accepted/);
});

test("mobile Home's chart keeps its reading, in the product's colours", () => {
  const home = read("mobile/app/(app)/(provider-tabs)/index.tsx");
  const chart = home.slice(home.indexOf("function RentCollection("), home.indexOf("function Figure("));

  // Still read by tapping a period, with haptics, and monthly or yearly.
  assert.match(chart, /setActive\(\(current\) => current === index \? null : index\);/);
  assert.match(chart, /haptics\.selectionAsync\(\)/);
  assert.match(chart, /setPeriod\(option\); setActive\(null\);/);
  assert.match(chart, /aria-selected=\{active === index\}/);
  // A tooltip beside the column it reads, so it never covers that reading.
  assert.match(chart, /const tipLeft = tipX > width \/ 2 \? Math\.max\(0, tipX - TIP - 12\) : Math\.min\(width - TIP, tipX \+ 12\);/);
  assert.match(chart, /<TipLine dot=\{COLLECTED\} label="Collected"/);
  // Money in is the brand's green, money owed is harmattan, gridlines are the ground's green.
  assert.match(home, /const COLLECTED = theme\.color\.kola\["600"\];/);
  assert.match(home, /const OWED = theme\.color\.harmattan\["500"\];/);
  assert.match(chart, /stroke=\{RULE\}/);
  assert.doesNotMatch(home, /#12181F|#0F1620|#B5822E|ph\.navy|ph\.gold/);
});

test("mobile Home's moves are ordered by what waiting costs", async () => {
  const { nextMoves, insights, ago } = await import("./dashboardWork.ts");
  const money = (minor) => `GH₵${minor / 100}`;
  const all = nextMoves({
    overdueMinor: 120000, settlementAttentionMinor: 5000, recordsToConfirm: 2, maintenanceAlerts: 1,
    requests: 3, viewingRequests: 4, draftAgreements: 1, propertiesToUpdate: 1, unreadEnquiries: 2, money,
  });
  assert.deepEqual(all.map((move) => move.key), ["overdue", "payout", "records", "repairs", "requests", "viewings", "drafts", "properties", "enquiries"]);
  assert.deepEqual(all.map((move) => move.tone), ["danger", "danger", "warning", "warning", "warning", "warning", "calm", "calm", "calm"]);
  assert.equal(all[0].title, "GH₵1200 overdue");
  assert.equal(all[2].title, "2 payment records to confirm");
  assert.equal(all[6].title, "1 agreement to send");
  // Nothing waiting is no moves at all, not a list of zeroes.
  assert.deepEqual(nextMoves({ overdueMinor: 0, settlementAttentionMinor: 0, recordsToConfirm: 0, maintenanceAlerts: 0, requests: 0, viewingRequests: 0, draftAgreements: 0, propertiesToUpdate: 0, unreadEnquiries: 0, money }), []);

  // Highlights say what follows, and only when there is something to say.
  // This month's collection is the rent ring's to say, never a highlight as well.
  const readings = insights({ units: 12, occupied: 10, vacant: 2, largest: { id: "p1", title: "Osu Heights", units: 6, occupied: 5 } });
  assert.deepEqual(readings.map((row) => row.headline), ["2 Units are empty", "Osu Heights is 83% let"]);
  assert.equal(readings[0].act, "Fill them");
  // Each card's corner arc is its reading: the empty share, and the largest Property's let share.
  assert.deepEqual(readings.map((row) => [row.tag, Math.round(row.share * 100)]), [["2 empty", 17], ["Largest", 83]]);
  assert.deepEqual(insights({ units: 0, occupied: 0, vacant: 0, largest: null }), []);
  assert.doesNotMatch(read("mobile/src/dashboardWork.ts"), /rent is in/);

  const now = new Date(2026, 9, 6, 12).getTime();
  assert.deepEqual([ago(new Date(2026, 9, 6, 8).toISOString(), now), ago(new Date(2026, 9, 5, 8).toISOString(), now), ago(new Date(2026, 9, 3, 8).toISOString(), now)], ["Today", "Yesterday", "3 days ago"]);
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
  const allowed = ["Agreed by both sides, all time", "Danpa HQ records rent."];
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

  // Tenancies and private access on one page: private access folds at the foot.
  assert.match(tenants, /title="Private access"/);
  assert.match(tenants, /Search tenants/);
  assert.match(tenants, /tenantWork\(all\)/);
  assert.match(tenants, /summary\?\.tenant_access/);
  assert.match(tenants, /provider-tenancy/);
  assert.doesNotMatch(tenants, /listUnits|listOrganizationProperties/);
  assert.doesNotMatch(tenants, /RequestLeaseActions|decidePropertyJoinRequest/);
  assert.match(requests, /summaries[\s\S]*flatMap\(\(summary\) => summary\.tenancy_requests/);
  assert.match(requests, /listReceivedApplications/);
  // Requests are worked through the leasing journey (owner, 2026-10-06): the
  // decision, the agreement, the tenant's turn, moving in — and Settled.
  assert.match(requests, /<Journey counts=\{work\.counts\}/);
  assert.match(requests, /"Your move"/);
  assert.match(requests, /"Waiting on others"/);
  assert.match(requests, /function SettledFold\(/);
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
