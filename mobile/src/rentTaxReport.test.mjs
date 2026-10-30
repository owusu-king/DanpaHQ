import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("mobile sends the same private report contract as web", async () => {
  const exports = {};
  let request;
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("./rentTaxReport.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: () => ({ apiFetch: async (...args) => { request = args; } }) });
  const input = { taxpayer_type: "business", taxpayer_name: "Example", taxpayer_tin: "PRIVATE-TIN", period_start: "2026-04-01", period_end: "2027-03-31" };
  await exports.generateRentTaxReport("portfolio-1", input);
  assert.equal(request[0], "/organizations/portfolio-1/finance/rent-tax-report/");
  assert.equal(request[1].method, "POST");
  assert.equal(request[1].body, input);
  assert.doesNotMatch(request[0], /PRIVATE-TIN/);
});

test("mobile shares PDF and CSV and cleans temporary files on success or failure", async () => {
  for (const [format, failure] of [["pdf", false], ["pdf", true], ["csv", false], ["csv", true]]) {
    const exports = {}, state = [], refs = [], calls = [];
    let cursor = 0, refCursor = 0;
    const jsx = (type, props) => ({ type, props });
    const imports = {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: {
        useEffect() {}, useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
        useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; },
      },
      "react-native": { Modal: "Modal", ScrollView: "ScrollView", View: "View" },
      "@/components/ui": { Button: "Button", Field: "Field", Notice: "Notice", Type: "Type", space: { 2: 8, 4: 16, 5: 20, 6: 24 } },
      "@/components/form/Select": { Select: "Select" },
      "@/components/sheet/ModalSafeArea": { ModalSafeArea: "ModalSafeArea", SafeBottom: "SafeBottom" },
      "@/rentTaxReport": { generateRentTaxReport: async (id, input) => { calls.push(["request", id, input.taxpayer_type, input.format]); return { filename: `report.${format}`, csv: "private report", pdf_base64: "JVBERi10ZXN0" }; } },
      "expo-file-system/legacy": { cacheDirectory: "file:///cache/", EncodingType: { Base64: "base64" }, writeAsStringAsync: async (path, content, options) => calls.push(["write", path, content, options?.encoding]), deleteAsync: async path => calls.push(["delete", path]) },
      "expo-sharing": { isAvailableAsync: async () => true, shareAsync: async (path, options) => { calls.push(["share", path, options.mimeType]); if (failure) throw new Error("Sharing failed"); } },
    };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL("./components/payments/GraReport.tsx", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, Error, require: name => imports[name] ?? {} });
    const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
    const render = () => {
      cursor = 0; refCursor = 0;
      const root = exports.GraReport({ organizationId: "portfolio-1", organizationName: "Example" });
      return nodes(nodes(root).find(node => node.type === "SafeBottom").props.render(0));
    };
    render().find(node => node.type === "Select" && node.props.label === "Taxpayer type").props.onChange("business");
    render().find(node => node.type === "Select" && node.props.label === "Report format").props.onChange(format);
    render().find(node => node.type === "Button" && node.props.label === (format === "pdf" ? "Generate and save PDF" : "Export CSV data")).props.onPress();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls[0], ["request", "portfolio-1", "business", format]);
    assert.equal(calls[1][2], format === "pdf" ? "JVBERi10ZXN0" : "private report");
    assert.equal(calls[1][3], format === "pdf" ? "base64" : undefined);
    assert.equal(calls[2][2], format === "pdf" ? "application/pdf" : "text/csv");
    assert.equal(calls[3][0], "delete");
    assert.equal(calls[3][1], calls[1][1]);
    if (failure) assert.equal(render().find(node => node.type === "Notice").props.title, "Sharing failed");
  }
});
