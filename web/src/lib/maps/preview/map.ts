import "./preview-map.css";

import type { GeoBounds } from "@/lib/places";
import type {
  AreaOptions,
  LatLng,
  MapMarker,
  MapMove,
  MapOptions,
  MapShape,
  MarkerOptions,
  RooomlyMap,
} from "../types";

const TILE = 256;
const TILE_URL = "https://tile.openstreetmap.org";
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const mercatorLatitude = (lat: number) => clamp(lat, -85.0511, 85.0511);

function project(point: LatLng, zoom: number) {
  const size = TILE * 2 ** zoom;
  const lat = mercatorLatitude(point.lat) * Math.PI / 180;
  return {
    x: ((point.lng + 180) / 360) * size,
    y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) * size / 2,
  };
}

function unproject(x: number, y: number, zoom: number): LatLng {
  const size = TILE * 2 ** zoom;
  return {
    lng: x / size * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) * 180 / Math.PI,
  };
}

function boundsFromFrame(center: LatLng, zoom: number, width: number, height: number): GeoBounds {
  const middle = project(center, zoom);
  const southwest = unproject(middle.x - width / 2, middle.y + height / 2, zoom);
  const northeast = unproject(middle.x + width / 2, middle.y - height / 2, zoom);
  return { west: southwest.lng, south: southwest.lat, east: northeast.lng, north: northeast.lat };
}

function pointInside(point: LatLng, bounds: GeoBounds): LatLng {
  return { lat: clamp(point.lat, bounds.south, bounds.north), lng: clamp(point.lng, bounds.west, bounds.east) };
}

/**
 * Keyless development basemap. It uses only tiles currently visible to a human,
 * relies on normal browser HTTP caching, and never preloads zoom levels.
 * Production chooses Google instead; this adapter is not a payout or API key
 * workaround and does not change Rooomly's authoritative map search.
 */
