/**
 * The two screens that answer "what do I own, and what is in it".
 *
 * Properties and Units were the last provider surfaces left on the flat
 * background while Home, Tenants, Payments and Agreements stood on Rooomly's
 * green with frosted panels. A list that reads as one product opening onto
 * screens that read as another is worse than neither.
 *
 * What is pinned here is the part an enhancement keeps losing: that both stand
 * on the green with figures above them, that each is narrowed by exactly one
 * control, and — the thing this change was asked for — that Units is still a
 * grid of tiles rather than another list of rows.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const properties = () => read("app/(app)/(provider-tabs)/properties.tsx");
const units = () => read("app/(app)/units.tsx");
const tile = () => read("src/components/property/UnitTile.tsx");

test("both inventory screens stand on the green, over their own figures", () => {
  for (const [name, source] of [["Properties", properties()], ["Units", units()]]) {
    assert.match(source, /<IndexGround>/, `${name} is still on the flat background`);
    assert.match(source, /<SummaryPanel/, `${name} leads with words rather than figures`);
    assert.match(source, /<ListHead/, `${name} has no list heading`);
    assert.match(source, /<SearchField/, `${name} cannot be searched`);
    assert.match(source, /<EmptyState/, `${name} rolls its own empty state`);
  }

  // Properties had no way to narrow itself at all, which a Portfolio of twenty
  // buildings felt first.
  assert.match(properties(), /label="Search Properties"/);
  assert.match(properties(), /<BottomSheet/);
  assert.match(properties(), /function stageOf/);

  // `SummaryPanel` lays its facts out at 45% each in a row that does not wrap,
  // so a third one is cut off the right edge rather than moved to a new line.
  const facts = read("src/components/portfolio/PortfolioList.tsx");
  assert.match(facts, /summaryFacts: \{\n    flexDirection: "row",/);
  assert.doesNotMatch(facts, /summaryFacts: \{[\s\S]{0,120}flexWrap/);
  for (const [name, source] of [["Properties", properties()], ["Units", units()]]) {
    const given = source.match(/facts=\{\[[\s\S]*?\]\}/)?.[0] ?? "";
    assert.equal((given.match(/\{ label:/g) ?? []).length, 2, `${name} gives the panel more facts than it can show`);
  }
});

test("Units is still a grid, and the tile is what carries the design", () => {
  // The ask was to enhance the grid, not replace it with rows. Two across, a
  // photograph leading each tile, and a lone tile on an odd last row held at
  // half width.
  assert.match(units(), /numColumns=\{UNIT_COLUMNS\}/);
  assert.match(units(), /<UnitTile/);
  assert.doesNotMatch(units(), /<ListRow/, "Units became a list of rows");
  assert.match(tile(), /export const UNIT_COLUMNS = 2;/);
  assert.match(tile(), /maxWidth: "50%"/);
  assert.match(tile(), /aspectRatio: 4 \/ 3/);

  // The tile reads on either ground without a second copy of it existing.
  assert.match(tile(), /surface = "paper"/);
  assert.match(tile(), /glass: \{\n    borderColor: EDGE,\n    backgroundColor: GLASS,\n  \}/);
  assert.match(units(), /surface="glass"/);
});

test("nothing in a tile drops below the size it can be read at", () => {
  // Half a phone is a narrow column and the temptation is to shrink into it.
  // 13pt is the floor for anything meant to be read rather than glanced at,
  // and separating the status into three facts is what bought the room.
  assert.doesNotMatch(tile(), /fontSize: (?:[0-9]|1[0-2])(?:\.\d+)?\b/);
  assert.match(tile(), /fontSize: 15/);
  assert.match(tile(), /fontSize: 13/);
});

test("a Property is its Units, with reference material one tap away", () => {
  const source = read("app/(app)/provider-property.tsx");

  // It carried a tab bar of its own — Units and Details — inside a pushed
  // detail screen. Nothing else in the app does that, and it hid half the
  // record behind a control nobody expects to find there.
  assert.doesNotMatch(source, /function PropertyTabs/);
  assert.doesNotMatch(source, /accessibilityRole="tablist"/);
  assert.match(source, /data=\{units\}/);

  // The record leads with how much of the building is let, and the address,
  // services, blocks and verification trail each open from the row that names
  // them rather than unfolding in the middle of the Units.
  assert.match(source, /<Lead\s+label="Let"/);
  assert.match(source, /<GroupLabel>About this Property<\/GroupLabel>/);
  for (const row of ["Property information", "Shared amenities", "Buildings and blocks", "Verification and records"]) {
    assert.match(source, new RegExp(`label="${row}"`), `${row} is not a row`);
  }
  // The one creative act is pinned where a thumb is, not inline in the header.
  assert.match(source, /<ActionBar>\s*<Pill label="Add Unit"/);
});

test("a Unit is a record, not a settings page", () => {
  const source = read("app/(app)/space.tsx");

  // Five stacked disclosures under one "Manage this Unit" heading is a
  // settings page. Each is its own piece of work, so each opens on its row.
  assert.doesNotMatch(source, /<Disclosure/);
  assert.match(source, /<GroupLabel>Manage this Unit<\/GroupLabel>/);
  for (const row of ["Photos", "Amenities", "Details and entrance", "Verification and publication"]) {
    assert.match(source, new RegExp(`label="${row}"`), `${row} is not a row`);
  }

  // A Unit is recognized by sight, so the photograph leads and carries the two
  // facts that would otherwise be words.
  assert.match(source, /style=\{styles\.hero\}/);
  assert.match(source, /occupied \? "Occupied" : "Vacant"/);
  assert.match(source, /styles\.heroPublic/);

  // Four separate facts for type, bedrooms, bathrooms and furnished became a
  // panel of three, with the size read as one line.
  assert.match(source, /<GroupLabel>What it is<\/GroupLabel>/);
  assert.match(source, /label="Size" value=\{size\}/);

  // Archiving or deleting waits behind one quiet way in, as on every record.
  assert.match(source, /<QuietAct\s+label="Archive or delete this Unit"/);
  assert.match(source, /sheet === "danger" \? \(/);
});

test("a row's own name wraps rather than being cut", () => {
  // At 320 a `LinkRow` leaves its body about 188 points, which is short of
  // "Verification and publication". The detail under it may be abbreviated;
  // the label may not.
  const kit = read("src/components/record/RecordSurfaces.tsx");
  assert.match(kit, /<Type variant="bodyStrong" numberOfLines=\{2\} style=\{styles\.linkLabel\}>\{label\}<\/Type>/);
  // And the well and chevron hold to the first line rather than floating to
  // the middle of a two-line row.
  assert.match(kit, /linkRow: \{[\s\S]{0,120}alignItems: "flex-start",/);
  assert.match(kit, /linkChevron: \{\n    marginTop: 9,\n  \},/);
});

test("each screen is narrowed by exactly one control", () => {
  // Units was filtered two ways at once and Properties not at all. Both now
  // open the same sheet, and what is on is a token that clears with a tap.
  for (const [name, source] of [["Properties", properties()], ["Units", units()]]) {
    assert.match(source, /<ActiveFilter/, `${name} does not say what is on`);
    assert.match(source, /<SheetFooter/, `${name} cannot reset`);
    assert.doesNotMatch(source, /horizontal showsHorizontalScrollIndicator/, `${name} keeps a second filter row`);
  }
  // A list of what you own has one creative act, and it is drawn in full kola:
  // an outlined pill on the green ground reads as unfinished, which is what it
  // looked like as a `QuietAction`.
  assert.match(properties(), /<PrimaryAction icon="add" label="Add Property"/);
  assert.match(units(), /<PrimaryAction icon="add" label="Add Unit"/);
  const kit = read("src/components/portfolio/PortfolioList.tsx");
  assert.match(kit, /export function PrimaryAction/);
  assert.match(kit, /primaryAction: \{[\s\S]{0,220}backgroundColor: KOLA,/);
  assert.match(kit, /primaryActionText: \{[\s\S]{0,80}color: WHITE,/);
});
