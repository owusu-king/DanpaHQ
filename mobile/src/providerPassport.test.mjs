import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("mobile provider Passport uses the same private scoped contract and submission as web", async () => {
  const calls = [];
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("./providerPassport.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ apiFetch: async (...args) => { calls.push(args); return { status: "submitted" }; } }) });
  const form = { representative_id: "member", representative_role: "Owner", registered_business: false, registration_number: "PRIVATE-REG", contact_email: "office@example.com", contact_phone: "0302123456" };
  await exports.getProviderPassport("portfolio");
  await exports.saveProviderPassport("portfolio", form);
  await exports.addPassportDocument("portfolio", "file", "business_certificate");
  await exports.removePassportDocument("portfolio", "document");
  const result = await exports.submitProviderPassport("portfolio");
  assert.equal(calls[0][0], "/organizations/portfolio/provider-passport/");
  assert.equal(calls[1][1].method, "PATCH");
  assert.equal(calls[1][1].body, form);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2][1].body)), { file_id: "file", evidence_type: "business_certificate" });
  assert.equal(calls[3][1].method, "DELETE");
  assert.equal(calls[4][1].method, "POST");
  assert.equal(result.status, "submitted");
  for (const [url] of calls) assert.doesNotMatch(url, /PRIVATE-REG|office@example/);
});

test("both clients render the same provider statuses and document categories", () => {
  const mobile = readFileSync(new URL("./providerPassport.ts", import.meta.url), "utf8");
  const web = readFileSync(new URL("../../web/src/lib/providerPassport.ts", import.meta.url), "utf8");
  const semantics = code => code.slice(code.indexOf("export const PASSPORT_STATUS"), code.indexOf("export const getProviderPassport"));
  assert.equal(semantics(mobile), semantics(web));
});
