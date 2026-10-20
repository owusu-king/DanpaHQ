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
