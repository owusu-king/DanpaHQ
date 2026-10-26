/**
 * Auth is a dialog over the page, not a place (owner, 2026-10-16).
 *
 * Sign in, sign-up, password reset and the welcome open from state over
 * whichever page asked; pressing Sign in never changes the address. Sign in
 * starts on Tenant, and a signed-in person lands on their dashboard — never on
 * Explore because of a remembered browsing context.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

test("pressing Sign in opens the dialog in place, without a navigation", () => {
  const dialog = code(read("src/components/auth/AuthDialog.tsx"));
  // A plain click opens the dialog; a modified click still follows the address.
  assert.match(dialog, /if \(event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey\) return;\s*event\.preventDefault\(\);\s*open\(view, params\);/);
  // Every view is a flow component held in state, remounted per switch.
  assert.match(dialog, /<Flow key=\{current\.key\} params=\{current\.params\} go=\{open\} close=\{close\} land=\{land\} \/>/);
  // Back with the dialog up takes the dialog away with the page.
  assert.match(dialog, /window\.addEventListener\("popstate", close\);/);

  // The provider sits above the chrome, so the dialog survives a landing.
  assert.match(code(read("src/components/AppShell.tsx")), /<AuthDialogProvider>\s*<ConsumerChrome/);

  // The front door, the site header, the portal gate and the 404 open it in place.
  for (const path of ["src/components/landing/FrontDoor.tsx", "src/components/SiteNav.tsx", "src/components/portal/PortalGate.tsx", "app/not-found.tsx"]) {
    const source = code(read(path));
    assert.match(source, /<AuthLink\s+view="(sign-in|register)"/, `${path} opens auth in place`);
    assert.doesNotMatch(source, /href=\{?["`]\/(sign-in|register)/, `${path} still links to an auth page`);
  }
  // A listing's save and apply, and a sale's enquiry, ask from over the page.
  assert.match(code(read("app/record/listing/page.tsx")), /openAuth\("sign-in", \{ workspace: "tenant", next \}\);/);
  assert.doesNotMatch(code(read("app/record/sale/page.tsx")), /router\.push\(`\/sign-in/);

  // Inside the dialog, the flows switch views instead of linking to pages.
  for (const flow of ["SignInFlow", "RegisterFlow", "ForgotPasswordFlow", "WelcomeFlow"]) {
    const source = code(read(`src/components/auth/flows/${flow}.tsx`));
    assert.doesNotMatch(source, /next\/link|useRouter|useSearchParams/, `${flow} navigates by address`);
  }
});

test("auth opens promptly as a centred dialog on touch devices", () => {
  const dialog = code(read("src/components/auth/AuthDialog.tsx"));
  const modal = code(read("src/components/auth/AuthModal.tsx"));
  const styles = code(read("src/styles/auth.css"));

  assert.match(dialog, /className=\{className \? `auth-trigger \$\{className\}` : "auth-trigger"\}/);
  assert.match(styles, /\.auth-trigger\s*\{\s*touch-action:\s*manipulation;/);
  assert.match(styles, /@media \(max-width: 30rem\)[\s\S]*?\.auth-layer\s*\{[\s\S]*?align-items:\s*center;/);
  assert.doesNotMatch(styles, /@media \(max-width: 30rem\)[\s\S]*?\.auth-layer\s*\{[^}]*align-items:\s*end;/);
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(styles, /\.auth-panel\s*\{[\s\S]*?max-height:\s*100%;[\s\S]*?overflow-y:\s*auto;/);
  assert.match(modal, /window\.matchMedia\("\(pointer: coarse\)"\)\.matches/);
  assert.match(modal, /tabIndex=\{-1\}/);
});

test("the old auth addresses open the dialog once, from outside", () => {
  for (const view of ["sign-in", "register", "forgot-password", "welcome"]) {
    assert.match(code(read(`app/${view}/page.tsx`)), new RegExp(`<AuthEntry view="${view}" />`));
  }
});

test("sign in starts on Tenant", () => {
  const flow = code(read("src/components/auth/flows/SignInFlow.tsx"));
  assert.match(flow, /useState<"tenant" \| "provider">\(params\.workspace \?\? "tenant"\)/);
  // The side is always sent, so what the switch shows is what the backend hears.
  assert.match(flow, /me = await chooseWorkspace\(workspace\);/);
});

test("signed in, the person lands on their dashboard unless they were mid-task", () => {
  const flow = code(read("src/components/auth/flows/SignInFlow.tsx"));
  assert.match(flow, /land\(safeNext \?\? resolveWebEntry\(me\)\);/);
  // Nothing re-routes behind the landing with a remembered context.
  assert.doesNotMatch(flow, /activeContext/);
  assert.doesNotMatch(code(read("src/components/auth/flows/WelcomeFlow.tsx")), /activeContext/);

  // A remembered "discovery" context can never turn an arrival into Explore.
  const navigation = code(read("src/lib/navigation.ts"));
  assert.match(navigation, /detailed\s*&& detailed\.type !== "discovery"/);
});
