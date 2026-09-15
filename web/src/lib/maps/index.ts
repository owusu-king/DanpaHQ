/**
 * Maps, behind Rooomly's own interface (ADR 0034).
 *
 * Components ask for a `RooomlyMap` and draw markers, areas and previews
 * through it. Which company draws the map is decided here, and only `./google`
 * knows it is Google — another provider is another folder and a change to this
 * file, and nothing that renders Explore or a listing moves.
 */

import { googleMapsConfigured, googleMapsSetupHint } from "./google/config";
import { onGoogleMapsRefused } from "./google/loader";
import { createGoogleMap } from "./google/map";
import type { MapOptions, RooomlyMap } from "./types";

export * from "./types";

/** Whether this build can draw a map at all. Without a key it cannot, and the page says so. */
export function mapsConfigured(): boolean {
  return googleMapsConfigured();
}

/** In a development build without a map, the setting that would draw one; otherwise nothing. */
export function mapSetupHint(): string | null {
  return googleMapsSetupHint();
}

export function createMap(container: HTMLElement, options: MapOptions): Promise<RooomlyMap> {
  return createGoogleMap(container, options);
}

/** Called when the provider refuses this site's key after the map has loaded. */
export function onMapRefused(listener: () => void): () => void {
  return onGoogleMapsRefused(listener);
}
