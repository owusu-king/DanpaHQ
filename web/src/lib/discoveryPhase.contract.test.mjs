import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relative) {
  return readFileSync(resolve(root, relative), "utf8");
}

test("web discovery exposes distinct viewing and application follow-up actions", () => {
  const listing = read("web/app/listings/[id]/page.tsx");
  assert.match(listing, /listMyViewings/);
  // Once an action has happened the page says so rather than offering it again.
  assert.match(listing, /Viewing requested — open it/);
  assert.match(listing, /Application sent — open it/);

  // Withdrawal moved onto the application record when it got its own address.
  const applicationRecord = read("web/src/components/applications/ApplicationRecord.tsx");
  assert.match(applicationRecord, /withdrawMyApplication/);
  assert.match(applicationRecord, />\s*Withdraw\s*</);
});

test("mobile provider can act on viewing requests and applications", () => {
  const viewings = read("mobile/app/(app)/provider-viewings.tsx");
  const viewing = read("mobile/app/(app)/provider-viewing.tsx");
  assert.match(viewings, /listReceivedViewings/);
  assert.match(viewings, /<FlatList/);
  assert.match(viewings, /label="Action"/);
  assert.match(viewings, /label="Upcoming"/);
  assert.match(viewings, /label="History"/);
  assert.match(viewing, /offerViewingSlots/);
  assert.match(viewing, /recordProviderViewingOutcome/);

  const applications = read("mobile/app/(app)/provider-applications.tsx");
  const application = read("mobile/app/(app)/provider-application.tsx");
  assert.match(applications, /listReceivedApplications/);
  assert.match(applications, /provider-application/);
  assert.match(application, /decideApplication/);

  // Routing moved out of the screen into the shared meaning module, where every
  // emitted target type is covered rather than the four an if-chain reached.
  const meaning = read("mobile/src/notificationMeaning.ts");
  assert.match(meaning, /provider-viewings/);
  assert.match(meaning, /provider-applications/);
});

test("mobile application form sends the shared application context", () => {
  const apply = read("mobile/app/(app)/apply/[id].tsx");
  for (const field of ["move_in_from", "occupation", "employer", "income_band"]) {
    assert.match(apply, new RegExp(field), `${field} is missing from mobile application submission`);
  }
  assert.match(apply, /Try again/);
});

test("tenant home always offers the canonical access-code tenancy-request entry", () => {
  const webHome = read("web/app/home/page.tsx");
  const webSetup = read("web/app/tenant/setup/page.tsx");
  // The tenant's home moved into a component of its own when it became a
  // control centre; the tab is the shell around it.
  const mobileHome = read("mobile/src/components/home/TenantHome.tsx");
  const mobileSetup = read("mobile/app/(app)/tenant-setup.tsx");

  // Web states it as the action on the Overview card, where the rest of the
  // account-level facts are. The entry itself is the rule, not the shape it
  // takes or where on the page it sits.
  assert.match(webHome, /href="\/tenant\/setup" className="home-primary-action[^"]*"/);
  assert.match(webHome, /Join a home/);
  // Mobile states it in words rather than as a floating glyph; the entry
  // itself is the rule, not the shape it takes.
  assert.match(mobileHome, /accessibilityLabel="Join another home"/);
  assert.match(mobileHome, /onPress=\{onJoin\}/);
  assert.doesNotMatch(mobileHome, /<Ionicons name="add"/);
  // And it is offered whatever workspace the account is in, which is where the
  // control used to disappear.
  assert.match(
    read("mobile/app/(app)/(tabs)/index.tsx"),
    /const tenantMode = Boolean\(me\);/,
  );

  for (const source of [webSetup, mobileSetup]) {
    assert.match(source, /I have a Unit access code/);
    assert.match(source, /property-join-lookup/);
    assert.match(source, /join-requests/);
    assert.match(source, /bed_id/);
    assert.doesNotMatch(source, /property-invitations|acceptPropertyInvitation|I have an invitation/);
  }
});

test("provider clients do not expose direct tenant invitations", () => {
  const sources = [
    read("web/src/components/property/SpaceTenantAccess.tsx"),
    read("mobile/app/(app)/space.tsx"),
    read("mobile/app/(app)/(provider-tabs)/tenants.tsx"),
  ];

  for (const source of sources) {
    assert.doesNotMatch(source, /createPropertyInvitation|Create invitation|INVITATION TYPE|invitation_id/);
    assert.match(source, /access code|AccessCode|tenancy request/i);
  }
});

test("provider space screens render occupied restrictions from backend actions", () => {
  const sources = [
    read("web/app/properties/[id]/spaces/[spaceId]/page.tsx"),
    read("mobile/app/(app)/space.tsx"),
  ];

  for (const source of sources) {
    assert.match(source, /availability\.state === "occupied"/);
    assert.match(source, /permitted_actions\.recheck/);
    assert.match(source, /permitted_actions\.edit_operational/);
    assert.match(source, /permitted_actions\.add_bed/);
    assert.match(source, /publish\?\.allowed/);
    assert.match(source, /Currently occupied/);
  }
});

test("public listing screens use the combined Unit and Property gallery", () => {
  const sources = [
    read("web/app/listings/[id]/page.tsx"),
    read("mobile/app/(app)/listing/[id].tsx"),
  ];

  for (const source of sources) {
    assert.match(source, /listing\.gallery\.filter/);
    // The label comes from the API rather than being hardcoded, so a photograph
    // carries its own source instead of the gallery splitting into sections.
    assert.match(source, /source_label/);
    assert.doesNotMatch(source, /"This unit"/);
    assert.doesNotMatch(source, /place\.photos\.(?:some|filter)/);
  }
});

test("provider tenants is a portfolio route over tenancy, lease and rent data", () => {
  const tenants = read("web/app/tenants/page.tsx");
  const tenancy = read("web/app/tenants/[tenancyId]/page.tsx");
  const navigation = read("web/src/lib/portalNav.ts");

  assert.match(navigation, /href: "\/tenants", label: "Tenants"/);
  assert.match(tenants, /getOrganizationPortfolio/);
  assert.match(tenants, /tenant\.tenancy_id/);
  assert.match(tenants, /tenant\.rent\.outstanding_minor/);
  assert.match(tenants, /Search tenants/);
  assert.match(tenants, /Needs attention/);
  assert.match(tenancy, /properties\/\$\{tenant\.property_id\}\/spaces\/\$\{tenant\.unit_id\}/);
  // The agreement has an address of its own now, so this names it directly
  // rather than asking the list to scroll to a hash.
  assert.match(tenancy, /`\/leases\/\$\{tenant\.lease_id\}`/);
  assert.doesNotMatch(tenants, /listUsers|createTenant/);
});
