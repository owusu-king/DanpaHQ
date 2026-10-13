/**
 * Role → details → number → account → Home (owner, 2026-10-07).
 *
 * The journey was reordered on the client only. These pin what that reorder
 * must keep true: nothing is created before the number is proved, the password
 * waiting for the code is never written anywhere, the role is asked once, and
 * the welcome is seen exactly once.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const draft = () => code(read("mobile/src/registrationDraft.ts"));
const register = () => code(read("mobile/app/(auth)/register.tsx"));
const verify = () => code(read("mobile/app/(auth)/code.tsx"));
const gate = () => code(read("mobile/app/_layout.tsx"));
const welcome = () => code(read("mobile/app/(auth)/welcome.tsx"));

test("the details wait in memory and nowhere else", () => {
  const body = draft();
  // A password in secure storage outlives the session that typed it, and one
  // in a route param lands in the web address bar.
  assert.doesNotMatch(body, /secure\.(set|get)\(|AsyncStorage|localStorage|sessionStorage/);
  assert.match(body, /^let draft: Draft \| null = null;/m);
  assert.doesNotMatch(register(), /params: \{[^}]*password/);
});

test("nothing is created until the number is proved", () => {
  // The details screen holds the details and goes to the phone; it only
  // creates the account itself when it already holds a proof.
  const body = register();
  assert.match(body, /if \(!createsHere\) \{\s*saveRegistrationDetails\(details\);\s*router\.push\(\{ pathname: "\/\(auth\)\/phone"/);
  assert.match(body, /const createsHere = Boolean\(ticket\) \|\| pinned;/);

  // The one call that makes a member still carries the ticket from /auth/verify.
  const shared = draft();
  assert.match(shared, /apiFetch<.+?>\("\/me\/registration\/"/);
  assert.match(shared, /registration_ticket: ticket \|\| undefined,/);

  // The code screen spends the ticket on the held details the moment the code is right.
  const screen = verify();
  assert.match(screen, /if \(result\.registration_required\) \{[\s\S]*?submitRegistration\(\{ details: draft, ticket, deviceFingerprint \}\)/);
  // A refused detail goes back to the details with the proof kept.
  assert.match(screen, /returnDraftWithErrors\(ticket, fields, summaryErrorFrom\(cause, fields\)\);/);
});

test("the role is asked once, and the details ask only the essentials", () => {
  const body = register();
  assert.doesNotMatch(body, /<PickCard\b|What brings you here/);
  for (const label of ["First name", "Last name", "Date of birth", "Password", "Confirm password", "Email (optional)"]) {
    assert.match(body, new RegExp(`label="${label.replace(/[()]/g, "\\$&")}"`), `${label} is missing`);
  }
  assert.match(body, /found\.confirm_password = /);
});

test("the welcome is shown once, by the gate, and never on a relaunch", () => {
  const body = gate();
  assert.match(body, /if \(accountJustCreated\(\) && session\.me\.registration_state === "complete"\) \{\s*return inAuthFlow && screen === "welcome" \? null : "\/\(auth\)\/welcome";/);
  // Marked before the session lands, in both places an account is created.
  for (const screen of [register(), verify()]) {
    assert.match(screen, /markAccountJustCreated\([^)]+\);[\s\S]{0,200}?signIn\(session\)/);
  }
  assert.match(welcome(), /finishAccountWelcome\(\);\s*router\.replace\(route as never\);/);
  assert.match(draft(), /^let justCreated: AccountType \| null = null;/m);
});

test("a new provider is told verification comes before operating", () => {
  const body = welcome();
  assert.match(body, /Verification is required/);
  assert.match(body, /<AuthAction label="Verify now" onPress=\{\(\) => leave\("\/\(app\)\/provider\?send=1"\)\} \/>/);

  // The pending provider's Home shows what is locked rather than hiding it,
  // and says "under review" once evidence is in.
  const home = code(read("mobile/app/(app)/provider.tsx"));
  assert.match(home, /Unlocks after verification/);
  assert.match(home, /title: "Verification under review"/);
  assert.match(home, /Verification submitted/);
  assert.match(home, /apiFetch<Standing>\("\/me\/provider-verification\/", \{\s*method: "POST"/);
});
