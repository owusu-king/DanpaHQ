import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Properties for sale on the web (owner, 2026-09-28): sold whole, public the
 * moment verification passes, reached through Explore's Buy side, and contacted
 * only by enquiry. These guard the rules the screens could quietly drop.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, "../../..", path), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("whether a sale is public is the server's answer, never worked out on the page", () => {
  const panel = code(read("web/src/components/property/SalePanel.tsx"));
  assert.match(panel, /if \(sale\.is_public\) \{/);
  // No local rule combining the status with the verification to decide it.
  assert.doesNotMatch(panel, /status === "active" && verified/);
  const list = code(read("web/app/properties/page.tsx"));
  assert.match(list, /sale\.is_public\s*\?\s*"For sale · public"/);
});

test("a sale takes no Units", () => {
  const page = code(read("web/app/properties/[id]/page.tsx"));
  assert.match(page, /const primary = !selling && !lifecycleOwnsPrimary && canAddUnit/);
  assert.match(page, /\{selling \? \(\s*sale \? \(\s*<SalePanel/);
});

test("the setup journey walks the steps this property has, not a fixed list", () => {
  const setup = code(read("web/app/properties/[id]/setup/page.tsx"));
  assert.match(setup, /const keys = steps\.map\(\(row\) => row\.key\);/);
  assert.match(setup, /<StepFooter\s+steps=\{keys\}/);
  // Every hand-off goes through `after`, so land skips details and amenities.
  assert.doesNotMatch(setup, /setStep\("(documents|photos|amenities)"\)/);
  assert.match(setup, /toSetupInput\([\s\S]*?sale \? sale\.missing\.length : null,/);
});

test("a sale's title and land's site plan go up typed, beside the relationship document", () => {
  const claim = code(read("web/src/components/property/AuthorityClaim.tsx"));
  assert.match(claim, /\.\.\.\(selling && titleFile \? \[\{ file: titleFile, type: titleType \}\] : \[\]\)/);
  assert.match(claim, /\.\.\.\(land && sitePlan \? \[\{ file: sitePlan, type: "site_plan" \}\] : \[\]\)/);
  assert.match(claim, /if \(upload\.type\) evidenceTypes\[stored\.id\] = upload\.type;/);
  assert.match(claim, /\.\.\.\(selling \? \{ evidence_types: evidenceTypes \} : \{\}\)/);
  // The letting claim is unchanged: one untyped document.
  assert.match(claim, /\{ file, type: null \}/);
});

test("a buyer reaches a seller by enquiry, and never by phone", () => {
  const page = code(read("web/app/sales/[id]/page.tsx"));
  assert.match(page, /await startEnquiry\(sale!\.id, body\)/);
  assert.doesNotMatch(page, /tel:|phone_number|seller_phone/);
  // An existing conversation is reopened rather than started twice.
  assert.match(page, /sale\.my_enquiry_id \? \(/);
});

test("Explore offers Rent and Buy, and Buy keeps its search in the address bar", () => {
  const page = code(read("web/app/rentals/page.tsx"));
  assert.match(page, /if \(asked === "buy"\) return <SaleBrowser \/>;/);
  // All is the default, and shows both sides at once — with the filters both
  // answer and a map holding both (owner, 2026-10-05).
  const all = code(read("web/src/components/explore/AllBrowser.tsx"));
  assert.match(all, /Promise\.allSettled\(\[\s*searchListingsFor\(new URLSearchParams\(search\), controller\.signal\),\s*searchSales\(/);
  assert.match(all, /<ExploreMapView[\s\S]{0,900}sales=\{sales\}/);
  assert.match(all, /\.sort\(\(a, b\) => b\.at\.localeCompare\(a\.at\)\)/);
  // Rent keeps its side through every filter change.
  assert.match(code(read("web/src/components/listings/ListingBrowser.tsx")), /get\("mode"\) === "rent"\) nextParams\.set\("mode", "rent"\)/);
  const browser = code(read("web/src/components/sales/SaleBrowser.tsx"));
  assert.match(browser, /const out = new URLSearchParams\(\{ mode: "buy" \}\);/);
  assert.match(browser, /window\.history\.replaceState\(null, "", /);
  assert.doesNotMatch(browser, /history\.state/);
  assert.match(browser, /const page = await searchSales\(filters\);/);
});

test("enquiries are reached on both sides, from the top bar's Enquiries", () => {
  // Conversations, not a place to work through: they left the rail for the
  // header, and both sides reach them there.
  const nav = read("web/src/lib/portalNav.ts");
  const shell = read("web/src/components/portal/PortalShell.tsx");
  assert.doesNotMatch(nav, /label: "Buyer enquiries"/);
  assert.match(nav, /return operates \? \{ href: "\/enquiries", as: "seller" \} : null;/);
  assert.match(nav, /return \{ href: "\/enquiries", as: "buyer" \};/);
  assert.match(shell, /className="portal-header-support"/);
  assert.match(shell, /<Icon name="headset" \/>/);
  assert.match(shell, />Enquiries<\/span>/);
  assert.match(read("web/src/lib/notificationMeaning.ts"), /case "sale_enquiry":\s*return `\/enquiries\/\$\{item\.target_id\}`;/);
});

test("enquiries are an inbox over the page, with the conversation's rules intact", () => {
  const inbox = code(read("web/src/components/enquiries/EnquiriesInbox.tsx"));
  const shell = code(read("web/src/components/portal/PortalShell.tsx"));

  // Enquiries opens it over whatever page is showing; the shell hosts it.
  assert.match(shell, /<EnquiriesInbox/);
  assert.match(shell, /onClick=\{\(\) => openEnquiries\(/);
  // The old addresses still work: arriving at one opens the inbox and steps back.
  assert.match(shell, /setInbox\(\{ open: true, request: \{ id, side \} \}\);/);
  assert.equal(code(read("web/app/enquiries/[id]/page.tsx")).includes("return null"), true);

  // List and conversation, through the same three calls the pages used.
  assert.match(inbox, /await listEnquiries\(effectiveSide\)/);
  assert.match(inbox, /await getEnquiry\(selectedId\)/);
  assert.match(inbox, /await replyToEnquiry\(selectedId, body\)/);
  // Reading marks it read on the server, and the list says so at once.
  assert.match(inbox, /row\.id === detail\.id \? \{ \.\.\.row, unread: false \}/);
  // A sold property or closed enquiry stays readable and takes no replies.
  assert.match(inbox, /const closed = thread \? thread\.status === "closed" \|\| thread\.sale\.status === "sold" : false;/);
  // Only an account that can sell is offered the selling side.
  assert.match(inbox, /const effectiveSide: EnquirySide = canSell \? side : "buyer";/);
});
