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
const YOU = "mobile/src/components/account/YouParts.tsx";
const TENANT = "mobile/app/(app)/(tabs)/profile.tsx";
const PROVIDER = "mobile/app/(app)/(provider-tabs)/more.tsx";

test("each side has one index, built from one set of parts", () => {
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
    assert.match(screen, /import \{ Identity, YouPage, [^}]*\} from "@\/components\/account\/YouParts";/);
    for (const route of ["profile-edit", "security", "notification-settings", "trust"]) {
      assert.match(screen, new RegExp(`/\\(app\\)/${route}"`), `${route} is missing from an index`);
    }
  }

  // What they list differs, and should: a tenant has no Team and no Archive,
  // a provider has no rental history.
  assert.match(more, /label: "Team"/);
  assert.match(more, /label: "Archive"/);
  assert.doesNotMatch(tab, /label: "Team"/);
  assert.doesNotMatch(tab, /label: "Archive"/);
  assert.match(tab, /label: "Applications"/);
  assert.doesNotMatch(more, /label: "Applications"/);
});

test("an index is a navigation surface, not an information page", () => {
  const you = code(read(YOU));
  const more = read(PROVIDER);
  const tab = read(TENANT);

  // A row that says Security and leads to Security needs no sentence under it.
  assert.doesNotMatch(you, /detail/);
  for (const screen of [more, tab]) {
    assert.doesNotMatch(screen, /<Surface/);
    assert.doesNotMatch(screen, /detail[=:]/);
  }

  // Changing view and leaving are acts, not destinations.
  assert.match(more, /Switch to renting/);
  assert.match(tab, /Switch to managing property/);
  for (const screen of [more, tab]) {
    assert.match(screen, /label: "Sign out", danger: true/);
  }
});

