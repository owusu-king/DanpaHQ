/**
 * How a control says what state it is in.
 *
 * React Native accepts two forms — `accessibilityState={{ checked }}` and
 * `aria-checked` — and they are not equivalent on every renderer:
 *
 * - **Native** honours both. `Pressable`, `View` and `Text` each fold `aria-*`
 *   back into `accessibilityState`, with `aria-*` winning where both are given.
 * - **react-native-web 0.21 honours only `aria-*`.** `createDOMProps` reads
 *   `aria-checked` and the deprecated flat `accessibilityChecked`, and never
 *   looks at `accessibilityState` at all. The same holds for `selected`,
 *   `expanded`, `busy` and `disabled`.
 *
 * So a control written the `accessibilityState` way is announced correctly on
 * a phone and announced as nothing on the web build. That was true of every
 * radio and checkbox in this app: the role reached the DOM, the state did not,
 * and a screen reader on the web build could not tell which role was selected
 * or which Properties were ticked.
 *
 * It also made the capture harness lie. The harness drives the web build, so
 * every check of "is the right row marked" was reading an attribute that was
 * never going to be there.
 *
 * One form, everywhere, and it is the one both renderers read.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function sources() {
  const found = [];
  for (const dir of ["app", "src"]) {
    const root = new URL(`../${dir}/`, import.meta.url);
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const where = `${entry.parentPath ?? entry.path}`.replaceAll("\\", "/");
      found.push({
        name: `${dir}${where.split(`/${dir}`).pop()}/${entry.name}`,
        text: readFileSync(new URL(entry.name, `file://${where}/`), "utf8"),
      });
    }
  }
  return found;
}

test("state is declared the way both renderers read it", () => {
  const offenders = sources()
    .filter((file) => /accessibilityState\s*=/.test(file.text))
    .map((file) => file.name);
  assert.deepEqual(
    offenders,
    [],
    `these announce state only on native: ${offenders.join(", ")}`,
  );
});

test("a control that has a state still declares one", () => {
  // The rule above is satisfied by deleting the state altogether, which would
  // be worse than what it replaced. These are the controls the product's
  // toggles are built from, and each has to say where it stands.
  const shared = [
    ["src/components/team/TeamPatterns.tsx", /aria-selected=\{radio \? selected : undefined\}/],
    ["src/components/team/TeamPatterns.tsx", /aria-checked=\{radio \? undefined : selected\}/],
    ["src/components/portfolio/PortfolioList.tsx", /aria-selected=\{selected\}/],
    ["src/components/portfolio/PortfolioSwitcher.tsx", /aria-selected=\{isCurrent\}/],
    ["src/components/billing/KeepChooser.tsx", /aria-checked=\{checked\}/],
    ["src/components/property/WorkspacePatterns.tsx", /aria-expanded=\{open\}/],
    ["src/components/nav/MainTabBar.tsx", /aria-selected=\{focused\}/],
    ["src/components/ui.tsx", /aria-checked=\{selected\}/],
    ["src/components/ui.tsx", /aria-selected=\{role === "radio" \? selected : undefined\}/],
  ];
  for (const [path, pattern] of shared) {
    assert.match(read(path), pattern, `${path} lost the state it announces`);
  }
});

test("a role and its state agree about which one applies", () => {
  // `aria-selected` on a checkbox and `aria-checked` on a radio are both
  // ignored, so the two shared pickers switch on their own role rather than
  // sending one attribute for both.
  for (const path of ["src/components/team/TeamPatterns.tsx", "src/components/ui.tsx"]) {
    const source = read(path);
    assert.match(source, /aria-selected=\{[^}]*\? [^}]*: undefined\}/, `${path} sends one attribute for both roles`);
    assert.match(source, /aria-checked=\{[^}]*\? undefined : [^}]*\}/, `${path} sends one attribute for both roles`);
  }
});
