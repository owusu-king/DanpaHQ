/**
 * Rooomly's map on a phone, in Rooomly's terms (ADR 0034).
 *
 * Screens hand the map markers to draw and an area to fit, and hear back what
 * the tenant does. Which library draws it — and which company's map — is
 * decided behind this, in `RooomlyMap`.
 */

import type { StyleProp, ViewStyle } from "react-native";

import type { GeoBounds } from "@/places";

export type LatLng = { lat: number; lng: number };
/** Where the map settled. `bounds` is what the tenant can see: the map less its insets. */
export type MapMove = { bounds: GeoBounds; zoom: number; byUser: boolean };
export type MapInsets = { top: number; right: number; bottom: number; left: number };

export type MapMarker = {
  key: string;
  position: LatLng;
  /** A price pill, a cluster disc, a stack of rentals on one point, or a
   *  property for sale — a gold pill, so it never reads as a month's rent. */
  kind: "price" | "cluster" | "stack" | "sale";
  /** "₵850", "12", "from ₵900". */
  label: string;
  count?: number;
  selected: boolean;
  visited: boolean;
  accessibilityLabel: string;
};

export type RooomlyMapProps = {
  initialView: { lat: number; lng: number; zoom: number };
  /** An area to fit; a new `key` fits again, the same key never refits. */
  fit: { key: string; bounds: GeoBounds } | null;
  /** How far the screen covers the map at each edge. Fits land in what is left, and the map's logo stays in sight. */
  insets: MapInsets;
  markers: MapMarker[];
  onMove: (move: MapMove) => void;
  onMarkerPress: (key: string) => void;
  onBackgroundPress: () => void;
  style?: StyleProp<ViewStyle>;
};
