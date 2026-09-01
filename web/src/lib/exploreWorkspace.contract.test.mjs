import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("discovery does not stop at the first page", () => {
  const api = read("web/src/lib/listings.ts");
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const mobileApi = read("mobile/src/listings.ts");
  const mobile = read("mobile/app/(app)/search.tsx");

  // Both clients returned `page.results` and dropped `next`, so however many
  // rentals existed, discovery ended at twenty.
  assert.match(api, /next: page\.next/);
  assert.match(mobileApi, /next: page\.next/);
  assert.match(browser, /searchPublicListingsPage/);
  assert.match(browser, /Show more rentals/);
  assert.match(mobile, /onEndReached/);
  assert.match(mobile, /searchListingsPage/);
});

test("a listing card compares on price and recognizes on the photograph", () => {
  const browser = read("web/src/components/listings/ListingCard.tsx");
  const card = read("mobile/src/components/listings/ListingCard.tsx");

  for (const source of [browser, card]) {
    // Advance gets its own line: in Ghana it often decides whether a place is
    // possible at all.
    assert.match(source, /advance_label/);
    // One quiet mark, and only when both checks passed — not a row of stamps
    // beside the rent.
    assert.match(source, /identity\.state === "verified"/);
    assert.match(source, /property\.state === "verified"/);
    assert.match(source, /Verified/);
    assert.doesNotMatch(source, /<Stamp/);
    // Detail belongs to the listing, not the card.
    assert.doesNotMatch(source, /description/);
    assert.doesNotMatch(source, /minimum_lease_months/);
    assert.doesNotMatch(source, /total_move_in/);
  }
});

test("desktop Explore gives each rental one of three generous columns", () => {
  const css = read("web/src/styles/explore-workspace.css");

  // At the 78rem content maximum, 22rem cards fit three across but never four.
  // Auto-fill preserves the existing natural two- and one-column collapse.
  assert.match(
    css,
    /\.explore-grid[\s\S]{0,160}repeat\(auto-fill, minmax\(min\(100%, 22rem\), 1fr\)\)/,
  );
});

test("filters open on PC and become a closed horizontal control rail on smaller screens", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const css = read("web/src/styles/explore-workspace.css");

  // The old page was a bordered form with a Search button: every adjustment
  // was a round trip through submit.
  assert.doesNotMatch(browser, /type="submit"/);
  assert.doesNotMatch(browser, /onSubmit/);
  assert.match(browser, /className="explore-filter-rail"/);
  assert.match(browser, /function MobileSelectFilter/);
  assert.match(browser, /aria-controls="explore-mobile-price"/);
  assert.doesNotMatch(browser, /<Modal|filtersOpen/);
  // The base rule is the PC experience. Below 64rem only compact, closed
  // controls are visible; the full field grid remains out of the first paint.
  assert.match(css, /\.explore-drawer \{[\s\S]{0,180}display: grid/);
  assert.match(css, /@media \(max-width: 63\.999rem\)[\s\S]{0,180}\.explore-drawer \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 63\.999rem\)[\s\S]{0,260}\.explore-mobile-filters \{ display: grid/);
  assert.match(css, /\.explore-filter-rail \{[\s\S]{0,240}overflow-x: auto/);
  assert.match(css, /\.explore-search \{ flex: none; width: 100%; \}/);
  assert.match(browser, /explore-chip/);
  assert.match(browser, /Clear all/);
  // A newer answer must win even when an older request is slower.
  assert.match(browser, /requestId\.current/);
});

test("place leads, because that is the first question", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const mobile = read("mobile/app/(app)/search.tsx");

  assert.match(browser, /searchLocalities/);
  assert.match(browser, /locality_id/);
  assert.match(mobile, /searchLocalities/);
  assert.match(mobile, /locality_id/);
  // Advance is a first-class control on both, not a hidden backend field.
  assert.match(browser, /advance_max/);
  assert.match(mobile, /advance_max/);
});

test("sorting exists and is the backend's, not the client's", () => {
  const params = read("backend/apps/listing/serializers.py");
  const view = read("backend/apps/listing/views.py");
  const browser = read("web/src/components/listings/ListingBrowser.tsx");

  assert.match(params, /choices=\["newest", "rent_asc", "rent_desc"\]/);
  // The cursor is the ordering, so a sort choice has to move the paginator.
  assert.match(view, /paginator\.ordering = ordering/);
  assert.match(view, /"rent_asc": \("rent_minor", "-created_at"\)/);
  assert.match(browser, /Rent: low to high/);
});

test("saving is offered where it can work, and reverts when it fails", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const card = read("web/src/components/listings/ListingCard.tsx");
  const mobile = read("mobile/app/(app)/search.tsx");

  // The heart appears only when there is an account to save against.
  assert.match(browser, /onSave=\{signedIn \? \(\) => void toggleSave\(listing\) : undefined\}/);
  assert.match(card, /aria-pressed=\{saved\}/);
  for (const source of [browser, mobile]) {
    assert.match(source, /unsave/i);
    // Optimistic, then put back if the server disagrees.
    assert.match(source, /catch \{[\s\S]{0,200}nextSet/);
  }
});

test("trust and cost share a row, and each fact carries its own mark", () => {
  const card = read("web/src/components/listings/ListingCard.tsx");
  const css = read("web/src/styles/explore-workspace.css");

  // Verified and the advance were two stacked rows of a card that is scanned,
  // not read. They are the two things weighed against each other before
  // opening anything, so they sit on one line.
  assert.match(card, /className="listing-card-terms"/);
  assert.match(css, /\.listing-card-terms \{[\s\S]{0,160}justify-content: space-between/);

  // The shield is the glyph verification already wears in the navigation, so
  // the mark means one thing across the product rather than two.
  assert.match(card, /<Icon name="verification" \/>/);
  assert.match(card, /<Icon name="pin" \/>/);
  assert.match(read("web/src/components/portal/icons.tsx"), /pin: \(/);

  // Card-scoped names. The listing *detail* page also defines `.listing-where`
  // and `.listing-terms`, and its stylesheet loads second — the card's row was
  // being laid out by rules written for another component entirely.
  assert.doesNotMatch(card, /className="listing-where"|className="listing-terms"/);
  assert.match(read("web/src/styles/listing-workspace.css"), /\.listing-where \{ display: grid/);

  // 20px is a navigation size; on a caption it is a badge.
  assert.match(css, /\.listing-card-where \.portal-icon \{ width: 15px/);
  assert.match(css, /\.listing-verified \.portal-icon \{ width: 15px/);
});
