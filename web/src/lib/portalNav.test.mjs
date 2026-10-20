import test from "node:test";
import assert from "node:assert/strict";

import {
  activeHref,
  enquiriesEntry,
  isPortalRoute,
  isSharedListingRoute,
  portalSections,
} from "./portalNav.compiled.mjs";

/**
 * Navigation is the one thing on every screen, so a wrong answer here is a
 * wrong answer everywhere. These tests hold the two properties that matter:
 * the menu is derived from capabilities and never from a role name, and a
 * tenant is never offered provider sections (or the reverse).
 */

function account({
  workspace = "tenant",
  exists = false,
  workspaceAccess = false,
  available = ["discovery", "tenant"],
  artisan = { status: "not_started", workspace_access: false, can_quote: false },
} = {}) {
  return {
    capabilities: {
      active_workspace: workspace,
      available_workspaces: available,
      provider: { exists, workspace_access: workspaceAccess },
      tenant: { workspace_access: true },
      artisan,
    },
  };
}

const hrefs = (me) => portalSections(me).flatMap((section) => section.items.map((i) => i.href));

test("a tenant is offered their rental journey, and no provider operations", () => {
  const links = hrefs(account());

  assert.deepEqual(links, [
    "/home", "/rentals", "/saved", "/applications", "/leases", "/payments", "/viewings",
    "/maintenance", "/passport", "/updates",
  ]);
  assert.ok(!links.includes("/properties"));
  assert.ok(!links.includes("/provider"));
});

test("the Housing Passport is the tenant's own, and its shared view is not portal", () => {
  // The passport belongs to the person, beside Updates; a provider operating a
  // Portfolio is not offered one in their rail.
  assert.ok(hrefs(account()).includes("/passport"));
  assert.ok(!hrefs(account({ workspace: "provider", exists: true, workspaceAccess: true })).includes("/passport"));
  assert.equal(isPortalRoute("/passport"), true);
  // A recipient opens a link without an account; it must never demand a session.
  assert.equal(isPortalRoute("/shared-passport"), false);
});

test("an approved provider is offered the portfolio, and no tenant shortlist", () => {
  const links = hrefs(account({
    workspace: "provider", exists: true, workspaceAccess: true,
  }));

  assert.deepEqual(links, [
    "/home", "/properties", "/units", "/tenants", "/documents", "/payments",
    "/applications", "/viewings", "/maintenance", "/updates",
  ]);
  assert.ok(!links.includes("/saved"));
});

test("a provider still in review gets the review, and no operational sections", () => {
  // Every one of those endpoints would refuse, so offering them would be a menu
  // of dead ends.
  const links = hrefs(account({ workspace: "provider", exists: true, workspaceAccess: false }));

  assert.deepEqual(links, ["/home", "/provider", "/updates"]);
});

test("a provider viewing the tenant side sees the tenant menu", () => {
  // The workspace leads, not the account type. Someone who crossed over is in
  // the tenant experience and should be given it.
  const links = hrefs(account({
    workspace: "tenant",
    exists: true,
    workspaceAccess: true,
    available: ["discovery", "tenant", "provider"],
  }));

  assert.ok(links.includes("/saved"));
  assert.ok(!links.includes("/properties"));
});

test("a Portfolio member is offered their role, and a role is offered what it reaches", () => {
  // Somebody invited into a Portfolio has no provider journey of their own —
  // `exists` is false and stays false — and the workspace is still theirs.
  const member = account({
    workspace: "provider",
    exists: false,
    workspaceAccess: true,
    available: ["discovery", "tenant", "provider"],
  });
  const portfolioAccess = (can) => ({
    state: "limited",
    requirements: [],
    scope: "assigned_properties",
    can: {
      operate_properties: false,
      create_properties: false,
      view_finances: false,
      view_billing: false,
      manage_team: false,
      ...can,
    },
  });
  const links = (access) =>
    portalSections(member, "Kente", access).flatMap((section) => section.items.map((i) => i.href));

  // An accountant reads rent and payment records for the Properties they are
  // assigned. Properties, Units and tenancy requests would every one refuse.
  assert.deepEqual(
    links(portfolioAccess({ view_finances: true, view_billing: true })),
    ["/home", "/payments", "/updates"],
  );

  // A property manager gets the operational workspace.
  const manager = links(portfolioAccess({ operate_properties: true, view_finances: true }));
  assert.ok(manager.includes("/properties"));
  assert.ok(manager.includes("/tenants"));
  assert.ok(manager.includes("/applications"));
  assert.ok(!manager.includes("/saved"));
});

