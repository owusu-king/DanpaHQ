/**
 * The Housing Passport on mobile (ADR 0035).
 *
 * The phone and the laptop must say the same thing about the same record, so
 * the words are mirrored from web and compared here; the API is the shared
 * contract, so the endpoints are too. The recipient's view stays on web.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const webPath = new URL("../../web/src/lib/passport.ts", import.meta.url);
const web = existsSync(webPath) ? readFileSync(webPath, "utf8") : null;

const lib = () => read("src/passport.ts");
const meaning = () => read("src/passportMeaning.ts");
const screen = () => read("app/(app)/passport.tsx");
const parts = () => [
  "src/components/passport/PassportDocument.tsx",
  "src/components/passport/ShareSheet.tsx",
  "src/components/passport/SharedLinks.tsx",
  "src/components/passport/CorrectionSheet.tsx",
].map(read).join("\n");

/** From the `--- words` rule to the end, without the link builder each client owns. */
function words(source) {
  const start = source.indexOf("// --- words");
  assert.notEqual(start, -1, "no words section");
  let rest = source.slice(start);
  const link = rest.indexOf("export function shareUrl");
  if (link !== -1) {
    const end = rest.indexOf("\n}\n", link) + 3;
    rest = rest.slice(0, link) + rest.slice(end).replace(/^\n/, "");
  }
  return rest.replace(/\r\n/g, "\n").trim();
}

test("a status reads the same on the phone as on the laptop", { skip: !web }, () => {
  assert.equal(words(meaning()), words(web), "passportMeaning has drifted from web/src/lib/passport.ts");
});

test("both clients call the same endpoints", { skip: !web }, () => {
  const paths = (source) => [...source.matchAll(/apiFetch<[^>]+>\(\s*[`"](\/me\/passport\/[^`"]*)[`"]/g)].map((match) => match[1]).sort();
  const owner = paths(web.replaceAll("authedFetch<", "apiFetch<"));
  assert.ok(owner.length >= 6, "no owner endpoints parsed from web");
  assert.deepEqual(paths(lib()), owner);
});

test("the token travels in the fragment, and the recipient's read stays on web", () => {
  assert.match(lib(), /`\$\{origin\}\/shared-passport#\$\{token\}`/);
  assert.doesNotMatch(lib() + parts() + screen(), /\/passport-shares\/open\/|shared-passport\?/);
});

test("with no web origin the app makes no link, and says to share from the web", () => {
  const share = read("src/components/passport/ShareSheet.tsx");
  assert.match(lib(), /export function webOrigin\(\): string \| null \{/);
  assert.match(share, /const canLink = webOrigin\(\) !== null;/);
  assert.match(share, /\{canLink \? \(\n\s*<SheetPrimaryButton label="Create link"/);
  assert.match(share, /Share it from the web for now/);
});

test("the passport is reached from the tenant's More and has its own stack title", () => {
  assert.match(read("app/(app)/(tabs)/profile.tsx"), /label: "Housing Passport", onPress: go\("\/\(app\)\/passport"\)/);
  assert.match(read("app/(app)/_layout.tsx"), /<Stack\.Screen name="passport" options=\{\{ title: "Housing Passport" \}\} \/>/);
});

test("sharing and reporting happen in the app's one sheet, with copy and the native Share sheet", () => {
  for (const sheet of ["ShareSheet.tsx", "CorrectionSheet.tsx"]) {
    const source = read(`src/components/passport/${sheet}`);
    assert.match(source, /<BottomSheet\b/);
    assert.match(source, /<SheetPrimaryButton\b/);
    assert.doesNotMatch(source, /<Modal\b/);
  }
  const share = read("src/components/passport/ShareSheet.tsx");
  assert.match(share, /type Step = "choose" \| "preview" \| "ready"/);
  assert.match(share, /await previewPassport\(scope\)/);
  assert.match(share, /<PassportDocument\b[\s\S]*audience="recipient"/);
  assert.match(share, /Share\.share\(/);
  assert.match(read("src/components/passport/SharedLinks.tsx"), /Clipboard\.setStringAsync\(url\)/);
  // Amounts are opt-in, as on web.
  assert.match(share, /setAmounts\(false\);/);
});

test("every empty state is the struck glyph, and nothing on the client invents a score", () => {
  const all = screen() + parts();
  assert.match(screen(), /<Empty\s+icon="home-outline"/);
  assert.match(read("src/components/passport/SharedLinks.tsx"), /<Empty\s+compact\s+icon="link-outline"/);
  assert.doesNotMatch(all, /\bscore\b|rating|stars?\b/i);
});

test("bold only where it is needed, and no ripple or Reanimated", () => {
  const all = screen() + parts();
  assert.doesNotMatch(all, /fontWeight: "(?:700|800|900|bold)"/);
  assert.doesNotMatch(all, /android_ripple|react-native-reanimated/);
});

test("no inline style reads `.value`, which makes Babel load Reanimated", () => {
  // Expo's Babel preset runs the Worklets plugin because Reanimated sits under
  // expo-router. It takes `x.value` inside an inline style for a shared value
  // and injects `require("react-native-reanimated")`; in Expo Go that load
  // fails ("Mismatch between JavaScript part and native part of Worklets") and
  // the screen breaks. The passport's rent bar did exactly this, and only the
  // iPhone showed it: web never runs that path.
  const offenders = [];
  for (const group of ["app", "src"]) {
    const root = new URL(`../${group}/`, import.meta.url);
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
      const where = `${entry.parentPath ?? entry.path}`.replaceAll("\\", "/");
      const source = readFileSync(new URL(entry.name, `file://${where}/`), "utf8");
      if (/style=\{\{[^}]*\b\w+\.value\b/.test(source)) offenders.push(`${where.split("/mobile/").pop()}/${entry.name}`);
    }
  }
  assert.deepEqual(offenders, []);
});
