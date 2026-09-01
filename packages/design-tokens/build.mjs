#!/usr/bin/env node
/**
 * Generates platform token files from tokens.json.
 *
 * One source of truth, three outputs: CSS custom properties for Next.js, a
 * typed object for React Native, and a shared TS export. Hand-editing any
 * generated file is a drift bug, so `--check` fails CI when the outputs no
 * longer match the source.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const tokens = JSON.parse(readFileSync(resolve(here, "tokens.json"), "utf8"));
const CHECK = process.argv.includes("--check");
const BANNER = "/* Generated from packages/design-tokens/tokens.json. Do not edit by hand. */";

const isMeta = (k) => k.startsWith("$");
const valueOf = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);

/** Flattens { color: { ink: { 900: {value} } } } to [["color-ink-900", "#101A17"]] */
function flatten(node, prefix = []) {
  const out = [];
  for (const [key, val] of Object.entries(node)) {
    if (isMeta(key)) continue;
    if (val && typeof val === "object" && !("value" in val)) {
      out.push(...flatten(val, [...prefix, key]));
    } else {
      out.push([[...prefix, key].join("-"), valueOf(val)]);
    }
  }
  return out;
}

// --- CSS for the web ---------------------------------------------------------
const cssPairs = [
  ...flatten(tokens.color, ["color"]),
  ...flatten(tokens.space, ["space"]),
  ...flatten(tokens.radius, ["radius"]),
  ...flatten(tokens.border, ["border"]),
  ...flatten(tokens.motion, ["motion"]),
  ...flatten(tokens.breakpoint, ["screen"]),
  ...Object.entries(tokens.typography.family).map(([k, v]) => [`font-${k}`, valueOf(v)]),
  ...Object.entries(tokens.elevation).map(([k, v]) => [`shadow-${k}`, valueOf(v)]),
  ["target-min", valueOf(tokens.target.min)],
];

const typeClasses = Object.entries(tokens.typography.scale)
  .map(([name, s]) => {
    const family = name.startsWith("amount")
      ? "var(--font-mono)"
      : name.startsWith("display") || name.startsWith("title")
        ? "var(--font-display)"
        : "var(--font-body)";
    const numeric = name.startsWith("amount") ? "\n  font-variant-numeric: tabular-nums;" : "";
    return `.type-${name} {
  font-family: ${family};
  font-size: ${s.size};
  line-height: ${s.lineHeight};
  font-weight: ${s.weight};
  letter-spacing: ${s.tracking};${numeric}
}`;
  })
  .join("\n\n");

const css = `${BANNER}

@theme {
${cssPairs.map(([k, v]) => `  --${k}: ${v};`).join("\n")}
}

${typeClasses}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-instant: 1ms;
    --motion-duration-fast: 1ms;
    --motion-duration-base: 1ms;
    --motion-duration-slow: 1ms;
  }
}
`;

// --- TypeScript for React Native --------------------------------------------
const nested = (node) => {
  const out = {};
  for (const [key, val] of Object.entries(node)) {
    if (isMeta(key)) continue;
    out[key] =
      val && typeof val === "object" && !("value" in val) ? nested(val) : valueOf(val);
  }
  return out;
};

const theme = {
  color: nested(tokens.color),
  space: nested(tokens.space),
  radius: nested(tokens.radius),
  border: nested(tokens.border),
  motion: nested(tokens.motion),
  type: tokens.typography.scale,
  family: nested(tokens.typography.family),
  targetMin: parseInt(valueOf(tokens.target.min), 10),
};

const ts = `${BANNER}

export const theme = ${JSON.stringify(theme, null, 2)} as const;

export type Theme = typeof theme;
export type ColorName = keyof typeof theme.color;
`;

// `tracked` says whether an output is committed, and that is what decides
// whether `--check` can have an opinion about it.
//
// `dist/` is gitignored, so `dist/theme.ts` does not exist on a clean checkout
// — and `--check` treated its absence as drift, which meant the CI job could
// never pass and had been failing on every run since it was written. A file
// that is not committed cannot drift from anything; it is a build artefact, so
// `--check` builds it and says nothing.
//
// The two committed outputs are the ones drift detection is actually for: a
// generated file edited by hand, or left behind when tokens.json moved.
const outputs = [
  { path: resolve(root, "web/src/styles/tokens.css"), contents: css, tracked: true },
  {
    path: resolve(root, "packages/design-tokens/dist/theme.ts"),
    contents: ts,
    tracked: false,
  },
  { path: resolve(root, "mobile/src/theme.ts"), contents: ts, tracked: true },
];

let drift = false;
for (const { path, contents, tracked } of outputs) {
  mkdirSync(dirname(path), { recursive: true });
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === contents) continue;
  if (CHECK && tracked) {
    console.error(`Design tokens are stale: ${relative(root, path)}`);
    drift = true;
  } else {
    writeFileSync(path, contents);
    if (!CHECK) console.log(`wrote ${relative(root, path)}`);
  }
}

if (CHECK) {
  if (drift) {
    console.error("Run `make tokens` and commit the result.");
    process.exit(1);
  }
  console.log("Design tokens are up to date.");
}
