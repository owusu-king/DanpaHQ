import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  const stop = source.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, `${end} is missing after ${start}`);
  return source.slice(at, stop);
};

const ROWS = "mobile/src/components/account/IndexRows.tsx";
const TENANT = "mobile/app/(app)/(tabs)/profile.tsx";
const PROVIDER = "mobile/app/(app)/(provider-tabs)/more.tsx";

test("each side has one index, built from one set of rows", () => {
  const more = read(PROVIDER);
  const tab = read(TENANT);

  // There was a Settings screen between the tenant tab and its own account
  // destinations, listing most of the same rows a second time. Two lists that
  // must be kept in step by hand is how they drifted apart.
  assert.ok(
    !existsSync(resolve(root, "mobile/app/(app)/settings.tsx")),
    "settings.tsx is back — the account rows have two homes again",
  );
  for (const screen of [more, tab]) {
    assert.match(screen, /from "@\/components\/account\/IndexRows"/);
    for (const route of ["profile-edit", "security", "notification-settings", "trust"]) {
      assert.match(screen, new RegExp(`/\\(app\\)/${route}"`), `${route} is missing from an index`);
    }
  }

  // What they list differs, and should: a tenant has no Team and no Archive,
  // a provider has no rental history.
  assert.match(more, /label="Team"/);
  assert.match(more, /label="Archive"/);
  assert.doesNotMatch(tab, /label="Team"/);
  assert.doesNotMatch(tab, /label="Archive"/);
  assert.match(tab, /label="Applications"/);
  assert.doesNotMatch(more, /label="Applications"/);
});

test("an index is a navigation surface, not an information page", () => {
  const rows = read(ROWS);
  const more = read(PROVIDER);
  const tab = read(TENANT);

  // A row that says Security and leads to Security needs no sentence under it.
  assert.doesNotMatch(rows, /detail/);
  for (const screen of [more, tab]) {
    assert.doesNotMatch(screen, /<Surface/);
    assert.doesNotMatch(screen, /detail=/);
  }

  // Changing view and leaving are acts, not destinations.
  assert.match(more, /Switch to renting/);
  assert.match(tab, /Switch to managing property/);
  for (const screen of [more, tab]) {
    assert.match(screen, /label="Sign out"/);
  }
});

