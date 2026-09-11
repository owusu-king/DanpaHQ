import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relative) {
  return readFileSync(resolve(root, relative), "utf8");
}

// Comments explain; they must never be what satisfies an assertion.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("dashboard navigation suppresses horizontal scrolling", () => {
  const portalCss = read("web/src/styles/portal.css");
  const managementCss = read("web/app/globals.css");

  assert.match(portalCss, /\.portal-nav\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(managementCss, /\.management-sidebar nav\s*\{[^}]*overflow-x:\s*hidden/s);
});

test("management has a persisted accessible desktop collapse control and icon links", () => {
  const shell = read("web/src/components/management/ManagementShell.tsx");
  const accountMenu = read("web/src/components/management/ManagementAccountMenu.tsx");
  const managementCss = read("web/app/globals.css");

  assert.match(shell, /const COLLAPSE_KEY = "management\.sidebar"/);
  assert.match(shell, /aria-label=\{isCollapsed \? "Expand sidebar" : "Collapse sidebar"\}/);
  assert.match(shell, /<Icon name=\{item\.icon\} \/>/);
  assert.match(shell, /className="management-nav-label"/);
  assert.match(shell, /<ManagementAccountMenu/);
  assert.doesNotMatch(shell, /href: "\/management\/profile"/);
  assert.match(accountMenu, /<Avatar name=\{user\.display_name\}/);
  assert.match(accountMenu, /Profile and security/);
  assert.match(accountMenu, /Sign out/);
  assert.match(accountMenu, /portal-account-trigger/);
  assert.match(managementCss, /\.management-app\.is-collapsed \.management-sidebar\s*\{[^}]*width:\s*4\.5rem/s);
  assert.match(managementCss, /@media \(max-width: 800px\)[\s\S]*\.management-collapse\s*\{\s*display:\s*none;/);
});

test("provider archive is reachable under account settings on web and mobile", () => {
  const accountMenu = read("web/src/components/portal/AccountMenu.tsx");
  const settingsIndex = read("web/app/settings/layout.tsx");
  const webArchive = read("web/app/settings/archive/page.tsx");
  const mobileMore = read("mobile/app/(app)/(provider-tabs)/more.tsx");
  const mobileArchive = read("mobile/app/(app)/archive.tsx");

  // Archive is a Settings panel now rather than a card on one long account page.
  // The account menu carries three items and no destinations of its own, so the
  // Settings index is the only place that names it.
  assert.doesNotMatch(accountMenu, /\/settings\/archive/);
  assert.match(settingsIndex, /\/settings\/archive/);
  assert.match(webArchive, /listMyArchive/);
  assert.match(webArchive, /restoreProperty/);
  assert.match(webArchive, /restoreSpace/);
  assert.match(webArchive, /Cannot restore yet/);

  // A provider reaches it from More. A tenant has no Archive to reach.
  assert.match(mobileMore, /label="Archive"/);
  assert.match(mobileMore, /\/\(app\)\/archive"/);
  assert.match(mobileArchive, /listMyArchive/);
  assert.match(mobileArchive, /restoreProperty/);
  assert.match(mobileArchive, /restoreSpace/);
  assert.match(mobileArchive, /Cannot restore yet/);
});

test("account sessions can sign out another device but not the current one", () => {
  const security = read("web/app/settings/security/page.tsx");
  const api = read("web/src/lib/console.ts");

  assert.match(api, /\/me\/sessions\/\$\{sessionId\}\//);
  assert.match(api, /method: "DELETE"/);
  assert.match(security, /!device\.is_current/);
  // A row with no button, marked THIS ONE, explains itself; the sentence went.
  assert.match(security, /Sign out everywhere/);
});

test("mobile removes a deleted device row instead of redrawing its action", () => {
  const security = code(read("mobile/app/(app)/security.tsx"));

  // Once the server has signed the device out or barred it, its row leaves
  // local state straight away — a state update right after the awaited action
  // that filters that device out — rather than staying on screen with an action
  // that no longer applies. The busy label's wording is not the behaviour.
  assert.match(
    security,
    /await [^;]+;\s*setDevices\(\((\w+)\) => \1\?\.filter\(\((\w+)\) => \2\.id !== device\.id\)[^;]*\);/,
  );
  // And while one device is being acted on, no device action takes another press.
  assert.match(security, /disabled=\{removingDevice !== null\}/);
});

test("provider tenant acquisition separates request decisions from active tenant work", () => {
  const tenants = read("web/app/tenants/page.tsx");
  const requests = read("web/app/applications/page.tsx");
  const property = read("web/app/properties/[id]/page.tsx");
  const unit = read("web/app/properties/[id]/spaces/[spaceId]/page.tsx");

  assert.match(tenants, /portfolio\.tenant_access/);
  assert.match(tenants, /<SpaceTenantAccess/);
  assert.doesNotMatch(tenants, /decidePropertyJoinRequest|TenancyRequestsSection/);
  // Still the Applications route's job, but no longer all in its one file: the
  // record moved to `/applications/<requestId>` when it stopped being a dialog,
  // and the loading and the wording went to modules both halves share.
  const loader = read("web/src/lib/useProviderRequests.ts");
  const record = read("web/src/components/requests/RequestRecord.tsx");
  const meaning = read("web/src/lib/tenancyRequests.ts");

  assert.match(loader, /portfolios[\s\S]*flatMap\(\(portfolio\) => portfolio\.tenancy_requests\)/);
  assert.match(record, /decidePropertyJoinRequest/);
  assert.match(record, /<LeasePreparationForm/);
  assert.match(requests, /useProviderRequests/);
  for (const stage of ["Needs action", "Agreement", "History"]) {
    assert.ok(meaning.includes(stage), `${stage} must still be a stage somebody can filter to`);
  }

  assert.doesNotMatch(property, /listPropertyJoinRequests|function TenantAccess/);
  assert.match(property, /"\/tenants" as never/);
  assert.doesNotMatch(unit, /<SpaceTenantAccess/);
  assert.match(unit, /"\/tenants#access" as never/);
});
