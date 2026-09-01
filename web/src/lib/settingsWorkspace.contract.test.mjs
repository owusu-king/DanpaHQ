import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("Settings is a product area, not one long account page", () => {
  const layout = read("web/app/settings/layout.tsx");

  assert.ok(
    !existsSync(resolve(root, "web/app/account/page.tsx")),
    "/account still exists — Settings would have two homes",
  );
  for (const panel of ["page", "security/page", "notifications/page", "verification/page", "archive/page"]) {
    assert.ok(
      existsSync(resolve(root, `web/app/settings/${panel}.tsx`)),
      `web/app/settings/${panel}.tsx is missing`,
    );
  }
  assert.match(layout, /aria-label="Settings"/);
  assert.match(layout, /aria-current=\{current \? "page" : undefined\}/);

  // Portfolio and Team are first-class destinations already; listing them here
  // would be the second competing owner.
  assert.doesNotMatch(layout, /href="\/portfolio"/);
  assert.doesNotMatch(layout, /href="\/team"/);
});

test("notification preferences are finally reachable, and honest about what they cost", () => {
  const panel = read("web/app/settings/notifications/page.tsx");
  const api = read("web/src/lib/console.ts");

  // Three real backend fields that no client had ever exposed.
  assert.match(api, /\/me\/notification-preferences\//);
  assert.match(panel, /sms_enabled/);
  assert.match(panel, /push_enabled/);
  assert.match(panel, /sms_important_only/);
  assert.match(panel, /Standard network charges apply/);

  // A failed save puts the switch back rather than leaving the page claiming
  // something the server did not accept.
  assert.match(panel, /setPreferences\(previous\)/);

  // "Only important texts" is meaningless with texts off.
  assert.match(panel, /disabled=\{!preferences\.sms_enabled\}/);
});

test("one Settings index, one entry point", () => {
  const menu = read("web/src/components/portal/AccountMenu.tsx");
  const nav = read("web/src/lib/portalNav.ts");

  assert.match(menu, /href=\{"\/settings" as never\}/);
  assert.match(menu, />\s*Settings\s*</);
  assert.match(nav, /"\/settings"/);
  assert.doesNotMatch(nav, /"\/account"/);
});

test("the account menu offers three things and no destinations of its own", () => {
  const menu = read("web/src/components/portal/AccountMenu.tsx");

  // Settings, the workspace crossing, and sign out. Everything the menu used to
  // carry — a Portfolio switcher, Updates, invitations, Archive — either lives
  // in the rail or in Settings, and listing it twice made the menu a second
  // navigation surface.
  assert.match(menu, /href=\{"\/settings" as never\}/);
  assert.match(menu, /<WorkspaceCrossing/);
  assert.match(menu, /<SignOutItem/);
  assert.doesNotMatch(menu, /CURRENT PORTFOLIO/);
  assert.doesNotMatch(menu, /href="\/updates"/);
  assert.doesNotMatch(menu, /portfolio-invitations/);
  assert.doesNotMatch(menu, /settings\/archive/);
});

test("a panel says its heading once, and is not a card inside a card", () => {
  const sections = read("web/src/components/account/AccountSections.tsx");
  const profile = read("web/app/settings/page.tsx");

  // These were written for one long /account page and moved into the shell
  // verbatim: every panel rendered its title twice — "Photo" then "Your photo" —
  // each inside a bordered box within the panel already holding it.
  assert.doesNotMatch(sections, /type-title-1/);
  const container = sections.slice(
    sections.indexOf("const sectionStyle"),
    sections.indexOf("};", sections.indexOf("const sectionStyle")),
  );
  assert.doesNotMatch(container, /border|padding/);
  assert.match(profile, /<h2>Photo<\/h2>/);
  // Comments legitimately name the headings that were removed.
  const rendered = sections.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(rendered, /Your photo/);
});

test("Verification is a clean overview and settlement status comes from the Portfolio", () => {
  const overview = read("web/app/settings/verification/page.tsx");
  const identity = read("web/app/settings/verification/identity/page.tsx");

  assert.match(overview, /getPayoutDestination/);
  assert.match(overview, /profile\?\.status === "verified"/);
  assert.match(overview, /payments\/payout-account\?organization=/);
  assert.match(overview, /title="Bank or Mobile Money"/);
  assert.doesNotMatch(overview, /<IdentitySection/);
  assert.doesNotMatch(overview, /Your checks/);
  assert.match(identity, /<IdentitySection/);
});