test("More is a hub of sections, not a profile page", () => {
  const tab = code(read(TENANT));
  const more = code(read(PROVIDER));
  const layout = read("mobile/app/(app)/(tabs)/_layout.tsx");

  // The header names the page what the tab bar calls it. It said "Profile" over
  // a tab called More.
  assert.match(layout, /<Tabs\.Screen name="profile" options=\{\{ title: "More", tabBarLabel: "More",/);

  // Nobody's photo, name or number opens it. Who you are is behind the Profile
  // row, and the page opens with its sections, in the order they were agreed.
  assert.doesNotMatch(tab, /display_name|phone_display|avatar_url|resolvePhotoUrl|<Image\b/);
  assert.match(tab, /return \(\s*<IndexPage>\s*\{invitationsWaiting \? \(\s*<Group title="Waiting for you"/);
  assert.deepEqual(
    [...tab.matchAll(/<Group title="([^"]+)"/g)].map((match) => match[1]),
    ["Waiting for you", "Your shortlist", "Your history", "Account and settings"],
  );
  assert.match(tab, /<AuthPrompt\s+icon="list"/);
  assert.match(tab, /next="\/\(app\)\/\(tabs\)\/profile"/);

  // Both indexes stand on the same page, and the provider's keeps its order.
  assert.match(more, /return \(\s*<IndexPage>\s*\{invitations \? \(\s*<Group title="Waiting for you"/);
  assert.deepEqual(
    [...more.matchAll(/<Group title="([^"]+)"/g)].map((match) => match[1]),
    ["Waiting for you", "Management", "Growth and trust", "Account and settings"],
  );
});

test("a signed-out tab gives a reason and both ways in", () => {
  // The prompt was a display heading, an info `Notice` carrying the body copy,
  // and a button saying "Sign In" — on bare ivory, while the signed-in version
  // of the same tab stood on the hub's ground behind frosted glass. So the tab
  // changed character on sign-in, a warning shape was doing the work of a
  // paragraph, and the one control assumed an account the reader may not have.
  const prompt = code(read("mobile/src/components/AuthPrompt.tsx"));

  // The same ground as the tab it stands in.
  assert.match(prompt, /<IndexGround>/);
  assert.doesNotMatch(prompt, /<Notice/);

  // A reason before the ask, in this tab's own colour and glyph.
  assert.match(prompt, /points\?: PromptPoint\[\];/);
  assert.match(prompt, /const hue = TONE\[tone\];/);

  // Both ways in. Sign-in is the act; making an account is beside it, not
  // behind it.
  assert.match(prompt, /<PromptAct label="Sign in" onPress=\{\(\) => go\("\/\(auth\)\/sign-in"\)\} \/>/);
  assert.match(prompt, /go\("\/\(auth\)\/phone"\)/);
  // The workspace intent is still written down, and the tab still comes back.
  assert.match(prompt, /rememberOnboardingIntent\("find_property"\)\.then/);
  assert.match(prompt, /params: \{ next, intent: "find_property" \}/);

  // Every screen that shows it gives it a glyph, a colour and its promises, so
  // no tab falls back to a generic wall.
  for (const path of [
    "mobile/app/(app)/(tabs)/profile.tsx",
    "mobile/app/(app)/(tabs)/services.tsx",
    "mobile/app/(app)/tenant-payments.tsx",
    "mobile/app/(app)/saved.tsx",
  ]) {
    const screen = code(read(path));
    assert.match(screen, /<AuthPrompt\s+icon="/, `${path}: the prompt has no glyph`);
    assert.match(screen, /\n\s+tone="/, `${path}: the prompt has no colour`);
    assert.match(screen, /points=\{\[/, `${path}: the prompt gives no reason`);
  }
});

test("each group is one glass panel, and its rows share one colour", () => {
  const rows = code(read(ROWS));

  // One frosted panel per group, clipped inside so a press never paints past
  // its corners, on a ground the chrome's green reaches into.
  assert.match(rows, /const GLASS = alpha\(WHITE, 0\.72\);/);
  assert.match(rows, /panel: \{\s*backgroundColor: GLASS,\s*borderWidth: 1,\s*borderColor: GLASS_EDGE,/);
  assert.match(rows, /<View style=\{\{ borderRadius: geometry\.panelRadius - 1, overflow: "hidden" \}\}>/);
  assert.match(rows, /<IndexGround>\s*<ScrollView/);
  assert.match(rows, /pointerEvents="none"\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/);
  assert.match(rows, /const id = `index\$\{useId\(\)\.replace\(\/\[\^a-zA-Z0-9\]\/g, ""\)\}`;/);

  // Android draws elevation through a translucent fill as a smudge, so only the
  // other platforms lift a panel, and only by a whisper.
  assert.match(rows, /style=\{\[styles\.panel, isAndroid \? null : styles\.panelLift,/);
  const lift = /panelLift: \{[^}]*shadowOpacity: ([\d.]+)/.exec(rows);
  assert.ok(lift && Number(lift[1]) <= 0.06, `a panel's shadow is a whisper: ${lift?.[1]}`);

  // Hairlines go between the rows that remain, inset past the glyph, and a group
  // a role has emptied draws nothing.
  assert.match(
    rows,
    /\{index \? \(\s*<View\s+style=\{\{\s*height: StyleSheet\.hairlineWidth,\s*marginLeft: geometry\.inset \+ geometry\.well \+ geometry\.gap,/,
  );
  assert.match(rows, /if \(!rows\.length\) return null;/);
  assert.match(rows, /<Type\s+variant="label"\s+accessibilityRole="header"/);

  // A row takes its colour from its group, in the families Services sorts by.
  assert.match(rows, /import \{ TONE \} from "@\/components\/services\/ServiceGlyph";/);
  assert.match(rows, /<GroupTone\.Provider value=\{tone\}>/);
  assert.match(rows, /const palette = TONE\[useContext\(GroupTone\)\];/);
  assert.match(rows, /backgroundColor: palette\.wash,/);
  assert.match(rows, /<Ionicons name=\{icon\} size=\{geometry\.glyph\} color=\{palette\.ink\} \/>/);

  // Every group names a colour, neighbours never share one, and Verification is
  // never laterite: a shield in that colour reads as a check that failed.
  for (const path of [TENANT, PROVIDER]) {
    const screen = code(read(path));
    const groups = screen.split("<Group ").slice(1);
    assert.ok(groups.length >= 3, `${path}: expected its groups`);
    const tones = groups.map((group) => /^title="[^"]+" tone="([a-z]+)">/.exec(group)?.[1]);
    assert.ok(tones.every(Boolean), `${path}: a group without a colour`);
    tones.forEach((tone, index) => {
      if (index) assert.notEqual(tone, tones[index - 1], `${path}: neighbouring groups share ${tone}`);
    });
    const verification = groups.findIndex((group) => /label="Verification"/.test(group));
    assert.notEqual(verification, -1, `${path}: Verification is missing`);
    assert.notEqual(tones[verification], "laterite", `${path}: Verification stands in laterite`);
  }
});

test("the index's colours read on what they stand on", () => {
  const tokens = JSON.parse(read("packages/design-tokens/tokens.json"));
  const rows = code(read(ROWS));
  const glyph = code(read("mobile/src/components/services/ServiceGlyph.tsx"));
  const plinth = code(read("mobile/src/components/home/plinth.tsx"));

  const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const token = (family, step) => channels(tokens.color[family][step].value);
  const mix = (base, over, amount) => base.map((value, index) => value + (over[index] - value) * amount);
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((value) => {
      const unit = value / 255;
      return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const number = (pattern, source = rows) => {
    const match = pattern.exec(source);
    assert.ok(match, `${pattern} is missing`);
    return Number(match[1]);
  };

  const white = token("field", "0");
  const kola = token("kola", "600");
  // The deepest the ground gets, just under the header: the floor, then the aura.
  const floor = number(/const FLOOR_OPACITY = ([\d.]+);/);
  const aura = number(/const AURA_OPACITY = ([\d.]+);/);
  assert.ok(floor + aura <= 0.16, `a tone under the header, never the Homes' green: ${floor + aura}`);
  const ground = mix(mix(token("field", "50"), kola, floor), kola, aura);
  const glass = mix(ground, white, number(/const GLASS = alpha\(WHITE, ([\d.]+)\);/));

  assert.ok(contrast(mix(ground, token("kola", "900"), number(/const LABEL = alpha\(DEEP, ([\d.]+)\);/)), ground) >= 4.5, "a group's name on the ground");
  assert.ok(contrast(token("ink", "900"), glass) >= 12, "a row's name on glass");
  assert.match(rows, /color: theme\.color\.ink\["900"\] \}\}/);

  // Each colour a group can take puts its glyph at 3:1 or better on its wash.
  const tones = [...glyph.matchAll(/(\w+): \{ ink: theme\.color\.(\w+)\["(\d+)"\], wash: theme\.color\.(\w+)\["(\d+)"\] \}/g)];
  assert.ok(tones.length >= 4, "the tone families were not found");
  for (const [, name, inkFamily, inkStep, washFamily, washStep] of tones) {
    assert.ok(contrast(token(inkFamily, inkStep), token(washFamily, washStep)) >= 3, `${name}: glyph on its wash`);
  }

  // A count is white on kola.
  assert.ok(contrast(white, token("kola", "600")) >= 4.5, "a count on kola-600");
  assert.match(rows, /count: \{[^}]*backgroundColor: theme\.color\.kola\["600"\],/);

  // The acts at the foot stand on Home's frosted glass: the switch's words in ink
  // at 70% with its eyebrow and glyph in kola, and Sign out in laterite.
  assert.match(rows, /backgroundColor: ph\.glass,/);
  const footGlass = mix(ground, white, number(/glass: "rgba\(255,255,255,([\d.]+)\)",/, plinth));
  const ink70 = number(/ink70: "rgba\(24,22,17,([\d.]+)\)",/, plinth);
  assert.ok(contrast(mix(footGlass, [24, 22, 17], ink70), footGlass) >= 4.5, "the switch's words on glass");
  assert.ok(contrast(token("kola", "600"), footGlass) >= 4.5, "the switch's eyebrow on glass");
  assert.ok(contrast(token("laterite", "600"), footGlass) >= 4.5, "Sign out on glass");
});

test("changing experience and signing out are designed acts that still say what they do", () => {
  const rows = code(read(ROWS));
  const tab = code(read(TENANT));
  const more = code(read(PROVIDER));

  // Both indexes end on the same two acts, with the words they always had, and
  // the text links they replaced are gone from both.
  assert.match(tab, /available_workspaces\.includes\("provider"\) \? \(\s*<SwitchExperienceButton/);
  assert.match(
    tab,
    /<SwitchExperienceButton\s+label="Switch to managing property"\s+busyLabel="Switching…"\s+busy=\{switching\}\s+onPress=\{\(\) => void switchToProvider\(\)\}/,
  );
  assert.match(
    more,
    /<SwitchExperienceButton\s+label="Switch to renting"\s+busyLabel="Switching…"\s+busy=\{switching\}\s+onPress=\{\(\) => void switchToTenant\(\)\}/,
  );
  for (const screen of [tab, more]) {
    assert.match(screen, /<IndexActions>[\s\S]*<SwitchExperienceButton[\s\S]*<SignOutButton\s+label="Sign out"\s+busyLabel="Signing out…"\s+busy=\{leaving\}/);
    assert.match(screen, /await signOut\(\);\s*router\.replace\("\/\(auth\)\/start"\);/);
    assert.doesNotMatch(screen, /<QuietLink/);
  }

  // A switch that fails says so beside the switch, not at the top of the page.
  assert.match(tab, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}\s*<IndexActions>/);

  // Both acts are one glass tile in two tones (revised on review, 2026-09-15): a
  // button that says when it is working and cannot be pressed twice meanwhile.
  const tile = between(rows, "function ActionTile(", "export function SwitchExperienceButton(");
  assert.match(tile, /accessibilityRole="button"/);
  assert.match(tile, /accessibilityLabel=\{busy \? busyLabel : label\}/);
  assert.match(tile, /aria-busy=\{busy\} aria-disabled=\{busy\}/);
  assert.match(tile, /disabled=\{busy\}/);
  assert.match(tile, /\{busy \? \(\s*<ActivityIndicator size="small"/);
  assert.match(tile, /\{busy \? busyLabel :/);
  assert.match(tile, /onPressIn=\{press\.pressIn\}\s+onPressOut=\{press\.pressOut\}/);

  // Leaving keeps laterite, so it is never mistaken for the way onward.
  assert.match(tile, /const ink = tone === "leave" \? theme\.color\.laterite\["600"\] :/);
  const switcher = between(rows, "export function SwitchExperienceButton(", "export function SignOutButton(");
  const leave = between(rows, "export function SignOutButton(", "export function QuietLink(");
  assert.match(switcher, /<ActionTile[^>]*icon="swap-horizontal"[^>]*tone="switch"/);
  assert.match(leave, /<ActionTile[^>]*icon="log-out-outline"[^>]*tone="leave"/);

  // They press like the tab bar, and Reduce Motion keeps the feedback while
  // dropping the movement.
  const spring = (text) => ({
    speed: Number(/speed:\s*([\d.]+)/.exec(text)?.[1]),
    bounciness: Number(/bounciness:\s*([\d.]+)/.exec(text)?.[1]),
  });
  const press = between(rows, "function usePressSpring()", "function ActionTile(");
  assert.deepEqual(spring(press), spring(code(read("mobile/src/components/nav/MainTabBar.tsx"))));
  assert.match(press, /const reduceMotion = useReduceMotion\(\);/);
  assert.match(press, /if \(reduceMotion\) \{\s*scale\.setValue\(toValue\);\s*return;\s*\}/);
});

test("editing your profile is a focused screen, not the index", () => {
  const editor = read("mobile/app/(app)/profile-edit.tsx");
  const tab = read(TENANT);

  assert.match(editor, /label="Save changes"/);
  assert.doesNotMatch(editor, /Your history/);
  assert.doesNotMatch(editor, /Sign out/);
  assert.doesNotMatch(tab, /from "\.\.\/profile"/);
});

test("mobile notification preferences use real switches and revert on failure", () => {
  const panel = read("mobile/app/(app)/notification-settings.tsx");
  const api = read("mobile/src/notifications.ts");

  assert.match(api, /\/me\/notification-preferences\//);
  assert.match(panel, /<Switch/);
  assert.match(panel, /accessibilityLabel=\{label\}/);
  assert.match(panel, /setPreferences\(previous\)/);
  assert.match(panel, /disabled=\{!preferences\.sms_enabled\}/);
  assert.match(api, /body:\s*input/);
  assert.doesNotMatch(
    api,
    /body:\s*JSON\.stringify\(input\)/,
    "apiFetch already serializes mobile request bodies; preferences must not be encoded twice",
  );
});

test("More stops advertising features that are not enabled", () => {
  const more = read(PROVIDER);

  assert.doesNotMatch(more, /is not enabled yet/);
  // Maintenance is enabled now (apps.maintenance, 2026-10-05). It may be listed
  // only because it opens a real screen, and only for those who operate.
  assert.match(more, /\{operates \? <Row icon="construct-outline" label="Maintenance" onPress=\{\(\) => router\.push\("\/\(app\)\/maintenance" as never\)\} \/> : null\}/);
  assert.doesNotMatch(more, /label="Documents"/);
  assert.doesNotMatch(more, /label="Reports"/);
});

test("no two route files claim the same path", () => {
  // A folder in parentheses contributes nothing to the URL, so
  // `(app)/profile.tsx` and `(app)/(tabs)/profile.tsx` are both `/profile` and
  // one silently wins. That was invisible while the tab merely re-exported its
  // sibling, and broke the moment they became different screens.
  const appDir = resolve(root, "mobile/app/(app)");
  const routes = (dir) => readdirSync(resolve(appDir, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx") && entry.name !== "_layout.tsx")
    .map((entry) => entry.name);

  const top = new Set(routes("."));
  for (const group of ["(tabs)", "(provider-tabs)"]) {
    for (const name of routes(group)) {
      if (!top.has(name)) continue;
      const tab = readFileSync(resolve(appDir, group, name), "utf8");
      assert.match(
        tab,
        /from "\.\.\//,
        `(app)/${name} and (app)/${group}/${name} both resolve to the same path, `
          + "and the tab does not re-export its sibling — one of them is unreachable",
      );
    }
  }
});
