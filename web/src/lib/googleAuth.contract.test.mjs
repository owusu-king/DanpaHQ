import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const button = read("../components/auth/GoogleIdentityButton.tsx");
const register = read("../components/auth/flows/RegisterFlow.tsx");
const signIn = read("../components/auth/flows/SignInFlow.tsx");
const security = read("../components/account/IdentitySecurity.tsx");
const shell = read("../components/portal/PortalShell.tsx");

test("GIS uses the maintained remote client and sends the opaque credential to the API", () => {
  assert.match(button, /https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(button, /NEXT_PUBLIC_GOOGLE_CLIENT_ID/);
  assert.doesNotMatch(button, /atob|decodeJwt|split\(["']\.["']\)/);
  assert.match(signIn, /\/auth\/google\//);
  assert.match(register, /google_registration_ticket/);
});

test("registration chooses the role and auth method before profile completion", () => {
  assert.match(register, /type Step = "role" \| "method" \| "details"/);
  assert.match(register, /if \(accountType\) go\("method"\)/);
  assert.match(register, /Continue with phone/);
  assert.match(register, /text="signup_with"/);
});

test("settings supports deliberate linking and progressive phone verification", () => {
  assert.match(security, /\/me\/google\//);
  assert.match(security, /\/me\/phone\//);
  assert.match(security, /\/me\/phone\/verify\//);
  assert.match(shell, /settings\/security#phone-verification/);
  assert.match(shell, /!me\.is_phone_verified/);
});
