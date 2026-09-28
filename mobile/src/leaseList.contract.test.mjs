/**
 * Leases, refined on review (2026-09-15), for the provider who grants agreements
 * and the tenant who holds them.
 *
 * One route, two readers, one shape: glass groups, rows that never cut an amount
 * or a status short, and one green Filter control found at a glance. These tests
 * hold what the redesign must not lose — the provider's stages, now with every
 * canonical status; what "waiting for tenant" means; the tenant's decision first,
 * with Review only while it is open; and empty states whose animation gives way
 * to anybody who has asked for less motion.
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
const screen = () => code(read("app/(app)/leases.tsx"));
const kit = () => code(read("src/components/portfolio/PortfolioList.tsx"));
const meaning = () => code(read("src/providerLeaseMeaning.ts"));
const provider = () => between(screen(), "function ProviderLeasesScreen(", "type AgreementRowData");
const tenant = () => between(screen(), "function TenantLeasesScreen(", "function shortDate(");

test("both readers get one green Filter instead of tabs", () => {
  const source = screen();
  const parts = kit();

  assert.doesNotMatch(source, /accessibilityRole="tab"|accessibilityRole="tablist"|function LeaseTab|function TenantAgreementFilters/);
  assert.match(provider(), /<ListHead title=\{VIEW_LABEL\[view\]\} count=\{matching\.length\} filters=\{view === "all" \? 0 : 1\} filterTone="kola" onFilter=\{\(\) => setFiltering\(true\)\} \/>/);
  assert.match(tenant(), /<ListHead title=\{FILTER_TITLE\[filter\]\} count=\{counts\[filter\]\} filters=\{filter === "all" \? 0 : 1\} filterTone="kola" onFilter=\{\(\) => setFiltering\(true\)\} \/>/);
  assert.equal(
    (source.match(/<BottomSheet\s+visible=\{filtering\}\s+onClose=\{\(\) => setFiltering\(false\)\}\s+title="Filter"\s+hideTitle\s+closeLabel="Close filter"/g) ?? []).length,
    2,
    "each reader has the one shared sheet",
  );

  // The green pill: a kola ground, white words and glyph, and a white badge when a filter is on.
  const button = between(parts, "export function FilterButton(", "export function ActiveFilter(");
  assert.match(button, /kola \? styles\.filterButtonKola : active \? styles\.filterButtonActive : null/);
  assert.match(button, /color=\{kola \? WHITE : active \? KOLA_DEEP : MUTED\}/);
  assert.match(button, /color: kola \? WHITE : active \? KOLA_DEEP : INK/);
  assert.match(button, /kola \? styles\.filterBadgeKola : null/);
  assert.match(parts, /filterButtonKola: \{\s*borderColor: KOLA,\s*backgroundColor: KOLA,\s*\}/);
  // Payments and Tenants keep their glass pill until they ask for green.
  assert.match(button, /tone = "glass"/);
});

test("the provider's stages hold every canonical status, and the list and the record say the same", () => {
  const rules = meaning();
  assert.match(
    rules,
    /return \["draft", "ready"\]\.includes\(lease\.status\)\s*\? "send"\s*: \["offered", "tenant_accepted", "awaiting_activation", "active"\]\.includes\(lease\.status\)\s*\? "current"\s*: "history";/,
  );
  for (const [status, label] of [
    ["draft", "Draft"],
    ["ready", "Ready to send"],
    ["offered", "Waiting for tenant"],
    ["tenant_accepted", "Confirmation needed"],
    ["awaiting_activation", "Awaiting activation"],
    ["active", "Active tenancy"],
    ["declined", "Declined"],
    ["cancelled", "Withdrawn"],
    ["ended", "Ended"],
  ]) {
    assert.match(rules, new RegExp(`${status}: "${label}",`), status);
  }

  // The agreement screen reads the same words and colours from the same place.
  const record = code(read("app/(app)/provider-lease.tsx"));
  assert.match(record, /from "@\/providerLeaseMeaning";/);
  assert.match(record, /return providerLeaseStatus\(lease\);/);
  assert.match(record, /const tone = providerLeaseTone\(lease\);/);
  assert.doesNotMatch(record, /tenant_accepted: "/);

  const source = provider();
  assert.match(screen(), /const STAGES: readonly ProviderLeaseStage\[\] = \["send", "current", "history"\];/);
  assert.match(source, /\.filter\(\(lease\) => view === "all" \|\| providerLeaseStage\(lease\) === view\)/);
  assert.match(source, /\(view === "all" \? STAGES : \[view\]\)/);
  assert.match(source, /title: view === "all" \? VIEW_LABEL\[stage\] : undefined/);

  // The sheet: All and every stage, each with its count, closing on what it will show.
  assert.match(source, /\{\(\["all", \.\.\.STAGES\] as const\)\.map\(\(value, index\) => \(/);
  assert.match(source, /count=\{stageCount\(value\)\}/);
  assert.match(source, /onPress=\{\(\) => setView\(value\)\}/);
  assert.match(source, /results=\{matching\.length\}/);
  assert.match(source, /onReset=\{\(\) => \{ setView\("all"\); setQuery\(""\); \}\}/);
});

test("what is running leads, and waiting for the tenant means offered and nothing else", () => {
  const source = provider();
  assert.match(source, /<SummaryPanel\s+label="Active"\s+value=\{String\(active\)\}/);
  assert.match(source, /const active = all\.filter\(\(lease\) => lease\.status === "active"\)\.length;/);
  assert.match(source, /const awaiting = all\.filter\(\(lease\) => lease\.status === "offered"\)\.length;/);
  assert.match(source, /const toSend = stageCount\("send"\);/);
  assert.match(source, /const toConfirm = all\.filter\(\(lease\) => lease\.status === "tenant_accepted"\)\.length;/);
  assert.match(source, /note=\{onYou \? \{ text: onYou, tone: "alert" \} : \{ text: "Nothing waiting on you", tone: "calm" \}\}/);
  assert.match(source, /\{ label: "Waiting for tenant", value: String\(awaiting\) \},\s*\{ label: "All agreements", value: String\(all\.length\) \},/);
});

test("a provider's row says who, where, how much and where it stands, and opens the record", () => {
  const source = screen();
  const row = between(source, "function ProviderLeaseRow(", "function ProviderEmpty(");

  assert.match(
    row,
    /accessibilityLabel=\{`\$\{tenant\}\. \$\{place\.join\(", "\)\}\. \$\{status\}\. \$\{rent \? `\$\{rent\} per \$\{period\}` : "Rent not recorded"\}\. \$\{when\}\. Open agreement\.`\}/,
  );
  assert.match(row, /end=\{rent \? <Type variant="bodyStrong" numberOfLines=\{1\} style=\{rowStyles\.rowAmount\}>\{rent\}<\/Type> : undefined\}/);
  assert.match(row, /end=\{<Type variant="caption" numberOfLines=\{1\} style=\{\[rowStyles\.rowStatus, \{ color: tone\.text \}\]\}>\{status\}<\/Type>\}/);
  assert.match(row, /const tone = TONE\[providerLeaseTone\(lease\)\];/);
  // On the narrowest phones the space keeps its whole line, and the status moves under it.
  assert.match(source, /<ProviderLeaseRow lease=\{item\} narrow=\{density\.veryCompact\}/);
  assert.match(row, /\{narrow \? \(/);
  assert.match(
    row,
    /<Type variant="caption" numberOfLines=\{1\} style=\{rowStyles\.rowSub\}>\{place\.join\(" · "\)\}<\/Type>\s*<Type variant="caption" numberOfLines=\{2\} style=\{rowStyles\.rowMeta\}>\s*<Type variant="caption" style=\{\[rowStyles\.rowStatus, \{ color: tone\.text \}\]\}>\{status\}<\/Type>/,
  );
  assert.match(between(kit(), "export function RowLine(", "export function EmptyState("), /<View style=\{styles\.lineEnd\}>\{end\}<\/View>/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/provider-lease", params: \{ leaseId: item\.id \} \} as never\)/);
  assert.match(source, /\.sort\(\(a, b\) => b\.created_at\.localeCompare\(a\.created_at\)\)/);
  assert.match(source, /<SearchField label="Search agreements" placeholder="Tenant, Property or Unit" value=\{query\} onChangeText=\{setQuery\} \/>/);

  // The place is exact, down to the bed, and the frozen agreement wins where there is one.
  const rules = meaning();
  assert.match(rules, /terms\?\.space\.bed_label \?\? lease\.bed_label,/);
  assert.match(rules, /return money \? formatMinor\(money\.rent_minor, money\.rent_currency\) : lease\.rent_formatted;/);

  // The one date that matters now.
  const when = between(rules, "export function providerLeaseWhen(", "export function leaseSearchText(");
  assert.match(when, /\["offered", "tenant_accepted", "awaiting_activation"\]\.includes\(lease\.status\)/);
  assert.match(when, /`Starts \$\{formatLeaseDate\(startsOn\)\}`/);
  assert.match(when, /endsOn \? `Ends \$\{formatLeaseDate\(endsOn\)\}` : `Since \$\{formatLeaseDate\(startsOn\)\}`/);
  assert.match(when, /return `Prepared \$\{formatLeaseDate\(lease\.created_at\)\}`;/);
});

test("a tenant sees what needs deciding first, and Review only while they may still decide", () => {
  const source = tenant();
  assert.match(screen(), /const TENANT_STAGES: readonly AgreementStage\[\] = \["action", "active", "past"\];/);
  assert.match(screen(), /action: "Needs your decision",/);
  assert.match(source, /\.filter\(\(stage\) => matchesAgreementFilter\(stage, filter\)\)/);
  assert.match(source, /title: filter === "all" \? STAGE_TITLE\[stage\] : undefined/);
  assert.match(source, /tone=\{section\.key === "action" \? KOLA_DEEP : undefined\}/);

  const row = between(source, "function TenantAgreementRow(", "function TenantEmpty(");
  assert.match(row, /const decide = state\.decisionOpen;/);
  assert.match(row, /\{decide \? \(\s*<View style=\{styles\.review\}>\s*<Type variant="captionStrong" style=\{styles\.reviewText\}>Review<\/Type>/);
  assert.match(
    row,
    /accessibilityLabel=\{`\$\{homeOf\(terms\)\}\. With \$\{terms\.landlordName\}\. \$\{money\(terms\.rentMinor, terms\.rentCurrency\)\} per \$\{per\(terms\.rentPeriod\)\}\. \$\{state\.line\}\.`\}/,
  );

  // Five of the six questions: which home, with whom, how much, for how long, what needs deciding.
  assert.match(row, /\{homeOf\(terms\)\}/);
  assert.match(row, /With \{terms\.landlordName\}/);
  assert.match(
    row,
    /<Type variant="bodyStrong" style=\{rowStyles\.rowAmount\}>\{money\(terms\.rentMinor, terms\.rentCurrency\)\}<\/Type>\s*\{` \/ \$\{per\(terms\.rentPeriod\)\}`\}\s*\{` · \$\{months\(terms\.termMonths\)\}`\}/,
  );
  assert.match(row, /\{money\(terms\.moveInTotalMinor, terms\.rentCurrency\)\} to move in/);
  assert.match(row, /\{terms\.startsOn \? ` · starts \$\{shortDate\(terms\.startsOn\)\}` : ""\}/);
  assert.match(row, /\{` · \$\{months\(terms\.termMonths\)\}`\}/);
  assert.match(row, /\{state\.line\}/);

  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/agreement\/\[id\]", params: \{ id: lease\.id \} \}\);/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
});

test("the tenant's Filter is the shared agreement filters, with their counts", () => {
  const source = tenant();
  assert.match(source, /\{agreementFilters\.map\(\(option, index\) => \(/);
  assert.match(source, /count=\{counts\[option\.id\]\}/);
  assert.match(source, /onPress=\{\(\) => setFilter\(option\.id\)\}/);
  assert.match(source, /results=\{counts\[filter\]\}/);
  assert.match(source, /onReset=\{\(\) => setFilter\("all"\)\}/);
  assert.match(source, /action: rows\.filter\(\(row\) => row\.state\.stage === "action"\)\.length,/);
});

test("an empty list's animation gives way to anybody who asked for less motion", () => {
  const parts = kit();
  const empty = between(parts, "export function EmptyState(", "export function initialsOf(");
  assert.match(empty, /const reduceMotion = useReduceMotion\(\);/);
  assert.match(empty, /\{art && !reduceMotion \? \(/);
  assert.match(empty, /accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/);
  assert.match(empty, /<Image source=\{art\} resizeMode="contain" style=\{styles\.art\} \/>/);
  assert.match(empty, /<Ionicons name=\{icon\} size=\{20\} color=\{KOLA\} \/>/);
  // Where the whole page is empty, the glyph sits large in the disc an animation would use.
  assert.match(empty, /const disc = hero \|\| Boolean\(art\);/);
  assert.match(empty, /<Ionicons name=\{icon\} size=\{36\} color=\{KOLA\} \/>/);
  assert.match(screen(), /<EmptyState icon=\{VIEW_ICON\.all\} hero title="No agreements yet"/);
  assert.match(screen(), /<EmptyState\s+icon=\{FILTER_ICON\.all\}\s+hero\s+title="No agreements yet"/);

  const source = screen();
  assert.match(between(source, "function ProviderEmpty(", "type AgreementRowData"), /title="No agreements yet"[\s\S]*action=\{requests\}/);
  assert.match(source, /label="Open tenancy requests" onPress=\{onRequests\}/);
  assert.match(source, /onRequests=\{\(\) => router\.push\("\/\(app\)\/provider-applications" as never\)\}/);
  assert.match(between(source, "function TenantEmpty(", "function shortDate("), /Nothing binds you until you accept\./);
});

test("both readers keep everything the page could do", () => {
  const source = screen();
  assert.match(source, /capabilities\.active_workspace === "provider"/);
  assert.equal((source.match(/refreshControl=\{<RefreshControl refreshing=\{refreshing\}/g) ?? []).length, 2, "pull to refresh");
  assert.equal((source.match(/\{error \? <Notice tone="error" title=\{error\} \/> : null\}/g) ?? []).length, 2, "load failures said");
  assert.equal(
    (source.match(/items === null \? <Type variant="caption" style=\{styles\.loading\}>Loading…<\/Type> : error \? null : \(/g) ?? []).length,
    2,
    "loading said, and no empty state claimed after a failure",
  );
  assert.match(provider(), /setItems\(null\);/);
  assert.match(provider(), /listGrantedLeases\(preferred \? \{ organization: preferred \} : undefined\)/);
  assert.match(tenant(), /setItems\(await listMyLeases\(\)\);/);
});

test("every status keeps its colour legibly, on glass and on its wash", () => {
  const tokens = JSON.parse(read("../packages/design-tokens/tokens.json"));
  const parts = kit();
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
  const stepOf = (name, family) => {
    const step = new RegExp(`export const ${name} = theme\\.color\\.${family}\\["(\\d+)"\\];`).exec(parts)?.[1];
    assert.ok(step, `${name} is not a ${family} token`);
    return step;
  };

  assert.match(source, /good: \{ text: KOLA, ink: KOLA_DEEP, wash: theme\.color\.kola\["50"\] \},/);
  assert.match(source, /attention: \{ text: LATERITE, ink: LATERITE, wash: theme\.color\.laterite\["100"\] \},/);
  assert.match(source, /waiting: \{ text: HARMATTAN, ink: HARMATTAN, wash: theme\.color\.harmattan\["100"\] \},/);
  assert.match(source, /muted: \{ text: MUTED, ink: theme\.color\.ink\["700"\], wash: theme\.color\.field\["100"\] \},/);

  for (const [ink, wash, label] of [
    [token("laterite", stepOf("LATERITE", "laterite")), token("laterite", "100"), "initials waiting on the provider"],
    [token("harmattan", stepOf("HARMATTAN", "harmattan")), token("harmattan", "100"), "initials waiting on somebody else"],
    [token("kola", stepOf("KOLA_DEEP", "kola")), token("kola", "50"), "initials of a running tenancy"],
    [token("ink", "700"), token("field", "100"), "initials of a closed agreement"],
  ]) {
    assert.ok(contrast(ink, wash) >= 4.5, label);
  }

  // White words on the green Filter and on the Review pill.
  assert.ok(contrast(token("field", "0"), token("kola", stepOf("KOLA", "kola"))) >= 4.5, "white on kola");
});
