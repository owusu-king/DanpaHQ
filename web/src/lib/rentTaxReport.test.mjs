import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function compile(path, imports, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Error, require: name => imports[name] ?? {}, ...globals });
  return exports;
}

test("taxpayer details are posted in the authenticated body, never added to a URL", async () => {
  let request;
  const { generateRentTaxReport } = compile("./rentTaxReport.ts", { "./auth": { authedFetch: async (...args) => { request = args; } } });
  const input = { taxpayer_type: "business", taxpayer_name: "Example", taxpayer_tin: "PRIVATE-TEST-TIN", period_start: "2026-01-01", period_end: "2026-12-31" };
  await generateRentTaxReport("portfolio-1", input);
  assert.equal(request[0], "/organizations/portfolio-1/finance/rent-tax-report/");
  assert.equal(request[1].method, "POST");
  assert.deepEqual(JSON.parse(request[1].body), input);
  assert.doesNotMatch(request[0], /PRIVATE-TEST-TIN/);
});

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
}

function screen(generateRentTaxReport) {
  const state = [], refs = [];
  let cursor = 0, refCursor = 0;
  const downloads = [], files = [];
  const jsx = (type, props) => ({ type, props });
  const { GraReport } = compile("../components/payments/GraReport.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useId() { return "financial-report-form"; },
      useEffect() {}, useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
    },
    "@/components/Button": { Button: "Button" }, "@/components/Field": { Field: "Field" },
    "@/components/Notice": { Notice: "Notice" }, "@/components/workspace/ModalSheet": { ModalSheet: "ModalSheet" },
    "@/lib/rentTaxReport": { generateRentTaxReport },
  }, {
    Blob, atob, URL: { createObjectURL: file => { files.push(file); return "blob:report"; }, revokeObjectURL() {} },
    document: { body: { appendChild() {} }, createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }) },
    window: { setTimeout: fn => fn() },
  });
  const render = () => { cursor = 0; refCursor = 0; return GraReport({ organizationId: "portfolio-1", organizationName: "Example" }); };
  return { render, downloads, files };
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);
const tick = () => new Promise(resolve => setImmediate(resolve));

test("the report selector supports business taxpayers and downloads the server-generated CSV", async () => {
  let sent;
  const view = screen(async (id, input) => { sent = { id, input }; return { csv: "safe csv", filename: "gra-test.csv" }; });
  nodes(view.render()).find(node => node.props?.["aria-label"] === "Report format").props.onChange({ target: { value: "csv" } });
  nodes(view.render()).find(node => node.props?.["aria-label"] === "Taxpayer type").props.onChange({ target: { value: "business" } });
  find(view.render(), "form").props.onSubmit({ preventDefault() {} });
  await tick();
  assert.equal(sent.id, "portfolio-1");
  assert.equal(sent.input.taxpayer_type, "business");
  assert.deepEqual(view.downloads, ["gra-test.csv"]);
  assert.equal(view.files[0].type, "text/csv;charset=utf-8");
});

test("PDF is the default and downloads decoded PDF bytes with the correct media type", async () => {
  let sent;
  const view = screen(async (id, input) => { sent = input; return { pdf_base64: Buffer.from("%PDF-test").toString("base64"), filename: "financial.pdf" }; });
  find(view.render(), "form").props.onSubmit({ preventDefault() {} });
  await tick();
  assert.equal(sent.format, "pdf");
  assert.deepEqual(view.downloads, ["financial.pdf"]);
  assert.equal(view.files[0].type, "application/pdf");
  assert.equal(await view.files[0].text(), "%PDF-test");
});

test("closing a report modal ignores a late response instead of downloading another Portfolio's data", async () => {
  let resolve;
  const view = screen(() => new Promise(done => { resolve = done; }));
  find(view.render(), "form").props.onSubmit({ preventDefault() {} });
  find(view.render(), "ModalSheet").props.onClose();
  resolve({ filename: "stale.csv", csv: "private" });
  await tick();
  assert.deepEqual(view.downloads, []);
});

test("report generation failures remain visible and retryable", async () => {
  const view = screen(async () => { throw new Error("Reporting unavailable"); });
  find(view.render(), "form").props.onSubmit({ preventDefault() {} });
  await tick();
  assert.equal(find(view.render(), "Notice").props.title, "Reporting unavailable");
  assert.deepEqual(view.downloads, []);
});
