import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const meaning = () => read("web/src/lib/accessCodeMeaning.ts");
const webUnit = () => read("web/app/properties/[id]/spaces/[spaceId]/page.tsx");
const webCard = () => read("web/src/components/property/UnitPrivateAccess.tsx");
const webTenants = () => read("web/src/components/property/SpaceTenantAccess.tsx");
const mobileUnit = () => read("mobile/app/(app)/space.tsx");
const mobileCard = () => read("mobile/src/components/property/UnitAccessCodeManagement.tsx");

/** Source with comments removed, so quoted history is not read as behaviour. */
const rendered = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

test("what an access code means is decided once, for both clients", () => {
  const strip = (source) => source.replace(/^\/\*\*[\s\S]*?\*\/\n/, "").trim();
  assert.equal(strip(meaning()), strip(read("mobile/src/accessCodeMeaning.ts")));
  // Self-contained, so the two can be compared byte for byte.
  assert.doesNotMatch(meaning(), /^import /m);
});

test("the code is managed from the Unit it belongs to", () => {
  // It used to be reachable on the web only through the Portfolio summary,
  // which is scoped to organization membership — so a provider holding a
  // Property directly saw an empty tab while their Units had live codes.
  assert.match(webUnit(), /<UnitPrivateAccess/);
  assert.match(webUnit(), /accessCode=\{space\.access_code\}/);
  assert.match(mobileUnit(), /<UnitAccessCodeManagement/);
  assert.match(mobileUnit(), /accessCode=\{unit\.access_code\}/);
});

test("both clients read the same section from the same rule", () => {
  for (const source of [webCard(), mobileCard()]) {
    assert.match(source, /privateAccess\(accessCode, \{ verified, occupied \}\)/);
    assert.match(source, /if \(!view\.show\) return null;/);
    assert.match(source, /view\.primary/);
    assert.match(source, /view\.canRevoke/);
  }
  // One implementation on the web: the Tenants tab renders the same component.
  assert.match(webTenants(), /<UnitPrivateAccess/);
  assert.doesNotMatch(rendered(webTenants()), /rotateUnitAccessCode|revokeUnitAccessCode/);
});

test("the section appears only when it is worth showing", () => {
  const rule = meaning();
  // Somebody who may read the Unit but not share it is not shown a sharing
  // mechanism at all.
  assert.match(rule, /if \(code\.can_manage === false\) return hidden;/);
  // Nor is an unchecked Unit told it cannot have a code — its verification
  // section already says what is missing.
  assert.match(rule, /if \(!context\.verified\) return hidden;/);
  // But a verified Unit that is blocked says which one thing blocks it.
  assert.match(rule, /End the tenancy to share it again/);
});

test("the readable code is never reconstructed or stored", () => {
  for (const source of [webCard(), mobileCard()]) {
    // It lives in component state after issue, and nowhere else.
    assert.match(source, /const \[issued, setIssued\] = useState\(""\)/);
    assert.doesNotMatch(source, /localStorage|sessionStorage|AsyncStorage/);
    assert.doesNotMatch(rendered(source), /accessCode\.code/);
  }
  assert.match(meaning(), /shown once/);
});

test("a control the service would refuse is not offered", () => {
  // `snapshot` answers from the Unit alone and does not know who is asking, so
  // the Unit read narrows it by the same capability the Portfolio read uses.
  const serializer = read("backend/apps/property/serializers.py");
  assert.match(serializer, /PropertyCapability\.TENANT_ACCESS\.value/);
  assert.match(serializer, /"can_rotate": bool\(code\["can_rotate"\] and allowed\)/);
  assert.match(serializer, /"can_revoke": bool\(code\["can_revoke"\] and allowed\)/);
  // Both read paths return the same key.
  assert.match(read("backend/apps/organization/services.py"), /code\["can_manage"\] = allowed/);
});


test("creating a code does not tear down the card showing it", () => {
  // The readable value is shown once and lives only in the card's own state,
  // so anything that unmounts the card destroys it. Creating a code triggers a
  // refresh, and that refresh used to blank the whole Portfolio while it was in
  // flight — the code appeared and vanished in the same breath.
  const page = read("web/app/tenants/page.tsx");

  // Blanking is for switching Portfolios, not for refreshing one.
  assert.match(page, /shownPortfolio\.current !== organizationId/);
  assert.match(page, /shownPortfolio\.current = organizationId/);

  // The card itself is a stable module-level component under a stable key, so
  // a re-render reconciles rather than remounting.
  assert.match(page, /key=\{space\.unit_id\}/);
  assert.match(webCard(), /^export function UnitPrivateAccess\(/m);
});

test("the tab is somewhere to create a code, not an inventory", () => {
  // A provider with many share-ready Units does not want a wall of cards here;
  // they want the one they are about to share, and a way through to the rest.
  // Units carries this same section on every Unit, so it is a complete answer.
  const page = read("web/app/tenants/page.tsx");

  // Web shows two rows of three small cards (owner, 2026-10-05: full-width
  // rows replaced the "simple cards"); still a preview, not the inventory.
  assert.match(page, /const ACCESS_PREVIEW = 6;/);
  assert.match(page, /ready\.slice\(0, ACCESS_PREVIEW\)/);
  assert.match(page, /\{shown\.map\(\(space, index\) => \(/);
  assert.match(page, /className="tenants-access-grid"/);

  // What is off screen is said, and there is one link to all of it.
  assert.match(page, /Showing \$\{shown\.length\} of \$\{ready\.length\}/);
  assert.match(rendered(page), /href="\/units"[^>]*>See all Units/);

  // Mobile caps the same way, to the same place.
  const tab = read("mobile/app/(app)/(provider-tabs)/tenants.tsx");
  assert.match(tab, /const ACCESS_PREVIEW = 3;/);
  assert.match(tab, /\.slice\(0, ACCESS_PREVIEW\)/);
  assert.match(tab, /Showing \$\{shown\} of \$\{ready\}/);
  assert.match(rendered(tab), /label="See all Units"/);
});
