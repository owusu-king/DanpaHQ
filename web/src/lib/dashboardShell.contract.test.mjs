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

test("shared workspaces reclaim desktop width as their sidebars collapse", () => {
  const portalCss = code(read("web/src/styles/portal.css"));
  const managementCss = code(read("web/app/globals.css"));
  const portalMain = portalCss.match(/\.portal-main\s*\{([^}]*)\}/)?.[1] ?? "";
  const managementMain = managementCss.match(/\.management-main\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(portalCss, /\.portal\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(portalCss, /\.portal\s*\{\s*grid-template-columns:\s*auto minmax\(0, 1fr\)/);
  assert.match(managementCss, /\.management-app\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)/s);
  for (const main of [portalMain, managementMain]) {
    assert.match(main, /width:\s*100%/);
    assert.match(main, /min-width:\s*0/);
    assert.match(main, /margin(?:-inline)?:\s*(?:0 )?auto/);
    assert.match(main, /max-width:\s*120rem/);
  }

  assert.match(portalCss, /padding: var\(--space-8\) clamp\(var\(--space-8\), 4\.5vw, var\(--space-20\)\) var\(--space-16\)/);
  assert.match(managementMain, /clamp\(1\.5rem, 5vw, 5rem\)/);
  // The rail, not a page-local width, determines the frame from laptop through
  // large desktop. The ultra-wide cap is a deliberate readable outer measure.
  for (const [expanded, collapsed] of [[264, 68], [272, 72]]) {
    for (const viewport of [1024, 1280, 1440, 1920]) {
      const width = (rail) => Math.min(viewport - rail, 120 * 16);
      assert.ok(width(collapsed) > width(expanded), `${viewport}px should gain content width`);
    }
  }

  assert.match(read("web/src/styles/home-workspace.css"), /container:\s*provider-home \/ inline-size/);
  assert.match(read("web/src/styles/units-workspace.css"), /\.units-grid\s*\{[^}]*repeat\(auto-fill/s);
  assert.match(read("web/src/styles/settings-workspace.css"), /\.settings-panel\s*\{[^}]*max-width:\s*44rem/s);
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
  const property = read("web/app/record/property/page.tsx");
  const unit = read("web/app/record/space/page.tsx");

  assert.match(tenants, /portfolio\.tenant_access/);
  assert.match(tenants, /<SpaceTenantAccess/);
  assert.doesNotMatch(tenants, /decidePropertyJoinRequest|TenancyRequestsSection/);
  // Still the Applications route's job, but no longer all in its one file: the
  // record moved to `/applications/<requestId>` when it stopped being a dialog,
  // and the loading and the wording went to modules both halves share.
  const loader = read("web/src/lib/useProviderRequests.ts");
  const record = read("web/src/components/requests/RequestRecord.tsx");
  const meaning = read("web/src/lib/tenancyRequests.ts");

  // Private Unit requests ride on the Portfolio, so the loader still folds them
  // in with the public applications — for the Portfolio being operated, not for
  // every Portfolio the account belongs to flattened into one list, which is
  // what this used to pin.
  assert.match(loader, /getOrganizationPortfolio\(scope\.id\)/);
  assert.match(loader, /portfolio\.tenancy_requests\.map\(/);
  assert.doesNotMatch(loader, /organizations\.map\(\(organization\) => getOrganizationPortfolio/);
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
