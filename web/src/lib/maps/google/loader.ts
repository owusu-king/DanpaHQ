import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

import { MapUnavailable } from "../types";
import { GOOGLE_MAPS_KEY, googleMapsConfigured } from "./config";

export type GoogleLibraries = {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
  core: google.maps.CoreLibrary;
};

declare global {
  interface Window {
    /** Called by the Maps JavaScript API when it refuses this site's key. */
    gm_authFailure?: () => void;
  }
}

let loading: Promise<GoogleLibraries> | null = null;
let refused = false;
const refusalListeners = new Set<() => void>();

/**
 * The Maps JavaScript API, loaded once per page with only the libraries the
 * maps use. A failed load stays failed for the page: the loader takes its
 * options once, and a refused key would only be refused again.
 */
export function loadGoogleMaps(): Promise<GoogleLibraries> {
  if (!googleMapsConfigured()) return Promise.reject(new MapUnavailable("not_configured"));
  if (refused) return Promise.reject(new MapUnavailable("rejected"));
  loading ??= (async () => {
    window.gm_authFailure = () => {
      refused = true;
      for (const listener of refusalListeners) listener();
    };
    setOptions({ key: GOOGLE_MAPS_KEY, v: "weekly", language: "en", region: "GH" });
    const [maps, marker, core] = await Promise.all([
      importLibrary("maps"),
      importLibrary("marker"),
      importLibrary("core"),
    ]);
    return { maps, marker, core };
  })().catch((cause: unknown) => {
    console.warn("Google Maps could not load", cause);
    throw new MapUnavailable("failed_to_load");
  });
  return loading;
}

/**
 * A key refused after loading — a referrer not allowed, an API not enabled —
 * otherwise shows as a darkened map stamped "for development purposes only".
 */
export function onGoogleMapsRefused(listener: () => void): () => void {
  refusalListeners.add(listener);
  if (refused) queueMicrotask(listener);
  return () => {
    refusalListeners.delete(listener);
  };
}
