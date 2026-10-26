import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(web, path), "utf8");

/** Every address the app serves, from its `page.tsx` files. */
function routes() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "page.tsx") {
        const folder = relative(join(web, "app"), dir).split(sep).filter((part) => part && !part.startsWith("("));
        found.push(`/${folder.join("/")}`);
      }
    }
  };
  walk(join(web, "app"));
  return found;
}

test("every page names itself in the browser tab", () => {
  // A route left out of the table shows the brand alone, which is the old
  // problem — a row of tabs that all say the same thing.
  const table = read("src/lib/pageTitles.ts");
  const named = new Set([...table.matchAll(/^\s+"(\/[^"]*)": "[^"]+",$/gm)].map((match) => match[1]));
  const missing = routes().filter((route) => !named.has(route));
  assert.deepEqual(missing, [], `name these pages in src/lib/pageTitles.ts: ${missing.join(", ")}`);
});

test("one title, from one place, in the form 'Home | DanpaHQ'", () => {
  const layout = read("app/layout.tsx");
  // A title in metadata would be a second, page-blind <title> in the head.
  assert.doesNotMatch(layout.slice(layout.indexOf("export const metadata"), layout.indexOf("export const viewport")), /title:/);
  assert.match(layout, /<PageTitleProvider>\s*<AppShell>\{children\}<\/AppShell>\s*<\/PageTitleProvider>/);
  assert.match(read("src/lib/pageTitles.ts"), /return name \? `\$\{name\} \| \$\{brand\}` : brand;/);
  assert.match(read("src/lib/pageTitles.ts"), /export const BRAND = "DanpaHQ";/);
  // Pages name a record through the hook, never by writing document.title.
  for (const route of routes()) {
    const folder = route === "/" ? "app" : `app${route}`;
    assert.doesNotMatch(read(`${folder}/page.tsx`), /document\.title\s*=/, `${route} writes document.title`);
  }
});
