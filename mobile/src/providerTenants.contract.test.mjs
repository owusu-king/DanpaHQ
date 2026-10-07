/**
 * Provider Tenants, read as the people in the Portfolio's homes (owner,
 * 2026-10-06).
 *
 * Who needs the landlord leads — overdue rent, unfinished paperwork, rent coming
 * due — then who is moving in, whose term is ending, and everyone settled by the
 * Property they live in. Private access folds into one line at the foot. These
 * tests hold what makes it usable: one exact tenancy per row, the rent account
 * one tap from an overdue row, requests decided only in their inbox, and private
 * access that never drops a code that was just issued.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ENDING_DAYS, NEEDS_YOU, laneOf, monthlyRent, tenantWork, termShare } from "./tenantWork.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  const stop = source.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, `${end} is missing after ${start}`);
  return source.slice(at, stop);
};
const screen = () => code(read("app/(app)/(provider-tabs)/tenants.tsx"));

const NOW = new Date(2026, 9, 6, 12).getTime();
const day = (offset) => {
  const at = new Date(2026, 9, 6 + offset, 12);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
};
const tenant = (id, extra = {}) => ({
  occupancy_id: id, tenancy_id: `t-${id}`, tenancy_status: "active", name: extra.name ?? id, property_title: extra.property ?? "Osu Heights",
  unit_label: extra.unit ?? "Unit 1", bed_label: null, lease_id: `l-${id}`, lease_rent_minor: 300000, lease_rent_currency: "GHS", lease_rent_period: "monthly",
  lease_starts_on: day(-200), lease_ends_on: day(165), can_record_payment: true,
  ...extra,
  rent: { status: "current", outstanding_minor: 0, overdue_minor: 0, next_due_on: day(25), ...(extra.rent ?? {}) },
});

test("every tenancy lands in one lane, and money owed comes before paperwork", () => {
  assert.deepEqual(NEEDS_YOU, ["overdue", "paperwork", "due"]);
  assert.equal(laneOf(tenant("a", { rent: { status: "overdue", overdue_minor: 1 } }), NOW), "overdue");
  // Overdue wins over a missing agreement: the money is the bigger problem.
  assert.equal(laneOf(tenant("b", { lease_id: null, rent: { status: "overdue", overdue_minor: 1 } }), NOW), "overdue");
  assert.equal(laneOf(tenant("c", { tenancy_status: "pending_lease" }), NOW), "paperwork");
  assert.equal(laneOf(tenant("d", { lease_id: null }), NOW), "paperwork");
  assert.equal(laneOf(tenant("e", { rent: { status: "outstanding", outstanding_minor: 1 } }), NOW), "due");
  assert.equal(laneOf(tenant("f", { tenancy_status: "upcoming" }), NOW), "moving_in");
  assert.equal(laneOf(tenant("g", { lease_ends_on: day(ENDING_DAYS - 1) }), NOW), "ending");
  assert.equal(laneOf(tenant("h", { lease_ends_on: day(ENDING_DAYS + 2) }), NOW), "settled");

  const work = tenantWork([
    tenant("small", { rent: { status: "overdue", overdue_minor: 100 } }),
    tenant("big", { rent: { status: "overdue", overdue_minor: 900 } }),
    tenant("paper", { lease_id: null }),
    tenant("z", { property: "Osu Heights", unit: "Unit 10" }),
    tenant("y", { property: "Osu Heights", unit: "Unit 2" }),
    tenant("x", { property: "Labone Court" }),
  ], NOW);
  assert.deepEqual(work.needsYou.map((row) => row.occupancy_id), ["big", "small", "paper"]);
  assert.equal(work.overdueMinor, 1000);
  // Everyone settled, by Property A to Z, Units in their natural order.
  assert.deepEqual(work.byProperty.map((group) => [group.property, group.tenants.map((row) => row.unit_label)]), [["Labone Court", ["Unit 1"]], ["Osu Heights", ["Unit 2", "Unit 10"]]]);
});

test("rent reads per month, and a term reads as how far through it is", () => {
  assert.equal(monthlyRent(tenant("a", { lease_rent_minor: 2_400_000, lease_rent_period: "yearly" })), 200_000);
  assert.equal(monthlyRent(tenant("b", { lease_rent_minor: null })), null);
  const halfway = termShare(tenant("c", { lease_starts_on: day(-100), lease_ends_on: day(100) }), NOW);
  assert.ok(Math.abs(halfway - 0.5) < 0.01);
  assert.equal(termShare(tenant("d", { lease_ends_on: null }), NOW), null);
});

test("the page is a briefing, lanes and Properties, with no Filter sheet", () => {
  const source = screen();
  assert.doesNotMatch(source, /<BottomSheet|<ListHead|<SummaryPanel|<ChoiceRow|<ActiveFilter/);
  assert.match(source, /label\("needs", "Needs you", work\.needsYou\.length, LATERITE\);/);
  assert.match(source, /label\("moving", "Moving in", work\.movingIn\.length\);/);
  assert.match(source, /label\("ending", "Ending soon", work\.ending\.length\);/);
  assert.match(source, /for \(const group of work\.byProperty\) \{\s*label\(`property:\$\{group\.property\}`, group\.property, group\.tenants\.length\);/);
  assert.match(source, /title=\{needs \? `\$\{needs\} \$\{needs === 1 \? "tenancy needs" : "tenancies need"\} you` : "Everyone is paid up"\}/);
  // Search earns its place past a glance, and reaches the person, the Property, the Unit and the bed.
  assert.match(source, /trailing=\{all\.length >= SEARCH_FROM/);
  assert.match(source, /\[tenant\.name, tenant\.property_title, tenant\.unit_label, tenant\.bed_label\]/);
  assert.match(source, /<SearchField label="Search tenants" placeholder="Name, Property, Unit or bed" value=\{query\} onChangeText=\{setQuery\} \/>/);
});

test("each row is one exact tenancy, and an overdue one opens its rent account", () => {
  const source = screen();
  const row = between(source, "function TenantRow(", "function AccessCard(");
  assert.match(source, /key: `\$\{prefix\}:\$\{tenant\.occupancy_id\}`/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/provider-tenancy", params: \{ tenancyId: tenant\.tenancy_id \?\? tenant\.occupancy_id, organizationId \} \} as never\)/);
  assert.match(row, /accessibilityRole="link"/);
  assert.match(row, /const place = \[tenant\.property_title, tenant\.unit_label, tenant\.bed_label\]\.filter\(Boolean\)\.join\(" · "\);/);
  assert.match(row, /\{lane === "overdue" && tenant\.lease_id \? \(\s*<Acts>\s*<Act label="Rent account" icon="wallet-outline" primary onPress=\{onAccount\} \/>/);
  assert.match(source, /pathname: "\/\(app\)\/rent-account",[\s\S]{0,260}canRecord: tenant\.can_record_payment \? "1" : "0"/);
  // What is owed is the row's figure while it is owed; the rent otherwise.
  assert.match(row, /lane === "overdue"\s*\? formatMinor\(tenant\.rent\.overdue_minor, currency\)/);
  assert.match(row, /: lane === "paperwork"\s*\? "No agreement yet"/);
});

test("a request is decided in its inbox; the page only says one is waiting", () => {
  const source = screen();
  assert.match(source, /const pendingRequests = summary \? summary\.tenancy_requests\.filter\(\(request\) => request\.status === "pending" && inScope\(request, scope\)\)\.length : 0;/);

  // Opened from a Unit or a Property, the page is about that one (owner,
  // 2026-10-06): its tenants, requests and access, with a chip that says so
  // and clears back to everyone. A Unit wins over its Property.
  assert.match(source, /unitId: requestedUnit, propertyId: requestedProperty/);
  assert.match(source, /if \(unitId\) return \{ kind: "unit", id: unitId \};\s*if \(propertyId\) return \{ kind: "property", id: propertyId \};/);
  assert.match(source, /const all = useMemo\(\(\) => \(summary\?\.tenants \?\? \[\]\)\.filter\(\(row\) => inScope\(row, scope\)\), \[summary, scope\]\);/);
  assert.match(source, /\{scope \? <ScopeChip label=\{scopeName\} unit=\{scope\.kind === "unit"\} onClear=\{clearScope\} \/> : null\}/);
  assert.match(source, /router\.setParams\(\{ unitId: undefined, propertyId: undefined \} as never\);/);
  assert.match(source, /label="Show every tenant" onPress=\{clearScope\}/);
  // And the Unit and Property pages open it narrowed.
  const read2 = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  assert.match(read2("app/(app)/space.tsx"), /pathname: "\/\(app\)\/\(provider-tabs\)\/tenants", params: \{ unitId: unit\.id, scopeLabel: /);
  assert.match(read2("app/(app)/provider-property.tsx"), /pathname: "\/\(app\)\/\(provider-tabs\)\/tenants", params: \{ propertyId: property\.id, scopeLabel: property\.title \}/);
  // A Unit with nobody in it says so, and opens on its private access.
  assert.match(source, /scope && !all\.length \? \(\s*<Calm icon=\{scope\.kind === "unit" \? "key-outline" : "business-outline"\} text=\{scope\.kind === "unit" \? "Nobody lives here yet\./);
  assert.match(source, /onPress: \(\) => router\.push\("\/\(app\)\/provider-applications" as never\)/);
  assert.match(source, /<SignalPanel signals=\{signals\} \/>/);
  assert.match(source, /if \(requestedView === "requests"\) router\.replace\("\/\(app\)\/provider-applications" as never\);/);
  assert.doesNotMatch(source, /RequestLeaseActions|decidePropertyJoinRequest/);
});

test("Private access folds into one line, stays short, and never drops a code that was just issued", () => {
  const source = screen();
  assert.match(source, /const ACCESS_PREVIEW = 3;/);
  assert.match(source, /access\.filter\(\(value\) => value\.condition_state === "approved" && value\.availability\.state === "available"\)/);
  assert.match(source, /title="Private access"/);
  assert.match(source, /ready\.slice\(0, ACCESS_PREVIEW\)\.forEach\(\(access\) => out\.push\(\{ kind: "card", key: `card:\$\{access\.unit_id\}`, access \}\)\);/);
  // Arriving with view=access opens the fold, as it once opened that view.
  assert.match(source, /if \(requestedView === "access"\) setAccessOpen\(true\);/);
  assert.match(source, /useState\(requestedView === "access" \|\| Boolean\(requestedUnit\)\)/);

  const card = between(source, "function AccessCard(", "function AccessFooter(");
  assert.match(
    card,
    /<UnitAccessCodeManagement\s+unitId=\{access\.unit_id\}\s+accessCode=\{access\.access_code\}\s+verified=\{access\.condition_state === "approved"\}\s+occupied=\{access\.availability\.state === "occupied"\}\s+onChanged=\{onChanged\}\s+layout="card"\s+\/>/,
  );
  assert.match(source, /onChanged=\{load\}/);
  assert.match(source, /const SHARING = privateAccess\(\{ state: "not_created", expires_at: null, can_rotate: true, can_revoke: false \}, \{ verified: true, occupied: false \}\)\.detail;/);
  assert.match(source, /<Footnote>\{SHARING\}<\/Footnote>/);

  const footer = between(source, "function AccessFooter(", "function TenantsSkeleton(");
  assert.match(footer, /const capped = ready > shown;/);
  assert.match(footer, /`Showing \$\{shown\} of \$\{ready\} ready to share`/);
  assert.match(footer, /<QuietAction icon="grid-outline" label="See all Units" onPress=\{onUnits\} \/>/);
  // No Unit ready: the key, struck, with the way to fix it.
  assert.match(source, /<Empty\s+compact\s+icon="key-outline"\s+title="No Units ready to share privately"/);
  assert.match(source, /label="Review Properties" onPress=\{\(\) => router\.push\("\/\(app\)\/\(provider-tabs\)\/properties" as never\)\}/);

  // A failed refresh keeps the Units on screen, so an issued code is not unmounted.
  assert.doesNotMatch(between(source, "} catch (cause) {", "} finally {"), /setSummary\(/);
});

test("the page keeps everything it could do, and says when there is nothing", () => {
  const source = screen();
  assert.match(source, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /const organization = organizations\.find\(\(row\) => row\.id === preferredId\) \?\? organizations\[0\];/);
  assert.match(source, /accessibilityRole="progressbar" accessibilityLabel="Loading tenants"/);
  assert.match(source, /<Empty\s+icon="people-outline"\s+title="No tenants yet"/);
  assert.match(source, /<Empty icon="search-outline" title="No matching tenants"/);
});

test("Payments and Tenants are built from one kit, so they cannot drift", () => {
  for (const path of ["app/(app)/(provider-tabs)/tenants.tsx", "app/(app)/(provider-tabs)/payments.tsx"]) {
    const source = code(read(path));
    assert.match(source, /\} from "@\/components\/portfolio\/PortfolioList";/, path);
    assert.match(source, /\} from "@\/components\/work\/WorkParts";/, path);
    assert.doesNotMatch(
      source,
      /function (SummaryPanel|Figure|FigureGrid|SignalPanel|InfoNote|ListHead|SearchField|QuietAction|ListRow|RowLine|Briefing|Fold|Empty|Face|Bar)\(/,
      `${path} keeps its own copy of a shared part`,
    );
    assert.doesNotMatch(source, /const (GLASS|EDGE|RULE|MUTED|FAINT|PANEL_RADIUS) = /, `${path} keeps its own glass`);
  }
});

test("a tenancy's initials keep their colour legibly", () => {
  const tokens = JSON.parse(read("../packages/design-tokens/tokens.json"));
  const source = screen();
  const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const token = (family, step) => channels(tokens.color[family][step].value);
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((value) => {
      const unit = value / 255;
      return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  assert.match(source, /overdue: \{ ink: LATERITE, wash: theme\.color\.laterite\["100"\] \},/);
  assert.match(source, /moving_in: \{ ink: LAGOON, wash: theme\.color\.lagoon\["100"\] \},/);
  assert.match(source, /settled: \{ ink: KOLA_DEEP, wash: theme\.color\.kola\["50"\] \},/);
  for (const [ink, wash, label] of [
    [token("laterite", "600"), token("laterite", "100"), "overdue"],
    [token("harmattan", "600"), token("harmattan", "100"), "paperwork, due or ending"],
    [token("lagoon", "600"), token("lagoon", "100"), "moving in"],
    [token("kola", "800"), token("kola", "50"), "settled"],
  ]) {
    assert.ok(contrast(ink, wash) >= 4.5, label);
  }
});
