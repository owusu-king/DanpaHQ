import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Navigation intent starts a screen's reads before the click.
 *
 * The prefetched responses are only safe to hand to a screen because they are
 * short-lived, used once, tied to the session that made them and discarded by
 * any change. And they are only useful if the screen asks for exactly the same
 * paths, which is why each route's prefetch must call the loaders that route's
 * own code calls.
 */

const web = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(web, path), "utf8");

test("prefetched reads are short-lived, single-use, per session and dropped by any change", () => {
  const auth = read("src/lib/auth.ts");
  assert.match(auth, /if \(method !== "GET"\) \{\s*\/\/[^\n]*\n\s*prefetched\.clear\(\);/);
  const ttl = Number(auth.match(/PREFETCH_TTL_MS = ([\d_]+);/)?.[1].replace(/_/g, ""));
  assert.ok(ttl > 0 && ttl <= 10_000, `prefetch lifetime ${ttl}ms`);
  assert.match(auth, /entry\.generation === generation/);
  assert.match(auth, /prefetched\.delete\(key\);/);
  assert.match(auth, /if \(sessionEnded\(\)\) return;/);
});

test("the portal navigation prefetches on hover, focus and touch", () => {
  const shell = read("src/components/portal/PortalShell.tsx");
  for (const event of ["onPointerEnter", "onFocus", "onTouchStart"]) {
    assert.match(shell, new RegExp(`${event}=\\{\\(\\) => prefetchProviderRoute\\(item\\.href, activeContext\\)\\}`));
  }
});

// Where each route's mount-time reads are written.
const ROUTE_SOURCES = {
  "/home": ["app/home/page.tsx"],
  "/properties": ["app/properties/page.tsx"],
  "/units": ["app/units/page.tsx"],
  "/tenants": ["app/tenants/page.tsx"],
  "/documents": ["src/components/documents/ContractsView.tsx"],
  "/payments": ["app/payments/page.tsx"],
  "/applications": ["src/lib/useProviderRequests.ts"],
  "/viewings": ["app/viewings/page.tsx"],
  "/maintenance": ["app/maintenance/page.tsx"],
  "/updates": ["app/updates/page.tsx"],
};

test("each route's prefetch calls the loaders that route itself calls", () => {
  const prefetch = read("src/lib/routePrefetch.ts");
  const block = prefetch.slice(prefetch.indexOf("const PROVIDER_READS"), prefetch.indexOf("const recent"));
  const entries = [...block.matchAll(/"(\/[\w-]+)": \(([^)]*)\) => ([\s\S]*?)(?=,\n  "\/|,\n\};)/g)];
  assert.ok(entries.length >= Object.keys(ROUTE_SOURCES).length, "every provider route is mapped");
  for (const [, route, , body] of entries) {
    const sources = ROUTE_SOURCES[route];
    assert.ok(sources, `${route} names where its reads are written`);
    const text = sources.map(read).join("\n");
    for (const [, loader] of body.matchAll(/void (\w+)\(/g)) {
      assert.match(text, new RegExp(`\\b${loader}\\(`), `${route} prefetches ${loader}, which the route does not call`);
    }
  }
});
