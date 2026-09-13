"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { compactRent, type MapClusterFeature, type MapFeature, type MapListingFeature } from "@/lib/mapSearch";
import type { GeoBounds, MapConfig } from "@/lib/places";

import { prepareMapLibre } from "./maplibreSetup";
import { rooomlyMapStyle } from "./mapStyle";

/**
 * The Explore map: Rooomly's basemap, price markers and the preview they open.
 *
 * It owns no search. It is given the features to draw and the area to fit, and
 * it reports what the tenant does — moves, taps a marker, taps the ground — so
 * the one search state stays with Explore and the map cannot drift from it.
 *
 * Markers are real buttons, not symbols painted into the canvas: a keyboard can
 * reach them, a screen reader can name them, and their states are CSS. The
 * server caps how many there are, which is what makes that affordable.
 */

export type MapMove = { bounds: GeoBounds; zoom: number; byUser: boolean };
export type MapSelection = { key: string; ids: string[] } | null;

/** Clear of a price marker and its tail, whichever side the popup opens on. */
const PREVIEW_OFFSET = {
  center: [0, -22],
  top: [0, 10],
  "top-left": [8, 10],
  "top-right": [-8, 10],
  bottom: [0, -42],
  "bottom-left": [8, -42],
  "bottom-right": [-8, -42],
  left: [20, -18],
  right: [-20, -18],
} satisfies Record<string, [number, number]>;

const currency = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  maximumFractionDigits: 0,
});

export function markerKey(feature: MapFeature): string {
  return feature.type === "listing" ? `listing:${feature.id}` : `cluster:${feature.key}`;
}

function describe(feature: MapFeature): string {
  if (feature.type === "listing") {
    const rent = feature.rent_minor === null ? "Rent not stated" : currency.format(feature.rent_minor / 100);
    const period = feature.rent_period === "yearly" ? "a year" : "a month";
    return `${rent} ${period}. Approximate location. Show this rental.`;
  }
  const from = feature.min_rent_minor === null ? "" : `, from ${currency.format(feature.min_rent_minor / 100)}`;
  return feature.stacked
    ? `${feature.count} rentals at this spot${from}. Show them.`
    : `${feature.count} rentals nearby${from}. Zoom in to see them.`;
}

