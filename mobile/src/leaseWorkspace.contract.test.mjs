import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile Leases switches between provider and tenant agreement work", () => {
  const list = read("mobile/app/(app)/leases.tsx");
  const more = read("mobile/app/(app)/(provider-tabs)/more.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");

  assert.match(list, /capabilities\.active_workspace === "provider"/);
  assert.match(list, /listGrantedLeases/);
  assert.match(list, /listMyLeases/);
  assert.match(list, /Search agreements/);
  assert.match(list, /"send", "current", "history"/);
  assert.match(list, /provider-lease/);
  // More names the destination and nothing else; the description went with the
  // rest of the passive copy.
  assert.match(more, /label="Leases"/);
  assert.match(layout, /name="provider-lease"/);
});

test("mobile provider agreement detail renders the frozen record and confirms lifecycle actions", () => {
  const detail = read("mobile/app/(app)/provider-lease.tsx");
  const api = read("mobile/src/leases.ts");

  assert.match(detail, /lease\.agreement\?\.terms/);
  assert.match(detail, /lease\.agreement\.content_hash/);
  assert.match(detail, /Withdraw this offer\?/);
  assert.match(detail, /End this tenancy\?/);
  assert.match(detail, /Reason \(optional\)/);
  assert.match(detail, /cancelLease/);
  assert.match(api, /\/leases\/\$\{id\}\/cancel\//);
  assert.match(api, /\/leases\/\$\{id\}\//);
});

test("mobile provider Home surfaces saved agreements that still need sending", () => {
  const home = read("mobile/app/(app)/(provider-tabs)/index.tsx");
  assert.match(home, /listGrantedLeases/);
  assert.match(home, /lease\.status === "draft"/);
  // A saved agreement is waiting on the provider, so it reaches the attention
  // list. The Draft/Sent pipeline panel was removed from Home along with the
  // web one: Home answers "what needs me", and everything in flight is the
  // Leases screen's job.
  assert.match(home, /to send/);
  assert.match(home, /drafts \?/);
  assert.match(home, /\/\(app\)\/leases/);
  assert.doesNotMatch(home, /function LeasingPosition|function FlowStage/);
});
