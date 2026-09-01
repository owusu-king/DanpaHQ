import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("each side has one index, built from one set of rows", () => {
  const more = read("mobile/app/(app)/(provider-tabs)/more.tsx");
  const tab = read("mobile/app/(app)/(tabs)/profile.tsx");

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
  const rows = read("mobile/src/components/account/IndexRows.tsx");
  const more = read("mobile/app/(app)/(provider-tabs)/more.tsx");
  const tab = read("mobile/app/(app)/(tabs)/profile.tsx");

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

test("editing your profile is a focused screen, not the index", () => {
  const editor = read("mobile/app/(app)/profile-edit.tsx");
  const tab = read("mobile/app/(app)/(tabs)/profile.tsx");

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
  const more = read("mobile/app/(app)/(provider-tabs)/more.tsx");

  assert.doesNotMatch(more, /is not enabled yet/);
  assert.doesNotMatch(more, /label="Maintenance"/);
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
