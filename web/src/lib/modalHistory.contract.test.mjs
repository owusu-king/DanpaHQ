import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, "../..", path), "utf8");

/** Every page that opens a record in a sheet over its list, and the links that can open one. */
const PAGES = {
  "app/applications/page.tsx": ["application", "request"],
  "app/documents/page.tsx": ["lease"],
  "app/leases/page.tsx": ["agreement"],
  "app/maintenance/page.tsx": ["request", "report"],
  "app/payments/page.tsx": ["receipt", "record", "due", "payfor"],
  "app/tenants/page.tsx": ["tenant"],
  "app/viewings/page.tsx": ["viewing"],
};

test("a modal is page state, not an address (owner, 2026-10-16)", () => {
  // Opening and closing never touch the address, so Back simply leaves the
  // page. Modals once kept themselves in it (`?tenant=` …), and Back kept
  // reopening them; a workaround had to guess at retracing. Both are gone.
  for (const [page, params] of Object.entries(PAGES)) {
    const source = read(page);
    for (const param of params) {
      assert.match(source, new RegExp(`useDeepLinkedModal\\("${param}"\\)`), `${page} opens ${param} from state`);
      assert.doesNotMatch(source, new RegExp(`search\\.get\\("${param}"\\)`), `${page} reads ${param} from the address`);
      assert.doesNotMatch(source, new RegExp(`set(Params)?\\(\\{[^}]*\\b${param}:`), `${page} writes ${param} to the address`);
    }
  }
  assert.ok(!existsSync(resolve(here, "historyReturn.ts")), "the history-guessing workaround is gone");
  assert.doesNotMatch(read("src/components/workspace/ModalSheet.tsx"), /arrivedByHistory|historyReturn/);
});

test("a link from elsewhere opens its modal once, then leaves the address clean", () => {
  const hook = read("src/lib/deepLinkedModal.ts");
  // The open record is React state; the parameter only seeds it.
  assert.match(hook, /const \[openId, setOpenId\] = useState\(""\);/);
  assert.match(hook, /if \(!linked\) return;\s*setOpenId\(linked\);\s*clearParam\(param\);/);
  // Cleared natively and synchronously, so two links cleared in one render
  // cannot write each other back, and with `null` so Next sees the change.
  assert.match(hook, /window\.history\.replaceState\(null, "", /);
  const code = hook.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(code, /router\.(replace|push)|history\.state/);

  // The links that rely on it still name their record.
  assert.match(read("src/lib/notificationMeaning.ts"), /`\/maintenance\?request=\$\{item\.target_id\}`/);
  assert.match(read("app/payments/receipts/[receiptId]/page.tsx"), /redirect\(`\/payments\?receipt=/);
  assert.match(read("app/home/page.tsx"), /`\/tenants\?tenant=/);
});

test("Back never returns to an open sheet, even from the back-forward cache", () => {
  // A page restored whole from the back-forward cache comes back frozen with
  // its state, sheet and all; that sheet closes.
  const sheet = read("src/components/workspace/ModalSheet.tsx");
  assert.match(sheet, /window\.addEventListener\("pageshow", restored\);/);
  assert.match(sheet, /if \(!event\.persisted\) return;\s*dialogRef\.current\?\.close\(\);\s*closeRef\.current\(\);/);
});
