/**
 * Maps on the phone, behind Rooomly's own interface (ADR 0034).
 *
 * Android and iOS resolve `./RooomlyMap` to the native file, which draws with
 * react-native-maps; the web build resolves the stand-in beside it.
 */

export { RooomlyMap, mapAvailable } from "./RooomlyMap";
export type { LatLng, MapMarker, MapMove, RooomlyMapProps } from "./types";
