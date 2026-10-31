import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { portalSections } from "./portalNav.compiled.mjs";

function client(fetch) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("./providerPassport.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ authedFetch: fetch }) });
  return exports;
}

test("provider credentials and documents use scoped authenticated body mutations", async () => {
  const calls = [];
  const api = client(async (...args) => { calls.push(args); return { status: "submitted" }; });
  const form = { representative_id: "member", representative_role: "Representative", registered_business: true, registration_number: "PRIVATE-REG", contact_email: "office@example.com", contact_phone: "0302123456" };
  await api.getProviderPassport("portfolio");
  await api.saveProviderPassport("portfolio", form);
  await api.addPassportDocument("portfolio", "file", "business_certificate");
  await api.removePassportDocument("portfolio", "document");
  await api.submitProviderPassport("portfolio");
  await api.passportDownload("/organizations/portfolio/provider-passport/documents/document/download/");
  assert.equal(calls[0][0], "/organizations/portfolio/provider-passport/");
  assert.equal(calls[1][1].method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1][1].body), form);
  assert.deepEqual(JSON.parse(calls[2][1].body), { file_id: "file", evidence_type: "business_certificate" });
  assert.equal(calls[3][1].method, "DELETE");
  assert.equal(calls[4][1].method, "POST");
  for (const [url] of calls) assert.doesNotMatch(url, /PRIVATE-REG|office@example/);
});

test("editing a Passport sends only editable credentials, never verification or private records", () => {
  const api = client(() => {});
  const form = { representative_id: "member", representative_role: "Owner", registered_business: false, registration_number: "", contact_email: "", contact_phone: "" };
  const result = api.passportForm({ credentials: { ...form, status: "verified", internal_note: "private", documents: ["file"] } });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), form);
});

test("only Portfolio managers of the team are offered Provider Passport; tenant Passport stays separate", () => {
  const me = { capabilities: { active_workspace: "provider", provider: { workspace_access: true }, tenant: { workspace_access: false }, artisan: {} } };
  const access = manage_team => ({ can: { manage_team, operate_properties: true, view_finances: true } });
  const links = permission => portalSections(me, "Portfolio", access(permission)).flatMap(section => section.items.map(item => item.href));
  assert.ok(links(true).includes("/provider-passport"));
  assert.ok(!links(false).includes("/provider-passport"));
  assert.ok(!links(true).includes("/passport"));
  const sections = portalSections(me, "Portfolio", access(true));
  assert.equal(sections.find(section => section.items.some(item => item.href === "/provider-passport")).title, "You");
});

test("server refusals propagate instead of marking provider credentials verified locally", async () => {
  const refusal = new Error("More information required");
  const api = client(async () => { throw refusal; });
  await assert.rejects(api.submitProviderPassport("portfolio"), error => error === refusal);
});
