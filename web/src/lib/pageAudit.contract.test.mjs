import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");

test("property condition evidence calls the property API rather than a console route", () => {
  const source = read("web/src/lib/verification.ts");
  assert.match(source, /subject === "property" \? `\/properties\/\$\{id\}`/);
  assert.doesNotMatch(source, /`\/record\/property\?id=\$\{id\}`/);
});

test("record flows do not request malformed API paths when their route id is absent", () => {
  for (const [file, guard] of [
    ["web/app/record/property/page.tsx", /if \(!id\) return;/],
    ["web/app/record/property-setup/page.tsx", /if \(!propertyId\) return;/],
    ["web/app/record/property-verify/page.tsx", /if \(!id\) return;/],
    ["web/app/record/space-new/page.tsx", /if \(!propertyId\) return;/],
    ["web/app/record/space-listing/page.tsx", /if \(!spaceId\) return;/],
  ]) assert.match(read(file), guard, `${file} fetches without a route id`);
});

test("an active agreement previews its schedule without calling future rent overdue", () => {
  const source = read("web/src/components/tenant/AgreementRecord.tsx");
  assert.match(source, /<h3>Rent schedule<\/h3>/);
  assert.match(source, /upcoming \? "Scheduled"/);
  assert.match(source, /Show \$\{remaining\} later payment/);
  assert.doesNotMatch(source, /<h3>Rent so far<\/h3>/);
});
