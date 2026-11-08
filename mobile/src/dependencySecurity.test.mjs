import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const require = createRequire(import.meta.url);
const fromRouter = createRequire(require.resolve("expo-router/package.json"));
const fromCli = createRequire(require.resolve("@expo/cli/package.json"));
const query = fromRouter("query-string");

test("patched Expo tooling preserves plugin input and output validation", () => {
  const { PluginSchema, DevToolsPluginOutputSchema } = fromCli("./build/src/start/server/devtools/DevToolsPlugin.schema.js");
  const { createMCPDevToolsExtensionSchema } = fromCli("./build/src/start/server/mcp/createMCPDevToolsExtensionSchema.js");
  const { validate } = fromCli("@expo/schema-utils");
  const { z } = fromCli("zod");
  const plugin = {
    packageName: "test-plugin", packageRoot: "/test-plugin",
    cliExtensions: { description: "Test commands", entryPoint: "commands.js", commands: [
      { name: "inspect", title: "Inspect", environments: ["mcp"], parameters: [
        { name: "count", type: "number" }, { name: "confirmed", type: "confirm" },
      ] },
    ] },
  };
  validate(PluginSchema, plugin);
  const schema = createMCPDevToolsExtensionSchema(plugin, z);
  assert.equal(schema.safeParse({ command: "inspect", count: 2, confirmed: false }).success, true);
  for (const input of [
    { command: "unknown" }, { command: "inspect", count: "2" },
    { command: "inspect", confirmed: "yes" }, { command: "inspect", extra: "unexpected" },
  ]) assert.equal(schema.safeParse(input).success, false);
  assert.throws(() => validate(PluginSchema, { packageName: "", packageRoot: "/test" }));
  assert.doesNotThrow(() => validate(DevToolsPluginOutputSchema, [{ type: "text", text: "Done", level: "info" }]));
  assert.throws(() => validate(DevToolsPluginOutputSchema, [{ type: "image", url: "invalid" }]));
});

test("oversized constrained collections cannot exhaust Expo tooling memory", () => {
  const source = `const { z } = require(${JSON.stringify(fromCli.resolve("zod"))});
    const result = z.array(z.string()).max(10).safeParse(Array(1000000).fill(null));
    if (result.success) process.exit(1);`;
  const child = spawnSync(process.execPath, ["--max-old-space-size=64", "-e", source], {
    timeout: 5000, encoding: "utf8",
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test("the patched decoder preserves navigation query values and encoded delimiters", () => {
  const parsed = query.parse("name=Danpa+HQ&area=Osu%20Accra&label=%E2%82%B5&return=%2Frentals%3Fmode%3Dbuy&plus=%2B");
  assert.equal(parsed.name, "Danpa HQ");
  assert.equal(parsed.area, "Osu Accra");
  assert.equal(parsed.label, "₵");
  assert.equal(parsed.return, "/rentals?mode=buy");
  assert.equal(parsed.plus, "+");
  assert.deepEqual(query.parse("tag=water&tag=power").tag, ["water", "power"]);
  assert.equal(query.stringify({ next: "/artisan" }), "next=%2Fartisan");
});

test("malformed percent-encoded navigation input cannot hang the decoder", () => {
  const source = `const q = require(${JSON.stringify(fromRouter.resolve("query-string"))});
    const value = q.parse('area=' + '%E0%A4'.repeat(10000)).area;
    if (typeof value !== 'string') process.exit(1);`;
  const child = spawnSync(process.execPath, ["-e", source], { timeout: 5000, encoding: "utf8" });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});
