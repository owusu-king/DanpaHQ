/**
 * Maps on the phone, behind Danpa HQ's own interface (ADR 0034).
 *
 * Android and iOS resolve `./DanpaHQMap` to the native file, which draws with
 * a Leaflet WebView; the web build resolves the stand-in beside it.
 */

export { DanpaHQMap, mapAvailable } from "./DanpaHQMap";
export type { BaseMapStyle, LatLng, MapMarker, MapMove, DanpaHQMapProps } from "./types";
