import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The artisan network on web.
 *
 * The trade filter is a copy of the backend's list, so a trade added there and
 * forgotten here would be impossible to find. And the product's position — a
 * connector and record-keeper, never a guarantor — is a rule about words, so it
 * is checked as one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

test("the trade filter offers exactly the backend's trades, in its order and words", () => {
  const models = read("backend/apps/artisan/models.py");
  const block = models.slice(models.indexOf("class Trade("), models.indexOf("\n\n\n", models.indexOf("class Trade(")));
  const backend = [...block.matchAll(/= "([a-z_]+)", "([^"]+)"/g)].map((match) => `${match[1]}=${match[2]}`);
  const client = code(read("web/src/lib/artisan.ts"));
  const list = client.slice(client.indexOf("export const TRADES"), client.indexOf("];", client.indexOf("export const TRADES")));
  const web = [...list.matchAll(/value: "([a-z_]+)", label: "([^"]+)"/g)].map((match) => `${match[1]}=${match[2]}`);

  assert.ok(backend.length >= 10, "no trades parsed from the backend");
  assert.deepEqual(web, backend);
});

test("no artisan screen promises what Danpa HQ does not do", () => {
  const files = [];
  for (const dir of ["web/src/components/artisan", "web/app/artisan"]) {
    (function walk(path) {
      for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
        const next = join(path, entry.name);
        if (entry.isDirectory()) walk(next);
        else if (entry.name.endsWith(".tsx")) files.push(next);
      }
    })(dir);
  }
  assert.ok(files.length >= 4);
  for (const file of files) {
    assert.doesNotMatch(code(read(file)), /\bTrusted\b|\bGuaranteed\b|Payment protected|trust score/i, file);
  }
});

test("the Artisans sheet keeps the electrical rule visible and its opt-in explicit", () => {
  const sheet = code(read("web/src/components/artisan/ArtisansSheet.tsx"));

  assert.match(sheet, /Wiring work needs a certified professional/);
  assert.match(sheet, /discoverArtisans\(\{ trade, district, certified, showUncertified \}/);
  assert.match(sheet, /onClick=\{\(\) => setShowUncertified\(true\)\}/);
  // A different trade forgets the opt-in rather than carrying it over.
  assert.match(sheet, /if \(seenTrade !== trade\) \{\s*setSeenTrade\(trade\);\s*setShowUncertified\(false\);/);
  // Certified is the shared switch, never a native box.
  assert.match(sheet, /<Switch checked=\{certified\} onChange=\{setCertified\} label="Certified only" \/>/);
});

test("becoming an artisan is a quiet link in the Artisans sheet, never a menu item", () => {
  // Owner, 2026-10-20: not pushed on tenants or providers. The account menu
  // gains only the switch, and only once the backend opens the experience.
  const menu = code(read("web/src/components/portal/AccountMenu.tsx"));
  assert.doesNotMatch(menu, /Become an artisan|Your artisan application|href=\{"\/artisan"/);
  assert.match(menu, /artisan: "Switch to artisan experience"/);

  const sheet = code(read("web/src/components/artisan/ArtisansSheet.tsx"));
  assert.match(sheet, /const becomeLabel = !artisan \|\| artisan\.workspace_access\s*\? null/);
  assert.match(sheet, /headerAction=\{becomeLabel && !top \? \(\s*<Link href=\{"\/artisan" as never\} onClick=\{onClose\}>\{becomeLabel\}<\/Link>/);
});
