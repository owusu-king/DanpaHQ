/**
 * Web sign-up: Get Started → how will you use Danpa HQ → who you are → your
 * sign-in method → verified credential → in (owner, 2026-10-18).
 *
 * The journey was reordered on the client only. These pin what that must keep
 * true: the role is asked once, first; nothing is created until either the
 * phone number or Google identity is proved; the welcome is seen once; a new
 * provider is told verification comes first; and an email reaches a phone
 * account only through its code.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const register = () => code(read("src/components/auth/flows/RegisterFlow.tsx"));

test("Get Started opens the question, and sign-up asks it first and once", () => {
  const door = code(read("src/components/landing/FrontDoor.tsx"));
  assert.match(door, /<AuthLink view="register" className="lp-door-action is-primary">\s*Get Started/);

  const body = register();
  assert.match(body, /resuming \|\| googleArrival \? "details" : preselected \? "method" : "role"/);
  assert.match(body, /title: "How will you use Danpa HQ\?"/);
  assert.match(body, /body: "Rent or find a place\."/);
  assert.match(body, /body: "Own or manage property\."/);
  assert.match(body, /className="auth-role-body">\{option\.body\}/);
  assert.doesNotMatch(body, /auth-role-points|option\.points/);
  // The role is the account type: the details step never asks it again.
  assert.doesNotMatch(body, /What brings you here|<Select\b/);
  for (const label of ["First name", "Last name", "Date of birth", "Password", "Confirm password"]) {
    assert.match(body, new RegExp(`label="${label}"`), `${label} is missing`);
  }
  assert.match(body, /label=\{method === "google" \? "Email" : "Email \(optional\)"\}/);
});

test("closing sign in leaves a signed-out visitor at the front door", () => {
  const redirect = code(read("src/components/EntryRedirect.tsx"));
  assert.match(redirect, /state\.status === "signed_in"/);
  assert.doesNotMatch(redirect, /installation\.visited|VISITED_KEY|"\/sign-in"/);

  // Closing is a callback: the dialog shuts over the page it opened on.
  const modal = code(read("src/components/auth/AuthModal.tsx"));
  assert.match(modal, /onClose: \(\) => void;/);
  assert.doesNotMatch(modal, /useRouter|router\.(back|replace|push)/);
  // An old /sign-in address opens the dialog over the front door, signed out.
  const dialog = code(read("src/components/auth/AuthDialog.tsx"));
  assert.match(dialog, /open\(view === "welcome" \? "sign-in" : view, params\);\s*router\.replace\("\/"\);/);
});

test("nothing is created until a phone or Google identity is proved", () => {
  const body = register();
  // Details continue to the phone; only a held phone/Google proof (or a resumed account) creates.
  assert.match(body, /if \(createsHere\) \{\s*void createAccount\(ticket\);\s*return;\s*\}\s*go\("phone"\);/);
  assert.match(body, /const createsHere = Boolean\(ticket \|\| googleTicket\) \|\| resuming;/);
  // The ticket from /auth/verify is spent at once on the held details.
  assert.match(body, /if \(result\.registration_ticket\) \{\s*setTicket\(result\.registration_ticket\);[\s\S]{0,60}await createAccount\(result\.registration_ticket\);/);
  assert.match(body, /registration_ticket: proof \|\| undefined,/);
  // Google returns an opaque, role-bound registration ticket; the client never decodes its ID token.
  assert.match(body, /if \(result\.registration_required && result\.google_registration_ticket && result\.profile\)/);
  assert.match(body, /google_registration_ticket: googleTicket \|\| undefined,/);
  assert.doesNotMatch(body, /atob|jwtDecode|parseJwt/);
  // A refusal returns to the details with the reason, keeping the proof.
  assert.match(body, /setErrors\(fields\);[\s\S]{0,200}setStep\("details"\);/);
  // The password is never written anywhere but component state.
  assert.doesNotMatch(body, /localStorage|sessionStorage|searchParams\.set\("password"/);
});

test("the welcome is shown once, then never again", () => {
  assert.match(register(), /markAccountJustCreated\(accountType, safeNext \?\? null\);[\s\S]{0,80}show\("welcome", \{ next: safeNext \}\);/);
  const lib = code(read("src/lib/registration.ts"));
  assert.match(lib, /^let justCreated: Arrival \| null = null;/m);
  // The tab may hold the flag across a full load, and nothing but the account
  // type and where to go next: never a detail of the person.
  assert.doesNotMatch(lib, /localStorage/);
  assert.match(lib, /window\.sessionStorage\.setItem\(KEY, JSON\.stringify\(justCreated\)\);/);
  assert.match(lib, /type Arrival = \{ type: AccountType; next: string \| null \};/);

  const welcome = code(read("src/components/auth/flows/WelcomeFlow.tsx"));
  // Read once and cleared at once, so this welcome is the only one.
  assert.match(welcome, /const found = accountJustCreated\(\);\s*finishAccountWelcome\(\);\s*setArrival\(found\);/);
  // Reached without the flag, it sends the person on rather than welcoming them.
  assert.match(welcome, /if \(arrival === undefined \|\| arrival\) return;\s*if \(state\.status === "signed_in"\) land\(resolveWebEntry/);
  assert.match(welcome, /finishAccountWelcome\(\);\s*land\(route\);/);
  assert.match(welcome, /Verification is required/);
  assert.match(welcome, /leave\("\/provider\?send=1"\)/);
  assert.match(code(read("src/components/AppShell.tsx")), /"\/welcome"/);
});

test("a pending provider's home shows where they stand and what is locked", () => {
  const page = code(read("app/provider/page.tsx"));
  assert.match(page, /title: "Verification under review"/);
  assert.match(page, /Verification submitted/);
  assert.match(page, /Unlocks after verification/);
  assert.match(page, /submitProviderVerification\(\[\{ file_id: stored\.id, evidence_type: documentType \}\]\)/);
  assert.match(page, /<VerificationTrack stops=\{providerStops\(status\)\} \/>/);
});

test("an email reaches the account only through its code", () => {
  const sections = code(read("src/components/account/AccountSections.tsx"));
  assert.doesNotMatch(sections, /email: email/);
  const details = code(read("src/components/account/ProfileDetails.tsx"));
  assert.match(details, /await startEmailVerification\(email\.trim\(\)\)/);
  assert.match(details, /await confirmEmail\(started\.verification_id, value\)/);
  const lib = code(read("src/lib/console.ts"));
  assert.match(lib, /authedFetch<EmailVerificationStarted>\("\/me\/email\/"/);
  assert.match(lib, /authedFetch<unknown>\("\/me\/email\/verify\/"/);
  assert.match(code(read("app/settings/page.tsx")), /<EmailSection current=\{me\.email\} verified=\{Boolean\(me\.is_email_verified\)\}/);
});
