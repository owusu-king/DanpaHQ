"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  createMap,
  onMapRefused,
  type MapMarker,
  type MapMove,
  type MapPadding,
  type RooomlyMap,
} from "@/lib/maps";
import { compactRent, type MapClusterFeature, type MapFeature, type MapListingFeature } from "@/lib/mapSearch";
import type { GeoBounds, MapConfig } from "@/lib/places";

/**
 * The Explore map: price markers and the preview they open.
 *
 * It owns no search. It is given the features to draw and the area to fit, and
 * it reports what the tenant does — moves, taps a marker, taps the ground — so
 * the one search state stays with Explore and the map cannot drift from it. It
 * draws through `@/lib/maps` and never touches a mapping library itself.
 *
 * Markers are Rooomly's own HTML whose states are CSS classes; the map makes
 * each one keyboard-reachable and names it for a screen reader. The server caps
 * how many there are, which is what makes that affordable.
 */

export type { MapMove };
export type MapSelection = { key: string; ids: string[] } | null;

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

function paint(element: HTMLElement, feature: MapFeature) {
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

function previewAnchor(): HTMLDivElement {
  const node = document.createElement("div");
  node.className = "explore-preview-anchor";
  return node;
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
  padding: MapPadding;
  selection: MapSelection;
  hoveredId: string | null;
  visited: ReadonlySet<string>;
  /** Drawn above the selected marker, when given a position. */
  preview: ReactNode;
  previewAt: { lat: number; lng: number } | null;
  onMove: (move: MapMove) => void;
  onSelectListing: (feature: MapListingFeature) => void;
  onSelectCluster: (feature: MapClusterFeature) => void;
  onBackgroundClick: () => void;
  onFailure: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<RooomlyMap | null>(null);
  const markers = useRef(new Map<string, { marker: MapMarker; element: HTMLElement; feature: MapFeature }>());
  const previewPin = useRef<MapMarker | null>(null);
  const [previewNode] = useState(() => (typeof document === "undefined" ? null : previewAnchor()));
  // Counts maps made, so drawing follows a map that arrived after the features.
  const [mapped, setMapped] = useState(0);
  const [failed, setFailed] = useState(false);

  // Callbacks change every render; the map's listeners are bound once and read
  // these. Refreshed after each render, never during it.
  const latest = useRef({ onMove, onSelectListing, onSelectCluster, onBackgroundClick, onFailure });
  useEffect(() => {
    latest.current = { onMove, onSelectListing, onSelectCluster, onBackgroundClick, onFailure };
  });

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cancelled = false;
    let created: RooomlyMap | null = null;
    const unsubscribe: Array<() => void> = [];
    const fail = () => {
      if (cancelled) return;
      setFailed(true);
      latest.current.onFailure();
    };
    const [west, south, east, north] = config.bounds;

    createMap(element, {
      center: { lat: config.default_view.lat, lng: config.default_view.lng },
      zoom: config.default_view.zoom,
      minZoom: config.min_zoom,
      maxZoom: config.max_zoom,
      limits: { west: west - 1, south: south - 1, east: east + 1, north: north + 1 },
      gestures: "greedy",
    })
      .then((map) => {
        if (cancelled) {
          map.destroy();
          return;
        }
        created = map;
        mapRef.current = map;
        unsubscribe.push(map.onMove((move) => latest.current.onMove(move)));
        unsubscribe.push(map.onBackgroundClick(() => latest.current.onBackgroundClick()));
        setMapped((count) => count + 1);
      })
      .catch((cause: unknown) => {
        console.warn("The map could not load", cause);
        fail();
      });
    unsubscribe.push(onMapRefused(fail));

    const markerMap = markers.current;
    return () => {
      cancelled = true;
      for (const stop of unsubscribe) stop();
      for (const entry of markerMap.values()) entry.marker.remove();
      markerMap.clear();
      previewPin.current?.remove();
      previewPin.current = null;
      created?.destroy();
      mapRef.current = null;
    };
  }, [config]);

  // Draw the features, reusing a marker whose identity has not changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapped) return;
    const wanted = new Set<string>();
    for (const feature of features) {
      const key = markerKey(feature);
      wanted.add(key);
      const existing = markers.current.get(key);
      if (existing) {
        existing.feature = feature;
        paint(existing.element, feature);
        existing.marker.setPosition({ lat: feature.lat, lng: feature.lng });
        existing.marker.setTitle(describe(feature));
        continue;
      }
      const element = document.createElement("span");
      element.dataset.key = key;
      paint(element, feature);
      const marker = map.addMarker({
        position: { lat: feature.lat, lng: feature.lng },
        element,
        anchor: feature.type === "listing" ? "bottom" : "center",
        title: describe(feature),
        onClick: () => {
          const current = markers.current.get(key)?.feature;
          if (!current) return;
          if (current.type === "listing") latest.current.onSelectListing(current);
          else latest.current.onSelectCluster(current);
        },
      });
      markers.current.set(key, { marker, element, feature });
    }
    for (const [key, entry] of markers.current) {
      if (wanted.has(key)) continue;
      entry.marker.remove();
      markers.current.delete(key);
    }
  }, [features, mapped]);

  // Selected, hovered and visited are classes, so the transitions are CSS's.
  useEffect(() => {
    for (const [key, entry] of markers.current) {
      const ids = entry.feature.type === "listing" ? [entry.feature.id] : entry.feature.ids ?? [];
      const selected = selection !== null && (selection.key === key || (entry.feature.type === "listing" && selection.ids.includes(entry.feature.id)));
      const hovered = !selected && hoveredId !== null && ids.includes(hoveredId);
      entry.element.classList.toggle("is-selected", selected);
      entry.element.classList.toggle("is-hovered", hovered);
      entry.element.classList.toggle("is-visited", !selected && ids.length > 0 && ids.every((id) => visited.has(id)));
      entry.marker.setPressed(selected);
      entry.marker.setZIndex(selected ? 3 : hovered ? 2 : 1);
    }
  }, [selection, hoveredId, visited, features, mapped]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapped || !fit) return;
    map.fitBounds(fit.bounds, { padding, maxZoom: fit.maxZoom ?? 15 });
    // Fit only when the area changes, never because padding was recomputed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.key, mapped]);

  // The preview rides the map above its marker, and the map moves only as far
  // as it must to show the whole card — never re-centring on every tap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapped || !previewNode) return;
    previewPin.current?.remove();
    previewPin.current = null;
    if (!previewAt) return;
    previewPin.current = map.addMarker({ position: previewAt, element: previewNode, anchor: "bottom", zIndex: 1000 });
    const frame = requestAnimationFrame(() => {
      const card = previewNode.getBoundingClientRect();
      const frameBox = container.current?.getBoundingClientRect();
      if (!frameBox || !card.width) return;
      const margin = 16;
      const dx = card.left < frameBox.left + margin
        ? card.left - frameBox.left - margin
        : card.right > frameBox.right - margin ? card.right - frameBox.right + margin : 0;
      const dy = card.top < frameBox.top + padding.top
        ? card.top - frameBox.top - padding.top
        : card.bottom > frameBox.bottom - margin ? card.bottom - frameBox.bottom + margin : 0;
      if (dx || dy) map.panBy(dx, dy);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAt?.lat, previewAt?.lng, mapped, previewNode]);

  return (
    <div className="explore-map-frame">
      <div ref={container} className="explore-map-canvas" role="region" aria-label="Map of rentals" />
      {!mapped && !failed ? <div className="explore-map-loading" aria-hidden="true" /> : null}
      {failed ? (
        <div className="explore-map-failed" role="status">
          <strong>The map could not load right now.</strong>
          <span>Your search is unchanged, and the rentals are still listed.</span>
        </div>
      ) : null}
      {previewNode && previewAt && preview ? createPortal(preview, previewNode) : null}
    </div>
  );
}
