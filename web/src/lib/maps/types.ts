/**
 * Rooomly's map, in Rooomly's terms (ADR 0034).
 *
 * Components draw through this interface — a map, markers made of our own
 * HTML, an area, and what the tenant does — and never through a mapping library.
 * The provider behind it lives in one folder beside this file.
 */

import type { GeoBounds } from "@/lib/places";

export type LatLng = { lat: number; lng: number };
export type MapPadding = { top: number; right: number; bottom: number; left: number };
export type MapMove = { bounds: GeoBounds; zoom: number; byUser: boolean };

export type MapOptions = {
  center: LatLng;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  /** How far the map may be moved: around Ghana, not the whole world. */
  limits: GeoBounds;
  /** "greedy" when the map is the page's subject; "cooperative" inside a page that scrolls. */
  gestures: "greedy" | "cooperative";
};

export type MarkerOptions = {
  position: LatLng;
  /** The marker's own HTML, styled by Rooomly's CSS. */
  element: HTMLElement;
  /** Where the element sits on its point: by its bottom edge, or by its centre. */
  anchor: "bottom" | "center";
  zIndex?: number;
  /** The accessible name of a marker that can be chosen. */
  title?: string;
  /** Given a click, the marker is keyboard-reachable too. */
  onClick?: () => void;
};

export interface MapMarker {
  setPosition(position: LatLng): void;
  setTitle(title: string): void;
  setZIndex(zIndex: number): void;
  setPressed(pressed: boolean): void;
  remove(): void;
}

export type AreaOptions = {
  center: LatLng;
  radiusMeters: number;
  color: string;
  fillOpacity: number;
  /** A dashed edge says the area is looser than it looks. */
  dashed: boolean;
};

export interface MapShape {
  remove(): void;
}

export interface RooomlyMap {
  fitBounds(bounds: GeoBounds, options: { padding: MapPadding; maxZoom?: number }): void;
  panBy(dx: number, dy: number): void;
  addMarker(options: MarkerOptions): MapMarker;
  addArea(options: AreaOptions): MapShape;
  /** After each move settles: where the map is, and whether the tenant moved it. */
  onMove(listener: (move: MapMove) => void): () => void;
  /** A tap on the map itself — not on a marker, nor anything drawn as one. */
  onBackgroundClick(listener: () => void): () => void;
  destroy(): void;
}

export type MapUnavailableReason = "not_configured" | "failed_to_load" | "rejected";

/** Why there is no map: nothing to configure it with, a load that failed, or a refused key. */
export class MapUnavailable extends Error {
  readonly reason: MapUnavailableReason;

  constructor(reason: MapUnavailableReason) {
    super(`The map is unavailable (${reason}).`);
    this.name = "MapUnavailable";
    this.reason = reason;
  }
}
