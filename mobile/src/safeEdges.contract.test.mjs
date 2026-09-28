/**
 * The bottom edge of every scrolling surface.
 *
 * Android draws edge-to-edge: its navigation buttons sit *over* the bottom of
 * the page. A list that pads by a fixed amount runs its last row underneath
 * them, and the buttons then look as though the content were showing through
 * — which is what a product owner reported seeing. iOS does the same under the
 * home indicator, and a page sheet pushed flush to the edge loses its last
 * control the same way.
 *
 * None of this is visible in the web capture harness: `react-native-safe-area-
 * context` reports zero insets on web, so every one of these renders correctly
 * there whether or not the inset is applied. That is exactly why it is pinned
 * here instead.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Pushed screens: no tab bar underneath, so the page itself must clear the navigation. */
const PUSHED = [
  "saved.tsx",
  "team.tsx",
  "archive.tsx",
  "trust.tsx",
  "security.tsx",
  "notification-settings.tsx",
  "payout-account.tsx",
  "notifications.tsx",
  "tenant-payments.tsx",
  "applications.tsx",
  "viewings.tsx",
  "leases.tsx",
  "provider-applications.tsx",
  "provider-viewings.tsx",
];

/** The record pages, which pad themselves when no action bar is doing it for them. */
const RECORDS = [
  "viewing/[id].tsx",
  "provider-viewing.tsx",
  "application/[id].tsx",
  "agreement/[id].tsx",
  "provider-lease.tsx",
];

test("the inset is added to the page's own breathing room, not substituted for it", () => {
  const platform = read("src/platform.ts");
  assert.match(platform, /export function useSafeBottom\(base: number\)/);
  assert.match(platform, /const insets = useSafeAreaInsets\(\);/);
  // `base + inset`, never `Math.max(base, inset)`: a device with a 48dp button
  // bar needs the gap *and* the clearance, not whichever is larger.
  assert.match(platform, /return base \+ insets\.bottom;/);
});

test("no pushed list ends under Android's navigation buttons", () => {
  for (const page of PUSHED) {
    const source = read(`app/(app)/${page}`);
    assert.match(source, /useSafeBottom/, `${page} pads by a fixed amount`);
    assert.match(source, /const pageBottom = useSafeBottom\(space\[12\]\);/, `${page} is missing the page bottom`);
    assert.match(source, /paddingBottom: pageBottom/, `${page} never uses it`);
    // The literal it replaced must not creep back in beside it.
    assert.doesNotMatch(source, /contentContainerStyle=\{\{[^}]*paddingBottom: space\[12\]/, `${page} still pads a list by a constant`);
  }
});

test("a record page clears the navigation whenever no bar is doing it", () => {
  for (const page of RECORDS) {
    const source = read(`app/(app)/${page}`);
    assert.match(source, /useSafeBottom\(space\[8\]\)/, `${page} does not measure its own bottom`);
  }
});

test("no pushed screen anywhere pads its scroll by a constant", () => {
  // The list above names the pages this began with. This one is the rule, so a
  // page added next month cannot quietly reintroduce the defect: a scrolling
  // surface on a screen with no tab bar under it measures the inset.
  //
  // Tab screens are exempt — `MainTabBar` sits below them and takes the inset
  // itself, so adding it again would only open a gap.
  const root = new URL("../app/(app)/", import.meta.url);
  const offenders = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
    const where = `${entry.parentPath ?? entry.path}`.replaceAll("\\", "/");
    if (where.includes("(tabs)") || where.includes("(provider-tabs)")) continue;
    const source = readFileSync(new URL(entry.name, `file://${where}/`), "utf8");
    // The bug is a constant inside an inline content-container object. A style
    // object overridden at the call site is not one, and neither is a base with
    // the inset added to it — `space[8] + insets.bottom` is the fix, not the bug.
    if (/contentContainerStyle=\{\{[^}]*paddingBottom: space\[(?:8|9|10|11|12)\](?!\s*\+)/.test(source)) {
      offenders.push(`${where.split("(app)/").pop()}/${entry.name}`);
    }
  }
  assert.deepEqual(offenders, [], `these pad their scroll by a constant: ${offenders.join(", ")}`);
});

test("a pushed screen that scrolls accounts for the bottom inset at all", () => {
  // The rule above reads the *shape* of an inline content container, so it saw
  // `contentContainerStyle={{ paddingBottom: space[12] }}` and missed
  // `contentContainerStyle={styles.page}` with the constant hidden in the
  // stylesheet. Two redesigned screens went out that way and the navigation
  // buttons had content sliding under them again.
  //
  // So this asks the blunter question instead: does the file mention the
  // inset anywhere? A screen that scrolls and never names it cannot be
  // clearing the navigation buttons by anything but luck.
  // `(auth)` is here too. It used to be left out, on the reasoning that it is a
  // short flow of focused screens — and `onboarding` promptly shipped with the
  // top inset and no bottom one.
  const offenders = [];
  for (const group of ["(app)", "(auth)"]) {
    const root = new URL(`../app/${group}/`, import.meta.url);
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
      const where = `${entry.parentPath ?? entry.path}`.replaceAll("\\", "/");
      // Tab screens are exempt: `MainTabBar` sits below them and takes the inset.
      if (where.includes("(tabs)") || where.includes("(provider-tabs)")) continue;
      const source = readFileSync(new URL(entry.name, `file://${where}/`), "utf8");
      if (!/<(ScrollView|FlatList|SectionList)/.test(source)) continue;
      if (/useSafeBottom|insets\.bottom/.test(source)) continue;
      offenders.push(`${where.split(`${group}/`).pop()}/${entry.name}`.replace(/^\/+/, ""));
    }
  }
  assert.deepEqual(offenders, [], `these scroll under the navigation buttons: ${offenders.join(", ")}`);
});

