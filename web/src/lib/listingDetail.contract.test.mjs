import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const web = () => read("web/app/listings/[id]/page.tsx");
const mobile = () => read("mobile/app/(app)/listing/[id].tsx");

test("photographs lead, and say where they came from", () => {
  for (const source of [web(), mobile()]) {
    assert.match(source, /gallery/);
    assert.match(source, /source_label/);
  }
  // Web opens a lightbox; mobile swipes and goes full screen.
  assert.match(web(), /listing-lightbox/);
  assert.match(web(), /ArrowRight/);
  assert.match(mobile(), /pagingEnabled/);
  assert.match(mobile(), /\{photoIndex \+ 1\} \/ \{photos\.length\}/);
});

test("photographs preview the place; they do not take the page", () => {
  const css = read("web/src/styles/listing-workspace.css");

  // A 16/9 mosaic across a 76rem page stands about 680px tall — a laptop's
  // whole first screen, before a word has been read.
  assert.doesNotMatch(css, /[.]listing-gallery [{][^}]*aspect-ratio/);
  assert.match(css, /[.]listing-gallery [{][^}]*height: clamp[(]/);

  // One control that says what it does, rather than a badge on the third tile
  // that a tenant has to guess is clickable.
  assert.match(web(), /listing-gallery-all/);
  assert.match(web(), /View all [{]photos[.]length[}] photos/);
  assert.doesNotMatch(web(), /listing-gallery-more|listing-gallery-source/);

  // Reaching the eighth photograph is one move, not seven: a strip on web, an
  // overview grid on mobile.
  assert.match(web(), /listing-lightbox-thumbs/);
  assert.match(css, /[.]listing-lightbox-thumb [{]/);
  assert.match(mobile(), /const heroHeight = Math[.]min[(]/);
  assert.match(mobile(), /photoGroups[.]map/);
  assert.match(mobile(), /grid-outline/);
});

test("trust reassures without dominating", () => {
  // Four stamps under "Know who you're dealing with" used to sit in the middle
  // of the page, with a paragraph under them.
  for (const source of [web(), mobile()]) {
    assert.match(source, /Verified rental/);
    assert.doesNotMatch(source, /Know who you.{0,3}re dealing with/);
    assert.doesNotMatch(source, /trust_stamps\.phone/);
  }
  assert.match(mobile(), /expandedTrust/);
});

test("web states the verification rather than hiding it behind a control", () => {
  // Whether to trust a listing is the question the reader arrived with. A
  // disclosure made them open something to find out, which is the wrong trade
  // for three stamps and one line.
  assert.doesNotMatch(web(), /<details className="listing-trust">/);
  assert.match(web(), /<section className="listing-trust"/);
  assert.match(web(), /className="listing-trust-stamps"/);
  // The shield, from the shared set, so the mark means one thing product-wide.
  assert.match(web(), /<Icon name="verification" \/>/);
  const css = read("web/src/styles/listing-workspace.css");
  assert.match(css, /\.listing-trust-title \.portal-icon \{ width: 16px/);
});

test("applying leads, and a viewing request is asked for rather than sent", () => {
  const source = web();

  // Applying is what this page exists to produce and it was the *secondary*
  // button, under a viewing request that fired on one click.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  const applyAt = code.indexOf("Apply to rent");
  const viewingAt = code.indexOf("Request a viewing");
  assert.ok(applyAt > 0 && applyAt < viewingAt, "Apply to rent must come first");
  assert.match(source, /<Button\s*\n\s*onClick=\{\(\) => \{[\s\S]{0,200}\/apply\//);

  // The request reaches a real person and cannot be taken back. The guard is
  // the *call site*: there must be exactly one, and it must be the confirm.
  // Asserting that `confirmingViewing` merely appears passed happily while the
  // button beside it went straight back to sending on one click.
  assert.equal((source.match(/void requestViewing\(\)/g) ?? []).length, 1);
  assert.match(source, /onClick=\{\(\) => void requestViewing\(\)\}[\s\S]{0,80}Yes, send it/);
  assert.match(source, /Send a viewing request\?/);
  // And the button that starts it only opens the question.
  assert.match(source, /setConfirmingViewing\(true\)[\s\S]{0,140}Request a viewing/);

  // Mobile asks too: a full-width button at the bottom of a scrolling page is
  // exactly where an accidental tap happens.
  assert.match(mobile(), /Alert\.alert\(\s*"Send a viewing request\?"/);
  assert.match(mobile(), /async function sendViewingRequest\(\)/);
});

test("saving is a mark, and sharing uses the platform with a safe fallback", () => {
  const source = web();
  const css = read("web/src/styles/listing-workspace.css");

  // A bookmark, not a heart. A heart is a favourite — an opinion about a place.
  // Saving is putting something aside to come back to.
  assert.match(source, /<Icon name="bookmark" \/>/);
  assert.doesNotMatch(source, /♥ Saved|♡ Save|name="saved"/);

  // Side by side and equal, with the mark on the same optical line as its
  // label — `Button` is a plain <button>, so an inline icon sat on the text
  // baseline until the content was laid out as a centred row.
  assert.match(css, /\.listing-secondary > button \{[\s\S]{0,200}display: inline-flex/);
  assert.match(css, /\.listing-secondary > button \{[\s\S]{0,200}align-items: center/);
  assert.match(css, /\.listing-secondary > button \{[\s\S]{0,200}flex: 1/);

  // Saved is a filled bookmark, driven by the same `aria-pressed` a screen
  // reader announces, so the mark and the announcement cannot disagree.
  assert.match(source, /aria-pressed=\{saved\}/);
  assert.match(css, /\[aria-pressed="true"\] \.portal-icon \{ fill: currentColor/);

  // Share uses the platform sheet where it exists, keeps a clipboard fallback,
  // and has a glyph from the same restrained set as Save.
  assert.match(source, /navigator\.share/);
  assert.match(source, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(source, /<Icon name="share" \/>/);
  assert.match(source, /"Share"/);
  assert.doesNotMatch(source, /Copy link/);
});

test("the price and action panel becomes the sticky decision surface", () => {
  const css = read("web/src/styles/listing-workspace.css");
  assert.match(css, /\.listing-panel \{[^}]*position: sticky;[^}]*align-self: start/);
  assert.match(css, /\.listing-panel \{[^}]*box-shadow:/);
  // Sticky needs a containing area taller than the panel. Related rentals now
  // extend the same grid, and the signed-in offset clears the portal header.
  assert.match(css, /grid-template-areas:[\s\S]{0,120}"details decision"[\s\S]{0,80}"related decision"/);
  assert.match(css, /\.listing-related \{ grid-area: related;/);
  assert.match(css, /\.portal \.listing-panel \{ top: calc\(3\.25rem \+ var\(--space-4\)\); \}/);
  assert.match(css, /@media \(max-width: 960px\)[\s\S]{0,400}grid-template-areas: "details" "decision" "related"/);
  assert.match(css, /@media \(max-width: 960px\)[\s\S]{0,500}\.listing-panel, \.portal \.listing-panel \{ position: static; \}/);

  const phone = mobile();
  assert.match(phone, /Share\.share/);
  assert.match(phone, /name="share-outline"/);
  assert.match(phone, /listing\.rent_formatted/);
});

test("an icon outside the navigation takes the colour of what it labels", () => {
  // `portal.css` paints every `.portal-icon` ink-500 for the rail. Anywhere
  // else that is simply wrong: the verified shield rendered grey beside green
  // text, on both the listing page and the Explore card.
  assert.match(
    read("web/src/styles/portal.css"),
    /\.portal-icon \{[^}]*color: var\(--color-ink-500\)/,
  );

  // Plain string slicing: a regex built by interpolating a selector needs the
  // selector's own dot escaped, and getting that wrong is how the first
  // version of this test passed against nothing.
  for (const [file, selector] of [
    ["web/src/styles/listing-workspace.css", ".listing-trust-title"],
    ["web/src/styles/listing-workspace.css", ".listing-secondary"],
    ["web/src/styles/explore-workspace.css", ".listing-verified"],
  ]) {
    const source = read(file);
    const at = source.indexOf(selector + " .portal-icon {");
    assert.notEqual(at, -1, selector + " has no icon rule");
    const rule = source.slice(at, source.indexOf("}", at));
    assert.ok(
      rule.includes("color: inherit"),
      selector + " icon must take the colour of what it labels",
    );
  }

  // The pin is the deliberate exception: a quiet mark beside quiet text.
  //
  // What matters is that it is *quieter than its own label*, not which token
  // says so — this asserted the literal `--color-ink-300` and so failed the
  // moment the palette moved, while a pin that had silently become the same
  // grey as the text beside it would have passed. So: it must not inherit, and
  // it must not simply restate the caption colour.
  const explore = read("web/src/styles/explore-workspace.css");
  const pinAt = explore.indexOf(".listing-card-where .portal-icon {");
  assert.notEqual(pinAt, -1, "the pin has no icon rule");
  const pinRule = explore.slice(pinAt, explore.indexOf("}", pinAt));
  assert.ok(/color:/.test(pinRule), "the pin must state a colour");
  assert.ok(!/color:\s*inherit/.test(pinRule), "the pin does not take its label's colour");

  const captionAt = explore.indexOf(".listing-card-where, .listing-card-facts {");
  const captionRule = explore.slice(captionAt, explore.indexOf("}", captionAt));
  const colourOf = (rule) => (rule.match(/color:\s*([^;]+)/) ?? [])[1]?.trim();
  assert.notEqual(
    colourOf(pinRule),
    colourOf(captionRule),
    "the pin must be quieter than the text it sits beside, not the same grey",
  );
});

test("the page states each answer once", () => {
  const source = web();

  // Rent, locality and availability each appear in exactly one place. The old
  // page repeated the locality in a top label and again under the property, and
  // carried the price in the heading and in a move-in card.
  assert.equal((source.match(/rent_formatted/g) ?? []).length, 1);
  assert.equal((source.match(/listing-status/g) ?? []).length, 1);
  assert.doesNotMatch(source, /What you are renting/);
  // Explaining what a viewing request is belongs to the action, not to two
  // paragraphs above it.
  assert.doesNotMatch(source, /A viewing request asks the representative/);
  assert.doesNotMatch(source, /Interested in this space\?/);
});

test("actions have a hierarchy and follow what already happened", () => {
  const source = web();

  // One primary, one secondary, two quiet — not four equal buttons. The
  // primary used to be the viewing request; applying is what this page exists
  // to produce, so it took the lead and the request became secondary.
  assert.match(source, /Request a viewing/);
  assert.match(source, /variant="secondary"[\s\S]{0,400}Request a viewing/);
  assert.doesNotMatch(source, /variant="secondary"[\s\S]{0,200}Apply to rent/);
  assert.match(source, /variant="quiet"[\s\S]{0,200}Save/);
  assert.match(source, /Viewing confirmed — open it/);
  // A taken listing offers nothing to act on.
  assert.match(source, /taken \?/);
  assert.match(source, /listing\.status !== "active"/);

  // Browsing is public; the account is asked for only at the point of acting.
  assert.match(source, /if \(!signedIn\) return requireAccount/);
});

test("mobile keeps the decision reachable without covering the page", () => {
  const source = mobile();

  // A bar, not a panel, pinned outside the ScrollView so it never covers the
  // page.
  assert.match(source, /<\/ScrollView>[\s\S]{0,60}The decision bar stays reachable/);

  // As on the web, applying leads and the viewing request is the step beside it
  // (owner, 2026-09-28). Apply is the bar's primary; the request is secondary;
  // and there is one Apply on the page, not a second one up in the terms.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  const bar = code.slice(code.indexOf("styles.barHead"));
  const applyAt = bar.indexOf("Apply to rent");
  const viewingAt = bar.indexOf("Request viewing");
  assert.ok(applyAt > 0 && applyAt < viewingAt, "Apply to rent must lead the decision bar");
  assert.doesNotMatch(bar.slice(0, viewingAt), /variant="secondary"/, "Apply to rent must not be the secondary");
  assert.match(bar.slice(applyAt, viewingAt + 200), /variant="secondary"/, "the viewing request is the secondary");
  assert.equal((code.match(/"Apply to rent"/g) ?? []).length, 1);
});

test("the exact address never reaches this page", () => {
  const serializer = read("backend/apps/listing/serializers.py");

  // The domain rule: street, house number and entrance note are released when a
  // viewing is confirmed, not to anyone who opens a listing.
  assert.match(serializer, /What is deliberately \*not\* here: the street/);
  for (const source of [web(), mobile()]) {
    // Comments explain the rule; the rendered page must not read the fields.
    // `.` stops at a line break, so this needs no newline class.
    const rendered = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    assert.doesNotMatch(rendered, /entrance_note|house_number|\bstreet\b/);
    // Locality, district and landmark are enough to judge a place.
    assert.match(rendered, /landmark/);
  }
});

test("related rentals are curated once and continue the listing journey", () => {
  const readModel = read("backend/apps/listing/read_models.py");
  const webApi = read("web/src/lib/listings.ts");
  const mobileApi = read("mobile/src/listings.ts");

  // Publication and occupancy come from the same public boundary as Explore.
  assert.match(readModel, /def public_listings/);
  assert.match(readModel, /exclude\(pk=listing\.pk\)/);
  assert.match(readModel, /location_score/);
  assert.match(readModel, /affordability_score/);
  assert.match(readModel, /amenity_overlap/);
  assert.match(readModel, /limit: int = 4/);

  for (const source of [webApi, mobileApi]) {
    assert.match(source, /listings\/\$\{[^}]+\}\/related\//);
  }
  assert.match(web(), /Related rentals/);
  assert.match(web(), /<ListingCard/);
  assert.match(mobile(), /Related rentals/);
  assert.match(mobile(), /horizontal/);
  assert.match(mobile(), /pathname: "\/\(app\)\/listing\/\[id\]"/);
});

test("web Explore restores the tenant's comparison context", () => {
  const browser = read("web/src/components/listings/ListingBrowser.tsx");

  assert.match(browser, /rememberExplorePosition/);
  assert.match(browser, /window\.history\.replaceState/);
  assert.match(browser, /rentals:return-scroll/);
  assert.match(browser, /window\.scrollTo/);
});
