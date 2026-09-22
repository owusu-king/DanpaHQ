/**
 * Your profile, on mobile: the photo and the names other people see.
 *
 * Redesigned on review (2026-09-15) to carry as few words as it can. These tests
 * hold what must not be lost on the way there: everything the editor could do,
 * a session that arrives after the screen, the refusal to dress completeness as
 * verification, and type that still reads on the glass it stands on.
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
const editor = () => code(read("app/(app)/profile-edit.tsx"));

test("the editor keeps everything it could do", () => {
  const source = editor();

  // The names are saved to the account, with the data saver carried unchanged.
  assert.match(
    source,
    /await apiFetch\("\/me\/", \{\s*method: "PATCH",\s*body: \{\s*first_name: firstName,\s*last_name: lastName,\s*preferred_name: preferredName,\s*data_saver: dataSaver,\s*\},\s*\}\);\s*await refreshMe\(\);\s*setSaved\(true\);/,
  );

  // The photo is asked for when it is wanted, cropped square for the circle,
  // uploaded as an avatar, linked, and can be taken away again.
  assert.match(source, /ImagePicker\.requestMediaLibraryPermissionsAsync\(\)/);
  assert.match(source, /allowsEditing: true,\s*aspect: \[1, 1\],/);
  assert.match(source, /await uploadImage\(result\.assets\[0\], "avatar"\);/);
  assert.match(source, /await setProfilePhoto\(stored\.id\);/);
  assert.match(source, /await setProfilePhoto\(null\);/);
  assert.match(source, /if \(!photoUri\) \{\s*void choosePhoto\(\);\s*return;\s*\}/);
  assert.match(source, /\{ text: "Choose a new photo", onPress: \(\) => void choosePhoto\(\) \}/);
  assert.match(source, /\{ text: "Remove photo", style: "destructive", onPress: \(\) => void removePhoto\(\) \}/);
  // A photo that resolves after it has changed never flashes the old one.
  assert.match(source, /if \(live\) setPhotoUri\(url\);/);

  // The number and the figure are still shown, and failure is still said.
  assert.match(source, /phone=\{me\.phone_display\}/);
  assert.match(source, /completeness=\{me\.profile\?\.completeness \?\? 0\}/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(
    source,
    /<SaveButton\s+label="Save changes"\s+busyLabel="Saving…"\s+busy=\{saving\}\s+saved=\{saved\}\s+onPress=\{save\}/,
  );
});

test("a session that arrives after the screen fills the fields once, and never over typing", () => {
  const source = editor();

  // A refresh or a link straight here mounts the screen behind the launch
  // curtain, before the account is known. The fields opened empty, and a save
  // from there sent empty names and switched the data saver off.
  assert.match(source, /const \[dataSaver, setDataSaver\] = useState\(me\?\.data_saver \?\? false\);/);
  assert.match(source, /const seeded = useRef\(me !== null\);/);
  assert.match(
    source,
    /if \(!me \|\| seeded\.current\) return;\s*seeded\.current = true;\s*setFirstName\(me\.first_name\);\s*setLastName\(me\.last_name\);\s*setPreferredName\(me\.preferred_name\);\s*setDataSaver\(me\.data_saver\);\s*\}, \[me\]\);/,
  );
  // Hooks run before the screen can return early, or React's order breaks.
  assert.match(between(source, "export default function ProfileScreen()", "if (!me) return null;"), /const seeded = useRef/);

  // "Saved" answers the last save: an edit after it is not saved yet.
  assert.match(source, /const edit = \(set: \(value: string\) => void\) => \(value: string\) => \{\s*setSaved\(false\);\s*set\(value\);\s*\};/);
  for (const [label, setter] of [["Preferred name", "setPreferredName"], ["First name", "setFirstName"], ["Surname", "setLastName"]]) {
    assert.match(source, new RegExp(`label="${label}"[\\s\\S]{0,80}onChangeText=\\{edit\\(${setter}\\)\\}`), label);
  }
});

test("the page carries as few words as it can", () => {
  const source = editor();

  for (const phrase of [
    "YOUR PHOTO",
    "YOUR NUMBER",
    "This is how you sign in",
    "A fuller profile gets more replies",
    "Optional. Tap to",
    "What should we call you?",
  ]) {
    assert.doesNotMatch(source, new RegExp(phrase.replace(/[.?]/g, "\\$&")), `"${phrase}" is back on the page`);
  }

  // One sentence stays, because it is about who can see you.
  assert.match(source, />\s*Landlords and agents see your preferred name\.\s*</);

  // The camera says the photo can be changed and the lock says the number is how
  // you sign in; a screen reader hears both in words.
  assert.match(source, /<Ionicons name="camera"/);
  assert.match(source, /<Ionicons name="lock-closed"/);
  assert.match(source, /accessibilityLabel=\{photoUri \? "Change or remove your profile photo" : "Add a profile photo"\}/);
  assert.match(source, /accessibilityLabel=\{`Signed in with \$\{phone\}\. Profile \$\{completeness\}% complete\.`\}/);
});

test("completeness is a ring and a number, never a mark of verification", () => {
  const identity = between(editor(), "function Identity(", "function Initials(");

  assert.match(identity, /<CompletenessRing size=\{ring\} value=\{completeness\} \/>/);
  assert.match(identity, /const share = Math\.max\(0, Math\.min\(1, value \/ 100\)\);/);
  assert.match(identity, /strokeDashoffset=\{circumference \* \(1 - share\)\}/);
  // An empty profile draws no arc, rather than a dot at twelve o'clock.
  assert.match(identity, /\{share > 0 \? \(/);

  // A complete profile is not a verified one, so nothing near the figure may
  // look like a check that passed.
  assert.doesNotMatch(identity, /checkmark|shield|Stamp|verified/i);
});

test("the names are one glass panel of real inputs, on the hub ground", () => {
  const source = editor();

  // The ground More and Services stand on, with a scroller that keeps a tap on
  // Save while the keyboard is open.
  assert.match(source, /import \{ IndexGround \} from "@\/components\/account\/IndexRows";/);
  assert.match(code(read("src/components/account/IndexRows.tsx")), /export function IndexGround\(/);
  assert.match(
    source,
    /<IndexGround>\s*<KeyboardAvoidingView style=\{\{ flex: 1 \}\} behavior=\{isIOS \? "padding" : undefined\}>\s*<ScrollView/,
  );
  assert.match(source, /keyboardShouldPersistTaps="handled"/);

  // No white surfaces and no stacked form fields: one panel of inline rows.
  assert.doesNotMatch(source, /<Surface|<Field\b/);
  assert.match(
    source,
    /<GlassPanel>\s*<NameRow\s+label="Preferred name"[\s\S]*?<NameRow\s+label="First name"[\s\S]*?<NameRow\s+label="Surname"[\s\S]*?<\/GlassPanel>/,
  );
  assert.match(source, /panel: \{\s*borderRadius: PANEL_RADIUS,\s*backgroundColor: GLASS,\s*borderWidth: 1,\s*borderColor: GLASS_EDGE,/);
  assert.match(source, /style=\{\[styles\.panel, isAndroid \? null : styles\.panelLift\]\}/);

  // Each row is an input a screen reader can name, with the platform's hints.
  const row = between(source, "function NameRow(", "function SaveButton(");
  assert.match(row, /accessibilityLabel=\{label\}/);
  assert.match(row, /autoCapitalize="words"/);
  assert.match(row, /maxFontSizeMultiplier=\{maxFontSizeMultiplier\}/);
  assert.match(row, /focused \? \{ backgroundColor: FOCUS \} : null/);
  for (const hint of ["nickname", "givenName", "familyName"]) {
    assert.match(source, new RegExp(`textContentType="${hint}"`), hint);
  }
});

test("the words left read on the ground and on the glass", () => {
  const tokens = JSON.parse(read("../packages/design-tokens/tokens.json"));
  const source = editor();
  const rows = code(read("src/components/account/IndexRows.tsx"));
  const plinth = code(read("src/components/home/plinth.tsx"));

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
  const number = (text, pattern) => Number(pattern.exec(text)?.[1]);

  const kola = token("kola", "600");
  const white = token("field", "0");
  const ink = token("ink", "900");
  // The deepest the hub ground gets, just under the header.
  const ground = mix(
    mix(token("field", "50"), kola, number(rows, /const FLOOR_OPACITY = ([\d.]+);/)),
    kola,
    number(rows, /const AURA_OPACITY = ([\d.]+);/),
  );
  const glass = mix(ground, white, number(source, /const GLASS = alpha\(WHITE, ([\d.]+)\);/));
  const meta = number(source, /const META = alpha\(INK, ([\d.]+)\);/);
  const focus = mix(glass, kola, number(source, /const FOCUS = alpha\(KOLA, ([\d.]+)\);/));

  assert.ok(contrast(ink, ground) >= 12, "the name on the ground");
  assert.ok(contrast(mix(ground, ink, meta), ground) >= 4.5, "the number and the figure on the ground");
  assert.ok(contrast(mix(glass, ink, meta), glass) >= 4.5, "a row's label on glass");
  assert.ok(contrast(ink, glass) >= 12, "a name being typed");
  assert.ok(contrast(token("kola", "800"), focus) >= 4.5, "a focused row's label on its tint");
  assert.ok(contrast(white, kola) >= 4.5, "Save's words on kola");
  assert.ok(contrast(kola, ground) >= 3, "the completeness arc on the ground");
  const ink70 = number(plinth, /ink70: "rgba\(24,22,17,([\d.]+)\)",/);
  assert.ok(contrast(mix(ground, [24, 22, 17], ink70), ground) >= 4.5, "the one sentence on the ground");
});

test("Save presses like the tab bar and says when it is working", () => {
  const source = editor();
  const save = between(source, "function SaveButton(", "const styles = StyleSheet.create(");

  assert.match(save, /accessibilityRole="button"/);
  assert.match(save, /accessibilityLabel=\{busy \? busyLabel : label\}/);
  assert.match(save, /aria-busy=\{busy\} aria-disabled=\{busy\}\s*disabled=\{busy\}/);
  assert.match(save, /<ActivityIndicator size="small" color=\{WHITE\} \/>/);
  assert.match(save, /\{busy \? busyLabel : saved \? "Saved" : label\}/);

  const spring = (text) => ({
    speed: Number(/speed:\s*([\d.]+)/.exec(text)?.[1]),
    bounciness: Number(/bounciness:\s*([\d.]+)/.exec(text)?.[1]),
  });
  assert.deepEqual(spring(save), spring(code(read("src/components/nav/MainTabBar.tsx"))));
  assert.match(save, /const reduceMotion = useReduceMotion\(\);/);
  assert.match(save, /if \(reduceMotion\) \{\s*scale\.setValue\(toValue\);\s*return;\s*\}/);

  // Lifted, not floated.
  const frame = between(source, "saveFrame: {", "  save: {");
  assert.ok(Number(/shadowOpacity: ([\d.]+)/.exec(frame)?.[1]) <= 0.16, "Save throws a heavy shadow");
  assert.ok(Number(/elevation: (\d+)/.exec(frame)?.[1]) <= 2, "Save floats on Android");
});
