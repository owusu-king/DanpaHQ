import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, "../..", path), "utf8");

test("a sheet the address reopens on Back closes instead (owner, 2026-10-05)", () => {
  const sheet = read("src/components/workspace/ModalSheet.tsx");
  const signal = read("src/lib/historyReturn.ts");

  // Back or Forward, with nothing touched since, means retracing steps.
  assert.match(signal, /window\.addEventListener\("popstate", \(\) => \{ traversed = true; \}\);/);
  assert.match(signal, /entry\?\.type === "back_forward"/);
  // Any press or key is the person acting again, so a click still opens a sheet.
  assert.match(signal, /window\.addEventListener\("pointerdown", acted, true\);/);
  assert.match(signal, /window\.addEventListener\("keydown", acted, true\);/);

  // Checked before the dialog is shown, and closed through the page's own
  // onClose, which is what takes the parameter out of the address.
  const at = sheet.indexOf("if (arrivedByHistory()) {");
  assert.ok(at > 0 && at < sheet.indexOf("dialog.showModal();"), "the check comes before showModal");
  assert.match(sheet, /if \(arrivedByHistory\(\)\) \{\s*if \(dialog\.open\) dialog\.close\(\);\s*closeRef\.current\(\);\s*return;/);
  // A whole page handed back from the back-forward cache closes its sheet too.
  assert.match(sheet, /window\.addEventListener\("pageshow", restored\);/);
  assert.match(sheet, /if \(!event\.persisted\) return;/);
});

test("the tenancy and rent account pages are the workspace's, not the old portal's", () => {
  const tenancy = read("app/tenants/[tenancyId]/page.tsx");
  const account = read("app/payments/[leaseId]/page.tsx");
  const detail = read("src/components/payments/RentAccount.tsx");

  for (const page of [tenancy, account]) {
    assert.match(page, /<WorkspaceHead/);
    assert.doesNotMatch(page, /PageHeader|LoadingRows/);
  }
  // The tenancy reads with the sheet's own meaning, so the two cannot disagree.
  assert.match(tenancy, /tenancyState\(tenant\)/);
  assert.match(tenancy, /leaseProgress\(tenant\)/);
  // Its payments are a page; the agreement opens over it, from local state, so
  // Back never brings it up again. Neither is listed twice.
  assert.match(tenancy, /href=\{`\/payments\/\$\{tenant\.lease_id\}` as never\}/);
  assert.match(tenancy, /useState<string \| null>\(null\)/);
  assert.equal((tenancy.match(/setLeaseOpen\(tenant\.lease_id\)/g) ?? []).length, 1);

  // The balance leads in its tone; charges show how much is paid; records their standing.
  assert.match(detail, /<section className="ra-hero" data-tone=\{tone\}/);
  assert.match(detail, /className="ra-charge-bar"/);
  assert.match(detail, /<li key=\{payment\.id\} data-tone=\{paymentTone\(payment\)\}>/);
  // Scoped: the record form also lives in Payments' own sheet.
  assert.doesNotMatch(read("src/styles/record-pages.css"), /^\.rent-/m);
});

test("the site may use its own camera, for a repair clip", () => {
  assert.match(read("next.config.mjs"), /camera=\(self\), microphone=\(self\)/);
});
