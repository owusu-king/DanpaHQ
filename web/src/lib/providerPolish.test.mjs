import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function compile(source, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, Intl, Date, require: name => imports[name] });
  return exports;
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const money = compile(read("./money.ts"));
const { ProfitLoss } = compile(read("../components/payments/ProfitLoss.tsx"), {
  react: { useState: () => ["GHS", () => {}] }, "react/jsx-runtime": jsx,
  "@/lib/money": money,
});
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree ? text(tree.props?.children) : "";
}
test("P&L renders net receipts, total costs and backend profit without using recent payments", () => {
  const ledger = { currency: "GHS", revenue_minor: 125001, refunds_minor: 10000, expenses_minor: 20000, fees_minor: 1500, profit_minor: 93501, monthly: [] };
  const output = text(ProfitLoss({ report: { basis: "cash", ledgers: [ledger] } }));
  assert.match(output, /1,150\.01/);
  assert.match(output, /215\.00/);
  assert.match(output, /935\.01/);
  assert.match(output, /Payouts are transfers/);
});
test("P&L labels losses and refuses to invent zero totals while the report is absent", () => {
  const output = text(ProfitLoss({ report: { basis: "cash", ledgers: [{ currency: "GHS", revenue_minor: 0, refunds_minor: 0, expenses_minor: 500, fees_minor: 0, profit_minor: -500, monthly: [] }] } }));
  assert.match(output, /Net loss/);
  assert.match(output, /-GH₵5\.00/);
  assert.match(text(ProfitLoss({})), /Refresh Finance/);
});
test("record actions use the established red outline with interactive states", () => {
  const css = read("../styles/payments-workspace.css");
  assert.match(css, /is-red-outline:hover:not\(:disabled\)/);
  assert.match(css, /is-red-outline:focus-visible/);
  assert.match(css, /is-red-outline:disabled/);
  assert.match(read("../components/documents/ContractsView.tsx"), /ws-action is-red-outline/);
});

test("expense fields keep focus on the shell and payment choices use one border", () => {
  const css = read("../styles/payments-workspace.css");
  assert.doesNotMatch(css, /\.expense-sheet\s+\.field\s+input:focus-visible/);
  assert.match(css, /\.expense-sheet \.field-shell:focus-within\s*\{[^}]*border-color: var\(--color-laterite-600\)/);
  const chip = css.match(/\.payment-chip\s*\{([^}]+)\}/)?.[1];
  assert.match(chip, /border: 1px solid/);
  assert.doesNotMatch(chip, /box-shadow:/);
  assert.doesNotMatch(css, /\.payment-chip:has\(input:checked\)\s*\{[^}]*box-shadow:/);
  assert.match(css, /\.payment-chip \.portal-icon\s*\{[^}]*color: inherit/);
  assert.doesNotMatch(css, /\.payment-chip:has\(input:checked\) \.portal-icon/);
});

test("property creation shares flat actions and artisan steps are quiet markers", () => {
  assert.match(read("../../app/home/page.tsx"), /className="btn btn-primary home-start-action"/);
  const buttons = read("../styles/foundation.css").split("/* --- focus")[0];
  assert.ok([...buttons.matchAll(/box-shadow:\s*([^;]+);/g)].every((match) => match[1].trim() === "none"));
  const marker = read("../styles/artisan.css").match(/\.art-step-number\s*\{([^}]+)\}/)?.[1];
  assert.match(marker, /border: 1px solid/);
  assert.doesNotMatch(marker, /gradient|box-shadow/);
  const empty = read("../styles/home-provider.css").split("/* --- beginning")[1].split(".home-provider .home-dashboard-skeleton")[0];
  assert.doesNotMatch(empty, /gradient|translateY/);
  assert.ok([...empty.matchAll(/box-shadow:\s*([^;]+);/g)].every((match) => match[1].trim() === "none"));
});
test("video guides are a breadcrumb page with addressable chapters and truthful placeholders", () => {
  const component = read("../components/landing/HowItWorks.tsx");
  assert.match(component, /EntityPath items=/);
  assert.match(component, /useSearchParams\(\)/);
  assert.match(component, /href=\{`\/how-it-works\?guide=/);
  assert.doesNotMatch(component, /showModal|<dialog|createPortal/);
  assert.match(component, /aria-current=/);
  assert.match(component, /apiFetch<GuideCollection>\("\/how-it-works\/"/);
  const player = read("../components/landing/GuideMedia.tsx");
  assert.match(player, /Video coming soon/);
  assert.match(player, /<iframe/);
  assert.match(player, /<track default kind="captions"/);
  const css = read("../styles/landing.css");
  assert.match(css, /\.hiw-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\) 240px/);
  assert.match(css, /\.hiw-page \{[^}]*height: calc\(100dvh - 80px\)[^}]*overflow: hidden/);
  assert.match(css, /\.hiw-playlist ol \{[^}]*overflow: auto/);
  assert.doesNotMatch(component, /A clearer way forward|Get to know Danpa HQ, one short guide|scrollIntoView/);
  assert.match(read("../../app/how-it-works/page.tsx"), /<Suspense/);
});
