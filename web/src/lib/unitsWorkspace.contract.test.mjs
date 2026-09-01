import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

/** One Python method's body: from its `def` to the next one at that indent. */
const pyBody = (source, name) => {
  const start = source.indexOf(`    def ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const rest = source.slice(start + 1);
  const next = rest.search(/[\r\n] {4}def /);
  return next === -1 ? rest : rest.slice(0, next);
};

/** One function's body, so an assertion about the card is about the card. */
const body = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);

  // Step over the parameter list first. A destructured parameter carries braces
  // of its own — `({ unit }: { unit: Unit })` — and matching from the first one
  // returns the signature instead of the body, which asserts nothing at all.
  let at = source.indexOf("(", start);
  let parens = 0;
  for (; at < source.length; at += 1) {
    if (source[at] === "(") parens += 1;
    if (source[at] === ")" && (parens -= 1) === 0) break;
  }

  const opened = source.indexOf("{", at);
  let depth = 0;
  for (let cursor = opened; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}" && (depth -= 1) === 0) {
      return source.slice(opened, cursor + 1);
    }
  }
  throw new Error(`${name} is unbalanced`);
};

test("Units are readable in one call, not one per Property", () => {
  const api = read("web/src/lib/console.ts");
  const page = read("web/app/units/page.tsx");
  const backend = read("backend/apps/organization/views.py");

  // The collection read that made a portfolio-wide screen possible. Without it
  // a provider with fifty Properties would issue fifty requests to find a room.
  assert.match(api, /\/organizations\/\$\{organizationId\}\/units\//);
  assert.match(page, /listPortfolioUnits/);
  assert.doesNotMatch(page, /listUnits\(/);

  // Same scoping as everything else: a member sees the Properties they are
  // assigned, not the Portfolio's.
  assert.match(backend, /properties_for_organization_member/);
  assert.match(backend, /class OrganizationUnitView/);
});

test("a Unit card carries enough to recognize it and nothing more", () => {
  const page = read("web/app/units/page.tsx");

  assert.match(page, /primary_photo/);
  assert.match(page, /unit\.property_title/);
  assert.match(page, /unit\.availability\.label/);

  // Verification, publication, occupancy, lease and listing detail belong to
  // the Unit itself. The card shows a flag only when something is wrong.
  //
  // Scoped to the card, not the page: the page reads publication to *filter*
  // on it, which is a different thing from printing it on every tile.
  const card = body(page, "UnitCard");
  assert.match(page, /function needsAttention/);
  assert.doesNotMatch(card, /publication\./);
  assert.doesNotMatch(card, /access_code/);
  assert.doesNotMatch(card, /photo_count/);
});

test("Public means on Explore, not merely offered to it", () => {
  const page = read("web/app/units/page.tsx");
  const mobile = read("mobile/app/(app)/units.tsx");
  const model = read("backend/apps/listing/models.py");

  // A listing may be `published` while it waits in the review queue, or after a
  // reviewer flagged it, or once Management suspended it — public search shows
  // none of those. Reading only `publication.state` would count them all.
  for (const source of [page, mobile]) {
    assert.match(source, /const isPublic = \(unit: Unit\) =>/);
    assert.match(source, /unit\.publication\.state === "published"/);
    assert.match(source, /unit\.publication\.listing_status === "active"/);
  }

  // The same set the public sees: search filters on the derived status.
  assert.match(model, /condition=models\.Q\(status="active"\)/);

  // A filter only — no publish, withdraw or edit control moved onto this screen.
  for (const source of [page, mobile]) {
    assert.doesNotMatch(source, /listingAction|updateListing|publishListing|withdrawListing/);
  }
});

test("finding a Unit scales past a handful", () => {
  const page = read("web/app/units/page.tsx");

  assert.match(page, /Search Unit or Property/);
  assert.match(page, /All Properties/);
  assert.match(page, /role="tablist"/);
  assert.match(page, /Needs attention first/);
  // A filter nobody can act on is noise: Attention appears only when it exists.
  assert.match(page, /counts\.attention \?/);
});

test("global creation chooses a Property, then reuses the flow that exists", () => {
  const create = read("web/app/units/new/page.tsx");
  const property = read("web/app/properties/[id]/page.tsx");

  // No second creation workflow — this hands over to the same route Property →
  // Add Unit uses, which is why that path skips this screen entirely.
  assert.match(create, /\/properties\/\$\{property\.id\}\/spaces\/new/);
  assert.match(property, /\/spaces\/new/);
  assert.doesNotMatch(create, /createUnit/);

  // Only Properties the person may actually add to, and one choice is no choice.
  assert.match(create, /private_inventory\?\.allowed/);
  assert.match(create, /eligible\.length === 1/);
});

test("Unit creation can be left safely and resumed with amenity photo evidence", () => {
  const create = read("web/app/properties/[id]/spaces/new/page.tsx");
  const detail = read("web/app/properties/[id]/spaces/[spaceId]/page.tsx");
  const amenities = read("web/src/components/property/SpaceAmenities.tsx");
  const photos = read("web/src/components/property/SpacePhotos.tsx");
  const policy = read("backend/apps/trust/evidence_policy.py");

  assert.match(create, /resumeUnitId/);
  assert.match(create, /Save for later/);
  assert.match(create, /saveForLaterLabel="Save for later"/);
  assert.match(detail, /Continue setup/);
  assert.match(detail, /unitId=\$\{space\.id\}/);

  assert.match(amenities, /amenity photo/);
  assert.match(photos, /every selected amenity/);
  assert.match(policy, /def amenity_slots/);
  assert.match(policy, /key=f"amenity\.\{row\.amenity_id\}"/);
  assert.match(policy, /required=True/);
});

test("Units is a destination beside Properties, and both open the same Unit", () => {
  const nav = read("web/src/lib/portalNav.ts");
  const units = read("web/app/units/page.tsx");
  const property = read("web/app/properties/[id]/page.tsx");

  assert.match(nav, /href: "\/units", label: "Units"/);
  // Property detail keeps its Units; the two are complementary, not a move.
  assert.match(property, /spaces\//);
  assert.match(units, /\/properties\/\$\{unit\.property_id\}\/spaces\/\$\{unit\.id\}/);
});

test("Unit detail exposes the backend-owned archive or delete decision", () => {
  const page = read("web/app/properties/[id]/spaces/[spaceId]/page.tsx");
  const actions = read("web/src/components/property/UnitLifecycleActions.tsx");
  const api = read("web/src/lib/console.ts");

  assert.match(page, /<UnitLifecycleActions unit=\{space\}/);
  assert.match(actions, /unit\.permitted_actions\.delete/);
  assert.match(actions, /unit\.permitted_actions\.archive/);
  assert.match(actions, /Why\? This is recorded\./);
  assert.match(actions, /deleteUnit\(unit\.id, reason\.trim\(\)\)/);
  assert.match(actions, /archiveUnit\(unit\.id, reason\.trim\(\)\)/);
  assert.match(api, /\/spaces\/\$\{unitId\}\/archive\//);
});

test("a Property is recognized by its picture, and its Units are browsed five across", () => {
  const list = read("web/app/properties/page.tsx");
  const detail = read("web/app/properties/[id]/page.tsx");
  const css = read("web/src/styles/property-workspace.css");
  const serializer = read("backend/apps/property/serializers.py");

  // Nothing uploads Property photographs — `PropertyMediaView` is routed and
  // neither client calls it — so a cover that read only `media` would be an
  // empty frame on every row. It falls back to the building's own condition
  // evidence, which is where photographs of a Property actually exist.
  assert.match(serializer, /def get_cover_url/);
  assert.match(serializer, /_cover_files\(\)/);
  assert.match(list, /property\.cover_url/);
  assert.match(list, /inventory-thumb/);

  // A Unit's photograph is never the building's face: a room is not the block
  // containing it, and a property of twelve flats would wear whichever flat was
  // photographed first.
  assert.doesNotMatch(pyBody(serializer, "get_cover_url"), /units/);
  for (const view of ["backend/apps/property/views.py", "backend/apps/organization/views.py"]) {
    assert.doesNotMatch(read(view), /"units__media__file"/);
    assert.match(read(view), /"media__file"/);
  }

  // Units inside their Property are tiles, not one-per-line rows.
  assert.match(detail, /className="unit-columns"/);
  assert.match(detail, /function UnitTile/);
  assert.doesNotMatch(detail, /function UnitRow/);
  assert.match(css, /\.unit-columns \{[\s\S]*?repeat\(5, minmax\(0, 1fr\)\)/);

  // Five is a desktop answer. The same grid on a handset is five slivers.
  assert.match(css, /repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /repeat\(2, minmax\(0, 1fr\)\)/);

  // The narrow override has to match the desktop rule's specificity, or the
  // five-column template survives into the phone layout and wins on it.
  assert.match(
    css,
    /\.inventory-row-with-media\.inventory-row-with-stat \{\n {4}grid-template-columns: 5rem/,
  );
});
