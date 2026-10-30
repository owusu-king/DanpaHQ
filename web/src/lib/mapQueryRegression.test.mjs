import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./exploreQuery.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { parseExploreQuery, serializeExploreQuery, listingSearchParams, withoutFilters, parseBounds } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("a stale bbox on a list URL does not filter rentals after refresh", () => {
  const query = parseExploreQuery(new URLSearchParams("bbox=-0.2,5.5,-0.1,5.7&rent_max=1000"));
  assert.equal(query.bbox, null);
  assert.equal(serializeExploreQuery(query).has("bbox"), false);
  assert.equal(listingSearchParams(query).has("west"), false);
});

test("an explicit map-area search survives copying and refreshing its URL", () => {
  const query = parseExploreQuery(new URLSearchParams("view=map&bbox=-0.2,5.5,-0.1,5.7"));
  assert.deepEqual(parseExploreQuery(serializeExploreQuery(query)), query);
  assert.equal(listingSearchParams(query).get("west"), "-0.2");
  assert.equal(serializeExploreQuery({ ...query, view: "list" }).has("bbox"), false);
});

test("clearing filters removes map narrowing and rent but keeps the chosen place", () => {
  const query = parseExploreQuery(new URLSearchParams("view=map&bbox=-0.2,5.5,-0.1,5.7&area=-0.3,5.4,0,5.8&area_name=Accra&rent_max=1000"));
  const cleared = withoutFilters(query);
  assert.equal(cleared.bbox, null);
  assert.equal(cleared.rentMax, "");
  assert.deepEqual(cleared.area, query.area);
});

test("blank or inverted coordinates cannot become an accidental map search", () => {
  for (const text of [",5,1,6", "0,5, ,6", "1,5,0,6", "0,5,1,5", "bad", "-181,5,1,6"]) {
    assert.equal(parseBounds(text), null);
  }
});
