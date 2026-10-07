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

test("both inventory screens stand on the green, over the dashboards' figures", () => {
  // Redesigned (owner, 2026-10-06): both end their summary on the Homes'
  // straight line of counts, from the same kit, so it cannot drift.
  for (const [name, source] of [["Properties", properties()], ["Units", units()]]) {
    assert.match(source, /<IndexGround>/, `${name} is still on the flat background`);
    assert.match(source, /from "@\/components\/home\/DashboardParts";/, `${name} has its own figures`);
    assert.match(source, /<StatCells>/, `${name} has no line of counts`);
    assert.equal((source.match(/<Cell label=/g) ?? []).length, 4, `${name} has a line of four counts`);
    assert.match(source, /<SearchField/, `${name} cannot be searched`);
    assert.match(source, /<EmptyState/, `${name} rolls its own empty state`);
    assert.doesNotMatch(source, /<SummaryPanel/, `${name} keeps the old summary`);
  }
  assert.match(properties(), /label="Search Properties"/);
  assert.match(properties(), /function stageOf/);
  // Units keeps the rings: what is let, and what of the vacant is on Explore.
  assert.match(units(), /<Rings>[\s\S]*<Ring[\s\S]*<Ring[\s\S]*<\/Rings>\s*<StatCells>/);
  assert.match(units(), /title="On Explore"/);
  // Properties draws the Portfolio instead of repeating the Home's rings (owner,
  // 2026-10-06): one bar split by verification stage, whose legend narrows the
  // list, and each Property as a row of windows, one per Unit, let or empty.
  assert.doesNotMatch(properties(), /<Ring\b|<Rings>/);
  assert.match(properties(), /<StageBar counts=\{counts\} total=\{properties\.length\} onPick=\{setFilter\} \/>/);
  assert.match(properties(), /<UnitWindows/);
  assert.match(properties(), /backgroundColor: index < property\.occupied_unit_count \? KOLA : RING_EMPTY/);
  assert.match(properties(), /onPress=\{\(\) => onPick\(stage\)\}/);
  assert.match(units(), /const listedVacant = all\.filter\(\(unit\) => unit\.availability\.state === "available" && isPublic\(unit\)\)\.length;/);
  // Properties' Vacant count opens Units narrowed to what is available, and Units honours it.
  assert.match(properties(), /params: \{ view: "available" \}/);
  assert.match(units(), /useLocalSearchParams<\{ view\?: string \}>\(\)/);
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
  // One identity card (owner, 2026-10-06): name, address, standing, a bar of
  // what is let, and the counts on one line.
  assert.match(source, /accessibilityLabel=\{`\$\{occupied\} of \$\{units\.length\} Units let`\}/);
  assert.match(source, /<PropertyFact label="Units"/);
  assert.match(source, /<GroupLabel>About this Property<\/GroupLabel>/);
  for (const row of ["Property information", "Shared amenities", "Buildings and blocks", "Verification details"]) {
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
  // One identity card (owner, 2026-10-06): the photograph, the name with whether
  // somebody lives there, where it stands, and what it is on one line of facts.
  assert.match(source, /<View style=\{styles\.card\}>\s*\{photo \? \(\s*<View style=\{styles\.hero\}>/);
  // Without a photo, a strip that leads to adding one, not a grey slab.
  assert.match(source, /accessibilityLabel="No photo yet\. Add photos\."\s+onPress=\{\(\) => setSheet\("photos"\)\}/);
  assert.match(source, /occupied \? "Occupied" : "Vacant"/);
  assert.match(source, /styles\.heroPublic/);
  assert.match(source, /<UnitFact label="Type" value=\{unit\.space_type_label\} \/>/);
  assert.match(source, /<UnitFact label="Size" value=\{size \|\| "—"\} wide \/>/);
  assert.doesNotMatch(source, /<GroupLabel>What it is<\/GroupLabel>/);

  // Archiving or deleting waits behind one quiet way in, offered only when the
  // backend allows one of them and named for that one — an occupied Unit used
  // to open a sheet with nothing in it (owner, 2026-10-06). When neither is
  // allowed, the page says why instead.
  assert.match(source, /\{removal \? \(\s*<View style=\{styles\.exit\}>\s*<QuietAct\s+label=\{removal === "delete" \? "Delete this Unit" : "Archive this Unit"\}/);
  assert.match(source, /<Footnote>\{unitRemovalBlocker\(unit\)\}<\/Footnote>/);
  assert.match(source, /sheet === "danger" \? \(/);
  const removal = read("src/components/property/UnitLifecycleActions.tsx");
  assert.match(removal, /if \(unit\.permitted_actions\.delete\?\.allowed\) return "delete";/);
  assert.doesNotMatch(removal, /<Disclosure/, "a sheet already is the disclosure");
  // A Unit already on Explore is never offered "Publish" again: it names its own listing.
  assert.match(source, /const listingId = unit\.publication\.listing_id \?\? listing\?\.id \?\? null;/);
  assert.match(source, /\) : !published && !listingId && publish\?\.allowed \? \(/);
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

test("each screen's filters are out where they can be seen", () => {
  // Redesigned (owner, 2026-10-06): a Filter button, a sheet and a token saying
  // what the sheet did were three controls for one choice. Each choice is now a
  // chip with its colour and count, and the one that is on is filled.
  for (const [name, source] of [["Properties", properties()], ["Units", units()]]) {
    assert.match(source, /<FilterChips/, `${name} hides its filters`);
    assert.doesNotMatch(source, /<BottomSheet|<ActiveFilter|<SheetFooter|<ListHead/, `${name} keeps the old filter sheet`);
    assert.match(source, /count: counts\[value\],/, `${name}'s chips do not say how many`);
  }
  const chips = read("src/components/portfolio/FilterChips.tsx");
  assert.match(chips, /aria-selected=\{on\}/);
  assert.match(chips, /filled \? \{ backgroundColor: tone, borderColor: tone \} : null/);
  // A choice with nothing in it steps back rather than vanishing, so the row never reshuffles.
  assert.match(chips, /const empty = option\.count === 0 && !on;/);
  // The list's one creative act stays solid kola, now compact beside its heading.
  assert.match(properties(), /<AddButton label="Add Property" onPress=\{add\} \/>/);
  assert.match(units(), /<AddButton label="Add Unit" onPress=\{addUnit\} \/>/);
  assert.match(chips, /add: \{[\s\S]{0,220}backgroundColor: KOLA_DEEP,/);
});
