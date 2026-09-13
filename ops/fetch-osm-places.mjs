// Fetches Ghana's named places from OpenStreetMap Overpass as several small
// queries (a busy public server answers those where one large query gets a
// 504), retries each with backoff across mirrors, then merges and validates.
// usage: node ops/fetch-osm-places.mjs <outFile>   (see docs/runbook.md, "Maps and places")
import { writeFileSync } from "node:fs";

const out = process.argv[2];
const HEAD = '[out:json][timeout:300];area["ISO3166-1"="GH"]["admin_level"="2"]->.gh;';
const TAIL = "out tags center bb qt;";
const parts = {
  admin: 'relation["boundary"="administrative"]["admin_level"~"^(4|6)$"]["name"](area.gh);',
  towns: 'node["place"~"^(city|town)$"]["name"](area.gh);way["place"~"^(city|town)$"]["name"](area.gh);relation["place"~"^(city|town)$"]["name"](area.gh);',
  suburbs: 'node["place"~"^(suburb|neighbourhood|quarter)$"]["name"](area.gh);way["place"~"^(suburb|neighbourhood|quarter)$"]["name"](area.gh);relation["place"~"^(suburb|neighbourhood|quarter)$"]["name"](area.gh);',
  landmarks: 'nwr["aeroway"="aerodrome"]["name"](area.gh);nwr["amenity"="university"]["name"](area.gh);nwr["shop"="mall"]["name"](area.gh);nwr["leisure"="stadium"]["name"](area.gh);nwr["amenity"="hospital"]["name"](area.gh);',
  villages: 'node["place"="village"]["name"](area.gh);',
};
const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(name, body) {
  const query = `${HEAD}(${body});${TAIL}`;
  let delay = 20_000;
  for (let round = 1; round <= 5; round += 1) {
    for (const endpoint of endpoints) {
      const started = Date.now();
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
            "user-agent": "Rooomly-dev-places-import/1.0",
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(400_000),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = JSON.parse(text);
        if (parsed.remark) throw new Error(`remark: ${parsed.remark}`);
        if (!Array.isArray(parsed.elements)) throw new Error("no elements array");
        console.log(`${name}: ${parsed.elements.length} elements from ${endpoint} in ${Math.round((Date.now() - started) / 1000)}s`);
        return parsed.elements;
      } catch (error) {
        console.log(`${name}: round ${round} ${endpoint} failed after ${Math.round((Date.now() - started) / 1000)}s (${error.message})`);
      }
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 180_000);
  }
  throw new Error(`${name}: every endpoint failed`);
}

const merged = new Map();
for (const [name, body] of Object.entries(parts)) {
  for (const element of await run(name, body)) merged.set(`${element.type}/${element.id}`, element);
  await sleep(5_000);
}
const elements = [...merged.values()];
if (elements.length < 1000) {
  console.log(`only ${elements.length} elements; refusing to write`);
  process.exit(1);
}
writeFileSync(out, JSON.stringify({ version: 0.6, generator: "Overpass API (split fetch)", elements }));
const counts = {};
for (const element of elements) {
  const tags = element.tags ?? {};
  const kind = tags.place ?? (tags.boundary ? `admin${tags.admin_level}` : tags.aeroway ?? tags.amenity ?? tags.shop ?? tags.leisure);
  counts[kind] = (counts[kind] ?? 0) + 1;
}
console.log(`wrote ${elements.length} elements: ${JSON.stringify(counts)}`);
