/**
 * The record pages, and the warm ground they stand on.
 *
 * The index pages stand on Rooomly's green with frosted-glass panels. A record
 * — one viewing, one agreement, one tenancy, one request — is a pushed screen
 * on the warm ivory the app has always used there, and 72%-white glass over
 * `field-50` lifts by about one percent. So these pages get the same vocabulary
 * in a warm dialect: paper panels, warm hairlines, the house's own elevation.
 *
 * What is pinned here is the part a redesign keeps losing: which surface a
 * record stands on, that a page offers one act rather than a column of buttons,
 * and that the two viewing records can propose the several times the backend
 * accepts rather than the one both clients used to send.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const kit = () => read("src/components/record/RecordSurfaces.tsx");
const offer = () => read("src/components/record/TimeOffer.tsx");

const RECORDS = [
  "viewing/[id].tsx",
  "provider-viewing.tsx",
  "application/[id].tsx",
  "agreement/[id].tsx",
  "provider-lease.tsx",
  "tenancy.tsx",
  "provider-tenancy.tsx",
  "provider-application.tsx",
];

test("a record stands on paper, not on the dashboard's glass", () => {
  const source = kit();
  assert.match(source, /export const PAPER = theme\.color\.field\["0"\];/);
  // The dashboards' card on the record's green (owner, 2026-10-06): a hairline of
  // the ground's own green, 20pt corners, and title-case section names.
  assert.match(source, /export const EDGE = alpha\(theme\.color\.kola\["900"\], 0\.09\);/);
  assert.match(source, /export const PANEL_RADIUS = 20;/);
  assert.match(source, /<Type variant="title2" accessibilityRole="header" style=\{styles\.groupLabel\}>\{children\}<\/Type>/);
  assert.doesNotMatch(source, /children\.toUpperCase\(\)/);
  // The house rule for depth: a very subtle shadow on iOS, hairlines on Android.
  assert.match(source, /\.\.\.surfaceElevation,/);
  // The green ground's glass must not be borrowed onto ivory, where it is
  // invisible. The tone tokens are palette steps and are shared deliberately.
  assert.doesNotMatch(code(source), /GLASS/);

  // And no record page reaches for the index pages' ground.
  for (const page of RECORDS) {
    assert.doesNotMatch(read(`app/(app)/${page}`), /IndexGround/, `${page} stands on the green`);
  }
});

test("whoever is proposing times may propose the several the backend accepts", () => {
  const source = offer();
  // `offer_slots` takes one to five. Both clients used to send exactly one,
  // which made the other side's "Pick a time" a list of one.
  assert.match(source, /export const MAX_SLOTS = 5;/);
  assert.match(source, /const full = chosen\.length >= MAX_SLOTS;/);
  assert.match(source, /if \(chosen\.includes\(iso\)\)/, "a duplicate time is refused");
  assert.match(source, /verb: "Offer" \| "Suggest"/, "a landlord offers; a tenant suggests");
  // Re-offering replaces what was proposed before — deliberate, and the times
  // it will replace are named here rather than counted, so the landlord can see
  // what is already on the table.
  assert.match(source, /already proposed, so nobody picks from a stale list/);
  assert.match(source, /replacing\.map\(\(iso\) =>/);
  assert.match(source, /replacing: string\[\]/);

  // And the provider's record shows the times they offered while it waits.
  const provider = read("app/(app)/provider-viewing.tsx");
  assert.match(provider, /<GroupLabel>Times you offered<\/GroupLabel>/);
  assert.match(provider, /!viewing\.actions\.can_confirm_slot && viewing\.slots\.length/);

  // Both viewing records use it, and hand the whole list to the endpoint.
  assert.match(read("app/(app)/provider-viewing.tsx"), /offerViewingSlots\(viewing\.id, \{ slots \}\)/);
  assert.match(read("app/(app)/provider-viewing.tsx"), /rescheduleViewing\(viewing\.id, slots\)/);
  assert.match(read("app/(app)/viewing/[id].tsx"), /rescheduleViewing\(viewing\.id, slots\)/);
});

test("the ways out of a viewing are one question, not three buttons", () => {
  const tenant = read("app/(app)/viewing/[id].tsx");
  // Rescheduling, cancelling and withdrawing all ask "should this go ahead",
  // so they share one entry and each takes the page when chosen.
  assert.match(tenant, /label="Change or cancel"/);
  assert.match(tenant, /label="Suggest another time"/);
  assert.match(tenant, /label="Cancel this viewing"/);
  assert.match(tenant, /label="Withdraw the request"/);
  assert.match(tenant, /mode === "withdraw"/);

  const provider = read("app/(app)/provider-viewing.tsx");
  assert.match(provider, /label="Change or cancel"/);
  assert.match(provider, /label="Offer different times"/);
  assert.match(provider, /label="Cancel appointment"/);
});

test("a decision that follows a reading is not put in a floating bar", () => {
  // Every other record answers "what do I do now" and keeps its act under the
  // thumb. The agreement answers "should I sign this", which is a question you
  // finish reading before you answer — so its decision sits at the foot.
  const agreement = read("app/(app)/agreement/[id].tsx");
  assert.doesNotMatch(agreement, /<ActionBar/);
  assert.match(agreement, /<Decision lease=\{lease\}/);
  assert.match(agreement, /<GroupLabel>Your decision<\/GroupLabel>/);

  // The provider's copy of the same record *is* a queue item, so it keeps one.
  const provider = read("app/(app)/provider-lease.tsx");
  assert.match(provider, /<ActionBar>/);
  // These are the one act the status is waiting on, chosen in `primaryAct`.
  assert.match(provider, /label: "Send agreement"/);
  assert.match(provider, /label: "Confirm and activate"/);
});

test("the irreversible acts wait behind one quiet way in", () => {
  const provider = read("app/(app)/provider-lease.tsx");
  assert.match(provider, /label="More"/);
  for (const act of ["Discard draft", "Withdraw offer", "End tenancy"]) {
    assert.match(provider, new RegExp(`label="${act}"`), `${act} is missing`);
  }
  // Each is still confirmed with a reason before anything happens.
  assert.match(provider, /label="Reason \(optional\)"/);
});

test("a tenancy names the two records it is made of", () => {
  const tenant = read("app/(app)/tenancy.tsx");
  assert.match(tenant, /label="Read the agreement"/);
  assert.match(tenant, /label="Rent account"/);
  assert.match(tenant, /pathname: "\/\(app\)\/agreement\/\[id\]"/);

  const provider = read("app/(app)/provider-tenancy.tsx");
  assert.match(provider, /<GroupLabel>Agreement and rent<\/GroupLabel>/);
  // The section that talks about the agreement opens it (owner, 2026-09-28),
  // whenever the tenancy has one.
  const section = provider.slice(provider.indexOf("<GroupLabel>Agreement and rent</GroupLabel>"), provider.indexOf("<GroupLabel>Related records</GroupLabel>"));
  assert.match(section, /\{tenant\.lease_id \? \(\s*<LinkRow[\s\S]*?label="Open agreement"/);
  assert.match(section, /pathname: "\/\(app\)\/provider-lease", params: \{ leaseId: tenant\.lease_id \}/);
  assert.match(provider, /provider-property/);
  assert.match(provider, /provider-tabs\)\/payments/);
});

test("a tenancy request leads with what the decision turns on", () => {
  const source = read("app/(app)/provider-application.tsx");
  // Whether the advance offered meets the advance asked decides most of these,
  // so it is the figure, not a line among the applicant's details.
  assert.match(source, /label="Advance offered"/);
  assert.match(source, /application\.meets_advance/);
  assert.match(source, /below the \$\{application\.advance_months_asked\} asked for/);
  // Accept and decline each take the page, so the note is written deliberately.
  assert.match(source, /label="Accept request"/);
  assert.match(source, /mode === "accept" \? "Accept this request\?" : "Decline this request\?"/);
});

test("a role is chosen on the row that says what it costs somebody", () => {
  const patterns = read("src/components/team/TeamPatterns.tsx");

  // The consequence used to sit in a caption *under* the picker, which is after
  // the choice rather than in it. It is now on each option.
  assert.match(patterns, /export function RoleChoice/);
  assert.match(patterns, /detail=\{roleConsequence\(role\.value\)\}/);

  // A radio where the answers are exclusive and a checkbox where they are not,
  // said in the state as well as in the mark: a tick drawn inside a label is
  // invisible to a screen reader.
  //
  // As `aria-*` rather than `accessibilityState`, because react-native-web
  // reads only the former — see `ariaState.contract.test.mjs` for the rule.
  assert.match(patterns, /accessibilityRole=\{radio \? "radio" : "checkbox"\}/);
  assert.match(patterns, /aria-selected=\{radio \? selected : undefined\}/);
  assert.match(patterns, /aria-checked=\{radio \? undefined : selected\}/);
  assert.match(patterns, /selected=\{selected\.includes\(property\.id\)\}/);
  // Properties were a stack of full-width buttons, one per Property.
  assert.doesNotMatch(patterns, /variant="secondary"/);
});

test("both ways of granting access offer it with one control", () => {
  const member = read("app/(app)/team-member.tsx");
  const team = read("app/(app)/team.tsx");

  for (const [name, source] of [["member", member], ["invitation", team]]) {
    assert.match(source, /<RoleChoice/, `the ${name} rolls its own role picker`);
    assert.match(source, /<PropertyScope/, `the ${name} rolls its own Property list`);
  }

  // The member record leads with what this person may reach, and keeps the two
  // acts that change anything out of the reading.
  assert.match(member, /<Lead label="Role" value=\{roleLabel\(member\.role\)\} note=\{accessLabel\(member\)\}/);
  assert.match(member, /<ActionBar note=\{roleChanged/);
  assert.match(member, /label="Save access"/);
  assert.match(member, /label="Discard changes"/);
  assert.match(member, /label="Remove from this Portfolio"/);
  // It was a display heading over three ruled sections.
  assert.doesNotMatch(member, /variant="display2"/);
  assert.doesNotMatch(member, /function Section\(/);

  // The invitation is a page sheet, so its decision is pinned inside the
  // sheet's own window rather than left at the end of a scroll.
  assert.match(team, /<ActPill\s+label="Send invitation"/);
  assert.match(team, /<QuietAct label="Cancel"/);
});

test("a plan is a panel you can compare, and the panel is the choice", () => {
  const plans = read("app/(app)/billing-plans.tsx");

  // Four pricing cards, each a screen and a half tall, is the one shape in
  // which plans cannot be compared. What a plan adds is capped, its paragraph
  // of description is gone, and its heading is no longer a display size.
  assert.match(plans, /const HIGHLIGHTS_SHOWN = 3;/);
  assert.match(plans, /option\.highlights\.slice\(0, HIGHLIGHTS_SHOWN\)/);
  assert.doesNotMatch(plans, /plan\.description/);
  assert.doesNotMatch(plans, /variant="title1"/);
  assert.doesNotMatch(plans, /<Surface/);

  // There is no button inside a plan to miss, and none beside three others to
  // weigh: the panel is pressable, and only when there is something to choose.
  assert.match(plans, /const choosable = Boolean\(option\.action\) && !option\.unavailable && !option\.isCurrent;/);
  assert.match(plans, /if \(!choosable\) return <RecordPanel/);

  // What is being paid today does not move when the cycle toggle does.
  assert.match(plans, /const held = billing\.subscription\?\.billing_interval \?\? "monthly";/);
  assert.match(plans, /<Lead label="You are on"/);

  // The comparison was three equal columns, which on a 320pt handset left
  // ninety points a column and cut every value that was a word, not a tick.
  assert.match(plans, /flexBasis: 96/);
  assert.match(plans, /flexWrap: "wrap"/);
});
