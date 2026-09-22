import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile Units is a real screen, not the web page shrunk", () => {
  const screen = read("mobile/app/(app)/units.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");
  const api = read("mobile/src/provider.ts");

  assert.match(api, /\/organizations\/\$\{organizationId\}\/units\//);
  assert.match(layout, /name="units" options=\{\{ title: "Units" \}\}/);

  // Virtualized, because a hostel is forty rooms and a portfolio is more.
  assert.match(screen, /FlatList/);
  assert.match(screen, /listPortfolioUnits/);

  // What people reach for stays on the screen; the rest goes in a sheet.
  assert.match(screen, /label="Search Units"/);
  assert.match(screen, /label="Add Unit"/);

  // One Filter, holding all three questions. It used to be narrowed two ways at
  // once — a row of chips for availability, and a page sheet for Property and
  // sort — so neither control could say what was on.
  assert.doesNotMatch(screen, /function Chip/, "the chip row is a second filter");
  assert.doesNotMatch(screen, /presentationStyle="pageSheet"/, "the filter is the shared sheet now");
  assert.equal((screen.match(/<FilterGroup title=/g) ?? []).length, 3, "Show, Property and Order");
  assert.match(screen, /<FilterGroup title="Show">/);
  assert.match(screen, /<FilterGroup title="Property">/);
  assert.match(screen, /<FilterGroup title="Order">/);
  // And whatever is on is a token under the heading, which clears with a tap.
  assert.match(screen, /const narrowed = \(view === "all" \? 0 : 1\) \+ \(propertyId \? 1 : 0\) \+ \(sort === "property" \? 0 : 1\);/);
  assert.match(screen, /<ActiveFilter label=\{VIEW_LABEL\[view\]\}/);
});

test("a mobile Unit tile recognizes, then opens the canonical Unit", () => {
  const screen = read("mobile/app/(app)/units.tsx");
  const tile = read("mobile/src/components/property/UnitTile.tsx");

  // What a Unit looks like is decided once, so it reads the same whether it is
  // reached through its Property or through Units.
  assert.match(tile, /primary_photo/);

  // Three facts, not one string. "Verified · Public · Available" was cut after
  // the first word in half a phone's width, so: whether it is let rides on the
  // photograph, where it stands in review is the line under the name, and being
  // on Explore is a mark. All three reach a screen reader through the label.
  assert.match(tile, /function occupancyOf/);
  assert.match(tile, /function reviewOf/);
  assert.doesNotMatch(tile, /<StatusLine/, "the combined status truncates in a tile");
  assert.match(
    tile,
    /accessibilityLabel=\{`\$\{unit\.label \|\| "Unnamed Unit"\}\. \$\{meta\}\. \$\{occupancy\.label\}\. \$\{review\.label\}\.\$\{published \? " On Explore\." : ""\}`\}/,
  );

  // The same tile on two grounds: paper inside a Property, glass on the green.
  assert.match(tile, /surface = "paper"/);
  assert.match(screen, /surface="glass"/);

  // Across a Portfolio the building tells two Room 4s apart — unless the list
  // is already ordered by name, when the kind of space is the useful fact.
  assert.match(screen, /meta=\{sort === "label" \? item\.property_title : item\.space_type_label\}/);
  // The same Unit screen a Property opens.
  assert.match(screen, /pathname: "\/\(app\)\/space"/);
});

