import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the console has a billing section, gated on the read capability", () => {
  const shell = read("web/src/components/management/ManagementShell.tsx");
  const page = code(read("web/app/management/billing/page.tsx"));

  assert.match(shell, /href: "\/management\/billing"/);
  assert.match(shell, /capability: "view_billing"/);
  assert.match(page, /managementFetch|useResource/);
});

test("plan and live usage sit together, because that is the support question", () => {
  const page = code(read("web/app/management/billing/page.tsx"));

  assert.match(page, /PROPERTY_COUNT/);
  assert.match(page, /PROPERTY_LIMIT/);
  assert.match(page, /over_limit/);
});

test("changing a plan needs the separate manage capability", () => {
  const page = code(read("web/app/management/billing/page.tsx"));

  // Reading is support work; committing somebody to a different plan is not.
  assert.match(page, /can\("manage_billing"\)/);
  assert.match(page, /mayManage/);
});

test("a reason is required and the change is described as a grant, not a sale", () => {
  const page = read("web/app/management/billing/page.tsx");

  assert.match(code(page), /!reason\.trim\(\)/);
  assert.match(code(page), /reason\s*\}\)/);
  assert.match(page, /administrative grant, not a sale/);
});

test("the console says plainly that a downgrade removes nothing", () => {
  const page = read("web/app/management/billing/page.tsx");

  assert.match(page, /never removes/);
  assert.match(page, /Nothing has been removed/);
});

test("plan history is shown with who did it", () => {
  const page = code(read("web/app/management/billing/page.tsx"));

  assert.match(page, /actor_label/);
  assert.match(page, /Plan history/);
});
