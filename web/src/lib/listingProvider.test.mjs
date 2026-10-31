import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("./listingProvider.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const { listingProvider } = exports;
const listing = () => ({
  trust_stamps: { identity: { state: "unverified" }, relationship: "owner" },
  property_context: { authority: { state: "verified" } },
  space: { verification: { checked: true } },
});
const credential = (category = "property_company", verified = true) => ({ name: "Test provider", category, verified, verified_at: null, valid_until: null });

test("property and unit approval never imply that the provider's identity is verified", () => {
  const data = listing();
  data.provider_passports = [credential()];
  const model = listingProvider(data);
  assert.equal(model.identity, "unverified");
  assert.equal(model.checks[0].state, "unverified");
  assert.equal(model.checks[1].state, "verified");
  assert.equal(model.checks[2].state, "verified");
  assert.equal(model.checks[3].state, "verified");
});

test("missing or unpublished credentials are not displayed as a failed business check", () => {
  for (const passports of [undefined, [], [credential("property_company", false)]]) {
    const data = listing();
    data.provider_passports = passports;
    const model = listingProvider(data);
    assert.equal(model.providers.length, 0);
    assert.equal(model.checks[1].label, "Provider credentials");
    assert.equal(model.checks[1].status, "Not published");
    assert.equal(model.checks[1].state, "unverified");
  }
});

test("individual and manager Passports do not imply registered business evidence", () => {
  for (const category of ["individual_owner", "property_manager", "hostel_operator"]) {
    const model = listingProvider({ ...listing(), provider_passports: [credential(category)] });
    assert.equal(model.checks[1].label, "Provider credentials");
    assert.equal(model.checks[1].state, "verified");
  }
  assert.equal(listingProvider({ ...listing(), provider_passports: [credential()] }).checks[1].label, "Business credentials");
});

test("each verification keeps its independent pending, expired or unchecked state", () => {
  const data = listing();
  data.trust_stamps.identity.state = "pending";
  data.trust_stamps.relationship = "manager";
  data.property_context.authority.state = "expired";
  data.space.verification.checked = false;
  const model = listingProvider(data);
  assert.equal(model.identity, "pending");
  assert.equal(model.checks[2].state, "expired");
  assert.equal(model.checks[3].state, "unverified");
  assert.equal(model.relationship, "Listed by an authorized representative");
});

test("multiple public providers remain distinct and their review dates are retained", () => {
  const first = { ...credential(), verified_at: "2026-10-28T12:00:00Z" };
  const second = { ...credential("individual_owner"), name: "Another test provider" };
  const model = listingProvider({ ...listing(), provider_passports: [first, second] });
  assert.equal(model.providers.length, 2);
  assert.equal(model.providers[0].verified_at, first.verified_at);
  assert.equal(model.providers[1].name, second.name);
  assert.equal(model.checks[1].label, "Provider credentials");
});
