import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney, parseAmount } from "./money.compiled.mjs";

test("formats the way the server does", () => {
  assert.equal(formatMoney({ minor: 1234560, currency: "GHS" }), "GH\u20b512,345.60");
  assert.equal(formatMoney({ minor: 5000, currency: "GHS" }, { symbol: false, group: false }), "50.00");
  assert.equal(formatMoney({ minor: 0, currency: "GHS" }), "GH\u20b50.00");
});

test("negative amounts put the sign before the symbol", () => {
  assert.equal(formatMoney({ minor: -5000, currency: "GHS" }).startsWith("-GH"), true);
});

test("parses what people type", () => {
  assert.deepEqual(parseAmount("1,500"), { minor: 150000, currency: "GHS" });
  assert.deepEqual(parseAmount("GH\u20b52400.50"), { minor: 240050, currency: "GHS" });
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
});
