import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleFrom = (source) => import(`data:text/javascript,${encodeURIComponent(compile(source))}`);

test("an abandoned React mount cannot initialize a Leaflet container after its import", async () => {
  const source = readFileSync(new URL("./maps/leaflet/map.ts", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace('await import("leaflet")', 'await Promise.resolve({ map() { throw new Error("Container initialized after abort"); } })');
  const { createLeafletMap } = await moduleFrom(source);
  const controller = new AbortController();
  const pending = createLeafletMap({}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("every React map consumer cancels its pending initialization on cleanup", () => {
  for (const path of ["../components/explore/ExploreMap.tsx", "../components/listings/ListingLocationMap.tsx", "../components/property/LocationPicker.tsx"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /signal: controller\.signal/);
    assert.match(source, /controller\.abort\(\)/);
  }
});


test("Management can disable maps before a Leaflet container is initialized", async () => {
  let source = readFileSync(new URL("./maps/leaflet/map.ts", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace('await import("leaflet")', 'await Promise.resolve({ map() { throw new Error("Disabled map initialized"); } })');
  source = 'const getMapConfig = async () => ({ enabled: false }); const reportMapUnavailable = () => {};\n' + source;
  const { createLeafletMap } = await moduleFrom(source);
  await assert.rejects(createLeafletMap({}, {}), /Maps are disabled in Management/);
});
