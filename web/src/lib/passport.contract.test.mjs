import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const lib = () => read("web/src/lib/passport.ts");
const recipient = () => read("web/app/shared-passport/page.tsx");
const owner = () => read("web/app/passport/page.tsx");
const share = () => read("web/src/components/passport/ShareFlow.tsx");
const shell = () => read("web/src/components/AppShell.tsx");

test("a share token travels in the fragment and a POST body, never a query or a path", () => {
  // A fragment is never sent to a server, so the token stays out of access
  // logs and Referer headers; the API reads it from the body.
  assert.match(lib(), /\/shared-passport#\$\{token\}/);
  assert.match(lib(), /"\/passport-shares\/open\/", \{ method: "POST", body: JSON\.stringify\(\{ token \}\) \}/);
  assert.match(recipient(), /window\.location\.hash/);
  assert.doesNotMatch(recipient(), /useSearchParams|location\.search/);
});

test("the recipient's page needs no session and wears no portal chrome", () => {
  assert.match(shell(), /const BARE = \[[^\]]*"\/shared-passport"/);
  assert.doesNotMatch(recipient(), /useSession/);
  // Never indexed, never referred onward.
  assert.match(recipient(), /name="robots" content="noindex, nofollow"/);
  assert.match(recipient(), /name="referrer" content="no-referrer"/);
});

test("the owner's calls carry the session, and only the recipient's read goes without", () => {
  // Plain apiFetch sends no access token, so the owner's page answered
  // "Sign in to continue." to somebody who was signed in.
  for (const path of ["/me/passport/", "/me/passport/preview/", "/me/passport/shares/", "/me/passport/corrections/"]) {
    assert.match(lib(), new RegExp(`authedFetch<\\w+(?:\\[\\])?>\\("${path.replaceAll("/", "\\/")}"`), `${path} is sent without the session`);
  }
  assert.match(lib(), /authedFetch<PassportShare>\(`\/me\/passport\/shares\/\$\{id\}\/revoke\/`/);
  assert.match(lib(), /export const openSharedPassport = \(token: string\) =>\n  apiFetch</);
});

test("every way a link can stop working has its own explanation", () => {
  for (const code of ["passport_share_expired", "passport_share_revoked"]) {
    assert.match(recipient(), new RegExp(code));
  }
  assert.match(recipient(), /This link has expired/);
  assert.match(recipient(), /This link was withdrawn/);
  assert.match(recipient(), /This link doesn’t open a passport/);
  assert.match(recipient(), /The passport didn’t open/);
});

test("the preview is the recipient's own document, read from the backend", () => {
  // Not a client-side guess at what they will see.
  assert.match(share(), /previewPassport\(scope\)/);
  assert.match(share(), /<PassportDocument[\s\S]*?audience="recipient"/);
  assert.match(recipient(), /<PassportDocument[\s\S]*?audience="recipient"/);
});

test("amounts are opt-in, and a live link cannot be re-scoped", () => {
  assert.match(share(), /setAmounts\(false\)/);
  // From the ready view there is no Back into the choices.
  assert.match(share(), /onBack=\{nav\.depth && !ready \? nav\.back : undefined\}/);
});

test("the owner can share, withdraw and report from the page", () => {
  assert.match(owner(), /<ShareFlow /);
  assert.match(owner(), /<SharedLinks /);
  assert.match(owner(), /<CorrectionSheet /);
  assert.match(read("web/src/components/passport/SharedLinks.tsx"), /revokePassportShare\(share\.id\)/);
});

test("nothing on the client invents a score", () => {
  for (const source of [lib(), read("web/src/components/passport/PassportDocument.tsx")]) {
    assert.doesNotMatch(source, /\bscore\b|\brating\b|trust_score/i);
  }
});

test("the record is an overview, not every tenancy and event drawn in full", () => {
  // Owner, 2026-10-20: "every history and record is dumped". Thirteen full
  // cards and thirty-nine timeline rows made a 7,000px page.
  const doc = read("web/src/components/passport/PassportDocument.tsx");
  const css = read("web/src/styles/passport.css");

  // Homes now in full; past homes as a ledger, five before "Show all".
  assert.match(doc, /const now = tenancies\.filter\(\(row\) => row\.status !== "ended"\);/);
  assert.match(doc, /const PAST_PREVIEW = 5;/);
  assert.match(doc, /const shown = showAll \? past : past\.slice\(0, PAST_PREVIEW\);/);
  assert.match(doc, /\`Show all \$\{past\.length\} past homes\`/);
  // A row opens in place to the same record the card shows.
  assert.match(doc, /aria-expanded=\{open\} aria-controls=\{detailId\}/);
  assert.match(doc, /<TenancyRecord tenancy=\{tenancy\} action=\{action\} headless \/>/);
  // How the rent went, at a glance, on every row.
  assert.match(doc, /<PaymentsGlance payments=\{tenancy\.payments\} reviewed=\{reviewed\} \/>/);

  // The timeline: the latest six by month, the whole of it one press away.
  assert.match(doc, /const TIMELINE_PREVIEW = 6;/);
  assert.match(doc, /const shown = expanded \? matching : events\.slice\(0, TIMELINE_PREVIEW\);/);
  assert.match(doc, /<h4 className="passport-month-label">\{month\.label\}<\/h4>/);

  // The owner, the share preview and the recipient all read it this way.
  assert.match(owner(), /<HousingRecord\s+className="passport-area-record"/);
  assert.doesNotMatch(owner(), /passport\.tenancies\.map\(/);
  assert.match(doc, /\{view\.tenancies\.length \? <HousingRecord tenancies=\{view\.tenancies\} \/> : null\}/);

  // Nothing in a ledger row is cut: the period takes its own width.
  assert.match(css, /grid-template-columns: 2\.25rem minmax\(0, 1fr\) auto 7rem 1\.25rem;/);
});
