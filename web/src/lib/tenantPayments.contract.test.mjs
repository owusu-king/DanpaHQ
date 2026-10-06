/**
 * A tenant's Payments is the landlord's page read from the other end: the same
 * figures, tiles, tabs and ledger rows (PaymentsParts), the next thing to pay
 * lifted above them, and rows that go to checkout rather than paying in place.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const tenant = () => code(read("web/src/components/payments/TenantPayments.tsx"));
const provider = () => code(read("web/app/payments/page.tsx"));
const css = () => read("web/src/styles/payments-workspace.css");

test("both sides of Payments are drawn from one set of parts", () => {
  for (const source of [tenant(), provider()]) {
    assert.match(source, /from "@\/components\/payments\/PaymentsParts"/);
    assert.match(source, /<FinanceFigure/);
    assert.match(source, /<PaymentTab/);
    assert.match(source, /<LedgerHead/);
    assert.doesNotMatch(source, /^function (FinanceFigure|PaymentTab|LedgerHead|AttentionTile)\(/m);
  }
  assert.match(tenant(), /className="ws-page rent-workspace tenant-payments-workspace"/);
  assert.match(tenant(), /<WorkspaceHead\s+icon="payments"\s+title="Payments"/);
  assert.match(css(), /\.payments-overview\.is-tenant \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
});

test("the next thing to pay leads, and is never one already being paid", () => {
  const body = tenant();
  assert.match(body, /const next = dueRows\.find\(\(row\) => !row\.intent\) \?\? null;/);
  assert.match(body, /<NextUp\s+tone=\{next\.charge\.is_overdue \? "overdue" : undefined\}/);
  assert.match(body, /action=\{\{ label: `Pay \$\{/);
  // Overdue first, then soonest due.
  assert.match(body, /Number\(b\.charge\.is_overdue\) - Number\(a\.charge\.is_overdue\)\s*\|\| a\.charge\.due_on\.localeCompare\(b\.charge\.due_on\)/);
});

test("a due row goes to checkout, or to the attempt already under way", () => {
  const body = tenant();
  assert.match(body, /`\/payments\/return\?intent=\$\{encodeURIComponent\(row\.intent\.id\)\}`/);
  assert.match(body, /`\/payments\/checkout\?lease=\$\{encodeURIComponent\(row\.account\.tenancy\.lease!\.id\)\}&obligation=\$\{encodeURIComponent\(row\.charge\.id\)\}`/);
  assert.match(body, /className="rent-row is-payable" href=\{payHref\(row\) as never\}/);
  assert.match(body, /\{intent \? "Check status" : "Pay rent"\}/);
});

test("the view is in the address, and every home's account stays reachable", () => {
  const body = tenant();
  assert.match(body, /search\.get\("view"\)/);
  assert.match(body, /router\.replace\(/);
  assert.match(body, />Rent accounts<\/PaymentTab>/);
  assert.match(body, /`\/payments\/\$\{account\.tenancy\.lease!\.id\}\?mode=tenant`/);
});

test("every state is designed inside the panel", () => {
  const body = tenant();
  assert.match(body, /loading \? <section className="ws-panel"[^>]*><PanelSkeleton/);
  assert.match(body, /<PanelState tone="error"[\s\S]{0,300}Try again/);
  assert.match(body, /title="No rent account yet"/);
  assert.match(body, /<PanelState icon="check" title="You’re paid up"/);
  assert.match(body, /error && accounts\?\.length \? <div className="ws-inline-error/);
  // A reload keeps what is shown.
  const load = body.slice(body.indexOf("const load = useCallback"), body.indexOf("useEffect(() => { void load(); }"));
  assert.doesNotMatch(load, /setAccounts\(null\)/);
});