test("the active item is the longest match, not the first", () => {
  const sections = portalSections(account({
    workspace: "provider", exists: true, workspaceAccess: true,
  }));

  assert.equal(activeHref(sections, "/properties"), "/properties");
  assert.equal(activeHref(sections, "/record/property-new"), "/properties");
  assert.equal(activeHref(sections, "/tenants"), "/tenants");
  assert.equal(activeHref(sections, "/home"), "/home");
  assert.equal(activeHref(sections, "/nowhere"), null);
});

test("portal routes are portal routes; listings belong to whoever is looking", () => {
  assert.ok(isPortalRoute("/home"));
  assert.ok(isPortalRoute("/apply/abc"));
  assert.ok(isPortalRoute("/properties/abc"));
  assert.ok(!isPortalRoute("/"));
  assert.ok(!isPortalRoute("/sign-in"));

  // Deliberately not a portal route: the shell decides from the session, so one
  // listing implementation serves the public site and Explore both.
  assert.ok(!isPortalRoute("/rentals"));
  assert.ok(isSharedListingRoute("/rentals"));
  assert.ok(isSharedListingRoute("/listings/abc"));
  assert.ok(!isSharedListingRoute("/home"));
});

test("every item carries an icon, because collapsed there is nothing else", () => {
  // In the collapsed rail the icon is the whole control. An item without one
  // would be an invisible row, so this is checked rather than assumed.
  for (const me of [
    account(),
    account({ workspace: "provider", exists: true, workspaceAccess: true }),
    account({ workspace: "provider", exists: true, workspaceAccess: false }),
  ]) {
    for (const section of portalSections(me)) {
      for (const item of section.items) {
        assert.ok(item.icon, `${item.href} has no icon`);
      }
    }
  }
});

test("account is reached through the avatar, not a nav row", () => {
  // One account control, not two. The menu behind the avatar owns /account,
  // and duplicating it in the rail is the competing-menus problem.
  for (const me of [
    account(),
    account({ workspace: "provider", exists: true, workspaceAccess: true }),
  ]) {
    assert.ok(!hrefs(me).includes("/account"));
  }
});

test("the operational section is named after the Portfolio being operated", () => {
  // "Where am I" has to be answerable without opening a menu, so the rail says
  // which Portfolio these areas belong to. It falls back to the generic word
  // rather than rendering an empty heading.
  const me = account({ workspace: "provider", exists: true, workspaceAccess: true });

  assert.equal(portalSections(me, "Ama Props")[1].title, "Ama Props");
  assert.equal(portalSections(me, "   ")[1].title, "Portfolio");
  assert.equal(portalSections(me, null)[1].title, "Portfolio");
  assert.equal(portalSections(me)[1].title, "Portfolio");
});

test("enquiries are reached from the top bar, on the same terms the rail offered them", () => {
  // A tenant reads the properties they asked to buy.
  assert.deepEqual(enquiriesEntry(account()), { href: "/enquiries", as: "buyer" });
  // An approved provider reads questions about what they sell…
  assert.deepEqual(
    enquiriesEntry(account({ workspace: "provider", exists: true, workspaceAccess: true })),
    { href: "/enquiries", as: "seller" },
  );
  // …unless their Portfolio role does not operate Properties…
  assert.equal(
    enquiriesEntry(
      account({ workspace: "provider", exists: true, workspaceAccess: true }),
      { can: { operate_properties: false } },
    ),
    null,
  );
  // …and a provider still in review has nothing to answer yet.
  assert.equal(enquiriesEntry(account({ workspace: "provider", exists: true, workspaceAccess: false })), null);
});

test("an approved artisan is offered four places and nothing about tenants or properties", () => {
  const me = account({
    workspace: "artisan",
    available: ["discovery", "tenant", "artisan"],
    artisan: { status: "approved", workspace_access: true, can_quote: true },
  });

  assert.deepEqual(hrefs(me), ["/home", "/artisan/requests", "/artisan/jobs", "/artisan/profile"]);
  assert.equal(enquiriesEntry(me), null);
  assert.equal(isPortalRoute("/artisan/jobs"), true);
});

test("a suspended artisan keeps their four places, to read their records", () => {
  const me = account({
    workspace: "artisan",
    available: ["discovery", "tenant", "artisan"],
    artisan: { status: "suspended", workspace_access: true, can_quote: false },
  });

  assert.equal(hrefs(me).length, 4);
});

test("an applicant is not given the artisan experience by asking for it", () => {
  // A stale or forged workspace with no access falls back to the tenant rail,
  // and nothing artisan is offered.
  const me = account({
    workspace: "artisan",
    artisan: { status: "pending", workspace_access: false, can_quote: false },
  });

  assert.ok(!hrefs(me).some((href) => href.startsWith("/artisan")));
  assert.ok(hrefs(me).includes("/rentals"));
});
