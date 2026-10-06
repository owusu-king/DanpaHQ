/**
 * Saved: one saved place is one card, never a banner across the page.
 *
 * The page used `repeat(auto-fit, minmax(19rem, 1fr))`, which collapses the
 * empty columns, so a lone card stretched to the full width. Fixed `auto-fill`
 * tracks keep a card's width whatever the count; a short list offers a way to
 * keep looking; a phone reads the shortlist as rows, not a screen per place.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const page = () => code(read("web/app/saved/page.tsx"));
const css = () => read("web/src/styles/saved-workspace.css");

test("a card keeps a card's width, however few there are", () => {
  assert.match(css(), /\.saved-grid \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 16rem\), 1fr\)\)/);
  assert.doesNotMatch(code(css()) + page(), /auto-fit/);
  assert.match(page(), /<ul className="saved-grid"/);
  // The shared card, as Explore shows it.
  assert.match(page(), /<ListingCard\s+key=\{row\.id\}\s+listing=\{row\.listing\}\s+saved/);
  assert.match(read("web/app/globals.css"), /@import "\.\.\/src\/styles\/saved-workspace\.css";/);
});

test("a short list says what to do with the rest of the row", () => {
  assert.match(page(), /const short = visible\.length > 0 && visible\.length <= 3 && !query;/);
  assert.match(page(), /\{short \? \(\s*<li className="saved-more">/);
});

test("on a phone a saved place is a row, not a screen", () => {
  const phone = css().slice(css().indexOf("@media (max-width: 40rem)"));
  assert.match(phone, /\.saved-grid \.listing-card \{\s*grid-template-columns: 7rem minmax\(0, 1fr\);/);
  assert.match(phone, /\.saved-grid \.listing-card-facts,[\s\S]{0,60}\.saved-grid \.listing-card-trust \{ display: none; \}/);
});

test("removing is forgiving: Undo in place, and the server is told at once", () => {
  const body = page();
  assert.match(body, /const UNDO_MS = 6000;/);
  assert.match(body, /await unsavePublicListing\(listingId\);/);
  assert.match(body, /await savePublicListing\(listingId\);/);
  assert.match(body, /window\.setTimeout\(\(\) => forget\(listingId, true\), UNDO_MS\)/);
  assert.match(body, /<li key=\{row\.id\} className="saved-removed" role="status">/);
});

test("the head summarises, tools earn their space, and every state is designed", () => {
  const body = page();
  assert.match(body, /<WorkspaceHead\s+icon="saved"\s+title="Saved"/);
  assert.match(body, /const showOrder = kept\.length > 1;/);
  assert.match(body, /const showSearch = kept\.length > 6 \|\| Boolean\(query\);/);
  assert.match(body, /title="Nothing saved yet"/);
  assert.match(body, /tone="error"/);
  assert.match(body, /No longer available/);
});