test("the auth flow answers the inset once, in the frame all of it stands on", () => {
  // The screens that moved onto `AuthScene` have no ScrollView of their own for
  // the rule above to find, so this is the half of the promise that rule cannot
  // see: the frame takes both insets, and every screen in the flow uses it.
  const root = new URL("../app/(auth)/", import.meta.url);
  const scene = readFileSync(new URL("../src/components/auth/AuthScene.tsx", import.meta.url), "utf8");
  // `lift` is the optical-centre bias, which only ever adds; the inset itself
  // is what has to be in there.
  assert.match(scene, /const bottom = insets\.bottom \+ space\[6\] \+ lift;/);
  assert.match(scene, /paddingBottom: bottom\b/);

  const loose = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".tsx") || entry.name === "_layout.tsx") continue;
    const source = readFileSync(new URL(entry.name, root), "utf8");
    const framed = /<AuthScene/.test(source);
    const ownInset = /insets\.bottom/.test(source);
    if (!framed && !ownInset) loose.push(entry.name);
  }
  assert.deepEqual(loose, [], `these take neither the frame nor the inset: ${loose.join(", ")}`);
});

test("a sheet without a footer insets its own body", () => {
  const sheet = read("src/components/sheet/BottomSheet.tsx");
  // The footer branch always had this; a footerless sheet — which is most of
  // them — ended flush against the edge.
  assert.match(sheet, /footer \? null : \{ paddingBottom: Math\.max\(edge\.bottom, space\[4\]\) \}/);
  // The footer measures the same edge, and stands its pills a little above it.
  assert.match(sheet, /styles\.footer, \{ paddingBottom: Math\.max\(edge\.bottom, space\[4\]\) \+ FOOTER_LIFT \}/);
  // Both numbers, and the height cap, come from the sheet's own window.
  assert.match(sheet, /<SafeInsets/);
  assert.match(sheet, /safeHeaderTop\(edge\.top\)/);
  assert.doesNotMatch(sheet, /useSafeAreaInsets/, "the sheet must not read the page's window");
});

test("the action bar lifts off the edge it is pinned to", () => {
  const kit = read("src/components/record/RecordSurfaces.tsx");
  assert.match(kit, /paddingBottom: Math\.max\(insets\.bottom, space\[3\]\)/);
  // And on the narrowest handsets it stacks rather than cutting its own label.
  assert.match(kit, /const narrow = width < 360;/);
  assert.match(kit, /narrow \? styles\.actionColumn : null/);
});

test("a page sheet is lifted off the bottom, not pushed under it", () => {
  const team = read("app/(app)/team.tsx");
  // Two page sheets, lifted two ways, both measured in the sheet's own window:
  // the Portfolio form pads the end of its scroll, and the invitation pins an
  // `ActionBar`, which takes the inset itself.
  assert.match(team, /\[styles\.formSheet, \{ paddingBottom: space\[8\] \+ bottom \}\]/);
  assert.match(team, /<ModalSafeArea>[\s\S]*?<ActionBar>/, "the invitation's bar is outside the modal's provider");
  // The value both replaced was measured in the page behind the sheet.
  assert.doesNotMatch(team, /sheetBottom/, "a page sheet must not carry the page's inset in");
});

test("a modal measures its own window rather than the page behind it", () => {
  const kit = read("src/components/sheet/ModalSafeArea.tsx");
  // A provider per window. Seeded from the app's first measurement so the sheet
  // does not render one frame at zero inset before its own window is measured.
  assert.match(kit, /<SafeAreaProvider initialMetrics=\{initialWindowMetrics\}/);
  assert.match(kit, /export function SafeBottom/);
  assert.match(kit, /export function SafeInsets/);
});

test("every Modal in the app carries its own safe-area provider", () => {
  // The defect this pins was reported from a Samsung handset: the filter
  // sheet's footer sat *under* the navigation buttons while the page behind it
  // was correctly inset, and a re-render swapped the two over. A React Native
  // `Modal` is a separate native window, and one provider cannot describe two.
  //
  // Web renders every window at zero inset, so the capture harness is blind to
  // this. It is a source rule or it is nothing.
  const offenders = [];
  for (const dir of ["app", "src"]) {
    const root = new URL(`../${dir}/`, import.meta.url);
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
      const where = `${entry.parentPath ?? entry.path}`.replaceAll("\\", "/");
      const source = readFileSync(new URL(entry.name, `file://${where}/`), "utf8");
      if (!source.includes("<Modal")) continue;
      if (source.includes("<ModalSafeArea>")) continue;
      offenders.push(`${dir}${where.split(`/${dir}`).pop()}/${entry.name}`);
    }
  }
  assert.deepEqual(offenders, [], `these modals read the page's insets: ${offenders.join(", ")}`);
});
