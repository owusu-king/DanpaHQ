/* Source maps stay in the ignored export directory. This guard checks module
 * reachability; it does not waive the outstanding build-tool advisories. */
const fs = require("node:fs");
const path = require("node:path");

const roots = process.argv.slice(2);
if (!roots.length) throw new Error("Pass the native export directories to inspect.");

for (const root of roots) {
  const maps = [];
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, item.name);
      if (item.isDirectory()) walk(target);
      else if (item.name.endsWith(".map")) maps.push(target);
    }
  }
  walk(root);
  if (!maps.length) throw new Error(`No release source maps found in ${root}.`);
  const sources = maps.flatMap(file => JSON.parse(fs.readFileSync(file, "utf8")).sources)
    .map(source => source.replaceAll("\\", "/"));
  if (!sources.some(source => source.includes("/node_modules/decode-uri-component/"))) {
    throw new Error("The decoder was not found; review the export before trusting this check.");
  }
  const forbidden = sources.filter(source =>
    /\/node_modules\/(?:node-forge|zod|@expo\/code-signing-certificates|@expo\/cli)\//.test(source)
    // Expo uses this small module loader in native apps; it is not the CLI's
    // certificate processing or schema-validation code.
    && !source.endsWith("/node_modules/@expo/cli/build/metro-require/require.js"));
  if (forbidden.length) throw new Error(`Unexpected tooling in release bundle:\n${forbidden.join("\n")}`);
  process.stdout.write(`${root}: ${sources.length} modules; affected CLI dependencies absent.\n`);
}
