/**
 * The first-launch introduction.
 *
 * Three scenes and one question. The story is for first-timers; the question is
 * for everybody — somebody who has seen it opens on the last page, and can walk
 * back to the beginning whenever they like.
 *
 * The rules worth holding are mostly about what it must *not* become: a second
 * sign-in, a second source of truth about who somebody is, or a toll charged to
 * a returning person on the way to the thing they came for.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Line endings are mixed across this repo, and a slice looking for "}\n"
// silently runs to the end of a CRLF file instead of stopping at its function.
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const welcome = () => read("mobile/app/(auth)/welcome.tsx");
const world = () => read("mobile/src/components/welcome/WelcomeWorld.tsx");
const progress = () => read("mobile/src/components/welcome/WelcomeProgress.tsx");
const seen = () => read("mobile/src/welcomeSeen.ts");
const gate = () => read("mobile/app/_layout.tsx");

test("the story plays once; the choice is always there", () => {
  // The gate does not decide between two screens. It sends every signed-out
  // person to the journey, and the journey decides which end of itself to open
  // on — which is why returning does not mean being shown an introduction
  // again, and does not mean losing it either.
  const body = code(gate());
  assert.match(body, /router\.replace\("\/\(auth\)\/welcome"\)/);
  assert.doesNotMatch(body, /hasSeenWelcome/);

  // The journey reads the flag and opens at the far end for anybody who has
  // seen it. Read before the first render, not scrolled to afterwards: an
  // offset applied after mount is a visible jump from scene one.
  const screen = code(welcome());
  assert.match(screen, /Promise\.all\(\[\s*hasSeenWelcome\(\),/);
  assert.match(screen, /setOpensAt\(opening\)/);
  assert.match(screen, /seen \? STOPS - 1 : 0/);
  assert.match(screen, /contentOffset=\{\{ x: opensAt \* width, y: 0 \}\}/);
  // Nothing is drawn until that is known.
  assert.match(screen, /if \(opensAt === null\) \{/);
  // The pager mounts at an offset without scrolling, so the controls have to be
  // told which page they are on.
  assert.match(screen, /setStop\(opening\);/);

  // And the journey is never taken away.
  assert.match(screen, /Back to welcome/);
  assert.match(screen, /onReplay=\{\(\) => goTo\(0\)\}/);

  // **Every** way out marks it seen, or it plays again.
  //
  // Asserted per exit, not by counting: `>= 1` let either one be gutted while
  // the other kept the test green, which is exactly the bug that would ship an
  // introduction replaying forever for anybody who skipped it.
  const exits = ["choose", "leave"];
  for (const name of exits) {
    const at = screen.indexOf(`async function ${name}(`);
    assert.notEqual(at, -1, `${name} is gone`);
    const body = screen.slice(at, screen.indexOf("\n  }", at));
    assert.match(body, /rememberWelcomeSeen\(\)/, `${name} does not mark the introduction seen`);
  }

  // Skip and "I don't have an account" go through `leave`.
  assert.equal((screen.match(/void leave\(/g) ?? []).length, 2);
  // The three ways in go through `choose` — browsing among them, which is why
  // it marks the story seen like the other two rather than slipping out
  // unrecorded.
  assert.equal((screen.match(/void onChoose\(/g) ?? []).length, 3);
});

test("seeing the introduction is not the same as having an account", () => {
  // Registration state, workspace access and verification are the backend's.
  // This flag answers one much smaller, device-local question.
  const body = seen();
  assert.match(body, /welcome\.seen/);
  assert.doesNotMatch(code(body), /registration_state|account_status|capabilities/);

  // Signing out must not un-introduce somebody: `clearLocal` clears the refresh
  // token and the cached `me`, and this key is deliberately not among them.
  const auth = code(read("mobile/src/auth.tsx"));
  const clearLocal = auth.slice(auth.indexOf("clearLocal"), auth.indexOf("clearLocal") + 600);
  assert.doesNotMatch(clearLocal, /welcome\.seen|welcomeSeen/);

  // A keychain that will not read is not a reason to trap anybody in an
  // introduction, so the failure leans toward letting them through.
  assert.match(body, /return true;/);
});

test("it hands over to the authentication that already exists", () => {
  const screen = code(welcome());

  // No second account system. The journey never owns credentials or calls an
  // authentication endpoint; it hands the chosen workspace to sign-in.
  assert.doesNotMatch(screen, /apiFetch|createAccount|secureTextEntry/);
  assert.doesNotMatch(screen, /useSignInFlow|AuthSheet|SignInSheet|signingInTo/);

  // Authentication is its own focused screen. The chosen workspace survives
  // the handoff so the backend still opens the experience the person requested.
  assert.match(screen, /pathname: "\/\(auth\)\/sign-in"/);
  assert.match(screen, /workspace: intent === "manage_property" \? "provider" : "tenant"/);
  assert.match(screen, /leave\("\/\(auth\)\/sign-in"\)/);

  // The existing intent store is reused rather than duplicated.
  assert.match(screen, /rememberOnboardingIntent\(intent\)/);

  // And the account-level role question, asked after a number is confirmed,
  // is a different thing and is left alone.
  assert.match(read("mobile/app/(auth)/role.tsx"), /pendingOnboardingIntent/);
});
test("the story is the relationship, not a search box", () => {
  const screen = welcome();

  // Three scenes: the ecosystem, the tenant's side, the provider's side.
  assert.match(screen, /Property\. Renting\./);
  assert.match(screen, /Your home,/);
  assert.match(screen, /Manage property/);

  // Three ways in, and browsing is one of them — it is how somebody uses
  // Rooomly without an account, and `find_property` is the intent the rest of
  // onboarding already knows. Demoting it to a footnote quietly dropped a
  // journey the backend understands.
  assert.match(code(screen), /find_property/);
  assert.match(screen, /title="Just browsing"/);
  assert.match(screen, /no account needed/);

  // Still drawn quieter than the two that begin a relationship.
  assert.match(screen, /quiet\n\s+onPress=\{\(\) => void onChoose\("find_property"\)\}/);
  assert.match(screen, /minHeight: quiet \? 68 : 84/);
});

test("almost nothing to read", () => {
  // One headline and one short line per scene. This is the screen where nobody
  // has any reason to persevere.
  const scenes = welcome().slice(welcome().indexOf("const SCENES"), welcome().indexOf("/** The scenes, then the question. */"));
  for (const line of scenes.matchAll(/line: "([^"]+)"/g)) {
    const words = line[1].split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 16, `${words} words where a line would do — "${line[1]}"`);
  }
  assert.equal((scenes.match(/headline:/g) ?? []).length, 3);
  // Anchored, because `headline:` ends with `line:` and the bare pattern
  // counted every headline twice.
  assert.equal((scenes.match(/^\s+line:/gm) ?? []).length, 3);
});

