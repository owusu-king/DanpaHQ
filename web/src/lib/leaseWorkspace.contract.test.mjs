import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("provider Leases owns agreement status without duplicating request preparation", () => {
  const page = read("web/app/leases/page.tsx");

  assert.match(page, /listGrantedLeases/);
  assert.doesNotMatch(page, /listReceivedApplications|draftLease|function DraftLease/);
  assert.match(page, /href="\/applications"/);
  assert.match(page, /Search tenant, Property or Unit/);

  // The stages and their words moved to the module both halves of the journey
  // read, when the record became a page of its own.
  const meaning = read("web/src/lib/leaseMeaning.ts");
  assert.match(meaning, /"all", "send", "current", "history"/);
  for (const label of ["To send", "Current", "History"]) {
    assert.ok(meaning.includes(label), `${label} must still be a stage somebody can filter to`);
  }
});

test("provider agreement details use the frozen record and deliberate actions", () => {
  // The record left the split pane for `/leases/<leaseId>`. Everything this
  // test was protecting went with it and none of it changed.
  const record = read("web/src/components/leases/LeaseRecord.tsx");
  const page = read("web/app/leases/page.tsx");
  const css = read("web/src/styles/leases-workspace.css");

  assert.match(record, /lease\.agreement\?\.terms/);
  assert.match(record, /lease\.agreement\.content_hash/);
  assert.match(record, /Withdraw this offer\?/);
  assert.match(record, /End this tenancy\?/);
  assert.match(record, /Reason \(optional\)/);
  assert.match(record, /Open Unit/);

  // Still not a dialog, and now not a pane either: the list links to it.
  assert.doesNotMatch(page, /ProviderLeaseDialog|showModal\(\)/);
  assert.doesNotMatch(record, /<dialog/);
  assert.match(read("web/app/leases/[leaseId]/page.tsx"), /<LeaseRecord/);
  assert.match(page, /href=\{`\/leases\/\$\{lease\.id\}`/);

  assert.match(css, /min-height: 48px/);
});

test("provider Home surfaces saved agreements that still need sending", () => {
  const home = read("web/app/home/page.tsx");
  assert.match(home, /listGrantedLeases/);
  assert.match(home, /lease\.status === "draft"/);
  // Home names drafts in its attention list and nowhere else. The Draft/Sent
  // pipeline panel was removed from the dashboard deliberately: Home answers
  // "what needs me", and a pipeline of everything in flight is the Leases
  // workspace's job. A draft that needs sending is still surfaced, because that
  // one *is* waiting on the provider.
  assert.match(home, /drafts\.length/);
  assert.doesNotMatch(home, /function FlowStage/);
  assert.doesNotMatch(home, /Agreement flow/);
});
