/**
 * The five list rows, and the fact that they go somewhere.
 *
 * Payments, Tenancy requests, Leases, Viewings and Applications all render the
 * same thing: a row that opens a record at its own address. A row that does
 * that has to look like it does, standing still and under a pointer.
 *
 * Written after the tenant's Applications row shipped with **neither** — no
 * chevron at all, and a hover that painted the row `--color-field-50`, which is
 * exactly the colour `body` already is. Pointing at it did nothing, and nothing
 * failed, because every assertion in the suite was about structure.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");

/** Every provider and tenant list that opens a record. */
const ROWS = [
  { sheet: "payments-workspace.css", row: "rent-row", page: "web/app/payments/page.tsx" },
  {
    sheet: "tenancy-requests-workspace.css",
    row: "request-row",
    page: "web/app/applications/page.tsx",
  },
  { sheet: "leases-workspace.css", row: "lease-row", page: "web/app/leases/page.tsx" },
  { sheet: "viewings-workspace.css", row: "viewing-row", page: "web/app/viewings/page.tsx" },
  {
    sheet: "applications-workspace.css",
    row: "application-row",
    page: "web/app/applications/page.tsx",
  },
  { sheet: "agreements-workspace.css", row: "agreement-row", page: "web/app/leases/page.tsx" },
  {
    sheet: "viewings-tenant.css",
    row: "tenant-viewing-row",
    page: "web/app/viewings/page.tsx",
  },
];

const sheetOf = (entry) => read(`web/src/styles/${entry.sheet}`);

function rule(sheet, selector) {
  const at = sheet.indexOf(selector + " {");
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

/** Whatever `body` is painted; a hover the same colour is not a hover. */
function pageGround() {
  const globals = read("web/app/globals.css");
  const body = globals.slice(globals.indexOf("\nbody {"), globals.indexOf("}", globals.indexOf("\nbody {")));
  const match = body.match(/background:\s*var\((--color-[a-z0-9-]+)\)/);
  assert.ok(match, "could not read the page ground from globals.css");
  return match[1];
}

test("a row that goes somewhere says so before it is touched", () => {
  for (const entry of ROWS) {
    const sheet = sheetOf(entry);
    // The chevron exists, and is rendered.
    rule(sheet, `.${entry.row}-arrow`);
    assert.match(
      read(entry.page),
      new RegExp(`className="${entry.row}-arrow"`),
      `${entry.page} never renders a ${entry.row}-arrow`,
    );
  }
});

test("a hover is never the colour the page already is", () => {
  // `.application-row:hover { background: var(--color-field-50) }` on a
  // `--color-field-50` body is a hover nobody can see.
  const ground = pageGround();
  for (const entry of ROWS) {
    const hover = rule(sheetOf(entry), `.${entry.row}:hover`);
    assert.match(hover, /background:/, `${entry.row} has no hover background`);
    assert.doesNotMatch(
      hover,
      new RegExp(`background:\\s*var\\(${ground}\\)`),
      `${entry.row} hovers to the page's own colour`,
    );
  }
});

test("the chevron moves toward where the row is about to go", () => {
  for (const entry of ROWS) {
    const sheet = sheetOf(entry);
    const nudge = rule(sheet, `.${entry.row}:hover .${entry.row}-arrow`);
    assert.match(nudge, /transform: translateX/);
    // Colour as well as movement, so the cue survives reduced motion.
    assert.match(nudge, /color:/);
    assert.match(rule(sheet, `.${entry.row}-arrow`), /transition:/);
  }
});

test("nothing still styles a row as a pressed button", () => {
  // These were `<button aria-pressed>` inside split views. They are links now,
  // and a link is never pressed — the rule could only ever be dead.
  for (const entry of ROWS) {
    assert.doesNotMatch(
      sheetOf(entry),
      new RegExp(`\\.${entry.row}\\[aria-pressed`),
      `${entry.row} still has a pressed state`,
    );
  }
});

test("the agreement row's pseudo-button is gone for good", () => {
  // A row is the link. It used to carry a `<span>` painted as a 44px kola
  // button reading "Open agreement" — which looked like a separate control,
  // did exactly what the row does, and repeated the standing line directly
  // above it. Every row already ends in a chevron that says where it goes.
  //
  // Asserted by name rather than by a rule about "anything button-shaped":
  // the six rows are built in three different shapes, and collecting
  // button-like classes out of six stylesheets produced false positives on
  // the filter pills. A precise guard that holds beats a general one that
  // cries wolf.
  const sheet = read("web/src/styles/agreements-workspace.css");
  assert.doesNotMatch(sheet, /\.agreement-primary/);
  assert.doesNotMatch(sheet, /\.agreement-secondary/);
  const page = read("web/app/leases/page.tsx");
  assert.doesNotMatch(page, /Open agreement</);
  assert.doesNotMatch(page, /Review agreement</);
});
