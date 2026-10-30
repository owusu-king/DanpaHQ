import "leaflet/dist/leaflet.css";
import "./map.css";
import { getMapConfig } from "../../places";
import { reportMapUnavailable } from "../events";
import { TILE_ATTRIBUTION, TILE_ATTRIBUTION_URL, TILE_URL, tilesConfigured } from "../tiles";
import type { DanpaHQMap, MapOptions, LatLng, MapMove } from "../types";

/** Leaflet stays behind the existing imperative adapter; it is imported only in the browser. */
export async function createLeafletMap(container: HTMLElement, options: MapOptions): Promise<DanpaHQMap> {
  const L = await import("leaflet");
  if (options.signal?.aborted) throw new DOMException("Map mount cancelled", "AbortError");
  const runtime = await getMapConfig();
  if (options.signal?.aborted) throw new DOMException("Map mount cancelled", "AbortError");
  if (runtime.enabled === false) { reportMapUnavailable(); throw new Error("Maps are disabled in Management."); }
  const tileConfig = runtime.tiles?.url ? runtime.tiles : { url: TILE_URL, attribution: TILE_ATTRIBUTION, attributionUrl: TILE_ATTRIBUTION_URL };
  if (!tilesConfigured(tileConfig)) { reportMapUnavailable(); throw new Error("Map tile configuration is invalid."); }
  const bounds = (box: { west: number; south: number; east: number; north: number }): import("leaflet").LatLngBoundsExpression => [
    [box.south, box.west], [box.north, box.east],
  ];
  const map = L.map(container, {
    center: [options.center.lat, options.center.lng], zoom: options.zoom,
    minZoom: options.minZoom, maxZoom: Math.min(options.maxZoom, 19),
    maxBounds: bounds(options.limits), scrollWheelZoom: options.gestures === "greedy",
    attributionControl: true, zoomControl: true,
  });
  map.attributionControl.setPrefix(false);
  const credit = document.createElement("a");
  credit.href = tileConfig.attributionUrl; credit.textContent = tileConfig.attribution;
  credit.target = "_blank"; credit.rel = "noopener noreferrer";
  const tiles = L.tileLayer(tileConfig.url, {
    attribution: credit.outerHTML, maxZoom: 19, updateWhenIdle: true,
    updateWhenZooming: false, keepBuffer: 1, noWrap: true,
  }).addTo(map);
  let loaded = false, errors = 0;
  tiles.on("tileload", () => { loaded = true; });
  tiles.on("tileerror", () => { if (!loaded && ++errors >= 3) reportMapUnavailable(); });
  const timeout = window.setTimeout(() => { if (!loaded) reportMapUnavailable(); }, 12_000);
  const valid = (point: LatLng) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
  const moves = new Set<(move: MapMove) => void>();
  const clicks = new Set<() => void>();
  const coordinateClicks = new Set<(position: LatLng) => void>();
  let byUser = false;
  map.on("dragstart zoomstart", (event) => { if ("originalEvent" in event || event.type === "dragstart") byUser = true; });
  // Zoom controls and wheel do not always carry originalEvent on zoomstart.
  const interaction = () => { byUser = true; };
  container.addEventListener("wheel", interaction, { passive: true });
  container.addEventListener("pointerdown", interaction);
  const report = () => {
    const box = map.getBounds();
    const move = { bounds: { west: box.getWest(), south: box.getSouth(), east: box.getEast(), north: box.getNorth() }, zoom: map.getZoom(), byUser };
    byUser = false;
    moves.forEach((listener) => listener(move));
  };
  map.on("moveend", report);
  map.on("click", (event: import("leaflet").LeafletMouseEvent) => {
    clicks.forEach((listener) => listener());
    coordinateClicks.forEach((listener) => listener({ lat: event.latlng.lat, lng: event.latlng.lng }));
  });
  const observer = new ResizeObserver(() => { map.invalidateSize({ animate: false }); });
  observer.observe(container);
  const frame = requestAnimationFrame(() => { map.invalidateSize(); report(); });
  return {
    capabilities: { satellite: false, streetView: false },
    fitBounds(box, { padding, maxZoom }) {
      byUser = false;
      map.fitBounds(bounds(box), { paddingTopLeft: [padding.left, padding.top], paddingBottomRight: [padding.right, padding.bottom], maxZoom: maxZoom ?? 16, animate: false });
    },
    panBy(dx, dy) { byUser = false; map.panBy([dx, dy], { animate: false }); },
    setBaseMap() {}, setStreetView() {},
    addMarker({ position, element, title, anchor, zIndex, onClick, draggable, onDragEnd }) {
      if (!valid(position)) return { setPosition() {}, setTitle() {}, setZIndex() {}, setPressed() {}, remove() {} };
      const wrapper = document.createElement("div");
      wrapper.className = `danpahq-leaflet-marker is-${anchor}`;
      wrapper.append(element);
      const icon = L.divIcon({ html: wrapper, className: `danpahq-leaflet-icon is-${anchor}`, iconSize: [0, 0], iconAnchor: [0, 0] });
      const marker = L.marker([position.lat, position.lng], { icon, title, keyboard: Boolean(onClick), zIndexOffset: zIndex ?? 1, draggable: Boolean(draggable), bubblingMouseEvents: false }).addTo(map);
      if (onClick) marker.on("click", onClick);
      if (onDragEnd) marker.on("dragend", () => { const point = marker.getLatLng(); onDragEnd({ lat: point.lat, lng: point.lng }); });
      return {
        setPosition: (next) => { if (valid(next)) marker.setLatLng([next.lat, next.lng]); },
        setTitle: (next) => { const node = marker.getElement(); if (node) { node.title = next; node.setAttribute("aria-label", next); } },
        setZIndex: (next) => { marker.setZIndexOffset(next); },
        setPressed: (pressed) => { marker.getElement()?.setAttribute("aria-pressed", String(pressed)); },
        remove: () => { marker.remove(); },
      };
    },
    addArea({ center, radiusMeters, color, fillOpacity, dashed }) {
      const circle = L.circle([center.lat, center.lng], { radius: radiusMeters, color, fillColor: color, fillOpacity, weight: 2, dashArray: dashed ? "6 5" : undefined, interactive: false }).addTo(map);
      return { remove: () => { circle.remove(); } };
    },
    onMove(listener) { moves.add(listener); return () => { moves.delete(listener); }; },
    onStreetViewChange() { return () => {}; },
    onBackgroundClick(listener) { clicks.add(listener); return () => { clicks.delete(listener); }; },
    onCoordinateClick(listener) { coordinateClicks.add(listener); return () => { coordinateClicks.delete(listener); }; },
    destroy() { window.clearTimeout(timeout); cancelAnimationFrame(frame); observer.disconnect(); container.removeEventListener("wheel", interaction); container.removeEventListener("pointerdown", interaction); map.remove(); },
  };
}
