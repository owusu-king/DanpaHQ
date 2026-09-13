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

test("search and filters form one responsive discovery system", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const css = read("web/src/styles/explore-workspace.css");
  const mobile = read("mobile/app/(app)/search.tsx");

  // The old page was a bordered form with a Search button: every adjustment
  // was a round trip through submit.
  assert.doesNotMatch(browser, /type="submit"/);
  assert.doesNotMatch(browser, /onSubmit/);
  assert.match(browser, /className="explore-discovery"/);
  assert.match(browser, /Search by location or property/);
  assert.match(browser, /aria-label="Quick rental filters"/);
  assert.match(browser, /function QuickSelectFilter/);
  assert.match(browser, /className="explore-advanced"/);
  assert.match(browser, /className="explore-filter-scrim"/);
  // One anchored desktop panel becomes a bottom sheet on narrow web layouts.
  assert.match(css, /\.explore-advanced \{[\s\S]{0,180}position: absolute/);
  assert.match(css, /@media \(max-width: 63\.999rem\)[\s\S]{0,1600}\.explore-advanced \{[\s\S]{0,100}position: fixed/);
  assert.match(css, /@media \(max-width: 63\.999rem\)[\s\S]{0,700}\.explore-quick \{[\s\S]{0,240}overflow-x: auto/);
  assert.match(browser, /explore-chip/);
  assert.match(browser, /Clear all/);
  // Native uses the same hierarchy, with its complete set in a true sheet.
  assert.match(mobile, /function SearchBox/);
  assert.match(mobile, /function FilterSheet/);
  assert.match(mobile, /<Modal visible=\{visible\} transparent animationType="slide"/);
  assert.match(mobile, /label="Filters"/);
  assert.match(mobile, /ActiveFilter/);
  // A newer answer must win even when an older request is slower.
  assert.match(browser, /requestId\.current/);
  assert.match(mobile, /requestId\.current/);
});

test("place leads, because that is the first question", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const mobile = read("mobile/app/(app)/search.tsx");

  assert.match(browser, /searchLocalities/);
  assert.match(browser, /locality_id/);
  assert.match(mobile, /searchLocalities/);
  assert.match(mobile, /locality_id/);
  // Free text must be sent when no suggested locality has been chosen.
  assert.match(mobile, /q: locality \? undefined : place\.trim\(\) \|\| undefined/);
  // Advance is a first-class control on both, not a hidden backend field.
  assert.match(browser, /advance_max/);
  assert.match(mobile, /advance_max/);
});

test("property and unit filters use the backend-owned vocabulary on both clients", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const mobile = read("mobile/app/(app)/search.tsx");

  for (const source of [browser, mobile]) {
    assert.match(source, /loadPropertyTypes/);
    assert.match(source, /property_type/);
    assert.match(source, /space_type/);
    assert.match(source, /Property &amp; unit|Property & unit/);
  }
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

test("the card follows the rental decision hierarchy without badge clutter", () => {
  const card = read("web/src/components/listings/ListingCard.tsx");
  const mobileCard = read("mobile/src/components/listings/ListingCard.tsx");
  const css = read("web/src/styles/explore-workspace.css");

  // Cost and its important Ghana-specific advance term are considered
  // together, while trust closes the card instead of competing on the photo.
  assert.match(card, /className="listing-card-price-row"/);
  assert.match(css, /\.listing-card-price-row \{[\s\S]{0,160}justify-content: space-between/);
  assert.ok(card.indexOf("listing-card-price-row") < card.indexOf("listing-card-headline"));
  assert.ok(card.indexOf("listing-card-headline") < card.indexOf("listing-card-where"));
  assert.ok(card.indexOf("listing-card-where") < card.indexOf("listing-card-facts"));
  assert.ok(card.indexOf("listing-card-facts") < card.indexOf("listing-card-trust"));
  assert.ok(mobileCard.indexOf("styles.priceRow") < mobileCard.indexOf("styles.headline"));
  assert.ok(mobileCard.indexOf("styles.headline") < mobileCard.indexOf("styles.location"));
  assert.ok(mobileCard.indexOf("styles.location") < mobileCard.indexOf("styles.facts"));
  assert.ok(mobileCard.indexOf("styles.facts") < mobileCard.indexOf("styles.trust"));

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
  assert.match(css, /\.listing-card-where \.portal-icon \{ width: 14px/);
  assert.match(css, /\.listing-verified \.portal-icon \{ width: 15px/);
});

test("mobile photos swipe inside the feed without making the API card heavy", () => {
  const serializer = read("backend/apps/listing/serializers.py");
  const webCard = read("web/src/components/listings/ListingCard.tsx");
  const mobileCard = read("mobile/src/components/listings/ListingCard.tsx");
  const related = read("mobile/app/(app)/listing/[id].tsx");
  const css = read("web/src/styles/explore-workspace.css");

  assert.match(serializer, /card_media = serializers\.SerializerMethodField\(\)/);
  assert.match(serializer, /if len\(items\) == 5:[\s\S]{0,40}break/);
  assert.match(mobileCard, /horizontal/);
  assert.match(mobileCard, /pagingEnabled/);
  assert.match(mobileCard, /directionalLockEnabled/);
  assert.match(mobileCard, /nestedScrollEnabled/);
  assert.match(mobileCard, /snapToInterval=\{mediaWidth\}/);
  assert.doesNotMatch(mobileCard, /contentOffset=/);
  assert.match(webCard, /onPointerDown=\{startSwipe\}/);
  assert.match(webCard, /onPointerMove=\{moveSwipe\}/);
  assert.match(webCard, /onPointerUp=\{finishSwipe\}/);
  assert.match(webCard, /className="listing-photo-track"/);
  // Direction controls remain discoverable and hide after use instead of
  // lingering because a pointer click left focus behind.
  for (const source of [webCard, mobileCard]) {
    assert.match(source, /Previous photo/);
    assert.match(source, /Next photo/);
  }
  assert.doesNotMatch(webCard, /controlsSuppressed/);
  assert.doesNotMatch(css, /controls-suppressed/);
  assert.match(mobileCard, /Animated\.timing\(controlsOpacity/);
  assert.match(mobileCard, /pointerEvents=\{controlsInteractive \? "box-none" : "none"\}/);
  // The related-rental rail is already horizontal, so it deliberately avoids
  // a horizontal gesture nested inside another horizontal gesture.
  assert.match(related, /photoSwipe=\{false\}/);
  assert.match(css, /aspect-ratio: 16 \/ 10/);
});

test("saved cards keep the same heart interaction and optimistically remove", () => {
  const webSaved = read("web/app/saved/page.tsx");
  const mobileSaved = read("mobile/app/(app)/saved.tsx");

  for (const source of [webSaved, mobileSaved]) {
    assert.match(source, /unsave/i);
    assert.match(source, /saved/);
    assert.match(source, /onSave/);
    assert.match(source, /setItems|setSaved/);
  }
});
