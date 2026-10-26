/* query-string 7 uses CommonJS; the patched decoder exports an ES module.
 * Keep the upstream decoder intact and normalize its default export for Node
 * 22 and Metro. Remove this bridge when Expo Router upgrades query-string.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const fromRouter = createRequire(require.resolve("expo-router/package.json"));
const entry = fromRouter.resolve("query-string");
const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), "package.json"), "utf8"));
if (metadata.version !== "7.1.3") {
  throw new Error("Review the decoder compatibility bridge before changing query-string.");
}
const original = "const decodeComponent = require('decode-uri-component');";
const replacement = "const decodeComponentModule = require('decode-uri-component');\nconst decodeComponent = decodeComponentModule.default ?? decodeComponentModule;";
const source = fs.readFileSync(entry, "utf8");
if (source.includes(original)) {
  fs.writeFileSync(entry, source.replace(original, replacement));
} else if (!source.includes(replacement)) {
  throw new Error("Unexpected query-string source; refusing an unverified compatibility patch.");
}

const parsed = fromRouter("query-string").parse("name=Danpa+HQ&place=Osu%20Accra");
if (parsed.name !== "Danpa HQ" || parsed.place !== "Osu Accra") {
  throw new Error("The patched decoder failed the navigation compatibility check.");
}
