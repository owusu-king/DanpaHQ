import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * MapLibre's web worker, served from the installed package.
 *
 * MapLibre 6 finds its worker beside its own module through `import.meta.url`,
 * which webpack rewrites to a `file://` path no browser will load. So the map is
 * told where the worker is (`setWorkerUrl`), and the two modules it needs are
 * served here straight from `node_modules` — never copied into the repository,
 * so they cannot drift from the version the page itself was bundled with.
 *
 * An allow-list, not a directory: nothing else under `node_modules` is reachable.
 */
const FILES = new Set(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]);

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (!FILES.has(file)) return new Response("Not found", { status: 404 });

  const body = await readFile(path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", file));
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
