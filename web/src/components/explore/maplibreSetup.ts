import { addProtocol, setWorkerUrl } from "maplibre-gl";
import { Protocol } from "pmtiles";

let prepared = false;

/**
 * MapLibre's worker and the PMTiles protocol, once per page, for every map.
 *
 * Webpack turns MapLibre's own `import.meta.url` worker lookup into a file://
 * path no browser loads, so the worker is served by
 * `app/maplibre/[file]/route.ts` and named here. The basemap is a PMTiles
 * archive read by range request, which is what the protocol does.
 */
export function prepareMapLibre() {
  if (prepared || typeof window === "undefined") return;
  setWorkerUrl(new URL("/maplibre/maplibre-gl-worker.mjs", window.location.origin).href);
  addProtocol("pmtiles", new Protocol().tile);
  prepared = true;
}
