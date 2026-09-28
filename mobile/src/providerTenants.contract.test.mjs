/**
 * Provider Tenants, refined on review (2026-09-15).
 *
 * The same reading order as Payments — how many need attention, anything waiting,
 * then one list — built from the same Portfolio parts. These tests hold what makes
 * it usable rather than decorative: one Filter control in place of tabs and a row
 * of choices, filters that still mean what they meant, tenancies grouped by whether
 * they need attention, rows that say one exact tenancy's rent and term and open
 * it, requests decided only in their inbox, and a Private access view that stays
 * short and never drops a code that was just issued.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
const kit = () => code(read("src/components/portfolio/PortfolioList.tsx"));

test("one Filter control holds both views and every status", () => {
  const source = screen();

  // No tabs, and no row of choices across the page.
  assert.doesNotMatch(source, /accessibilityRole="tab"|accessibilityRole="tablist"|function TenantTab|<Choice\b/);

  assert.match(source, /<ListHead title=\{VIEW_LABEL\[view\]\} count=\{view === "access" \? readyCount : tenants\.length\} filters=\{activeFilters\} onFilter=\{\(\) => setFiltering\(true\)\} \/>/);
  assert.match(source, /const activeFilters = view === "tenants" && filter !== "all" \? 1 : 0;/);
  assert.match(source, /<BottomSheet\s+visible=\{filtering\}\s+onClose=\{\(\) => setFiltering\(false\)\}\s+title="Filter"\s+hideTitle\s+closeLabel="Close filter"/);

  const sheet = between(source, "<BottomSheet", "</BottomSheet>");
  assert.match(sheet, /<FilterGroup title="Show">\s*\{VIEWS\.map\(/);
  assert.match(sheet, /count=\{value === "tenants" \? all\.length : readyCount\}/);
  assert.match(sheet, /onPress=\{\(\) => setView\(value\)\}/);
  // Statuses only for the list they can filter.
  assert.match(sheet, /\{view === "tenants" \? \(\s*<FilterGroup title="Status">\s*\{FILTERS\.map\(/);
  assert.match(sheet, /count=\{filterCount\(value\)\}/);
  assert.match(sheet, /onPress=\{\(\) => setFilter\(value\)\}/);

  // It closes on what it will show; Reset returns to where the page opens.
  assert.match(sheet, /results=\{results\}/);
  assert.match(source, /const results = view === "access" \? shownAccess\.length : tenants\.length;/);
  assert.match(sheet, /onReset=\{\(\) => \{ setView\("tenants"\); setFilter\("all"\); setQuery\(""\); \}\}/);

  // What is on is said on the page, with the way to take it off.
  assert.match(
    source,
    /\{view === "tenants" && filter !== "all" \? \(\s*<ActiveFilter label=\{FILTER_LABEL\[filter\]\} tone=\{FILTER_TONE\[filter\]\} onClear=\{\(\) => setFilter\("all"\)\} \/>/,
  );
});

test("the filters and the search mean what they meant", () => {
  const source = screen();

  const match = between(source, "function matchesFilter(", "function tenantNeedsAttention(");
  assert.match(match, /if \(filter === "attention"\) return tenantNeedsAttention\(tenant\);/);
  assert.match(match, /if \(filter === "overdue"\) return tenant\.rent\.status === "overdue";/);
  assert.match(match, /if \(filter === "current"\) return tenant\.rent\.status === "current" && tenant\.tenancy_status === "active";/);
  assert.match(source, /function tenantNeedsAttention\(tenant: Tenant\) \{\s*return tenant\.tenancy_status === "pending_lease" \|\| !tenant\.lease_id \|\| tenant\.rent\.status !== "current";\s*\}/);

  // The list and the sheet's counts ask the same question.
  assert.match(source, /\.filter\(\(tenant\) => matchesFilter\(tenant, filter\)\)/);
  assert.match(source, /const filterCount = \(value: TenantFilter\) => all\.filter\(\(tenant\) => matchesFilter\(tenant, value\)\)\.length;/);

  // Search reaches the person, the Property, the Unit and the bed, and says so.
  assert.match(source, /\[tenant\.name, tenant\.property_title, tenant\.unit_label, tenant\.bed_label\]/);
  assert.match(source, /<SearchField label="Search tenants" placeholder="Name, Property, Unit or bed" value=\{query\} onChangeText=\{setQuery\} \/>/);

  // Each status in the colour it carries elsewhere.
  assert.match(source, /const FILTER_TONE[^;]*attention: HARMATTAN,\s*overdue: LATERITE,\s*current: KOLA,/);
});

test("tenancies are grouped: what needs attention leads, then what is on track", () => {
  const source = screen();

  const sections = between(source, "const sections = useMemo<Section[]>(", "}, [shownAccess, summary, tenants, view]);");
  assert.match(sections, /const attention = tenants\.filter\(tenantNeedsAttention\);/);
  assert.match(sections, /const track = tenants\.filter\(\(tenant\) => !tenantNeedsAttention\(tenant\)\);/);
  assert.match(
    sections,
    /\.\.\.\(attention\.length \? \[\{ key: "attention" as const, title: "Needs attention", data: attention\.map[\s\S]*\.\.\.\(track\.length \? \[\{ key: "track" as const, title: "On track", data: track\.map/,
  );
  // Within the list, attention first and then by name, as before.
  assert.match(source, /\.sort\(\(a, b\) => Number\(tenantNeedsAttention\(b\)\) - Number\(tenantNeedsAttention\(a\)\) \|\| a\.name\.localeCompare\(b\.name\)\)/);

  // A group's name and size sit above it, and its rows read as one glass panel.
  assert.match(source, /<GroupLabel count=\{section\.data\.length\}>\{section\.title\}<\/GroupLabel>/);
  assert.match(source, /<ListRow first=\{index === 0\} last=\{index === section\.data\.length - 1\}>/);
  assert.match(source, /stickySectionHeadersEnabled=\{false\}/);

  // The figures lead with how many need attention, and overdue money is part of it.
  assert.match(source, /<SummaryPanel\s+label="Needs attention"\s+value=\{attentionCount \? String\(attentionCount\) : "None"\}\s+note=\{summary\.money\.overdue_minor > 0/);
  assert.match(source, /const attentionCount = all\.filter\(tenantNeedsAttention\)\.length;/);
  assert.match(source, /\{ label: "Tenancies", value: String\(all\.length\) \},\s*\{ label: "Paid up", value: String\(filterCount\("current"\)\) \},/);
});

test("each row is one exact tenancy: its rent, its term, and the way into it", () => {
  const source = screen();
  const row = between(source, "function TenantRow(", "function AccessCard(");

  assert.match(source, /keyExtractor=\{\(item\) => item\.kind === "tenant" \? item\.value\.occupancy_id : item\.value\.unit_id\}/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/provider-tenancy", params: \{ tenancyId: item\.value\.tenancy_id \?\? item\.value\.occupancy_id, organizationId \} \} as never\)/);
  assert.match(row, /accessibilityRole="link"/);

  // A screen reader hears the whole tenancy, not only the name.
  assert.match(
    row,
    /\$\{tenant\.name\}, \$\{tenancyLabel\(tenant\)\}, \$\{\[tenant\.property_title, tenant\.unit_label, tenant\.bed_label\]\.filter\(Boolean\)\.join\(", "\)\}, \$\{rentLabel\(tenant\)\}\$\{term \? `, \$\{term\}` : ""\}/,
  );

  // What is owed and how it stands end their lines, which never cut them short.
  assert.match(row, /<RowLine\s+start=\{<Type variant="bodyStrong" numberOfLines=\{1\} style=\{rowStyles\.rowTitle\}>\{tenant\.name\}<\/Type>\}\s+end=\{<Type variant="bodyStrong" numberOfLines=\{1\} style=\{\[rowStyles\.rowAmount/);
  assert.match(row, /end=\{status \? <Type variant="caption" numberOfLines=\{1\} style=\{\[rowStyles\.rowStatus, \{ color: standing\.statusInk \}\]\}>\{status\}<\/Type> : undefined\}/);
  // On the narrowest phones only a paid-up row's next date gives way; what is owed never does.
  assert.match(row, /const status = standing\.paid && narrow \? "" : standing\.status;/);
  assert.match(between(kit(), "export function RowLine(", "export function EmptyState("), /<View style=\{styles\.lineEnd\}>\{end\}<\/View>/);

  // The exact place, down to the bed.
  assert.match(row, /const place = \[tenant\.property_title, tenant\.unit_label, tenant\.bed_label\]\.filter\(Boolean\)\.join\(" · "\);/);

  // The term: an agreement still needed says so; otherwise when it starts or ends.
  assert.match(row, /\{agreementNeeded \? "Agreement needed" : term \|\| tenancyLabel\(tenant\)\}/);
  const term = between(source, "function termOf(", "function onDay(");
  assert.match(term, /if \(tenant\.tenancy_status === "pending_lease" \|\| !tenant\.lease_id\) return "";/);
  assert.match(term, /`Starts \$\{onDay\(tenant\.lease_starts_on, narrow\)\}`/);
  assert.match(term, /`Ends \$\{onDay\(tenant\.lease_ends_on, narrow\)\}`/);

  // Overdue says its overdue amount in laterite; outstanding says when it is due.
  const standing = between(source, "function standingOf(", "function termOf(");
  assert.match(standing, /if \(tenant\.rent\.status === "overdue"\) \{\s*return \{ figure: formatMinor\(tenant\.rent\.overdue_minor, currency\), status: "Overdue", statusInk: LATERITE,/);
  assert.match(standing, /figure: formatMinor\(tenant\.rent\.outstanding_minor, currency\),\s*status: tenant\.rent\.next_due_on \? `Due \$\{shortDate\(tenant\.rent\.next_due_on\)\}` : "Outstanding",\s*statusInk: HARMATTAN,/);

  // The words a screen reader hears for rent and tenancy are the ones they were.
  assert.match(source, /if \(tenant\.rent\.status === "current"\) return "Paid up";/);
  assert.match(source, /return `\$\{formatMinor\(amount, tenant\.lease_rent_currency \?\? "GHS"\)\} \$\{tenant\.rent\.status\}`;/);
  assert.match(source, /if \(tenant\.tenancy_status === "pending_lease" \|\| !tenant\.lease_id\) return "Agreement needed";/);
});

test("a request is decided in its inbox; the page only says one is waiting", () => {
  const source = screen();

  assert.match(source, /const pendingRequests = summary \? summary\.tenancy_requests\.filter\(\(request\) => request\.status === "pending"\)\.length : 0;/);
  assert.match(source, /onPress: \(\) => router\.push\("\/\(app\)\/provider-applications" as never\)/);
  assert.match(source, /<SignalPanel signals=\{signals\} \/>/);
  assert.match(source, /if \(requestedView === "requests"\) router\.replace\("\/\(app\)\/provider-applications" as never\);/);
  assert.doesNotMatch(source, /RequestLeaseActions|decidePropertyJoinRequest/);
});

test("Private access stays short and never drops a code that was just issued", () => {
  const source = screen();

  assert.match(source, /const ACCESS_PREVIEW = 3;/);
  assert.match(source, /summary \? summary\.tenant_access\.filter\(\(value\) => value\.condition_state === "approved" && value\.availability\.state === "available"\) : \[\]/);
  assert.match(source, /const shownAccess = useMemo\(\(\) => ready\.slice\(0, ACCESS_PREVIEW\), \[ready\]\);/);

  const card = between(source, "function AccessCard(", "function AccessFooter(");
  assert.match(
    card,
    /<UnitAccessCodeManagement\s+unitId=\{access\.unit_id\}\s+accessCode=\{access\.access_code\}\s+verified=\{access\.condition_state === "approved"\}\s+occupied=\{access\.availability\.state === "occupied"\}\s+onChanged=\{onChanged\}\s+layout="card"\s+\/>/,
  );
  assert.match(source, /onChanged=\{load\}/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/space", params: \{ propertyId: item\.value\.property_id, unitId: item\.value\.unit_id \} \} as never\)/);

  // In a card that already names the Unit: no second title, the state in one line
  // with its whole meaning still spoken, and every act the section has. The Unit
  // screen keeps the section.
  const management = code(read("src/components/property/UnitAccessCodeManagement.tsx"));
  assert.match(management, /layout = "section",/);
  // The section names itself with a group label now, in the record kit's
  // voice. The card still must not carry a title of its own.
  assert.match(management, /<GroupLabel>Private access<\/GroupLabel>/);
  const cardLayout = between(management, 'if (layout === "card") {', "<GroupLabel>Private access</GroupLabel>");
  assert.doesNotMatch(cardLayout, /variant="title2"/);
  assert.doesNotMatch(cardLayout, /<GroupLabel>/);

  // One act at a time reports that it is working. A single shared flag made
  // every control spin when any one was pressed, so revoking a code looked as
  // though it were rotating it too.
  assert.match(management, /const \[running, setRunning\] = useState<"rotate" \| "revoke" \| null>\(null\);/);
  assert.match(management, /busy=\{running === "rotate"\} disabled=\{busy\}/);
  assert.match(management, /busy=\{running === "revoke"\} disabled=\{busy\}/);
  assert.match(cardLayout, /accessibilityLabel=\{`\$\{view\.headline\}\. \$\{view\.detail\}`\}/);
  assert.match(cardLayout, /<Notice tone="success" title=\{notice\.title\} body=\{notice\.body\} \/>\s*<View style=\{styles\.codeWell\}>\s*<Type variant="mono" selectable/);
  assert.match(cardLayout, /<CardAct label="Share code"[^>]*onPress=\{share\}/);
  assert.match(cardLayout, /<CardAct label=\{view\.primary\}[^>]*onPress=\{\(\) => void rotate\(\)\}/);
  assert.match(cardLayout, /<CardAct label="Revoke"[^>]*onPress=\{\(\) => void revoke\(\)\}/);
  assert.match(cardLayout, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.doesNotMatch(code(read("app/(app)/space.tsx")), /layout=/);

  // What a code lets someone do is said once, in the meaning module's own words.
  assert.match(source, /const SHARING = privateAccess\(\{ state: "not_created", expires_at: null, can_rotate: true, can_revoke: false \}, \{ verified: true, occupied: false \}\)\.detail;/);
  assert.match(source, /\{view === "access" && shownAccess\.length \? <Footnote>\{SHARING\}<\/Footnote> : null\}/);

  // What is off screen is said once, with the way to all of it.
  const footer = between(source, "function AccessFooter(", "function Empty(");
  assert.match(footer, /const capped = ready > shown;/);
  assert.match(footer, /if \(!capped && unavailable <= 0\) return null;/);
  assert.match(footer, /`Showing \$\{shown\} of \$\{ready\} ready to share`/);
  assert.match(footer, /<QuietAction icon="grid-outline" label="See all Units" onPress=\{onUnits\} \/>/);
  assert.match(source, /onUnits=\{\(\) => router\.push\("\/\(app\)\/units" as never\)\}/);
  assert.match(between(source, "function Empty(", "function matchesFilter("), /title="No Units ready to share privately"[\s\S]*label="Review Properties" onPress=\{onProperties\}/);
  assert.match(source, /onProperties=\{\(\) => router\.push\("\/\(app\)\/\(provider-tabs\)\/properties" as never\)\}/);

  // A failed refresh keeps the Units on screen, so an issued code is not unmounted.
  assert.doesNotMatch(between(source, "} catch (cause) {", "}, [activeContext]);"), /setSummary\(/);
});

test("the page keeps everything it could do", () => {
  const source = screen();

  assert.match(source, /type ViewName = "tenants" \| "access";/);
  assert.match(source, /useState<ViewName>\(requestedView === "access" \? "access" : "tenants"\)/);
  assert.match(source, /<SectionList<Row, Section>/);
  assert.match(source, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /const organization = organizations\.find\(\(row\) => row\.id === preferredId\) \?\? organizations\[0\];/);
  assert.match(source, /title=\{hasTenants \? "No matching tenants" : "No active tenancies"\}/);
});

test("Payments and Tenants are built from one kit, so they cannot drift", () => {
  for (const path of ["app/(app)/(provider-tabs)/tenants.tsx", "app/(app)/(provider-tabs)/payments.tsx"]) {
    const source = code(read(path));
    assert.match(source, /\} from "@\/components\/portfolio\/PortfolioList";/, path);
    assert.doesNotMatch(
      source,
      /function (SummaryPanel|Figure|FigureGrid|SignalPanel|AttentionPanel|InfoNote|ListHead|FilterButton|ActiveFilter|SearchField|QuietAction|ListRow|RowLine|RowSeparator|EmptyState|FilterGroup|ChoiceRow|SheetFooter)\(/,
      `${path} keeps its own copy of a shared part`,
    );
    assert.doesNotMatch(source, /const (GLASS|EDGE|RULE|MUTED|FAINT|PANEL_RADIUS) = /, `${path} keeps its own glass`);
  }
  const source = screen();
  assert.match(source, /<ChoiceRow\s+key=\{value\}/);
  assert.match(source, /footer=\{<SheetFooter\s/);
});

test("a tenancy's initials keep their colour legibly", () => {
  const tokens = JSON.parse(read("../packages/design-tokens/tokens.json"));
  const source = screen();
  const parts = kit();

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
  const stepOf = (name, family) => new RegExp(`export const ${name} = theme\\.color\\.${family}\\["(\\d+)"\\];`).exec(parts)?.[1];

  const standing = between(source, "function standingOf(", "function termOf(");
  assert.match(standing, /ink: LATERITE, wash: theme\.color\.laterite\["100"\]/);
  assert.match(standing, /ink: HARMATTAN,\s*wash: theme\.color\.harmattan\["100"\]/);
  assert.match(standing, /ink: attention \? HARMATTAN : KOLA_DEEP,\s*wash: attention \? theme\.color\.harmattan\["100"\] : theme\.color\.kola\["50"\]/);

  for (const [name, family, wash] of [["LATERITE", "laterite", "100"], ["HARMATTAN", "harmattan", "100"], ["KOLA_DEEP", "kola", "50"]]) {
    const step = stepOf(name, family);
    assert.ok(step, `${name} is not a ${family} token`);
    assert.ok(contrast(token(family, step), token(family, wash)) >= 4.5, `${name} initials on their ${family} ${wash} wash`);
  }
});
