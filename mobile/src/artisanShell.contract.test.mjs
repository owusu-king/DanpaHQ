/**
 * The artisan experience on mobile: earned, four tabs, and nothing beyond them.
 *
 * Three failures this guards against. An address reaching the artisan tabs
 * without an approved application (the backend refuses every request behind
 * them, but the shell must not draw them either). A fifth tab creeping in — a
 * Menu, a Properties — that would show an artisan more than their own work.
 * And a tab route sharing an address with the renter's, which a group in
 * parentheses does not prevent.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

test("only an approved artisan who chose the experience is shown the artisan tabs", () => {
  const gate = code(read("app/_layout.tsx"));

  assert.match(gate, /const inArtisanTabs = group === "\(app\)" && screen === "\(artisan-tabs\)";/);
  assert.match(gate, /const mayWork = capabilities\.artisan\.workspace_access && capabilities\.active_workspace === "artisan";/);
  assert.match(gate, /if \(inArtisanTabs && !mayWork && !destination\.startsWith\("\/\(app\)\/\(artisan-tabs\)"\)\) \{\s*return destination;/);
  // A stored context can never route somebody into tabs they cannot open.
  assert.match(code(read("src/navigation.ts")), /if \(route === "\/\(app\)\/\(artisan-tabs\)"\) return me\.capabilities\.artisan\.workspace_access;/);
});

test("the artisan tabs are Home, Requests, Jobs and My Profile, on both platforms", () => {
  const layout = code(read("app/(app)/(artisan-tabs)/_layout.tsx"));
  const native = [...layout.matchAll(/<NativeTabs\.Trigger name="([^"]+)"/g)].map((match) => match[1]);
  const js = [...layout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((match) => match[1]);
  const expected = ["index", "artisan-requests", "artisan-jobs", "artisan-profile"];

  assert.deepEqual(native, expected);
  assert.deepEqual(js, expected);
  for (const label of ["Home", "Requests", "Jobs", "My Profile"]) {
    assert.match(layout, new RegExp(`<NativeTabs\\.Trigger\\.Label>${label}</NativeTabs\\.Trigger\\.Label>`));
    assert.match(layout, new RegExp(`tabBarLabel: "${label}"`));
  }
});

test("no artisan tab shares an address with the renter's or the provider's", () => {
  const artisan = code(read("app/(app)/(artisan-tabs)/_layout.tsx"));
  const others = code(read("app/(app)/(tabs)/_layout.tsx")) + code(read("app/(app)/(provider-tabs)/_layout.tsx"));
  const names = (source) => new Set([...source.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((match) => match[1]));
  const shared = [...names(artisan)].filter((name) => name !== "index" && names(others).has(name));

  assert.deepEqual(shared, []);
});

test("the artisan screens frame each tab and leave the way out on My Profile", () => {
  for (const [file, tab, screen] of [
    ["index", "home", "ArtisanHomeScreen"],
    ["artisan-requests", "requests", "ArtisanRequestsScreen"],
    ["artisan-jobs", "jobs", "ArtisanJobsScreen"],
    ["artisan-profile", "profile", "ArtisanProfileScreen"],
  ]) {
    const source = code(read(`app/(app)/(artisan-tabs)/${file}.tsx`));
    assert.match(source, new RegExp(`<ArtisanTabFrame tab="${tab}">\\s*<${screen} />`));
  }

  const screens = code(read("src/components/artisan/ArtisanScreens.tsx"));
  // My Profile is the only page with the crossings, and it offers only what
  // the backend says is open.
  assert.match(screens, /\(me\?\.capabilities\.available_workspaces \?\? \[\]\)\.filter\(/);
  assert.match(screens, /onPress=\{\(\) => void switchTo\(workspace\)\}/);
  assert.match(screens, /const next = await chooseWorkspace\(workspace\);\s*await refreshMe\(\);\s*router\.replace\(resolveEntryRoute\(next\) as never\);/);
  // Suspension is said on every tab, read from capabilities, never inferred.
  assert.match(screens, /if \(!me \|\| me\.capabilities\.artisan\.can_quote\) return null;/);
  assert.equal((screens.match(/<SuspendedNotice me=\{me\} \/>/g) ?? []).length, 4);
});

test("the application never switches anybody, and only an open experience offers the way in", () => {
  const screen = code(read("app/(app)/artisan-application.tsx"));

  // The one chooseWorkspace call is behind the approved button.
  assert.equal((screen.match(/chooseWorkspace\(/g) ?? []).length, 1);
  assert.match(screen, /const open = status === "approved" \|\| status === "suspended";/);
  assert.match(screen, /\{open && !inside \? \(\s*<AuthAction label="Switch to artisan work"/);
  assert.match(screen, /<ArtisanApplicationForm\s/);

  const form = code(read("src/components/artisan/ArtisanApplicationForm.tsx"));
  // An ID is asked for only when applying and Danpa HQ holds none; certificates are optional.
  assert.match(form, /const needsId = mode === "apply" && !application\.identity_on_file;/);
  assert.match(form, /title="Certificates \(optional\)"/);
  // Editing saves the profile; it never re-applies.
  assert.match(form, /mode === "edit"\s*\? await updateArtisanProfile\(fields\)\s*: await applyAsArtisan\(\{ \.\.\.fields, identity_documents: identity \}\)/);
  // Payment wording: a connector, not a guarantor.
  assert.match(form, /Customers pay you directly; Danpa HQ does not hold or move the money\./);
  for (const source of [screen, form]) assert.doesNotMatch(source, /Trusted|Guaranteed|Payment protected/);
});

test("tenants reach Artisans from Services and providers from More, as a sheet", () => {
  const stack = code(read("app/(app)/_layout.tsx"));
  assert.match(stack, /<Stack\.Screen name="artisans" options=\{\{ title: "Artisans", presentation: "modal", headerLeft: closeHeaderLeft \}\} \/>/);
  assert.match(code(read("app/(app)/(provider-tabs)/more.tsx")), /\{ key: "artisans", icon: "hammer-outline", label: "Find Artisans", onPress: go\("\/\(app\)\/artisans"\) \}/);
  // Becoming one is a quiet header link inside it, gone once approved.
  const sheet = code(read("app/(app)/artisans.tsx"));
  assert.match(sheet, /const becomeLabel = !artisan \|\| artisan\.workspace_access\s*\? null/);
  assert.match(sheet, /onPress=\{\(\) => router\.push\("\/\(app\)\/artisan-application" as never\)\}/);
  // Inside it, three tabs — never new tabs in the bar.
  const screen = code(read("app/(app)/artisans.tsx"));
  assert.match(screen, /\{ key: "find", label: "Find" \},\s*\{ key: "requests", label: "Requests" \},\s*\{ key: "records", label: "Records" \},/);
});

test("electrical work shows only certified electricians until the person asks for the rest", () => {
  const screen = code(read("app/(app)/artisans.tsx"));
  assert.match(screen, /Wiring work needs a certified professional/);
  assert.match(screen, /discoverArtisans\(\{ trade, district, certified, showUncertified \}\)/);
  assert.match(screen, /onPress=\{\(\) => setShowUncertified\(true\)\}/);
  assert.match(screen, /if \(seenTrade !== trade\) \{\s*setSeenTrade\(trade\);\s*setShowUncertified\(false\);/);
  assert.doesNotMatch(screen, /Trusted|Guaranteed|Payment protected/);
});
