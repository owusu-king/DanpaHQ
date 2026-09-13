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
  // A callback named onSubmitText is not a form submit; a form or its handler would be.
  assert.doesNotMatch(browser, /<form\b|onSubmit=\{/);
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
  const places = read("web/src/components/explore/PlaceSearch.tsx");
  const query = read("web/src/lib/exploreQuery.ts");
  const mobile = read("mobile/app/(app)/search.tsx");

  // Web chooses a place — a slug with a centre and a box — not a locality string.
  assert.match(browser, /<PlaceSearch\s/);
  assert.match(places, /searchPlaces\(typed, controller\.signal\)/);
  // A link made before places still filters by its locality.
  assert.match(query, /params\.set\("locality_id", query\.localityId\)/);
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
  // The web search spells its vocabulary once, where the query becomes parameters.
  const web = browser + read("web/src/lib/exploreQuery.ts");
  const mobile = read("mobile/app/(app)/search.tsx");

  for (const source of [web, mobile]) {
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

test("every Explore choice is shown once and removed one way", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const css = read("web/src/styles/explore-workspace.css");
  const mobile = read("mobile/app/(app)/search.tsx");

  // The search field drew two clears: the designed one and the browser's own
  // search-cancel cross beside it.
  assert.match(css, /\.explore-search input::-webkit-search-cancel-button,[\s\S]{0,80}appearance: none/);
  const places = read("web/src/components/explore/PlaceSearch.tsx");
  const query = read("web/src/lib/exploreQuery.ts");
  assert.equal(places.match(/aria-label="Clear search"/g)?.length, 1);
  assert.doesNotMatch(browser, /aria-label="Clear search"/);

  for (const source of [browser, mobile]) {
    // Chips carry only what no pill shows. Place had a chip as well as the
    // field's clear, and every pill was repeated as a chip below it.
    const start = source.indexOf("const unshown = [");
    const chips = source.slice(start, source.indexOf("].filter(Boolean)", start));
    assert.ok(start > 0 && chips.length > 0, "chip list not found");
    assert.doesNotMatch(chips, /locality|rentMin|rentMax|propertyType &&|bedrooms|furnished &&/);
    assert.match(chips, /spaceType && \{/);
    assert.match(chips, /advanceMax && \{/);
    assert.match(chips, /sort !== "newest" && \{/);

    // `bedrooms_min=0` is `>= 0` to the backend: a studio choice that was Any.
    assert.doesNotMatch(source, /\["0", "/);
  }

  // Clear all clears filters. Place has its own clear, in the field.
  const mobileClearStart = mobile.indexOf("function clearFilters() {");
  assert.ok(mobileClearStart > 0, "mobile clearFilters not found");
  const mobileClear = mobile.slice(mobileClearStart, mobile.indexOf("}", mobileClearStart));
  assert.match(mobileClear, /setSort\("newest"\)/);
  assert.match(mobileClear, /setFurnished\(false\)/);
  assert.doesNotMatch(mobileClear, /setLocality|setQ\(|setPlace\(/);
  const webClearStart = browser.indexOf("function clearFilters() {");
  assert.ok(webClearStart > 0, "web clearFilters not found");
  assert.match(browser.slice(webClearStart, browser.indexOf("}", webClearStart)), /update\(withoutFilters\(query\)\);/);
  const keptStart = query.indexOf("export function withoutFilters(");
  assert.ok(keptStart > 0, "withoutFilters not found");
  const kept = query.slice(keptStart, query.indexOf("\n}", keptStart));
  assert.match(kept, /\.\.\.EMPTY_EXPLORE_QUERY,/);
  for (const field of ["place", "bbox", "q", "localityId", "localityName", "view"]) {
    assert.match(kept, new RegExp("\\b" + field + ": query\\." + field + ","));
  }

  // The count badge counts refinements; place is not one of them.
  const countStart = query.indexOf("export function refinementCount(");
  assert.ok(countStart > 0, "refinementCount not found");
  const counted = query.slice(countStart, query.indexOf("].filter(Boolean)", countStart));
  assert.doesNotMatch(counted, /place|locality|bbox|query\.q\b/);
  assert.match(browser, /const filterCount = refinementCount\(query\);/);

  // One Clear all on the surface; the empty state guides instead of repeating it.
  const emptyStart = browser.indexOf('className="explore-empty"');
  assert.doesNotMatch(browser.slice(emptyStart, browser.indexOf("</div>", emptyStart)), /<button/);
  const mobileEmpty = mobile.slice(mobile.indexOf("ListEmptyComponent={"), mobile.indexOf("<FilterSheet"));
  assert.doesNotMatch(mobileEmpty, /<Button|clearFilters/);
});

test("quick filters open designed menus, not the operating system's list", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const icons = read("web/src/components/portal/icons.tsx");
  const css = read("web/src/styles/explore-workspace.css");

  // A native select invisibly stretched over the pill opened the OS list, and
  // the panel's Selects did the same behind a drawn arrow.
  // A tag followed by its attributes: the component's own comment names the
  // old `<select>` it replaced, and that mention is not a use.
  assert.doesNotMatch(browser, /<select\s|<Select\s/);
  const quick = browser.slice(browser.indexOf("function QuickSelectFilter("));
  assert.match(quick, /<DropdownMenu\.RadioGroup value=\{value\} onValueChange=\{onChange\}>/);
  assert.match(quick, /<DropdownMenu\.ItemIndicator className="explore-menu-check">\s*<Icon name="check" \/>/);
  assert.match(quick, /<Icon name="chevron-down" \/>/);
  // Portalled, because the rail scrolls sideways on a phone and would clip it.
  assert.match(quick, /<DropdownMenu\.Portal>\s*<DropdownMenu\.Content className="explore-menu"/);
  // Touch and pen wait for the tap, so a swipe along the rail opens nothing.
  assert.match(quick, /if \(event\.pointerType !== "mouse"\) event\.preventDefault\(\);/);
  assert.match(quick, /if \(pointer\.current === "touch" \|\| pointer\.current === "pen"\) setOpen/);

  // Glyphs are drawn to the shared icon construction rather than typed.
  for (const name of ["chevron-down", "close", "check", "filters"]) {
    assert.match(icons, new RegExp(`\\n  "?${name}"?: [(<]`));
  }
  assert.doesNotMatch(browser, /[×⌄]/);
  assert.doesNotMatch(browser, /function FilterGlyph/);
  assert.doesNotMatch(css, /explore-pill-chevron::before/);

  // The panel's short sets are chips over real radios, one name per set.
  const choice = browser.slice(browser.indexOf("function ChoiceSet("));
  assert.match(choice, /<input\s+type="radio"\s+name=\{name\}/);
  assert.match(choice, /className="chip explore-choice"/);
  assert.match(browser, /<Switch checked=\{query\.furnished\} onChange=\{\(checked\) => update\(\{ furnished: checked \}\)\} label="Furnished only" \/>/);
  // Colour belongs to `.chip`: restated here it would outrank the checked state.
  const choiceRule = css.slice(css.indexOf(".explore-choice {"), css.indexOf("}", css.indexOf(".explore-choice {")));
  assert.doesNotMatch(choiceRule, /background|color/);
});

test("the Filters panel behaves as the dialog it announces", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const css = read("web/src/styles/explore-workspace.css");

  assert.match(browser, /role="dialog"\s+aria-modal="true"/);
  // Focus goes in on open, stays in on Tab, and the scrim is not a tab stop.
  assert.match(browser, /if \(advancedOpen\) advancedPanel\.current\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(browser, /onKeyDown=\{keepFocusInPanel\}/);
  assert.match(browser, /if \(event\.shiftKey && \(current === first \|\| current === event\.currentTarget\)\) \{\s*event\.preventDefault\(\);\s*last\.focus\(\);/);
  assert.match(browser, /else if \(!event\.shiftKey && current === last\) \{\s*event\.preventDefault\(\);\s*first\.focus\(\);/);
  assert.match(browser, /<div className="explore-filter-scrim" aria-hidden="true" \/>/);
  // The suggestions are a real listbox the keyboard can walk and dismiss.
  const places = read("web/src/components/explore/PlaceSearch.tsx");
  assert.match(places, /role="combobox"/);
  assert.match(places, /role="listbox"/);
  assert.match(places, /event\.key === "Escape"\) \{\s*if \(listOpen\) \{[\s\S]{0,160}setOpen\(false\);/);

  // Filters leads the rail, so its count is never scrolled out of sight.
  const rail = browser.slice(browser.indexOf('aria-label="Quick rental filters"'));
  assert.ok(rail.indexOf("explore-more-filters") < rail.indexOf("<QuickSelectFilter"));
  // The sheet rises out of the tray's stacking context, above the portal's sticky header.
  assert.match(css, /@media \(max-width: 63\.999rem\)[\s\S]*\.explore-discovery:has\(> \.explore-advanced\) \{ z-index: 80; \}/);
  // A 15px field makes iOS zoom the page on focus.
  assert.doesNotMatch(css, /\.explore-search input \{[^}]*font-size: \.9375rem/);
  // The count and the panel speak the same word.
  assert.doesNotMatch(browser, /homes/);
});
