/** The focused mobile sign-in screen and the decisions it must preserve. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const signIn = () => read("mobile/app/(auth)/sign-in.tsx");
const welcome = () => read("mobile/app/(auth)/welcome.tsx");
const flow = () => read("mobile/src/signInFlow.ts");
const fields = () => read("mobile/src/components/auth/AuthFields.tsx");
const crest = () => read("mobile/src/components/welcome/AuthCrest.tsx");
const ui = () => read("mobile/src/components/ui.tsx");

test("authentication stays on one focused screen", () => {
  const screen = code(signIn());
  const journey = code(welcome());

  assert.match(screen, /useSignInFlow\(/);
  assert.doesNotMatch(screen, /apiFetch|chooseWorkspace|resolveEntryRoute|isNotAProvider/);

  // The final welcome choice hands over; it does not contain another sign-in.
  assert.match(journey, /pathname: "\/\(auth\)\/sign-in"/);
  assert.doesNotMatch(journey, /useSignInFlow|AuthSheet|SignInSheet|secureTextEntry/);
});

test("the sign-in flow keeps the existing authority and routing decisions", () => {
  const body = code(flow());
  assert.match(body, /apiFetch<\{[\s\S]{0,200}?\}>\("\/auth\/sign-in\/"/);
  assert.match(body, /chooseWorkspace\(workspace, result\.access_token\)/);
  assert.match(body, /resolveEntryRoute\(user, context\)/);
  assert.match(body, /isNotAProvider\(cause\)/);
  assert.match(body, /await signIn\(result\);\s*\n\s*setNotAProvider\(true\)/);
});

test("the chosen workspace survives the welcome handoff", () => {
  const body = code(welcome());
  assert.match(body, /rememberOnboardingIntent\(intent\)/);
  assert.match(body, /workspace: intent === "manage_property" \? "provider" : "tenant"/);
  assert.match(body, /router\.push\(\{\s*pathname: "\/\(auth\)\/sign-in"/);
});

test("Ghana is the default and a password can be checked", () => {
  const shared = code(fields());
  assert.match(shared, /export const DIAL_CODE = "\+233";/);
  assert.match(shared, /prefix=\{DIAL_CODE\}/);
  assert.match(shared, /secureTextEntry=\{!reveal\}/);
  assert.match(shared, /accessibilityLabel=\{reveal \? "Hide password" : "Show password"\}/);
  assert.match(shared, /\n\s+suffix=\{/);
  assert.match(code(ui()), /suffix\?: ReactNode;/);
  assert.match(code(ui()), /\{suffix \? <View style=\{styles\.inputSuffix\}>\{suffix\}<\/View> : null\}/);
});

test("sign in is the only primary action", () => {
  const buttons = [...code(signIn()).matchAll(/<Button\b[\s\S]{0,200}?label="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((label) => label !== "Go to your home");
  assert.deepEqual(buttons, ["Sign in"], `too many buttons: ${buttons.join(", ")}`);
  assert.match(code(fields()), /export function TextLink\(/);
});

test("recovery, registration and public browsing remain one tap away", () => {
  const body = code(signIn());
  assert.match(body, /\/\(auth\)\/forgot-password/);
  assert.match(body, /pathname: "\/\(auth\)\/phone"/);
  assert.match(body, /params: \{ workspace: workspace \?\? undefined \}/);
  assert.match(body, /\(tabs\)\/explore/);
});

test("the heading says where signing in leads", () => {
  const body = code(flow());
  assert.match(body, /Sign in to manage/);
  assert.match(body, /Sign in to\\nyour home/);
  assert.match(body, /Welcome back/);
  assert.doesNotMatch(body, /Use the number on your account and your password/);
  assert.match(code(signIn()), /signInHeading\(workspace\)/);
});

test("the standalone sign-in keeps Rooomly's visual identity", () => {
  assert.match(code(signIn()), /<AuthCrest/);
  const body = code(crest());
  assert.match(body, /scene = OPENING_SCENE/);
  assert.doesNotMatch(body, /Animated|useNativeDriver|loop/);
  assert.match(body, /pointerEvents="none"/);
  assert.match(body, /accessibilityElementsHidden/);
});
