/**
 * Agreements, for the provider who grants them and the tenant who holds them.
 *
 * The provider's page is read as work (owner, 2026-10-06): the monthly rent the
 * running agreements bring in, what waits on the provider with the step on the
 * row, the agreements being signed with their four steps drawn, tenancies whose
 * term is running out, and everything running with how far through its term it
 * is. The tenant's keeps the review-era shape (2026-09-15): one green Filter,
 * what needs deciding first, Review only while it is open.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ENDING_DAYS,
  agreementWork,
  laneOf,
  monthlyRentMinor,
  nextAct,
  signingLine,
  stepsDone,
  termProgress,
} from "./agreementWork.ts";
import { TENANT_STEPS, laneOf as tenantLane, stepsDone as tenantSteps, termOf } from "./tenantAgreementWork.ts";

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
const provider = () => code(read("src/components/agreements/ProviderAgreements.tsx"));
const kit = () => code(read("src/components/portfolio/PortfolioList.tsx"));
const work = () => code(read("src/components/work/WorkParts.tsx"));
const meaning = () => code(read("src/providerLeaseMeaning.ts"));
const tenant = () => code(read("src/components/agreements/TenantAgreements.tsx"));

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-06T12:00:00Z");
const date = (days) => new Date(NOW + days * DAY).toISOString().slice(0, 10);
const lease = (status, extra = {}) => ({
  id: extra.id ?? status, status, created_at: extra.created_at ?? "2026-09-01T10:00:00Z", activation_requirement: "initial_payment",
  rent_minor: 300000, rent_currency: "GHS", rent_period: "monthly", starts_on: date(-90), ends_on: date(275), term_months: 12, agreement: null, ...extra,
});

test("every agreement lands in one lane, by whose move it is and how much term is left", () => {
  assert.equal(laneOf(lease("draft"), NOW), "yours");
  assert.equal(laneOf(lease("ready"), NOW), "yours");
  assert.equal(laneOf(lease("tenant_accepted"), NOW), "yours");
  assert.equal(laneOf(lease("offered"), NOW), "signing");
  assert.equal(laneOf(lease("awaiting_activation"), NOW), "signing");
  assert.equal(laneOf(lease("active"), NOW), "running");
  // A day either side of the line, so no time zone can move a date across it.
  assert.equal(laneOf(lease("active", { ends_on: date(ENDING_DAYS - 1) }), NOW), "ending");
  assert.equal(laneOf(lease("active", { ends_on: date(ENDING_DAYS + 2) }), NOW), "running");
  for (const status of ["declined", "cancelled", "ended"]) assert.equal(laneOf(lease(status), NOW), "closed", status);
  // The frozen agreement's term wins over the lease's own fields.
  assert.equal(laneOf(lease("active", { agreement: { terms: { term: { starts_on: date(-300), ends_on: date(10), term_months: 12 }, money: { rent_minor: 1, rent_currency: "GHS", rent_period: "monthly" } } } }), NOW), "ending");
});

test("the provider's step is on the row, and the steps of signing are drawn", () => {
  assert.deepEqual(nextAct(lease("draft")), { label: "Send agreement", icon: "send-outline" });
  assert.deepEqual(nextAct(lease("ready")), { label: "Send agreement", icon: "send-outline" });
  assert.deepEqual(nextAct(lease("tenant_accepted")), { label: "Confirm move-in", icon: "checkmark-done-outline" });
  assert.equal(nextAct(lease("offered")), null);
  assert.deepEqual(["draft", "offered", "tenant_accepted", "awaiting_activation", "active"].map((status) => stepsDone({ status })), [1, 2, 3, 3, 4]);
  assert.equal(signingLine(lease("awaiting_activation")), "Accepted — waiting for the first payment");
  assert.equal(signingLine({ status: "awaiting_activation", activation_requirement: "lease_accepted" }), "Accepted — waiting to activate");

  const row = between(provider(), "function AgreementRow(", "function shortDate(");
  assert.match(row, /<Segments total=\{SIGNING_STEPS\.length\} done=\{stepsDone\(lease\)\} tone=\{look\.ink\} \/>/);
  assert.match(row, /<Act label=\{act\.label\} icon=\{act\.icon\} primary onPress=\{onOpen\} \/>/);
  assert.match(row, /<Bar value=\{progress\?\.share \?\? 1\} tone=\{look\.ink\} \/>/);
  // Both steps happen on the agreement itself.
  assert.match(provider(), /router\.push\(\{ pathname: "\/\(app\)\/provider-lease", params: \{ leaseId: lease\.id \} \} as never\)/);
});

test("a running term says which month of how many, and the rent roll adds yearly to monthly", () => {
  const halfway = termProgress(lease("active", { starts_on: date(-182), ends_on: date(183), term_months: 12 }), NOW);
  assert.ok(halfway && Math.abs(halfway.share - 0.5) < 0.01);
  assert.deepEqual([halfway.month, halfway.months], [6, 12]);
  assert.equal(termProgress(lease("active", { ends_on: null }), NOW), null);

  assert.deepEqual(monthlyRentMinor(lease("active", { rent_minor: 2_400_000, rent_period: "yearly" })), { minor: 200_000, currency: "GHS" });
  const lanes = agreementWork([
    lease("active", { id: "a", rent_minor: 300_000 }),
    lease("active", { id: "b", rent_minor: 2_400_000, rent_period: "yearly", ends_on: date(20) }),
    lease("offered", { id: "c" }),
    lease("draft", { id: "d" }),
  ], NOW);
  assert.deepEqual(lanes.rentRoll, { minor: 500_000, currency: "GHS" });
  assert.deepEqual([lanes.yours, lanes.signing, lanes.ending, lanes.running].map((rows) => rows.map((row) => row.id)), [["d"], ["c"], ["b"], ["a"]]);
  assert.equal(agreementWork([lease("draft")], NOW).rentRoll, null);
});

test("the provider's page is a briefing, lanes and a fold, with no Filter sheet", () => {
  const source = provider();
  assert.match(screen(), /return provider \? <ProviderAgreementsScreen \/> : <TenantAgreementsScreen \/>;/);
  assert.doesNotMatch(source, /<BottomSheet|<ListHead|<SummaryPanel|<ChoiceRow/);
  assert.match(source, /figure=\{work\.rentRoll \? formatMinor\(work\.rentRoll\.minor, work\.rentRoll\.currency\)\.replace\(\/\\\.00\$\/, ""\) : undefined\}/);
  assert.match(source, /for \(const section of \["yours", "signing", "ending", "running"\] as const\)/);
  assert.match(source, /yours: \{ title: "Your move", ink: LATERITE/);
  assert.match(source, /ending: \{ title: "Ending soon", ink: HARMATTAN/);
  assert.match(source, /title="Closed"/);
  assert.match(source, /if \(!work\.yours\.length && out\.length\) out\.unshift\(\{ kind: "calm", key: "calm" \}\);/);
  // Search earns its place only once there is more than a glance can take in.
  assert.match(source, /trailing=\{all\.length >= SEARCH_FROM/);
  assert.match(source, /<SearchField label="Search agreements" placeholder="Tenant, Property or Unit"/);

  // The place stays exact, down to the bed, and the frozen agreement wins.
  const rules = meaning();
  assert.match(rules, /terms\?\.space\.bed_label \?\? lease\.bed_label,/);
  assert.match(rules, /return money \? formatMinor\(money\.rent_minor, money\.rent_currency\) : lease\.rent_formatted;/);
});

test("a tenant sees their decision first, then their home and its term", () => {
  assert.deepEqual(["offered", "tenant_accepted", "awaiting_activation", "active", "declined", "cancelled", "ended"].map((status) => tenantLane({ status })), ["decide", "finalising", "finalising", "home", "past", "past", "past"]);
  assert.deepEqual(TENANT_STEPS, ["Offered", "You accepted", "Landlord confirmed", "In place"]);
  assert.deepEqual(["offered", "tenant_accepted", "awaiting_activation", "active"].map((status) => tenantSteps({ status })), [1, 2, 3, 4]);
  const term = termOf({ startsOn: "2026-01-01", endsOn: "2026-12-31", termMonths: 12 }, Date.parse("2026-07-02T12:00:00"));
  assert.deepEqual([term.month, term.months], [6, 12]);
  assert.equal(termOf({ startsOn: "2026-01-01", endsOn: null, termMonths: 12 }), null);

  const source = tenant();
  assert.match(source, /<Section title="Needs your decision" tone=\{LATERITE\} rows=\{lanes\.decide\} lane="decide" onOpen=\{open\} \/>/);
  const row = between(source, "function AgreementRow(", "function AgreementsSkeleton(");
  // The list offers the review, never the decision: accepting happens there, after the terms.
  assert.match(row, /<Act label="Review agreement" icon="document-text-outline" primary onPress=\{onOpen\} \/>/);
  assert.doesNotMatch(source, /acceptLease|declineLease|Accept agreement/);
  assert.match(row, /\$\{money\(terms\.moveInTotalMinor, terms\.rentCurrency\)\} to move in/);
  assert.match(row, /With \{terms\.landlordName\}/);
  assert.match(row, /.Month \$\{term\.month\} of \$\{term\.months\} · ends /);
  assert.match(row, /<Segments total=\{TENANT_STEPS\.length\} done=\{stepsDone\(row\.lease\)\} tone=\{LAGOON\} \/>/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/agreement\/\[id\]", params: \{ id: lease\.id \} \}\);/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.doesNotMatch(source, /<BottomSheet|<ListHead|agreementFilters/);
});

test("nothing yet is the page's own glyph, struck, with one way on", () => {
  const empty = between(work(), "export function Empty(", "export function Age(");
  assert.match(work(), /export const EMPTY_CLAY = "#CC9B8B";/);
  assert.match(empty, /const strike = crossed && !done;/);
  assert.match(empty, /<Ionicons name=\{icon\} size=\{size\} color=\{ink\} \/>/);
  assert.doesNotMatch(empty, /borderRadius|backgroundColor: ink/);
  assert.match(provider(), /<Empty\s+icon="document-text-outline"\s+title="No agreements yet"/);
  assert.match(provider(), /label="Open tenancy requests" onPress=\{\(\) => router\.push\("\/\(app\)\/provider-applications" as never\)\}/);
  assert.match(provider(), /<Empty icon="search-outline" title="No matching agreements"/);
  assert.match(tenant(), /<Empty\s+icon="document-text-outline"\s+title="No agreements yet"\s+hint="When a landlord sends one, it waits here for you\. Nothing binds you until you accept\."/);
});

test("both readers keep everything the page could do", () => {
  assert.match(screen(), /capabilities\.active_workspace === "provider"/);
  for (const page of [tenant(), provider()]) {
    assert.match(page, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
    assert.match(page, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  }
  assert.match(provider(), /setItems\(null\);/);
  assert.match(provider(), /listGrantedLeases\(preferred \? \{ organization: preferred \} : undefined\)/);
  assert.match(provider(), /accessibilityRole="progressbar" accessibilityLabel="Loading agreements"/);
  assert.match(tenant(), /setItems\(await listMyLeases\(\)\);/);
});

test("every lane keeps its colour legibly on its wash", () => {
  const tokens = JSON.parse(read("../packages/design-tokens/tokens.json"));
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
  const source = provider();
  assert.match(source, /wash: theme\.color\.laterite\["100"\]/);
  assert.match(source, /wash: theme\.color\.harmattan\["100"\]/);
  assert.match(source, /wash: theme\.color\.lagoon\["100"\]/);
  for (const [ink, wash, label] of [
    [token("laterite", "600"), token("laterite", "100"), "the provider's move"],
    [token("harmattan", "600"), token("harmattan", "100"), "a term running out"],
    [token("lagoon", "600"), token("lagoon", "100"), "being signed"],
    [token("kola", "600"), token("kola", "50"), "running"],
    [token("ink", "700"), token("field", "100"), "closed"],
  ]) {
    assert.ok(contrast(ink, wash) >= 4.5, label);
  }
  assert.ok(contrast(token("field", "0"), token("kola", "800")) >= 4.5, "white on the step");
});