export async function createPreviewMap(container: HTMLElement, options: MapOptions): Promise<RooomlyMap> {
  const root = document.createElement("div");
  root.className = `rooomly-preview-map${options.gestures === "cooperative" ? " is-cooperative" : ""}`;
  const tiles = document.createElement("div");
  tiles.className = "rooomly-preview-tiles";
  const shapesLayer = document.createElement("div");
  shapesLayer.className = "rooomly-preview-shapes";
  const markerLayer = document.createElement("div");
  markerLayer.className = "rooomly-preview-markers";
  const controls = document.createElement("div");
  controls.className = "rooomly-preview-controls";
  const attribution = document.createElement("a");
  attribution.className = "rooomly-preview-attribution";
  attribution.href = "https://www.openstreetmap.org/copyright";
  attribution.target = "_blank";
  attribution.rel = "noopener noreferrer";
  attribution.textContent = "Preview map - \u00A9 OpenStreetMap contributors";
  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.textContent = "+";
  zoomIn.setAttribute("aria-label", "Zoom in");
  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.textContent = "-";
  zoomOut.setAttribute("aria-label", "Zoom out");
  controls.append(zoomIn, zoomOut);
  root.append(tiles, shapesLayer, markerLayer, controls, attribution);
  container.append(root);

  let center = pointInside(options.center, options.limits);
  let zoom = clamp(Math.round(options.zoom), options.minZoom, options.maxZoom);
  let destroyed = false;
  const tileNodes = new Map<string, HTMLImageElement>();
  const markerNodes = new Set<{ wrapper: HTMLDivElement; position: LatLng; anchor: "bottom" | "center" }>();
  const shapeNodes = new Set<{ node: HTMLDivElement; center: LatLng; radiusMeters: number }>();
  const moveListeners = new Set<(move: MapMove) => void>();
  const clickListeners = new Set<() => void>();
  const size = () => ({ width: root.clientWidth, height: root.clientHeight });

  function emitMove(byUser: boolean) {
    const { width, height } = size();
    if (!width || !height) return;
    const move: MapMove = { bounds: boundsFromFrame(center, zoom, width, height), zoom, byUser };
    for (const listener of moveListeners) listener(move);
  }

  function render() {
    if (destroyed) return;
    const { width, height } = size();
    if (!width || !height) return;
    const middle = project(center, zoom);
    const left = middle.x - width / 2;
    const top = middle.y - height / 2;
    const maxTile = 2 ** zoom;
    const wanted = new Set<string>();
    const xMin = Math.floor(left / TILE);
    const xMax = Math.floor((left + width) / TILE);
    const yMin = Math.max(0, Math.floor(top / TILE));
    const yMax = Math.min(maxTile - 1, Math.floor((top + height) / TILE));

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        if (x < 0 || x >= maxTile) continue;
        const key = `${zoom}/${x}/${y}`;
        wanted.add(key);
        let image = tileNodes.get(key);
        if (!image) {
          image = document.createElement("img");
          image.alt = "";
          image.draggable = false;
          image.decoding = "async";
          image.src = `${TILE_URL}/${key}.png`;
          image.className = "rooomly-preview-tile";
          tileNodes.set(key, image);
          tiles.append(image);
        }
        image.style.left = `${Math.round(x * TILE - left)}px`;
        image.style.top = `${Math.round(y * TILE - top)}px`;
      }
    }
    for (const [key, image] of tileNodes) {
      if (wanted.has(key)) continue;
      image.remove();
      tileNodes.delete(key);
    }

    for (const marker of markerNodes) {
      const pixel = project(marker.position, zoom);
      marker.wrapper.style.left = `${Math.round(pixel.x - left)}px`;
      marker.wrapper.style.top = `${Math.round(pixel.y - top)}px`;
      marker.wrapper.style.translate = marker.anchor === "bottom" ? "-50% -100%" : "-50% -50%";
    }
    for (const shape of shapeNodes) {
      const pixel = project(shape.center, zoom);
      const longitudeMeters = 111_320 * Math.cos(shape.center.lat * Math.PI / 180);
      const metersPerPixel = longitudeMeters * 360 / (TILE * 2 ** zoom);
      const diameter = Math.max(1, shape.radiusMeters * 2 / metersPerPixel);
      shape.node.style.left = `${Math.round(pixel.x - left)}px`;
      shape.node.style.top = `${Math.round(pixel.y - top)}px`;
      shape.node.style.width = `${diameter}px`;
      shape.node.style.height = `${diameter}px`;
    }
  }

  function changeZoom(delta: number, byUser: boolean) {
    const next = clamp(zoom + delta, options.minZoom, options.maxZoom);
    if (next === zoom) return;
    zoom = next;
    render();
    emitMove(byUser);
  }

  zoomIn.addEventListener("click", () => changeZoom(1, true));
  zoomOut.addEventListener("click", () => changeZoom(-1, true));
  root.addEventListener("wheel", (event) => {
    if (options.gestures === "cooperative" && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 1 : -1, true);
  }, { passive: false });

  let drag: { x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as Element).closest(".rooomly-preview-marker, .rooomly-preview-controls, .rooomly-preview-attribution")) return;
    if (options.gestures === "cooperative" && event.pointerType === "touch" && !event.isPrimary) return;
    drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    root.setPointerCapture(event.pointerId);
  });
  root.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 5) drag.moved = true;
    if (!drag.moved) return;
    const middle = project(center, zoom);
    center = pointInside(unproject(middle.x - dx, middle.y - dy, zoom), options.limits);
    drag.x = event.clientX;
    drag.y = event.clientY;
    render();
  });
  root.addEventListener("pointerup", () => {
    if (!drag) return;
    if (drag.moved) emitMove(true);
    else for (const listener of clickListeners) listener();
    drag = null;
  });
  root.addEventListener("pointercancel", () => { drag = null; });

  const observer = new ResizeObserver(() => {
    render();
    emitMove(false);
  });
  observer.observe(root);
  render();
  requestAnimationFrame(() => { render(); emitMove(false); });

  return {
    fitBounds(bounds, { padding, maxZoom }) {
      const { width, height } = size();
      if (!width || !height) return;
      const availableWidth = Math.max(1, width - padding.left - padding.right);
      const availableHeight = Math.max(1, height - padding.top - padding.bottom);
      let fitted = options.minZoom;
      for (let candidate = options.minZoom; candidate <= Math.min(maxZoom ?? options.maxZoom, options.maxZoom); candidate++) {
        const nw = project({ lat: bounds.north, lng: bounds.west }, candidate);
        const se = project({ lat: bounds.south, lng: bounds.east }, candidate);
        if (se.x - nw.x <= availableWidth && se.y - nw.y <= availableHeight) fitted = candidate;
        else break;
      }
      zoom = fitted;
      const nw = project({ lat: bounds.north, lng: bounds.west }, zoom);
      const se = project({ lat: bounds.south, lng: bounds.east }, zoom);
      center = pointInside(unproject((nw.x + se.x) / 2, (nw.y + se.y) / 2, zoom), options.limits);
      render();
      emitMove(false);
    },
    panBy(dx, dy) {
      const middle = project(center, zoom);
      center = pointInside(unproject(middle.x + dx, middle.y + dy, zoom), options.limits);
      render();
      emitMove(false);
    },
    addMarker({ position, element, anchor, zIndex, title, onClick }: MarkerOptions): MapMarker {
      const wrapper = document.createElement("div");
      wrapper.className = "rooomly-preview-marker";
      wrapper.style.zIndex = String(zIndex ?? 1);
      if (title) wrapper.title = title;
      if (onClick) {
        wrapper.role = "button";
        wrapper.tabIndex = 0;
        wrapper.setAttribute("aria-label", title ?? "Open rental");
        wrapper.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
        wrapper.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); }
        });
      }
      wrapper.append(element);
      markerLayer.append(wrapper);
      const record = { wrapper, position, anchor };
      markerNodes.add(record);
      render();
      return {
        setPosition(next) { record.position = next; render(); },
        setTitle(next) { wrapper.title = next; if (onClick) wrapper.setAttribute("aria-label", next); },
        setZIndex(next) { wrapper.style.zIndex = String(next); },
        setPressed(pressed) { if (onClick) wrapper.setAttribute("aria-pressed", String(pressed)); },
        remove() { markerNodes.delete(record); wrapper.remove(); },
      };
    },
    addArea({ center: point, radiusMeters, color, fillOpacity, dashed }: AreaOptions): MapShape {
      const node = document.createElement("div");
      node.className = "rooomly-preview-area";
      node.style.borderColor = color;
      node.style.borderStyle = dashed ? "dashed" : "solid";
      node.style.backgroundColor = color;
      node.style.opacity = String(fillOpacity);
      shapesLayer.append(node);
      const record = { node, center: point, radiusMeters };
      shapeNodes.add(record);
      render();
      return { remove() { shapeNodes.delete(record); node.remove(); } };
    },
    onMove(listener) { moveListeners.add(listener); return () => { moveListeners.delete(listener); }; },
    onBackgroundClick(listener) { clickListeners.add(listener); return () => { clickListeners.delete(listener); }; },
    destroy() {
      destroyed = true;
      observer.disconnect();
      moveListeners.clear();
      clickListeners.clear();
      markerNodes.clear();
      shapeNodes.clear();
      tileNodes.clear();
      root.remove();
    },
  };
}
