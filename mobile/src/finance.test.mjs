import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("./finance.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const { financeEntries, FINANCE_VIEWS } = exports;
const entries = [
  { kind: "tenant", key: "due:tenant" }, { kind: "payment", key: "recent:payment" },
  { kind: "settlement", key: "paid:payout" }, { kind: "expense", key: "expense:cost" },
  { kind: "recordExpense", key: "recordExpense" }, { kind: "more", key: "more:records" },
  { kind: "fold", key: "fold:paid", fold: "paid" },
  { kind: "fold", key: "fold:expenses", fold: "expenses" },
];
test("Finance has five explicit destinations and preserves each record workflow", () => {
  assert.deepEqual(Array.from(FINANCE_VIEWS, row => row[1]), ["Rent Due", "Payment Records", "Payouts", "Expenses", "Profit & Loss (P&L)"]);
  const ids = view => Array.from(financeEntries(entries, view), row => row.key);
  assert.deepEqual(ids("balances"), ["due:tenant"]);
  assert.deepEqual(ids("records"), ["recent:payment", "more:records"]);
  assert.deepEqual(ids("payouts"), ["paid:payout", "fold:paid"]);
  assert.deepEqual(ids("expenses"), ["expense:cost", "recordExpense", "fold:expenses"]);
  assert.deepEqual(ids("pnl"), []);
  assert.equal(financeEntries(entries, "balances")[0], entries[0]);
});
test("Finance keeps section labels with their records and hides unrelated labels", () => {
  const labels = ["overdue", "due", "review", "recent", "attention", "way", "found-payments", "found-tenants"].map(key => ({ kind: "label", key: `label:${key}` }));
  assert.deepEqual(Array.from(financeEntries(labels, "records"), row => row.key), ["label:review", "label:recent", "label:found-payments"]);
});