test("mobile Unit detail can archive or delete without a modal workflow", () => {
  const screen = read("mobile/app/(app)/space.tsx");
  const actions = read("mobile/src/components/property/UnitLifecycleActions.tsx");
  const api = read("mobile/src/provider.ts");

  assert.match(screen, /<UnitLifecycleActions unit=\{unit\}/);
  assert.match(actions, /unit\.permitted_actions\.delete/);
  assert.match(actions, /unit\.permitted_actions\.archive/);
  assert.match(actions, /Why\? This is recorded\./);
  assert.doesNotMatch(actions, /Alert|Modal/);
  assert.match(actions, /deleteUnit\(unit\.id, reason\.trim\(\)\)/);
  assert.match(actions, /archiveUnit\(unit\.id, reason\.trim\(\)\)/);
  assert.match(api, /\/spaces\/\$\{unitId\}\/archive\//);
});

test("Units are browsed two across on a handset", () => {
  const tile = read("mobile/src/components/property/UnitTile.tsx");
  const screens = [
    read("mobile/app/(app)/units.tsx"),
    read("mobile/app/(app)/provider-property.tsx"),
  ];

  assert.match(tile, /export const UNIT_COLUMNS = 2;/);
  for (const screen of screens) {
    assert.match(screen, /numColumns=\{UNIT_COLUMNS\}/);
    assert.match(screen, /columnWrapperStyle=\{\{ gap: UNIT_TILE_GAP \}\}/);
  }

  // A lone tile on an odd last row must stay at half width. With `flex: 1`
  // alone it stretches across the screen, and the grid appears to break on
  // exactly the counts a real portfolio produces.
  assert.match(tile, /maxWidth: "50%"/);

  // Half a phone is a narrow column, so the tile steps the type down — but not
  // below 13pt, which is the floor for anything meant to be read.
  assert.match(tile, /fontSize: 15/);
  assert.match(tile, /fontSize: 13/);
  assert.doesNotMatch(tile, /fontSize: (?:[0-9]|1[0-2])\b/);

  // A status is allowed to wrap rather than be cut to "Verification in pro…".
  const patterns = read("mobile/src/components/property/WorkspacePatterns.tsx");
  assert.match(patterns, /compact = false/);
  assert.match(patterns, /numberOfLines=\{compact \? 2 : undefined\}/);
});

test("mobile creation chooses a Property, then reuses space-new", () => {
  const create = read("mobile/app/(app)/unit-new.tsx");
  const property = read("mobile/app/(app)/provider-property.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");

  assert.match(create, /pathname: "\/\(app\)\/space-new"/);
  assert.match(create, /private_inventory\?\.allowed/);
  assert.doesNotMatch(create, /createUnit/);
  assert.match(layout, /name="unit-new" options=\{\{ title: "Add Unit" \}\}/);
  // Property → Add Unit still goes straight there; the Property is known.
  assert.match(property, /pathname: "\/\(app\)\/space-new", params: \{ propertyId: property\.id \}/);
});

test("mobile Unit creation saves and resumes the same draft journey", () => {
  const create = read("mobile/app/(app)/space-new.tsx");
  const detail = read("mobile/app/(app)/space.tsx");
  const amenities = read("mobile/src/components/property/SpaceAmenities.tsx");
  const photos = read("mobile/src/components/property/SpacePhotos.tsx");

  assert.match(create, /resumeUnitId/);
  assert.match(create, /label="Save for later"/);
  assert.match(create, /saveForLaterLabel="Save for later"/);
  assert.match(detail, /label="Continue setup"/);
  assert.match(detail, /pathname: "\/\(app\)\/space-new"/);
  assert.match(amenities, /amenity photo/);
  assert.match(photos, /every selected amenity/);
});

test("Units is reachable without spending a tab", () => {
  const more = read("mobile/app/(app)/(provider-tabs)/more.tsx");
  const tabs = read("mobile/app/(app)/(provider-tabs)/_layout.tsx");

  assert.match(more, /label="Units"/);
  assert.match(more, /\/\(app\)\/units"/);
  // Five tabs stays five: Home, Properties, Tenants, Payments, More.
  assert.equal((tabs.match(/<Tabs\.Screen name="(?!add)/g) ?? []).length, 5);
});

test("choosing an option looks like choosing", () => {
  const ui = read("mobile/src/components/ui.tsx");
  const units = read("mobile/app/(app)/units.tsx");
  const patterns = read("mobile/src/components/team/TeamPatterns.tsx");

  // `selected` used to change only the accessibility state, so a picked filter
  // rendered identically to an unpicked one. Every screen that needed a visible
  // choice wrote a "✓ " into the label instead.
  assert.match(ui, /const palette = selected/);
  assert.match(ui, /selected \? \{ borderWidth: 2 \} : null/);
  for (const source of [units, patterns]) {
    assert.doesNotMatch(source, /"✓ "/);
    assert.match(source, /selected=\{/);
  }
});
