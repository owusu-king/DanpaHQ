/**
 * The settlement account, refined on review (2026-09-15).
 *
 * The account in use leads as a card, because that is the one fact this page
 * exists to state. Every account the Portfolio has saved follows as one glass
 * list, each row carrying its verification and the one act that state allows;
 * adding another is a panel opened on request. `payoutSetup.contract.test.mjs`
 * keeps the provisioning rules; these hold what the page says about them.
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
const screen = () => code(read("app/(app)/payout-account.tsx"));

test("the account rent arrives in leads, and what is missing when there is none", () => {
  const source = screen();
  const card = between(source, "function InUse(", "function AccountRow(");

  assert.match(source, /const active = state\?\.active_profile \?\? null;/);
  assert.match(source, /<InUse profile=\{active\} saved=\{state\.profiles\.length\} \/>/);
  assert.match(card, /\{saved \? "No account chosen yet" : "No receiving account yet"\}/);
  assert.match(card, /\{saved\s*\? "Choose a verified account below and new rent payments will use it\."\s*: "Add a bank or Mobile Money account, then verify it with Paystack\."\}/);
  assert.match(card, /<Type variant="label" style=\{styles\.inUse\}>IN USE<\/Type>/);
  assert.match(card, /<Type variant="amountLg" numberOfLines=\{1\} style=\{styles\.heroAccount\}>\{profile\.masked_account\}<\/Type>/);
  assert.match(card, /\{profile\.institution\} · \{profile\.status_display\}/);
  assert.match(card, /accessibilityLabel=\{`In use: \$\{profile\.account_name\}, \$\{profile\.institution\}, \$\{profile\.masked_account\}, \$\{profile\.status_display\}`\}/);

  assert.match(source, /<Footnote>Paystack sends rent to this account after its fee\. Payments already in progress are never redirected\.<\/Footnote>/);
  assert.match(source, /\{state\.profiles\.length > 0 && !state\.active_profile \? \(\s*<Notice tone="warning" title="Choose an account for new payments"/);
  assert.doesNotMatch(source, /variant="display2"|PAYOUT DESTINATION/);
});

test("every saved account carries its verification and the acts that state allows", () => {
  const source = screen();
  const row = between(source, "function AccountRow(", "function MethodChoice(");

  assert.match(source, /<GroupLabel count=\{state\.profiles\.length \|\| undefined\}>Receiving accounts<\/GroupLabel>/);
  assert.match(source, /\{state\.profiles\.map\(\(profile, index\) => \(/);
  assert.match(row, /const tone = profile\.status === "verified" \? KOLA : profile\.status === "unverified" \? HARMATTAN : LATERITE;/);
  assert.match(row, /end=\{<Type variant="caption" numberOfLines=\{1\} style=\{\[rowStyles\.rowStatus, \{ color: tone \}\]\}>\{profile\.status_display\}<\/Type>\}/);
  assert.match(row, /\{profile\.institution\} · \{profile\.masked_account\}\{profile\.is_active \? " · Used for new rent payments" : ""\}/);
  assert.match(row, /\{profile\.status === "unverified" \? \(\s*<SmallAct label="Check verification status"/);
  assert.match(row, /\{profile\.status === "verified" && !profile\.is_active \? \(\s*<SmallAct label="Use this account"/);
  assert.match(row, /\{!removing \? <SmallAct label="Remove"/);
  assert.match(row, /busy=\{busy === `refresh:\$\{profile\.id\}`\}/);
  assert.match(row, /busy=\{busy === `activate:\$\{profile\.id\}`\}/);

  // Removing asks first, and says what it does not touch.
  assert.match(source, /<Type variant="bodyStrong" style=\{styles\.confirmTitle\}>Remove from future use\?<\/Type>/);
  assert.match(source, /Payments already in progress and historical records will keep this destination\./);
  assert.match(source, /<Button label="Yes, remove account" variant="destructive" busy=\{busy === `remove:\$\{profile\.id\}`\} onPress=\{\(\) => void removeAccount\(profile\.id\)\} \/>/);
  assert.match(source, /<Button label="Keep account" variant="quiet" onPress=\{\(\) => setRemoveCandidate\(""\)\} \/>/);
});

test("adding one is a panel opened on request, and the number is never kept", () => {
  const source = screen();
  assert.match(source, /\{!showSetup && state\.profiles\.length \? \(/);
  assert.match(source, /<QuietAction icon="add-circle-outline" label="Add receiving account" onPress=\{\(\) => setShowSetup\(true\)\} \/>/);
  // A Portfolio with no account at all opens straight into the panel.
  assert.match(source, /\) : showSetup \|\| state\.profiles\.length === 0 \? \(/);

  assert.match(source, /<View accessibilityRole="radiogroup" accessibilityLabel="How rent arrives" style=\{styles\.methods\}>/);
  assert.match(source, /<MethodChoice label="Bank account" icon="business-outline" selected=\{method === "bank"\} onPress=\{\(\) => changeMethod\("bank"\)\} \/>/);
  assert.match(source, /<MethodChoice label="Mobile Money" icon="phone-portrait-outline" selected=\{method === "mobile_money"\} onPress=\{\(\) => changeMethod\("mobile_money"\)\} \/>/);
  assert.match(source, /label=\{method === "bank" \? "Find your bank" : "Find your network"\}/);
  assert.match(source, /accessibilityRole="radio"\s*aria-checked=\{bankCode === institution\.code\}/);
  assert.match(source, /accessibilityLabel=\{`Change \$\{method === "bank" \? "bank" : "network"\}, currently \$\{selectedInstitution\?\.name\}`\}/);
  assert.match(source, /hint="Used only to create the Paystack subaccount\. Rooomly does not retain this number\."/);
  assert.match(source, /setAccountNumber\(value\.replace\(\/\\s\/g, ""\)\); setResolved\(null\);/);

  // Confirm, then save: a bank account is named back before it is added.
  assert.match(source, /\{method === "bank" && bankCode && !resolved \? \(\s*<Button label="Confirm account" variant="secondary" busy=\{busy === "resolve"\} disabled=\{!accountNumber\.trim\(\)\}/);
  assert.match(source, /\{\(method === "mobile_money" && bankCode\) \|\| resolved \? \(/);
  assert.match(source, /<Button label="Add receiving account" busy=\{busy === "save"\} disabled=\{!accountNumber\.trim\(\)\} onPress=\{\(\) => void saveAccount\(\)\} \/>/);
  assert.match(source, /Property owners bear Paystack’s transaction fee\./);
  assert.match(source, /setAccountNumber\(""\); setResolved\(null\); setShowSetup\(false\);/);
});

test("only an owner or admin manages it, and a check in flight is never re-run", () => {
  const source = screen();
  assert.match(source, /const allowed = organization\.current_user_role === "owner" \|\| organization\.current_user_role === "admin";/);
  assert.match(source, /\{mayManage === false && organizationId \? <Notice tone="warning" title="Owner or admin access required"/);
  assert.match(source, /const checking = state\?\.provisioning\?\.checking === true;/);
  assert.match(source, /\{checking \? \(\s*<Notice tone="info" title="Checking with Paystack"/);
  // The institution directory going down must not hide a configured destination.
  assert.match(source, /setInstitutions\(\[\]\);\s*setError\(cause instanceof ApiFailure \? cause\.error\.message : "Could not load payout institutions\."\);/);
  assert.match(source, /setStatusNote\("New rent payments will use this account\. Payments already in progress are unchanged\."\);/);
  assert.match(source, /setStatusNote\("Account removed from future use\. Existing payment and settlement records remain unchanged\."\);/);
});

test("loading and a failure each say the right thing", () => {
  const source = screen();
  assert.match(source, /\{busy === "load" \? <SettlementSkeleton \/> : null\}/);
  assert.match(between(source, "function SettlementSkeleton(", "const styles = StyleSheet.create("), /accessibilityRole="progressbar" accessibilityLabel="Loading settlement details"/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /\{statusNote \? <Notice tone="info" title="Settlement account updated" body=\{statusNote\} \/> : null\}/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /<IndexGround>/);
});
