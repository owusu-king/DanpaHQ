import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const require = createRequire(import.meta.url);
const fromRouter = createRequire(require.resolve("expo-router/package.json"));
const query = fromRouter("query-string");

test("the patched decoder preserves navigation query values and encoded delimiters", () => {
  const parsed = query.parse("name=Danpa+HQ&area=Osu%20Accra&label=%E2%82%B5&return=%2Frentals%3Fmode%3Dbuy&plus=%2B");
  assert.equal(parsed.name, "Danpa HQ");
  assert.equal(parsed.area, "Osu Accra");
  assert.equal(parsed.label, "₵");
  assert.equal(parsed.return, "/rentals?mode=buy");
  assert.equal(parsed.plus, "+");
  assert.deepEqual(query.parse("tag=water&tag=power").tag, ["water", "power"]);
  assert.equal(query.stringify({ next: "/artisan" }), "next=%2Fartisan");
});

test("malformed percent-encoded navigation input cannot hang the decoder", () => {
  const source = `const q = require(${JSON.stringify(fromRouter.resolve("query-string"))});
    const value = q.parse('area=' + '%E0%A4'.repeat(10000)).area;
    if (typeof value !== 'string') process.exit(1);`;
  const child = spawnSync(process.execPath, ["-e", source], { timeout: 5000, encoding: "utf8" });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});
