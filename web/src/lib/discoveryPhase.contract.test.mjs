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
  const listing = read("web/app/record/listing/page.tsx");
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
  assert.match(viewings, /label="Needs action"/);
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
  // The flow lives in one component: a modal from Home (owner, 2026-10-05),
  // and the same form on /tenant/setup for a direct link.
  const webSetup = read("web/src/components/tenant/JoinHome.tsx");
  assert.match(read("web/app/tenant/setup/page.tsx"), /<JoinHomeForm \/>/);
  assert.match(webSetup, /<ModalSheet/);
  // The tenant's home moved into a component of its own when it became a
  // control centre; the tab is the shell around it.
  const mobileHome = read("mobile/src/components/home/TenantHome.tsx");
  const mobileSetup = read("mobile/app/(app)/tenant-setup.tsx");

  // Web states it as the action on the Overview card, where the rest of the
  // account-level facts are. The entry itself is the rule, not the shape it
  // takes or where on the page it sits.
  assert.match(webHome, /<JoinHomeButton className="home-primary-action[^"]*"/);
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
    read("web/app/record/space/page.tsx"),
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
    read("web/app/record/listing/page.tsx"),
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
  const tenancy = read("web/app/record/tenant/page.tsx");
  const navigation = read("web/src/lib/portalNav.ts");

  assert.match(navigation, /href: "\/tenants", label: "Tenants"/);
  assert.match(tenants, /getOrganizationPortfolio/);
  assert.match(tenants, /tenant\.tenancy_id/);
  // The rent reading moved to the module the card and the tenancy modal share.
  assert.match(read("web/src/lib/tenancyDisplay.ts"), /tenant\.rent\.outstanding_minor/);
  assert.match(tenants, /Search tenants/);
  // Plain filters (owner, 2026-10-05): Active and an Archive of past tenants,
  // not "Needs attention" and "Paid up".
  assert.match(tenants, /\{ key: "active", label: "Active" \}/);
  assert.match(tenants, /\{ key: "archive", label: "Archive" \}/);
  assert.doesNotMatch(tenants, /label: "Needs attention"|label: "Paid up"/);
  assert.match(tenants, /portfolio\?\.past_tenants/);
  assert.match(tenancy, /portfolio\.past_tenants/);
  assert.match(tenancy, /record\/space\?propertyId=\$\{tenant\.property_id\}&spaceId=\$\{tenant\.unit_id\}/);
  // A lease is a document: a manager reading a tenant opens it over the
  // tenancy, in a modal, rather than leaving for another page.
  assert.match(tenancy, /<LeaseModal/);
  assert.match(tenancy, /setLeaseOpen\(tenant\.lease_id\)/);
  const modal = read("web/src/components/leases/LeaseModal.tsx");
  assert.match(modal, /<LeaseRecord lease=\{lease\} onChanged=\{changed\} \/>/);
  assert.match(modal, /listGrantedLeases\(\)/);
  assert.doesNotMatch(tenants, /listUsers|createTenant/);
});

test("a tenant card is a portrait that opens its tenancy in a sheet", () => {
  const tenants = read("web/app/tenants/page.tsx");
  const modal = read("web/src/components/tenants/TenantModal.tsx");
  const css = read("web/src/styles/tenants-workspace.css");

  // Minimal: the person, the state, the home and one rent line.
  assert.match(tenants, /className="tenant-card-avatar"/);
  assert.doesNotMatch(tenants, /tenant-card-facts/);
  // Their photo, not just initials (owner, 2026-10-05), from the row's own
  // endpoint; the backend lets a provider read it while the person lives there.
  assert.match(tenants, /<Avatar name=\{tenant\.name\} size=\{44\} photoUrl=\{tenant\.avatar_url \?\? null\} \/>/);
  assert.match(read("backend/apps/files/services.py"), /if stored\.purpose == FilePurpose\.AVATAR:/);
  // A plain record card (owner, 2026-10-05: the hover "looked fake"). Nothing
  // hides on hover — no View pill swapping out the rent, no floating portrait,
  // no lift — and Open is always there.
  assert.doesNotMatch(tenants, /tenant-card-view/);
  assert.match(tenants, /className="tenant-card-open" aria-hidden="true">Open/);
  assert.doesNotMatch(css, /\.tenant-card:hover[^{]*\{[^}]*transform: translateY/);
  assert.doesNotMatch(css, /\.tenant-card-avatar \{[^}]*position: absolute/);

  // A plain click opens the sheet, held in page state; the card still links
  // to the tenancy's own page for a new tab.
  assert.match(tenants, /useDeepLinkedModal\("tenant"\)/);
  assert.match(tenants, /href=\{href as never\}/);
  assert.match(tenants, /event\.preventDefault\(\);\s*onPeek\(\);/);
  assert.match(tenants, /<TenantModal tenant=\{openedTenant\}/);

  // The sheet does not repeat the card. Its only two actions leave for their
  // own pages (owner, 2026-10-05): the tenant's payments and the tenancy page.
  // Nothing nests — no agreement or payments view inside it, no modal over it.
  assert.doesNotMatch(modal, /tm-hero/);
  assert.doesNotMatch(modal, /useModalViews|<AgreementView|<PaymentsView|<LeaseModal|<ReceiptView/);
  assert.match(modal, /href=\{`\/record\/payment\?leaseId=\$\{tenant\.lease_id\}` as never\}>\s*<Icon name="payments" \/>View payments/);
  assert.match(modal, /href=\{`\/record\/tenant\?tenancyId=\$\{id\}` as never\}>\s*<Icon name="users" \/>Open the tenancy page/);
  const actions = modal.slice(modal.indexOf('className="tm-actions"'));
  assert.equal((actions.match(/<Link className=/g) ?? []).length, 2, "the tenancy sheet has exactly two actions");
  assert.match(modal, /href=\{`\/record\/space\?propertyId=\$\{tenant\.property_id\}&spaceId=\$\{tenant\.unit_id\}` as never\}/);
});
