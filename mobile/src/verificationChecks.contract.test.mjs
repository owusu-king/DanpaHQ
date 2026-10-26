/**
 * Verification, refined on review (2026-09-15).
 *
 * How far the checks have got leads as a ring, with the one that needs somebody
 * named beside it. The checks then read as two glass groups — the person's own,
 * and the ones a Portfolio needs — each row carrying its state in colour and the
 * single way on. `verificationExperience.contract.test.mjs` keeps this page an
 * overview over focused journeys; these hold what the overview says.
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
const screen = () => code(read("app/(app)/trust.tsx"));

test("how far the checks have got leads, and the one that needs somebody is named", () => {
  const source = screen();
  assert.match(source, /const done = all\.filter\(\(check\) => check\.state === "verified"\)\.length;/);
  // The one to act on first: something with a way on, and only then anything else unfinished.
  assert.match(source, /const waiting = all\.find\(\(check\) => check\.onPress && check\.state !== "verified"\)\s*\?\? all\.find\(\(check\) => check\.state !== "verified"\);/);
  assert.match(source, /<Progress done=\{done\} total=\{all\.length\} \/>/);
  assert.match(source, /\{done === all\.length \? "Everything is verified" : `\$\{all\.length - done\} \$\{all\.length - done === 1 \? "check needs" : "checks need"\} you`\}/);
  assert.match(source, /`\$\{waiting\.title\} · \$\{waiting\.statusLabel \?\? stateLabel\(waiting\.state\)\}`/);

  // The ring is the arc of what is confirmed, kola only when it is all of it.
  const ring = between(source, "function Progress(", "function CheckGroup(");
  assert.match(ring, /const share = total \? done \/ total : 0;/);
  assert.match(ring, /stroke=\{share === 1 \? KOLA : HARMATTAN\}/);
  assert.match(ring, /strokeDasharray=\{`\$\{circumference \* share\} \$\{circumference\}`\}/);
  assert.match(ring, /accessibilityLabel=\{`\$\{done\} of \$\{total\} checks verified`\}/);
  assert.doesNotMatch(source, /variant="display2"|TRUST &amp; IDENTITY/);
});

test("the checks read as two groups: the person's own, and the Portfolio's", () => {
  const source = screen();
  assert.match(source, /<CheckGroup title="Your checks" checks=\{yours\} \/>/);
  assert.match(source, /\{business\.length \? <CheckGroup title="Your Portfolio" checks=\{business\} \/> : null\}/);
  assert.match(source, /const open = kind === "identity" && entry\.state !== "verified";/);
  assert.match(source, /onPress: open \? \(\) => router\.push\("\/\(app\)\/identity-verification" as never\) : undefined,/);
  assert.match(source, /if \(payload && me\?\.capabilities\.provider\.exists\) \{/);
  assert.match(source, /onPress: \(\) => router\.push\("\/\(app\)\/provider" as never\),/);
  assert.match(source, /if \(payload && \(me\?\.capabilities\.provider\.workspace_access \|\| me\?\.capabilities\.provider\.exists\)\) \{/);
  assert.match(source, /business\.push\(settlementCheck\(settlement, settlementError, \(organizationId\) => router\.push\(\{\s*pathname: "\/\(app\)\/payout-account",\s*params: \{ organizationId \},\s*\}\)\)\);/);
});

test("the settlement account is read as a check, in every state it can be in", () => {
  const check = between(screen(), "function settlementCheck(", "const emptyTrustEntry");
  assert.match(check, /if \(error\) return \{ \.\.\.base, state: "unverified", statusLabel: "Unavailable", detail: error \};/);
  assert.match(check, /if \(settlement === undefined\) \{/);
  assert.match(check, /statusLabel: "Portfolio needed"/);
  assert.match(check, /statusLabel: "Owner managed"/);
  assert.match(check, /const profile = settlement\.destination\?\.active_profile \?\? settlement\.destination\?\.profile;/);
  assert.match(check, /const verified = profile\?\.status === "verified";/);
  assert.match(check, /statusLabel: verified \? "Verified" : profile \? profile\.status_display : savedProfiles\.length \? "Selection needed" : "Not set up",/);
  assert.match(check, /actionLabel: profile \|\| savedProfiles\.length \? "Manage" : "Set up",/);
  assert.match(check, /onPress: \(\) => onSetup\(settlement\.organization!\.id\),/);
});

test("a row says what it is, where it stands and the one way on", () => {
  const source = screen();
  const row = between(source, "function CheckRow(", "function ChecksSkeleton(");

  assert.match(row, /const status = check\.statusLabel \?\? stateLabel\(check\.state\);/);
  assert.match(row, /<Ionicons name=\{check\.state === "verified" \? "checkmark" : check\.icon\} size=\{17\} color=\{tone\.ink\} \/>/);
  assert.match(row, /end=\{<Type variant="caption" numberOfLines=\{1\} style=\{\[rowStyles\.rowStatus, \{ color: tone\.text \}\]\}>\{status\}<\/Type>\}/);
  assert.match(row, /\{check\.actionLabel \? \(\s*<View style=\{styles\.act\}>\s*<Type variant="captionStrong" style=\{styles\.actText\}>\{check\.actionLabel\}<\/Type>/);
  // A check with nothing to do is not a button.
  assert.match(row, /if \(!check\.onPress\) return <View style=\{\[rowStyles\.row, first \? null : styles\.ruled\]\}>\{body\}<\/View>;/);
  assert.match(row, /accessibilityLabel=\{`\$\{check\.title\}, \$\{status\}, \$\{check\.actionLabel \?\? "View"\}`\}/);

  // Confirmed in kola, under way in harmattan, out of date in laterite, untouched quiet.
  const tone = between(source, "function stateTone(", "function formatDate(");
  assert.match(tone, /verified: \{ text: KOLA, ink: KOLA_DEEP, wash: theme\.color\.kola\["50"\] \},/);
  assert.match(tone, /pending: \{ text: HARMATTAN, ink: HARMATTAN, wash: theme\.color\.harmattan\["100"\] \},/);
  assert.match(tone, /expired: \{ text: LATERITE, ink: LATERITE, wash: theme\.color\.laterite\["100"\] \},/);
  assert.match(source, /return \{ verified: "Verified", pending: "In progress", unverified: "Not checked", expired: "Out of date" \}\[state\];/);
});

test("loading and a failure each say the right thing", () => {
  const source = screen();
  assert.match(source, /setPayload\(await apiFetch<TrustPayload>\("\/trust\/verifications\/"\)\);/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /\{!payload && !error \? <ChecksSkeleton \/> : null\}/);
  assert.match(between(source, "function ChecksSkeleton(", "function settlementCheck("), /accessibilityRole="progressbar" accessibilityLabel="Loading verification"/);
  // The Portfolio's settlement account belongs to whoever operates it, invited admins included.
  assert.match(source, /if \(!me\?\.capabilities\.provider\.workspace_access && !me\?\.capabilities\.provider\.exists\) \{\s*setSettlement\(null\);/);
  assert.match(source, /const mayManage = \["owner", "admin"\]\.includes\(organization\.current_user_role\);/);
  assert.match(source, /const destination = mayManage \? await getPayoutDestination\(organization\.id\) : null;/);
});