function paint(element: HTMLButtonElement, feature: MapFeature) {
  element.type = "button";
  element.setAttribute("aria-label", describe(feature));
  if (feature.type === "listing") {
    element.className = "explore-marker explore-price-marker";
    element.textContent = compactRent(feature.rent_minor, feature.rent_period);
    return;
  }
  element.className = `explore-marker explore-cluster-marker${feature.stacked ? " is-stack" : ""}`;
  element.dataset.size = feature.count >= 100 ? "l" : feature.count >= 10 ? "m" : "s";
  element.replaceChildren();
  const count = document.createElement("span");
  count.className = "explore-cluster-count";
  count.textContent = feature.count > 999 ? "999+" : String(feature.count);
  element.append(count);
  if (feature.stacked) {
    const from = document.createElement("span");
    from.className = "explore-cluster-from";
    from.textContent = `from ${compactRent(feature.min_rent_minor)}`;
    element.append(from);
  }
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ExploreMap({
  config,
  features,
  fit,
  padding,
  selection,
  hoveredId,
  visited,
  preview,
  previewAt,
  onMove,
  onSelectListing,
  onSelectCluster,
  onBackgroundClick,
  onFailure,
}: {
  config: MapConfig;
  features: MapFeature[];
  /** An area to fit; a new `key` fits again, the same key never refits. */
  fit: { key: string; bounds: GeoBounds; maxZoom?: number } | null;
  padding: { top: number; right: number; bottom: number; left: number };
  selection: MapSelection;
  hoveredId: string | null;
  visited: ReadonlySet<string>;
  /** Rendered in a popup anchored above the selected marker, when given a position. */
  preview: ReactNode;
  previewAt: { lat: number; lng: number } | null;
  onMove: (move: MapMove) => void;
  onSelectListing: (feature: MapListingFeature) => void;
  onSelectCluster: (feature: MapClusterFeature) => void;
  onBackgroundClick: () => void;
  onFailure: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; element: HTMLButtonElement; feature: MapFeature }>());
  const popup = useRef<Popup | null>(null);
  const [popupNode] = useState(() => (typeof document === "undefined" ? null : document.createElement("div")));
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Callbacks change every render; the map's listeners are bound once and read
  // these. Refreshed after each render, never during it — the listeners only
  // fire once the map exists, which is after the first commit.
  const latest = useRef({ onMove, onSelectListing, onSelectCluster, onBackgroundClick, onFailure });
  useEffect(() => {
    latest.current = { onMove, onSelectListing, onSelectCluster, onBackgroundClick, onFailure };
  });

  useEffect(() => {
    if (!container.current) return;
    prepareMapLibre();
    const [west, south, east, north] = config.bounds;
    const map = new MapLibreMap({
      container: container.current,
      style: rooomlyMapStyle(config),
      center: [config.default_view.lng, config.default_view.lat],
      zoom: config.default_view.zoom,
      minZoom: config.min_zoom,
      maxZoom: config.max_zoom,
      maxBounds: [[west - 1, south - 1], [east + 1, north + 1]],
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      fadeDuration: reducedMotion() ? 0 : 150,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new AttributionControl({ compact: true, customAttribution: config.attribution }), "bottom-left");

    let loaded = false;
    map.on("load", () => {
      loaded = true;
      setReady(true);
    });
    map.on("error", (event) => {
      // A missing tile is a gap; a basemap that never loads is a failure worth saying.
      if (loaded) return;
      console.warn("Map failed to load", event.error);
      setFailed(true);
      latest.current.onFailure();
    });
    map.on("moveend", (event) => {
      const box = map.getBounds();
      latest.current.onMove({
        bounds: { west: box.getWest(), south: box.getSouth(), east: box.getEast(), north: box.getNorth() },
        zoom: map.getZoom(),
        byUser: Boolean((event as { originalEvent?: unknown }).originalEvent),
      });
    });
    map.on("click", (event) => {
      const target = event.originalEvent?.target as Element | null;
      if (target?.closest(".explore-marker, .explore-preview-popup")) return;
      latest.current.onBackgroundClick();
    });

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    mapRef.current = map;
    const markerMap = markers.current;

    return () => {
      resize.disconnect();
      for (const entry of markerMap.values()) entry.marker.remove();
      markerMap.clear();
      popup.current?.remove();
      popup.current = null;
      map.remove();
      mapRef.current = null;
    };
    // The map is created once per config; everything else is applied below.
  }, [config]);

  // Draw the features, reusing a marker whose identity has not changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const wanted = new Set<string>();
    for (const feature of features) {
      const key = markerKey(feature);
      wanted.add(key);
      const existing = markers.current.get(key);
      if (existing) {
        existing.feature = feature;
        paint(existing.element, feature);
        existing.marker.setLngLat([feature.lng, feature.lat]);
        continue;
      }
      const element = document.createElement("button");
      element.dataset.key = key;
      paint(element, feature);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const current = markers.current.get(key)?.feature;
        if (!current) return;
        if (current.type === "listing") latest.current.onSelectListing(current);
        else latest.current.onSelectCluster(current);
      });
      const marker = new Marker({ element, anchor: feature.type === "listing" ? "bottom" : "center" })
        .setLngLat([feature.lng, feature.lat])
        .addTo(map);
      markers.current.set(key, { marker, element, feature });
    }
    for (const [key, entry] of markers.current) {
      if (wanted.has(key)) continue;
      entry.marker.remove();
      markers.current.delete(key);
    }
  }, [features, ready]);

  // Selected, hovered and visited are classes, so the transitions are CSS's.
  useEffect(() => {
    for (const [key, entry] of markers.current) {
      const ids = entry.feature.type === "listing" ? [entry.feature.id] : entry.feature.ids ?? [];
      const selected = selection !== null && (selection.key === key || (entry.feature.type === "listing" && selection.ids.includes(entry.feature.id)));
      entry.element.classList.toggle("is-selected", selected);
      entry.element.classList.toggle("is-hovered", !selected && hoveredId !== null && ids.includes(hoveredId));
      entry.element.classList.toggle("is-visited", !selected && ids.length > 0 && ids.every((id) => visited.has(id)));
      entry.element.setAttribute("aria-pressed", String(selected));
    }
  }, [selection, hoveredId, visited, features]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fit) return;
    map.fitBounds(
      [[fit.bounds.west, fit.bounds.south], [fit.bounds.east, fit.bounds.north]],
      { padding, maxZoom: fit.maxZoom ?? 15, duration: reducedMotion() ? 0 : 650 },
    );
    // Fit only when the area changes, never because padding was recomputed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.key, ready]);

  // The preview rides a popup above its marker, and the map moves only as far
  // as it must to show the whole card — never re-centring on every tap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !popupNode) return;
    if (!previewAt) {
      popup.current?.remove();
      popup.current = null;
      return;
    }
    if (!popup.current) {
      popup.current = new Popup({
        closeButton: false,
        closeOnClick: false,
        closeOnMove: false,
        focusAfterOpen: false,
        maxWidth: "none",
        offset: PREVIEW_OFFSET,
        className: "explore-preview-popup",
      }).setDOMContent(popupNode);
    }
    popup.current.setLngLat([previewAt.lng, previewAt.lat]).addTo(map);
    const frame = requestAnimationFrame(() => {
      const card = popup.current?.getElement()?.getBoundingClientRect();
      const frameBox = container.current?.getBoundingClientRect();
      if (!card || !frameBox) return;
      const margin = 16;
      const dx = card.left < frameBox.left + margin
        ? card.left - frameBox.left - margin
        : card.right > frameBox.right - margin ? card.right - frameBox.right + margin : 0;
      const dy = card.top < frameBox.top + padding.top
        ? card.top - frameBox.top - padding.top
        : card.bottom > frameBox.bottom - margin ? card.bottom - frameBox.bottom + margin : 0;
      if (dx || dy) map.panBy([dx, dy], { duration: reducedMotion() ? 0 : 300 });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAt?.lat, previewAt?.lng, ready, popupNode]);

  return (
    <div className="explore-map-frame">
      <div ref={container} className="explore-map-canvas" role="region" aria-label="Map of rentals" />
      {!ready && !failed ? <div className="explore-map-loading" aria-hidden="true" /> : null}
      {failed ? (
        <div className="explore-map-failed" role="status">
          <strong>The map could not load right now.</strong>
          <span>Your search is unchanged, and the rentals are still listed.</span>
        </div>
      ) : null}
      {popupNode && previewAt && preview ? createPortal(preview, popupNode) : null}
    </div>
  );
}