test("the illustrations are assets, not shapes drawn in code", () => {
  // The version before this one hand-authored the street: walls as rects, roofs
  // as triangles, people as two quadratic curves. It read exactly like what it
  // was, because authoring path data blind is not illustrating. The stage
  // carries artwork now, and this is the guard against drawing it again.
  const body = code(world());
  const crest = code(read("mobile/src/components/welcome/AuthCrest.tsx"));
  const drawn = /<(Path|Circle|Ellipse|Polygon|Polyline|G)[\s/>]/;
  assert.doesNotMatch(body, drawn);
  assert.doesNotMatch(crest, drawn);

  // Bundled, never fetched. A first launch on a slow connection is exactly when
  // a downloaded scene would make the product feel broken, so the cost is paid
  // once in install size instead.
  const manifest = read("mobile/src/components/welcome/scenes.ts");
  for (const source of [manifest, body, crest]) {
    assert.doesNotMatch(source, /uri:|https?:\/\//);
  }

  // Every layer is a plain view translating on the UI thread. Nothing animates
  // an SVG property, which in React Native costs a JavaScript round trip per
  // frame, and nothing animates on the JS thread at all.
  //
  // This used to assert `useNativeDriver: true` on the pager's `Animated.event`.
  // The offset is a Reanimated shared value now, written by a scroll handler
  // that is itself a worklet — there is no driver flag to set because there is
  // no JS-thread path to opt out of.
  assert.doesNotMatch(body, /createAnimatedComponent/);
  assert.match(code(welcome()), /useAnimatedScrollHandler\(/);
  assert.match(code(welcome()), /scroll\.value = event\.contentOffset\.x/);
  // And the layers read that value directly rather than each rebuilding an
  // interpolation chain of their own on every render.
  assert.match(code(body), /useAnimatedStyle\(/);
  assert.doesNotMatch(code(body), /\.interpolate\(/);

  // Depth is the difference between the layers *of one scene*, not a decoration
  // spread across the set: a far layer and a near layer travelling at the same
  // rate is a flat picture sliding. Counted per scene, because a global tally
  // of distinct depths is answered by whichever scene still happens to differ.
  const scenes = [...manifest.matchAll(/layers: \[([\s\S]*?)\n  \],/g)].map((match) => match[1]);
  assert.ok(scenes.length >= 3, "the scenes lost their layers");
  for (const scene of scenes) {
    const depths = [...scene.matchAll(/depth: ([\d.]+)/g)].map((match) => Number(match[1]));
    assert.ok(depths.length >= 2, "a scene is down to a single layer");
    assert.equal(new Set(depths).size, depths.length, "two layers of one scene share a rate");

    // Every one of those layers is bundled — not just enough of them to answer
    // a search of the whole file.
    const bundled = scene.match(/require\("\.\.\/\.\.\/\.\.\/assets\/welcome\/[\w-]+\.webp"\)/g);
    assert.equal(bundled?.length, depths.length, "a layer is not bundled with the app");
  }

  // The art has a budget. It ships inside the app, and somebody pays for that
  // install on a metered connection.
  assert.match(read("mobile/assets/welcome/README.md"), /180 KB per file/);
});test("motion is offered, never imposed", () => {
  // The only motion left is the parallax, and it is tied to a finger that is
  // already moving. Somebody who has asked the system to stop animations has
  // asked for this one too, so the layers hold still and the scenes simply
  // cross-fade.
  const body = code(world());
  assert.match(body, /useReduceMotion\(\)/);
  assert.match(body, /reduceMotion\s*\n?\s*\?\s*\n?\s*0/);
  // Programmatic paging does not animate when the system asks it not to.
  assert.match(code(welcome()), /animated: !reduceMotion/);
});test("the progress is Rooomly's, not a row of dots", () => {
  const body = code(progress());
  assert.match(body, /accessibilityRole="progressbar"/);
  // Segments that fill, the same shape property setup uses.
  assert.match(body, /SEGMENT/);
  assert.match(body, /translateX: interpolate\(/);
  assert.match(body, /Extrapolation\.CLAMP/);
  // Scaling would grow the fill from the centre of each segment.
  assert.doesNotMatch(body, /scaleX/);
});

test("the provider-to-choice boundary never changes layout", () => {
  const screen = code(welcome());

  // The footer used to replace a row with a differently sized column after
  // momentum ended, resizing the flex pager and shifting every bottom-aligned
  // child. Both control states now remain mounted in one fixed frame.
  assert.match(screen, /function JourneyControls\(/);
  assert.match(screen, /<View style=\{\{ height: 52 \}\}>/);
  assert.ok((screen.match(/<Animated\.View/g) ?? []).length >= 2);
  assert.doesNotMatch(screen, /\{atEnd \? \(\s*<View/);

  // The swipe drives both layers on the UI thread; React state only changes
  // which already-mounted layer can receive touches. Each layer is one worklet
  // computing its own opacity and shift together, rather than four separate
  // interpolations of the same offset.
  assert.match(screen, /const journeyStyle = useAnimatedStyle\(/);
  assert.match(screen, /const choiceStyle = useAnimatedStyle\(/);
  assert.doesNotMatch(screen, /\.interpolate\(/);

  // A returning user cannot render one frame of stop one before stop four.
  assert.match(screen, /scroll\.value = opening \* widthRef\.current/);

  // Bundled artwork is decoded before the pager mounts.
  assert.match(screen, /Asset\.loadAsync\(WELCOME_ASSET_MODULES\)/);
  assert.match(read("mobile/src/components/welcome/scenes.ts"), /WELCOME_ASSET_MODULES/);
});

test("the final choice remains touchable when iOS settles without momentum", () => {
  const screen = code(welcome());

  // Android commonly completes a paged swipe with a momentum event; iOS can
  // settle directly from drag-end. Both paths must synchronise the state that
  // controls pointer events for the two final links.
  assert.match(screen, /onScrollEndDrag=\{finishDrag\}/);
  assert.match(screen, /onMomentumScrollEnd=\{finishMomentum\}/);
  assert.match(screen, /Platform\.OS !== "ios"/);
  assert.match(screen, /targetContentOffset\?\.x/);
  assert.match(screen, /setStop\(stopForOffset\(offset\)\)/);
});

test("the way out is reachable on every device", () => {
  const screen = code(welcome());
  // Controls sit inside the safe area, clear of the home indicator and notch.
  assert.match(screen, /useSafeAreaInsets/);
  assert.match(screen, /insets\.bottom \+ space\[5\]/);
  // The top inset reaches the scenes: they receive it as a number, so the
  // page reads `insets.top` once and each scene pads by it.
  assert.match(screen, /insets=\{insets\.top\}/);
  assert.match(screen, /paddingTop: insets \+ space\[6\]/);
  // Tap targets meet the product's own minimum.
  assert.match(screen, /width: theme\.targetMin/);
  assert.match(screen, /hitSlop=\{12\}/);
  // Swiping is the primary gesture; the arrow is the alternative.
  assert.match(screen, /pagingEnabled/);
});

test("the introduction is a screen a signed-out person may be on", () => {
  // `SIGNED_OUT_SCREENS` is a list that does not fail loudly: a missing entry
  // bounces somebody back the instant they tap through.
  const body = gate();
  const list = body.slice(body.indexOf("SIGNED_OUT_SCREENS = ["), body.indexOf("];", body.indexOf("SIGNED_OUT_SCREENS = [")));
  for (const screen of ["welcome", "sign-in"]) {
    assert.ok(list.includes(`"${screen}"`), `${screen} is not a signed-out screen`);
  }
});