test("More opens with the person, like WhatsApp's You, and then its cards", () => {
  const tab = code(read(TENANT));
  const more = code(read(PROVIDER));
  const layout = read("mobile/app/(app)/(tabs)/_layout.tsx");
  const providerLayout = read("mobile/app/(app)/(provider-tabs)/_layout.tsx");

  // The tab bar names it More; the page stands on its own ground with no bar
  // (owner, 2026-10-06), so the clock turns dark while it is in front.
  assert.match(layout, /<Tabs\.Screen name="profile" options=\{\{ title: "Menu", tabBarLabel: "Menu", headerShown: false,/);
  assert.match(providerLayout, /<Tabs\.Screen name="more" options=\{\{ title: "Menu", tabBarLabel: "Menu", headerShown: false,/);
  const you = code(read(YOU));
  assert.match(you, /\{focused \? <StatusBar style="dark" \/> : null\}/);

  // The photo, name and pencil all open the profile, so there is no Profile row.
  for (const screen of [tab, more]) {
    assert.match(screen, /<Identity\s+name=\{me\.display_name\}\s+photoUri=\{photoUri\}/);
    assert.match(screen, /\(me\.profile\?\.completeness \?\? 0\) < 100/);
    assert.match(screen, /verified=\{me\.is_phone_verified\}\s+onPress=\{go\("\/\(app\)\/profile-edit"\)\}/);
    assert.match(screen, /\{ key: "edit", icon: "pencil", label: "Edit your profile", onPress: go\("\/\(app\)\/profile-edit"\) \}/);
    assert.doesNotMatch(screen, /label: "Profile"/);
  }
  assert.match(tab, /\{ key: "join", icon: "key-outline", label: "Join your home with a code", onPress: go\("\/\(app\)\/tenant-setup"\) \}/);
  assert.match(more, /\{ key: "create", icon: "add", label: "Add or create", onPress: go\("\/\(app\)\/provider-actions"\) \}/);

  // Untitled cards, in the order agreed.
  const keys = (screen) => [...screen.matchAll(/^ {4}\{\n {6}key: "([a-z]+)",/gm)].map((match) => match[1]);
  assert.deepEqual(keys(tab), ["waiting", "renting", "account", "leave"]);
  assert.deepEqual(keys(more), ["waiting", "work", "business", "account", "leave"]);
  assert.doesNotMatch(you, /export type YouSection = \{[^}]*title/);

  assert.match(tab, /<AuthPrompt\s+icon="list"/);
  assert.match(tab, /next="\/\(app\)\/\(tabs\)\/profile"/);
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

test("each card is white and plain, and search reaches every row", () => {
  const you = code(read(YOU));

  // WhatsApp's rows: a line glyph in ink with no well, the body's size and
  // weight, a light chevron, and a hairline that starts where the words start.
  assert.match(you, /<Ionicons name=\{item\.icon\} size=\{24\} color=\{ink\} style=\{styles\.itemIcon\} \/>/);
  assert.match(you, /itemLabel: \{\s*flex: 1,\s*minWidth: 0,\s*fontSize: 17,/);
  assert.match(you, /\{item\.danger \? null : <Ionicons name="chevron-forward" size=\{18\} color=\{CHEVRON\} \/>\}/);
  assert.match(you, /card: \{\s*overflow: "hidden",\s*borderRadius: 26,\s*backgroundColor: WHITE,/);
  assert.match(you, /\{index \? <View style=\{styles\.rule\} \/> : null\}/);
  assert.match(you, /rule: \{\s*height: StyleSheet\.hairlineWidth,\s*marginLeft: 66,/);
  // A card a role has emptied draws nothing.
  assert.match(you, /const visible = sections\.filter\(\(section\) => section\.items\.length\);/);
  // Rows lead to pages; on the web a row is a link, so a button never nests.
  assert.match(you, /accessibilityRole=\{item\.danger \? "button" : "link"\}/);

  // Search filters every row on the page by name, and says so when none match.
  assert.match(you, /sections\.flatMap\(\(section\) => section\.items\)\.filter\(\(item\) => item\.label\.toLocaleLowerCase\("en-GH"\)\.includes\(needle\)\)/);
  assert.match(you, /<Empty icon="search-outline" title="Nothing by that name"/);
  assert.match(you, /<IndexGround>/);

  // Role gating survives the move to data: a row a role would refuse is not listed.
  const more = code(read(PROVIDER));
  assert.match(more, /\.\.\.only\(operates, \{ key: "units", icon: "grid-outline", label: "Units", onPress: go\("\/\(app\)\/units"\) \}\)/);
  assert.match(more, /\.\.\.only\(operates \|\| finances, \{ key: "leases"/);
  assert.match(more, /\.\.\.only\(billing, \{ key: "settlement"/);
  assert.match(more, /\.\.\.only\(billing, \{ key: "billing"/);
  assert.match(more, /\.\.\.only\(operates, \{ key: "archive"/);
  assert.match(more, /label: "Updates", count: unread,/);
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

  // The WhatsApp-style cards: words in ink on white, leaving in laterite on white.
  const you = code(read(YOU));
  assert.match(you, /const WHITE = theme\.color\.field\["0"\];/);
  assert.match(you, /const INK = theme\.color\.ink\["900"\];/);
  assert.ok(contrast(token("ink", "900"), white) >= 12, "a row's name on its card");
  assert.ok(contrast(token("laterite", "600"), white) >= 4.5, "Sign out on its card");
  assert.match(you, /count: \{[^}]*backgroundColor: theme\.color\.kola\["600"\],/);

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

test("changing experience and signing out are the last card, and still say what they do", () => {
  const you = code(read(YOU));
  const tab = code(read(TENANT));
  const more = code(read(PROVIDER));

  assert.match(tab, /\.\.\.\(me\.capabilities\.available_workspaces\.includes\("provider"\)\s*\? \[\{ key: "switch", icon: "swap-horizontal-outline" as const, label: "Switch to managing property", busy: switching, busyLabel: "Switching…", onPress: \(\) => void switchToProvider\(\) \}\]/);
  assert.match(more, /\{ key: "switch", icon: "swap-horizontal-outline", label: "Switch to renting", busy: switching, busyLabel: "Switching…", onPress: \(\) => void switchToTenant\(\) \}/);
  for (const screen of [tab, more]) {
    assert.match(screen, /key: "leave",\s*items: \[[\s\S]*key: "switch"[\s\S]*\{ key: "sign-out", icon: "log-out-outline", label: "Sign out", danger: true, busy: leaving, busyLabel: "Signing out…", onPress: \(\) => void leave\(\) \}/);
    assert.match(screen, /await signOut\(\);\s*router\.replace\("\/\(auth\)\/start"\);/);
    // A switch that fails says so under the card it was pressed in.
    assert.match(screen, /notice=\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
    assert.match(screen, /setError\(cause instanceof ApiFailure \? cause\.error\.message : "Could not switch\."\);/);
  }

  // A row that is working says so and cannot be pressed twice; leaving is laterite.
  assert.match(you, /aria-busy=\{item\.busy\}\s+disabled=\{item\.busy\}/);
  assert.match(you, /\{item\.busy \? \(\s*<ActivityIndicator size="small"/);
  assert.match(you, /item\.busy && item\.busyLabel \? item\.busyLabel : item\.label/);
  assert.match(you, /const DANGER = theme\.color\.laterite\["600"\];/);
  assert.match(you, /const ink = item\.danger \? DANGER : INK;/);
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
  assert.match(more, /\.\.\.only\(operates, \{ key: "maintenance", icon: "construct-outline", label: "Maintenance", onPress: go\("\/\(app\)\/maintenance"\) \}\)/);
  assert.doesNotMatch(more, /label: "Documents"/);
  assert.doesNotMatch(more, /label: "Reports"/);
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
