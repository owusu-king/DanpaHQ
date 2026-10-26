import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("provider Leases owns agreement status without duplicating request preparation", () => {
  // The provider's list is the Leases view of Documents now.
  const page = read("web/src/components/documents/LeasesView.tsx");

  assert.match(page, /listGrantedLeases/);
  assert.doesNotMatch(page, /listReceivedApplications|draftLease|function DraftLease/);
  assert.match(page, /href=\{"\/applications" as never\}/);
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
  const page = read("web/src/components/documents/LeasesView.tsx");
  const css = read("web/src/styles/documents-workspace.css");

  assert.match(record, /lease\.agreement\?\.terms/);
  assert.match(record, /lease\.agreement\.content_hash/);
  assert.match(record, /Withdraw this offer\?/);
  assert.match(record, /End this tenancy\?/);
  assert.match(record, /Reason \(optional\)/);
  // One or two actions per state (owner, 2026-10-05). Ended opens the closing
  // account only; active ends the tenancy (in red) or downloads; the document
  // offers Print alone; and nothing links off to the Unit or Properties.
  assert.match(record, /lease\.status === "ended" \? \(\s*<Link className="btn btn-secondary" href=\{`\/record\/payment\?leaseId=\$\{lease\.id\}` as never\}>\s*Open closing account/);
  assert.match(record, /<Button variant="destructive" disabled=\{busy\} onClick=\{\(\) => setConfirmation\("end"\)\}>\s*End tenancy/);
  assert.match(record, /documentAction\("download"\)\}>\s*Download/);
  assert.doesNotMatch(record, /View PDF|Open Unit|Open Properties/);
  // Preparing and sending belong to the tenancy request: a draft or ready
  // agreement reads as Pending here, with one way back to its request, and no
  // Send or Discard of its own.
  assert.match(record, /\{pending \? "Pending" : providerLeaseStatus\(lease\)\}/);
  assert.match(record, /<Link className="btn btn-primary" href=\{requestHref\}>Review to send<\/Link>/);
  assert.match(record, /`\/applications\?request=\$\{lease\.application\}`/);
  assert.doesNotMatch(record, /Send agreement|Discard draft|act\("offer"\)/);

  // The record itself is never the dialog: the lease modal hosts it, and the
  // same record is what the page at its own address renders.
  assert.doesNotMatch(page, /ProviderLeaseDialog|showModal\(\)/);
  assert.doesNotMatch(record, /<dialog/);
  assert.match(read("web/src/components/leases/LeaseModal.tsx"), /<LeaseRecord lease=\{lease\}/);
  assert.match(read("web/app/record/lease/page.tsx"), /<LeaseRecord/);
  assert.match(page, /href=\{`\/record\/lease\?leaseId=\$\{lease\.id\}`/);

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
