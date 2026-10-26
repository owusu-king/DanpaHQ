/**
 * Tenancy requests, as the work they are (owner, 2026-10-06).
 *
 * The page was an inbox of records: a summary panel, a Filter sheet slicing by
 * stage and source, and rows that named a status. It is now a briefing — how
 * much waits on the provider and for how long — the leasing journey as the only
 * filter, then "Your move" with the evidence and the next step on each row,
 * "Waiting on others", and the settled history folded into one line.
 *
 * Most of these tests run the meaning module itself (`requestQueue.ts`), so
 * they hold what the page decides about a request, not how it is spelled.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  JOURNEY,
  daysSince,
  evidenceFor,
  isNew,
  isYourMove,
  nextStep,
  phaseOf,
  queue,
  readyToDecide,
  shortAge,
  standingLine,
  viewingFor,
  waitingSince,
} from "./requestQueue.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const screen = () => code(read("app/(app)/provider-applications.tsx"));

const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const application = (status, extra = {}) => ({
  key: `application:${extra.id ?? "a"}`,
  kind: "application",
  application: {
    id: "a", status, listing_id: "l", applicant_name: "Kwame Asante", listing_headline: "Flat", property_title: "Osu Heights",
    unit_label: "Unit 4B", locality_name: "Osu", advance_months_asked: 12, advance_months_offered: 12, meets_advance: true,
    created_at: ago(5), decided_at: null, concluded_at: null, ...extra.application,
  },
  lease: extra.lease ?? null,
  viewing: extra.viewing ?? { state: "none" },
});
const direct = (status, extra = {}) => ({
  key: `private:${extra.id ?? "r"}`,
  kind: "private",
  organizationId: "org",
  request: {
    id: "r", requester_display: "Adwoa Nyarko", property_title: "Labone Court", unit_label: "Room 4", bed_label: "Bed 2",
    status, lease_id: null, lease_status: null, created_at: ago(2), can_manage: true, ...extra,
  },
});
const lease = (status, extra = {}) => ({ id: "lease", status, created_at: ago(2), tenant_accepted_at: null, activation_requirement: "initial_payment", ...extra });

test("every request lands on one step of the leasing journey", () => {
  assert.deepEqual(JOURNEY.map((step) => step.phase), ["decide", "agreement", "tenant", "moving"]);
  assert.equal(phaseOf(application("submitted")), "decide");
  assert.equal(phaseOf(application("under_review")), "decide");
  assert.equal(phaseOf(application("accepted")), "agreement");
  assert.equal(phaseOf(application("accepted", { lease: lease("draft") })), "agreement");
  assert.equal(phaseOf(application("accepted", { lease: lease("ready") })), "agreement");
  assert.equal(phaseOf(application("accepted", { lease: lease("offered") })), "tenant");
  assert.equal(phaseOf(application("accepted", { lease: lease("tenant_accepted") })), "moving");
  assert.equal(phaseOf(application("accepted", { lease: lease("awaiting_activation") })), "moving");
  assert.equal(phaseOf(application("accepted", { lease: lease("active") })), "settled");
  assert.equal(phaseOf(application("rejected")), "settled");
  assert.equal(phaseOf(application("withdrawn")), "settled");
  // An accepted application whose agreement ended is history, whatever its status says.
  assert.equal(phaseOf(application("accepted", { application: { concluded_at: ago(1) } })), "settled");
  // Direct requests walk the same journey.
  assert.equal(phaseOf(direct("pending")), "decide");
  assert.equal(phaseOf(direct("approved")), "agreement");
  assert.equal(phaseOf(direct("approved", { lease_id: "x", lease_status: "offered" })), "tenant");
});

test("the provider's move is a decision, an agreement, or a tenant waiting to be confirmed", () => {
  assert.equal(isYourMove(application("submitted")), true);
  assert.equal(isYourMove(application("accepted")), true);
  assert.equal(isYourMove(application("accepted", { lease: lease("tenant_accepted") })), true);
  assert.equal(isYourMove(application("accepted", { lease: lease("offered") })), false);
  assert.equal(isYourMove(application("accepted", { lease: lease("awaiting_activation") })), false);

  assert.deepEqual(nextStep(application("submitted")), { kind: "decide" });
  assert.deepEqual(nextStep(application("accepted")), { kind: "prepare", label: "Prepare agreement" });
  assert.deepEqual(nextStep(application("accepted", { lease: lease("draft") })), { kind: "lease", label: "Send agreement", leaseId: "lease" });
  assert.deepEqual(nextStep(application("accepted", { lease: lease("tenant_accepted") })), { kind: "lease", label: "Confirm move-in", leaseId: "lease" });
  assert.equal(nextStep(application("accepted", { lease: lease("offered") })), null);
  // Only an Owner, Admin or the assigned manager may answer a direct request.
  assert.equal(nextStep(direct("pending", { can_manage: false })), null);
  assert.equal(standingLine(direct("pending", { can_manage: false })), "Needs an Owner, Admin or its manager");
});

test("the queue puts the longest wait first, and settles the rest out of the way", () => {
  const old = application("submitted", { id: "old", application: { id: "old", created_at: ago(9) } });
  const fresh = application("submitted", { id: "fresh", application: { id: "fresh", created_at: ago(0) } });
  const sent = application("accepted", { id: "sent", application: { id: "sent" }, lease: lease("offered") });
  const done = application("rejected", { id: "done", application: { id: "done" } });
  const work = queue([fresh, sent, done, old]);
  assert.deepEqual(work.yours.map((item) => item.key), ["application:old", "application:fresh"]);
  assert.deepEqual(work.theirs.map((item) => item.key), ["application:sent"]);
  assert.deepEqual(work.settled.map((item) => item.key), ["application:done"]);
  assert.deepEqual(work.counts, { decide: 2, agreement: 0, tenant: 1, moving: 0 });

  // A wait is measured from the step it is on: a confirmation from when the tenant accepted.
  const confirming = application("accepted", { lease: lease("tenant_accepted", { tenant_accepted_at: ago(1) }) });
  assert.equal(daysSince(waitingSince(confirming)), 1);
  assert.equal(shortAge(0), "Today");
  assert.equal(shortAge(5), "5d");
  assert.equal(shortAge(21), "3w");
});

test("a row carries what the decision turns on, and offers it only when the evidence is in", () => {
  const when = () => "Wed 30 Sept";
  const viewed = application("submitted", { viewing: { state: "viewed", at: ago(6) } });
  assert.deepEqual(evidenceFor(viewed, when).map((row) => row.text), ["Meets 12-month advance", "Viewed Wed 30 Sept"]);
  const short = application("submitted", { application: { meets_advance: false, advance_months_offered: 6 }, viewing: { state: "requested" } });
  assert.deepEqual(evidenceFor(short, when).map((row) => [row.text, row.tone]), [["Offers 6 of 12 months", "caution"], ["Viewing requested", "quiet"]]);
  assert.deepEqual(evidenceFor(direct("pending"), when).map((row) => row.text), ["Holds the Unit's access code"]);
  // Past the decision, the outcome says more than the evidence did.
  assert.deepEqual(evidenceFor(application("accepted"), when), []);

  assert.equal(readyToDecide(viewed), true);
  assert.equal(readyToDecide(short), false);
  assert.equal(readyToDecide(application("submitted", { viewing: { state: "upcoming", at: ago(-2) } })), false);
  assert.equal(readyToDecide(direct("pending")), true);
  assert.equal(readyToDecide(direct("pending", { can_manage: false })), false);

  const source = screen();
  assert.match(source, /step\?\.kind === "decide" \? \(readyToDecide\(item\) \? \(/);
  assert.match(source, /<Act label="Accept" icon="checkmark" primary onPress=\{\(\) => onDecide\("accept"\)\} \/>/);
  // A decision begun on the row is confirmed, with its note, on the record.
  assert.match(source, /\.\.\.\(decide \? \{ decide \} : \{\}\),/);
  const record = code(read("app/(app)/provider-application.tsx"));
  assert.match(record, /useState<Mode>\(decide === "accept" \|\| decide === "decline" \? decide : "none"\)/);
  assert.match(record, /const focused = mode !== "none" && open && mayManage;/);
});

test("a viewing joins an application only where the same person asked to see the same listing", () => {
  const app = { listing_id: "l1", applicant_name: "Kwame Asante" };
  const viewing = (status, extra = {}) => ({ listing_id: "l1", tenant_name: "Kwame Asante", status, confirmed_starts_at: null, is_upcoming: false, checked_in_at: null, ...extra });
  assert.deepEqual(viewingFor(app, []), { state: "none" });
  assert.deepEqual(viewingFor(app, [viewing("requested")]), { state: "requested" });
  assert.deepEqual(viewingFor(app, [viewing("completed", { checked_in_at: "2026-10-01T10:00:00Z" })]), { state: "viewed", at: "2026-10-01T10:00:00Z" });
  // A visit still ahead wins over one already made.
  assert.equal(viewingFor(app, [viewing("completed"), viewing("confirmed", { is_upcoming: true, confirmed_starts_at: "2026-10-09T10:00:00Z" })]).state, "upcoming");
  // Somebody else's viewing of the same listing says nothing about this applicant.
  assert.deepEqual(viewingFor(app, [viewing("completed", { tenant_name: "Efua Mensah" })]), { state: "none" });
});

test("new means new since the last visit, and never everything on the first", () => {
  const item = application("submitted", { application: { created_at: ago(1) } });
  assert.equal(isNew(item, null), false);
  assert.equal(isNew(item, ago(2)), true);
  assert.equal(isNew(item, ago(0)), false);
  const source = screen();
  assert.match(source, /void secure\.get\(seenKey\)\.then/);
  assert.match(source, /void secure\.set\(seenKey, new Date\(\)\.toISOString\(\)\)/);
  assert.match(source, /\.replace\(\/\[\^A-Za-z0-9\._-\]\/g, "_"\)/);
});

test("the page is a briefing with the journey as its only filter", () => {
  const source = screen();
  // No Filter sheet, no stage x source slicing, no standing search box.
  assert.doesNotMatch(source, /<BottomSheet|<ChoiceRow|<FilterGroup|<ListHead\b|<SummaryPanel|setSource/);
  assert.match(source, /<Journey counts=\{work\.counts\} focus=\{focus\} onFocus=\{toggleFocus\} \/>/);
  assert.match(source, /setFocus\(\(current\) => \(current === phase \? null : phase\)\);/);
  assert.match(source, /aria-selected=\{selected\}/);
  // Search appears only once there is more than a glance can take in, and reads everything.
  assert.match(source, /const SEARCH_FROM = 9;/);
  assert.match(source, /canSearch=\{items\.length >= SEARCH_FROM\}/);
  assert.match(source, /if \(needle\) \{\s*const found = items/);
  // Sections cap themselves, so 500 requests read like 5.
  assert.match(source, /const SHOWN = \{ yours: 8, theirs: 4, settled: 6 \} as const;/);
  assert.match(source, /section\("yours", "Your move", yours, LATERITE\);\s*section\("theirs", "Waiting on others", theirs\);/);
  assert.match(source, /if \(!focus && !yours\.length\) out\.unshift\(\{ kind: "calm", key: "calm" \}\);/);
  assert.match(source, /"You're all caught up"/);
});

test("the Portfolio on screen, loading, nothing yet and a failure are each handled", () => {
  const source = screen();
  assert.match(source, /useBlankOnPortfolioSwitch\(activeContext, \(\) => \{\s*setSummaries\(null\);\s*setApplications\(null\);\s*setLeases\(\[\]\);\s*\}\);/);
  assert.match(source, /listReceivedApplications\(false, scope\),\s*listGrantedLeases\(scope\),/);
  // Viewings are evidence: their failure never takes the decisions with it.
  assert.match(source, /listReceivedViewings\(false, scope\)\.catch\(\(\) => \[\] as Viewing\[\]\)/);
  assert.match(source, /\}, \[activeContext\]\);/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /accessibilityRole="progressbar" accessibilityLabel="Loading tenancy requests"/);
  // Nothing yet: the page's own glyph, large and struck, with one way on.
  assert.match(source, /<Empty\s+icon="document-text-outline"\s+title="No tenancy requests yet"/);
  assert.match(source, /label="Tenants" onPress=\{\(\) => router\.push\("\/\(app\)\/\(provider-tabs\)\/tenants" as never\)\}/);
  assert.match(source, /<Empty icon="search-outline" title="No matching requests"/);
  assert.match(source, /pathname: "\/\(app\)\/provider-application",/);
});
