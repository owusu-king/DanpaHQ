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
  // One search bar and one Filters button, as on the phone: no rail of quick
  // pills, and no chips repeating what the panel holds.
  const bar = browser.slice(browser.indexOf('<div className="explore-bar">'), browser.indexOf("{advancedOpen ? ("));
  assert.match(bar, /<PlaceSearch\s/);
  assert.match(bar, /className=\{`explore-filters-button\$\{filterCount \? " is-active" : ""\}\$\{advancedOpen \? " is-open" : ""\}`\}/);
  assert.doesNotMatch(browser, /QuickSelectFilter|explore-quick|explore-filter-pill|DropdownMenu/);
  assert.match(browser, /className="explore-advanced"/);
  assert.match(browser, /className="explore-filter-scrim"/);
  // One anchored desktop panel becomes a bottom sheet on narrow web layouts.
  assert.match(css, /\.explore-advanced \{[\s\S]{0,180}position: absolute/);
  assert.match(css, /@media \(max-width: 63\.999rem\)[\s\S]{0,1600}\.explore-advanced \{[\s\S]{0,100}position: fixed/);
  assert.match(browser, /explore-chip/);
  assert.match(browser, /Clear all/);
  // Native keeps one search bar and one Filters button over its map, with the
  // complete set in a true sheet.
  assert.match(mobile, /function SearchBox/);
  assert.match(mobile, /function FiltersButton/);
  assert.match(mobile, /function FilterSheet/);
  // The complete set sits in the shared sheet a thumb can swipe away.
  assert.match(mobile, /<BottomSheet\s+visible=\{visible\}\s+onClose=\{onClose\}\s+title="Filters"/);
  // A newer answer must win even when an older request is slower.
  assert.match(browser, /requestId\.current/);
  assert.match(mobile, /requestId\.current/);
});

test("place leads, because that is the first question", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const places = read("web/src/components/explore/PlaceSearch.tsx");
  const query = read("web/src/lib/exploreQuery.ts");
  const mobile = read("mobile/app/(app)/search.tsx");

  // Web chooses a place — resolved to a centre and a box — not a locality string.
  assert.match(browser, /<PlaceSearch\s/);
  assert.match(places, /suggestPlaces\(typed, session\.current, controller\.signal\)/);
  // A link made before places still filters by its locality.
  assert.match(query, /params\.set\("locality_id", query\.localityId\)/);
  // The phone chooses places the same way, through the same API.
  assert.match(mobile, /suggestPlaces\(typed, session\.current\)/);
  assert.match(mobile, /west: box\?\.west/);
  // Free text must be sent when no suggested place has been chosen.
  assert.match(mobile, /q: area \? undefined : place\.trim\(\) \|\| undefined/);
  // Advance is a first-class control on both, not a hidden backend field.
  assert.match(browser, /name="explore-advance"/);
  assert.match(browser, /onChange=\{\(value\) => update\(\{ advanceMax: value \}\)\}/);
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
  }
  // Both ask each as its own dropdown, in one compact panel or sheet.
  assert.match(browser, /<FilterSelect\s+name="explore-property-type"\s+label="Property type"[\s\S]*<FilterSelect\s+name="explore-space-type"\s+label="Unit type"/);
  assert.match(mobile, /<SelectField\s+label="Property type"[\s\S]*<SelectField\s+label="Unit type"/);
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
  // On the web, direction controls remain discoverable and hide after use
  // instead of lingering because a pointer click left focus behind.
  assert.match(webCard, /Previous photo/);
  assert.match(webCard, /Next photo/);
  assert.doesNotMatch(webCard, /controlsSuppressed/);
  assert.doesNotMatch(css, /controls-suppressed/);
  // On a phone the swipe is the control and the dots say where it is: arrows
  // drawn over a small photograph only got in the thumb's way.
  assert.doesNotMatch(mobileCard, /Previous photo|Next photo|controlsOpacity/);
  assert.match(mobileCard, /styles\.photoDotActive/);
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

  // Neither client repeats a choice as a pill or a chip: every one lives in the
  // Filters panel or sheet, the button counts what is on, and the one chip left
  // is the map area, which is where rather than what.
  for (const source of [browser, mobile]) {
    assert.doesNotMatch(source, /const unshown = \[|function CompactFilter|function ActiveFilter|QuickSelectFilter/);
  }
  assert.match(browser, /\{filterCount \? <span className="explore-filter-count" aria-hidden="true">\{filterCount\}<\/span> : null\}/);
  assert.match(browser, /aria-label=\{filterCount \? `Filters, \$\{filterCount\} active` : "Filters"\}/);
  assert.match(mobile, /<FiltersButton\s+count=\{refinementCount\}/);

  // `bedrooms_min=0` is `>= 0` to the backend: a studio choice that was Any.
  for (const source of [browser, mobile]) {
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
  for (const field of ["area", "bbox", "q", "localityId", "localityName", "view"]) {
    assert.match(kept, new RegExp("\\b" + field + ": query\\." + field + ","));
  }

  // The count badge counts refinements; place is not one of them.
  const countStart = query.indexOf("export function refinementCount(");
  assert.ok(countStart > 0, "refinementCount not found");
  const counted = query.slice(countStart, query.indexOf("].filter(Boolean)", countStart));
  assert.doesNotMatch(counted, /place|area|locality|bbox|query\.q\b/);
  assert.match(browser, /const filterCount = refinementCount\(query\);/);

  // One Clear all on the surface; the empty state guides instead of repeating it.
  const emptyStart = browser.indexOf('className="explore-empty"');
  assert.doesNotMatch(browser.slice(emptyStart, browser.indexOf("</div>", emptyStart)), /<button/);
  const mobileEmpty = mobile.slice(mobile.indexOf("ListEmptyComponent={"), mobile.indexOf("<FilterSheet"));
  assert.doesNotMatch(mobileEmpty, /<Button|clearFilters/);
});

