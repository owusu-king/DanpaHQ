/** The focused mobile sign-in screen and the decisions it must preserve. */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const signIn = () => read("mobile/app/(auth)/sign-in.tsx");
const start = () => read("mobile/app/(auth)/start.tsx");
const flow = () => read("mobile/src/signInFlow.ts");
const fields = () => read("mobile/src/components/auth/AuthFields.tsx");
const scene = () => read("mobile/src/components/auth/AuthScene.tsx");

test("a haptic never decides whether anything completes", () => {
  // The code screen reached for haptics as
  //   `const H = await import("expo-haptics").catch(() => null);`
  //   `await H?.notificationAsync(H.NotificationFeedbackType.Success);`
  // where the catch covers the import and nothing after it. On a build without
  // the native module that second line threw `Cannot read property 'Success'
  // of undefined` — on success inside the try, so a *correct* code reported
  // "That did not work" and never opened the session; in the catch inside
  // nothing, so it escaped as an unhandled rejection. A buzz is a garnish.
  const offenders = [];
  for (const group of ["app", "src"]) {
    const base = new URL(`../${group}/`, import.meta.url);
    for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const where = `${entry.parentPath ?? entry.path}`.replaceAll("\\", "/");
      // Comments stripped first: `code.tsx` documents the broken shape it was
      // fixed from, and a pin that reads prose fails on its own explanation.
      const source = code(readFileSync(new URL(entry.name, `file://${where}/`), "utf8"));
      if (!source.includes("expo-haptics")) continue;
      const file = `${group}/${where.split(`/${group}/`)[1] ?? ""}/${entry.name}`.replace(/\/+/g, "/");

      // Fire and forget, and one catch around the whole chain — never an
      // awaited import whose enum is then read outside the guard.
      if (/await import\("expo-haptics"\)/.test(source)) offenders.push(`${file}: awaited import`);
      if (/NotificationFeedbackType/.test(source) && !/\.then\(/.test(source)) {
        offenders.push(`${file}: reads the enum outside a then`);
      }
      if (!/\.catch\(/.test(source)) offenders.push(`${file}: no catch`);
    }
  }
  assert.deepEqual(offenders, [], `haptics can break these flows: ${offenders.join(", ")}`);
});

test("authentication stays on one focused screen", () => {
  const screen = code(signIn());
  const question = code(start());

  assert.match(screen, /useSignInFlow\(/);
  assert.doesNotMatch(screen, /apiFetch|chooseWorkspace|resolveEntryRoute|isNotAProvider/);

  // The opening question hands over; it does not contain another sign-in.
  assert.match(question, /pathname: "\/\(auth\)\/sign-in"/);
  assert.doesNotMatch(question, /useSignInFlow|AuthSheet|SignInSheet|secureTextEntry/);
});

test("the sign-in flow keeps the existing authority and routing decisions", () => {
  const body = code(flow());
  assert.match(body, /apiFetch<\{[\s\S]{0,200}?\}>\("\/auth\/sign-in\/"/);
  assert.match(body, /chooseWorkspace\(workspace, result\.access_token\)/);
  assert.match(body, /resolveEntryRoute\(user, context\)/);
  assert.match(body, /isNotAProvider\(cause\)/);
  assert.match(body, /await signIn\(result\);\s*\n\s*setNotAProvider\(true\)/);
});

test("the chosen workspace survives the handoff from the question", () => {
  const body = code(start());
  assert.match(body, /rememberOnboardingIntent\(intent\)/);
  assert.match(body, /workspace: intent === "manage_property" \? "provider" : "tenant"/);
  assert.match(body, /router\.push\(\{\s*pathname: "\/\(auth\)\/sign-in"/);

  // Browsing is a way of using Rooomly, not an account to open: no workspace,
  // no sign-in, straight to the public listings.
  assert.match(body, /if \(intent === "find_property"\) \{\s*router\.replace\("\/\(app\)\/\(tabs\)\/explore"\);/);
});

test("Ghana is the default and a password can be checked", () => {
  assert.match(code(fields()), /export const DIAL_CODE = "\+233";/);

  // The dialling code is never retyped as a literal. Three screens ask for a
  // number and all three must show the same prefix the same way.
  for (const name of ["sign-in", "phone", "forgot-password"]) {
    const screen = code(read(`mobile/app/(auth)/${name}.tsx`));
    assert.match(screen, /prefix=\{DIAL_CODE\}/, `${name} does not use the shared dialling code`);
    assert.doesNotMatch(screen, /prefix="\+233"/, `${name} hardcodes the dialling code`);
  }

  // Typing a password blind on a phone keyboard is the commonest reason a
  // correct one is entered wrong twice, so every password in the flow reveals.
  const scene = code(read("mobile/src/components/auth/AuthScene.tsx"));
  assert.match(scene, /accessibilityLabel=\{shown \? "Hide password" : "Show password"\}/);
  for (const name of ["sign-in", "register", "forgot-password"]) {
    const screen = code(read(`mobile/app/(auth)/${name}.tsx`));
    assert.match(screen, /secureTextEntry=\{!reveal\}/, `${name} has no reveal`);
    assert.match(screen, /<RevealToggle shown=\{reveal\}/, `${name} does not draw the reveal`);
  }
});

test("one field language across the whole flow", () => {
  // Five screens used to mix three field styles: `PhoneField`/`PasswordField`
  // on sign-in, the app-wide `Field` on the rest, and bare `TextInput` for the
  // code cells. Every labelled input in the flow is now one row of one card.
  const scene = code(read("mobile/src/components/auth/AuthScene.tsx"));
  assert.match(scene, /export const AuthField = forwardRef</);
  assert.match(scene, /export function AuthFields\(/);
  // The card carries the frame; the rows carry a hairline join, not a border.
  assert.match(scene, /fieldCard: \{[\s\S]{0,220}?overflow: "hidden",/);
  assert.match(scene, /join: \{[\s\S]{0,140}?marginLeft: 52,/);

  assert.doesNotMatch(code(fields()), /PhoneField|PasswordField/);
  for (const name of ["sign-in", "phone", "register", "forgot-password", "onboarding"]) {
    const screen = code(read(`mobile/app/(auth)/${name}.tsx`));
    assert.match(screen, /<AuthFields>/, `${name} does not group its fields`);
    assert.doesNotMatch(
      screen,
      /<Field\b|<PhoneField|<PasswordField/,
      `${name} still draws a field in the old language`,
    );
  }

  // A password is never a row of somebody else's card. It is answered at a
  // different moment from the number beside it and is the only secret on the
  // screen, so it stands on its own surface.
  for (const name of ["sign-in", "register"]) {
    const screen = code(read(`mobile/app/(auth)/${name}.tsx`));
    const cards = screen.split("<AuthFields>");
    const withPassword = cards.filter((card) => /label="(?:New )?[Pp]assword"/.test(card));
    assert.equal(withPassword.length, 1, `${name} should have exactly one password card`);
    assert.equal(
      /label="Mobile number"|label="Email/.test(withPassword[0].split("</AuthFields>")[0]),
      false,
      `${name} joins its password to another field`,
    );
  }
});

test("a code is six boxes wherever it is asked for", () => {
  // Two screens ask for six digits: verifying a new number, and the middle step
  // of a password reset. Only the first had the boxes; the reset asked in a
  // plain labelled field, so one task looked like two depending on which door
  // you came in by, and a fix to one never reached the other.
  const scene = code(read("mobile/src/components/auth/AuthScene.tsx"));
  assert.match(scene, /export function CodeCells\(/);
  // One hidden input behind the boxes: six inputs break autofill, paste and
  // the backspace key.
  assert.match(scene, /<TextInput\s+ref=\{field\}/);
  assert.match(scene, /\{\.\.\.otpInputProps\}/);

  for (const name of ["code", "forgot-password"]) {
    const screen = code(read(`mobile/app/(auth)/${name}.tsx`));
    assert.match(screen, /<CodeCells\b/, `${name} does not draw the six boxes`);
    assert.doesNotMatch(screen, /otpInputProps/, `${name} still wires its own code input`);
  }
});

test("frosted edges survive Android", () => {
  // `hairlineWidth` is 1/density — a third of a pixel on a 3x phone — and a
  // border that thin is rounded away on Android, so every frosted surface in
  // these kits lost its edge there while looking correct on iOS. `IndexRows`
  // had already learned this and draws its panels at 1.
  for (const path of [
    "mobile/src/components/auth/AuthScene.tsx",
    "mobile/src/components/AuthPrompt.tsx",
    "mobile/src/components/home/PublicHome.tsx",
  ]) {
    const source = code(read(path));
    assert.doesNotMatch(
      source,
      /borderWidth: StyleSheet\.hairlineWidth/,
      `${path}: a border Android will not draw`,
    );
  }
  // Separators are a different problem: a hairline *height* is a laid-out view,
  // not a stroke, so it survives. Those stay.
  assert.match(
    code(read("mobile/src/components/auth/AuthScene.tsx")),
    /height: StyleSheet\.hairlineWidth/,
  );

  // Every rounded control that takes a ripple clips it. Android draws
  // `android_ripple` as a rectangle unless the view has `overflow: "hidden"`,
  // so a rounded button squares off under the thumb; iOS takes no ripple at
  // all, which is why this only ever looked wrong on one platform. The
  // app-wide `Button` has carried `overflow: "hidden"` for the same reason.
  const rounded = [
    ["mobile/src/components/auth/AuthScene.tsx", ["action", "card", "back"]],
    ["mobile/src/components/home/PublicHome.tsx", ["act", "quiet"]],
    ["mobile/src/components/AuthPrompt.tsx", ["act"]],
  ];
  for (const [path, names] of rounded) {
    const source = code(read(path));
    for (const name of names) {
      const block = new RegExp(`\\n  ${name}: \\{[\\s\\S]*?\\n  \\},`).exec(source)?.[0];
      assert.ok(block, `${path}: ${name} is missing`);
      assert.match(block, /borderRadius:/, `${path}: ${name} is not rounded`);
      assert.match(
        block,
        /overflow: "hidden"/,
        `${path}: ${name} rounds its corners but lets Android's ripple square them off`,
      );
    }
  }
});

test("the composition is the same on every screen, and bounded", () => {
  const scene = code(read("mobile/src/components/auth/AuthScene.tsx"));

  // Mark, heading, one line — then the screen's own body. A 40-point heading
  // took two enormous lines and became the screen, so it is display3.
  assert.match(scene, /export function AuthMark\(/);
  assert.match(scene, /<Type variant="display3"/);
  assert.doesNotMatch(scene, /variant="display2"/);

  // Centred and capped, so a two-field form is a column on a tablet rather
  // than a row of inputs stretched across it.
  assert.match(scene, /const MEASURE = 440;/);
  assert.match(scene, /maxWidth: MEASURE,/);
  assert.match(scene, /alignSelf: "center",/);
  // The mark and the heading go up into the hero; everything after them stands on the panel.
  assert.match(scene, /return isValidElement\(child\) && \(child\.type === AuthMark \|\| child\.type === AuthHeading\);/);
  assert.match(scene, /\{hero\.length \? <View style=\{styles\.heroBody\}>\{hero\}<\/View> : null\}/);

  // The live act is solid kola with white on it. The inactive state is neutral
  // and never a paler green: `kola-50` and then kola at 16% both read as the
  // green button badly drawn rather than as a button that is not ready.
  assert.match(scene, /action: \{[\s\S]{0,260}?backgroundColor: KOLA,/);
  assert.match(scene, /actionText: \{\s*color: WHITE,/);
  assert.match(scene, /actionOff: \{\s*backgroundColor: alpha\(DEEP, 0\.09\),/);
  assert.doesNotMatch(scene, /actionOff: \{\s*backgroundColor: (?:theme\.color\.kola|alpha\(KOLA)/);

  // A back control belongs at the top of the screen. Passed as the first child
  // it rode the centred block into the middle of the page, which put the code
  // screen's escape hatch halfway down it.
  for (const name of ["phone", "code", "forgot-password"]) {
    const screen = code(read(`mobile/app/(auth)/${name}.tsx`));
    assert.match(screen, /header=\{<AuthBack /, `${name} does not pin its back control`);
  }

  // Where you are and how to leave are two different things and do not share a
  // line: the back mark, then the step marks under it. The marks are short —
  // a full-width rail read as a loading bar rather than a position.
  assert.match(scene, /progress\?: \{ step: number; of: number \};/);
  assert.match(scene, /crownInner: \{[\s\S]{0,180}?justifyContent: "space-between",/);
  assert.match(scene, /tick: \{\s*width: 18,\s*height: 4,/);
  assert.match(scene, /tickHere: \{\s*width: 30,/);
  assert.doesNotMatch(scene, /tick: \{\s*flex: 1,/);
  for (const name of ["phone", "code", "forgot-password", "register", "role", "onboarding"]) {
    const screen = code(read(`mobile/app/(auth)/${name}.tsx`));
    assert.match(screen, /progress=\{\{ step: /, `${name} does not draw the step rail`);
    assert.doesNotMatch(
      screen,
      /<AuthProgress/,
      `${name} places the step marks itself instead of letting the frame crown the page`,
    );
  }

  for (const name of ["start", "sign-in", "phone", "code", "register", "forgot-password", "role", "onboarding"]) {
    const screen = code(read(`mobile/app/(auth)/${name}.tsx`));
    assert.match(screen, /<AuthScene/, `${name} is not on the shared frame`);
    assert.doesNotMatch(screen, /eyebrow=/, `${name} still sets an eyebrow`);
    // The old flow's step counter, shouted in small caps.
    assert.doesNotMatch(screen, /STEP \d OF \d/, `${name} still spells out its step`);
  }

  // The mark leads the two screens somebody can arrive at cold.
  for (const name of ["start", "sign-in"]) {
    assert.match(code(read(`mobile/app/(auth)/${name}.tsx`)), /<AuthMark \/>/);
  }
});

test("sign in is the only primary action", () => {
  // `AuthAction` is the auth flow's one filled control. The shared `Button` is
  // ink-on-ivory, which on the green dawn these screens now stand on reads as a
  // foreign object — but the rule it enforced is the one that mattered, so it
  // follows the primary action rather than the component it used to be.
  const acts = [...code(signIn()).matchAll(/<AuthAction\b[\s\S]{0,200}?label="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((label) => label !== "Go to your home");
  assert.deepEqual(acts, ["Sign in"], `too many actions: ${acts.join(", ")}`);
  assert.doesNotMatch(code(signIn()), /<Button\b/);
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

test("the identity is the product's own green hero, not a dawn", () => {
  // The crest was a 132-point header that drew a gradient and left a hole for
  // artwork nobody drew, so in every shipped build it was empty space at the
  // top of the screen most launches end on. The colour is in the page now.
  const screen = code(signIn());
  assert.match(screen, /<AuthScene>/);
  assert.doesNotMatch(screen, /AuthCrest|OPENING_SCENE/);

  // Redesigned (owner, 2026-10-06): the dawn read as decoration rather than as
  // Rooomly. The screens open on the chrome's textured green, as every page past
  // sign-in does, with the Homes' pale panel rising over its foot.
  const body = code(scene());
  assert.doesNotMatch(body, /auth-sky|auth-warm|auth-deep/);
  assert.match(body, /<HeaderChromeBackground edge=\{false\} \/>/);
  assert.match(body, /hero: \{[\s\S]{0,160}backgroundColor: shell\.chrome,/);
  assert.match(body, /panel: \{[\s\S]{0,200}marginTop: -RISE,[\s\S]{0,200}borderTopLeftRadius: RISE,[\s\S]{0,120}backgroundColor: ph\.ground,/);
  assert.match(body, /title: \{\s*color: shell\.onChrome,/);
  // The texture is silent to a screen reader and never takes a touch.
  assert.match(code(read("mobile/src/components/nav/HeaderChromeBackground.tsx")), /pointerEvents="none"\s+accessibilityElementsHidden/);
  // Static. A header that moves while somebody is typing a password is a header
  // that is in the way.
  assert.doesNotMatch(body, /Animated|useNativeDriver/);
});

test("every auth screen clears the navigation buttons at the bottom", () => {
  // Android draws edge-to-edge. Eight of these nine screens had their last
  // control under the navigation buttons, because each one padded its own page
  // and the bottom inset was the part that kept getting left out. One frame
  // answers it once — so the rule is that they all use the frame.
  const body = code(scene());
  assert.match(body, /const insets = useSafeAreaInsets\(\);/);
  assert.match(body, /const bottom = insets\.bottom \+ space\[6\];/);
  assert.match(body, /paddingBottom: bottom\b/);
  // The top belongs to whichever element is actually first: the step rail or
  // the back control when either is there, the scroll when neither is. Either
  // way it is *added* to the inset, never substituted for it.
  assert.match(body, /const crown = Boolean\(header \|\| progress\);/);
  // The hero takes the top inset; the way back and the step marks ride its first line.
  assert.match(body, /styles\.hero, \{ paddingTop: insets\.top \+ space\[3\] \}/);
  assert.match(body, /<KeyboardAvoidingView/);

  for (const name of ["start", "sign-in", "phone", "code", "register"]) {
    const screen = code(read(`mobile/app/(auth)/${name}.tsx`));
    assert.match(screen, /<AuthScene/, `${name} does not stand on the shared frame`);
    assert.doesNotMatch(
      screen,
      /contentContainerStyle/,
      `${name} pads its own scroll instead of letting the frame do it`,
    );
  }
});
