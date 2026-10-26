import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relative) {
  return readFileSync(resolve(root, relative), "utf8");
}

test("a provider under review waits in a waiting room, not behind a notice (owner, 2026-10-25)", () => {
  const home = read("web/app/home/page.tsx");
  const room = read("web/src/components/home/ProviderReview.tsx");
  const css = read("web/src/styles/provider-review.css");

  // The Home hands the whole page to it whenever property tools are not open yet.
  assert.match(home, /if \(!provider\.workspace_access\) \{[\s\S]{0,200}return <ProviderReview me=\{me\} \/>;/);
  assert.doesNotMatch(home, /REVIEW_COPY|Your documents are with our review team|Explore rentals meanwhile/);
  assert.match(read("web/app/globals.css"), /@import "\.\.\/src\/styles\/provider-review\.css";/);

  // Every review state has its own words; an unknown one reads as not started.
  for (const state of ["not_started", "pending", "needs_more_info", "rejected", "revoked", "expired"]) {
    assert.match(room, new RegExp(`\\n  ${state}: \\{`), state);
  }
  assert.match(room, /const status = provider\.verification_status \?\? "not_started";/);
  assert.match(room, /: REVIEWS\[status\] \?\? REVIEWS\.not_started!;/);

  // A seal, the three steps of the journey, and two doors: the verification and renting meanwhile.
  assert.match(room, /className="review-seal"/);
  assert.match(room, /\{ title: "Documents sent"[\s\S]*\{ title: "Review"[\s\S]*\{ title: "Property tools open"/);
  assert.match(room, /<Link href="\/provider" className="review-door is-primary">/);
  assert.match(room, /<Link href="\/rentals" className="review-door">/);
  // No promise about how long a review takes.
  assert.doesNotMatch(room, /day or two|within \d|hours?\b/i);
  // The team's note is shown when they asked for something or said no, never while it is simply waiting.
  assert.match(room, /const note = review\.tone === "waiting" \? "" :/);

  // While it simply waits, the first door is Updates, where the decision arrives — never /provider, which sends it back here.
  assert.match(room, /\{review\.tone === "waiting" \? \(\s*<Link href="\/updates" className="review-door is-primary">/);
  // A phone that is not confirmed comes before any review state, as on /provider.
  assert.match(room, /const review = !me\.is_phone_verified\s*\? REVIEWS\.phone!/);
  // Home makes the check /provider used to: every 30 seconds, and the session reloads only when the review has moved.
  assert.match(room, /setInterval\(\(\) => \{\s*getProviderStanding\(\)/);
  assert.match(room, /if \(standing\.workspace_access \|\| standing\.verification_status !== status\) void refresh\(\);/);
  assert.match(room, /\}, 30000\);/);

  // The light moves only while the review is with the team, and never for someone who asked for less motion.
  assert.match(css, /\.review-wait:not\(\[data-tone="waiting"\]\) \.review-seal-arc \{ animation: none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.review-seal-arc/);
});

test("/provider stays for the steps, and hands a review that is only waiting to Home", () => {
  const page = read("web/app/provider/page.tsx");
  const nav = read("web/src/lib/portalNav.ts");

  // Only on the provider side (where Home shows the review), only while pending, and only once the phone is confirmed.
  assert.match(
    page,
    /const waitsOnHome = Boolean\(\s*me\s*&& me\.capabilities\.active_workspace === "provider"\s*&& !me\.capabilities\.provider\.workspace_access\s*&& me\.capabilities\.provider\.verification_status === "pending"\s*&& me\.is_phone_verified,\s*\);/,
  );
  assert.match(page, /useEffect\(\(\) => \{ if \(waitsOnHome\) router\.replace\("\/home"\); \}, \[router, waitsOnHome\]\);/);
  assert.match(page, /if \(waitsOnHome\) return null;/);
  // Everything with something to do is still here: the agreement, the phone code, requesting approval, opening the workspace.
  assert.match(page, /<ProviderTermsConsent/);
  assert.match(page, /<PhoneVerificationSection \/>/);
  assert.match(page, /method: "POST"/);
  assert.match(page, /Open provider workspace/);

  // The rail no longer has a Verification place of its own for someone in review.
  const inReview = nav.slice(nav.indexOf("if (inProvider && !provider.workspace_access) {"), nav.indexOf("if (inProvider) {"));
  assert.doesNotMatch(inReview, /href: "\/provider"|label: "Verification"/);
  // ...and /provider is still a portal route, so the links that lead to it keep the portal's chrome.
  assert.match(nav, /\n  "\/provider",\n/);
});