test("filters open one designed panel, never the operating system's list", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  const icons = read("web/src/components/portal/icons.tsx");
  const css = read("web/src/styles/explore-workspace.css");

  // A native select invisibly stretched over a pill opened the OS list, and the
  // panel's Selects did the same behind a drawn arrow.
  // A tag followed by its attributes: a comment naming the old `<select>` is a
  // mention, not a use.
  assert.doesNotMatch(browser, /<select\s|<Select\s/);

  // Glyphs are drawn to the shared icon construction rather than typed.
  for (const name of ["close", "filters"]) {
    assert.match(icons, new RegExp(`\\n  "?${name}"?: [(<]`));
  }
  assert.doesNotMatch(browser, /[×⌄]/);
  assert.doesNotMatch(browser, /function FilterGlyph/);
  // The quick menus and their pills are gone, style and all.
  assert.doesNotMatch(css, /explore-pill-chevron|explore-menu|explore-quick|explore-filter-pill/);

  // Lists are the panel's own listbox, bedrooms are real radios drawn as
  // segments, and furnishing is a switch; see exploreFilters.contract.test.mjs.
  const fields = read("web/src/components/explore/FilterFields.tsx");
  assert.match(fields, /role="listbox"/);
  assert.match(fields, /<input type="radio" name=\{name\}/);
  assert.match(browser, /<Switch checked=\{query\.furnished\} onChange=\{\(checked\) => update\(\{ furnished: checked \}\)\} label="Furnished only" \/>/);
  assert.doesNotMatch(fields, /<select\s|<Select\s/);
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

  // The button sits beside the search bar, and says what it opens and whether it is open.
  const bar = browser.slice(browser.indexOf('<div className="explore-bar">'), browser.indexOf("{advancedOpen ? ("));
  assert.ok(bar.indexOf("<PlaceSearch") < bar.indexOf("explore-filters-button"));
  assert.match(bar, /aria-haspopup="dialog"\s+aria-expanded=\{advancedOpen\}\s+aria-controls="explore-advanced-filters"/);
  // The sheet rises out of the tray's stacking context, above the portal's sticky header.
  assert.match(css, /@media \(max-width: 63\.999rem\)[\s\S]*\.explore-discovery:has\(> \.explore-advanced\) \{ z-index: 80; \}/);
  // A 15px field makes iOS zoom the page on focus.
  assert.doesNotMatch(css, /\.explore-search input \{[^}]*font-size: \.9375rem/);
  // The count and the panel speak the same word.
  assert.doesNotMatch(browser, /homes/);
});
