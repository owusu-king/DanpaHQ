import "./google-maps.css";

import type { GeoBounds } from "@/lib/places";

import type {
  AreaOptions,
  LatLng,
  MapMarker,
  MapMove,
  MapOptions,
  MapShape,
  MarkerOptions,
  DanpaHQMap,
} from "../types";
import { GOOGLE_MAPS_MAP_ID } from "./config";
import { loadGoogleMaps } from "./loader";

const literal = (bounds: GeoBounds): google.maps.LatLngBoundsLiteral => ({
  west: bounds.west,
  south: bounds.south,
  east: bounds.east,
  north: bounds.north,
});

/** A circle as a ring of points, for the edge a Google circle cannot dash. */
function ring(center: LatLng, radiusMeters: number, steps = 72): google.maps.LatLngLiteral[] {
  const dLat = radiusMeters / 110_574;
  const dLng = radiusMeters / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  return Array.from({ length: steps + 1 }, (_, step) => {
    const angle = (step / steps) * Math.PI * 2;
    return { lat: center.lat + dLat * Math.sin(angle), lng: center.lng + dLng * Math.cos(angle) };
  });
}

/**
 * A `DanpaHQMap` drawn by the Maps JavaScript API.
 *
 * Markers are advanced markers holding Danpa HQ's own HTML in a wrapper, so the
 * product's CSS styles them and Google positions them. A marker given a click
 * is `gmpClickable`: focusable, operable from the keyboard, named by its title.
 */
export async function createGoogleMap(container: HTMLElement, options: MapOptions): Promise<DanpaHQMap> {
  const { maps, marker, core } = await loadGoogleMaps();
  const map = new maps.Map(container, {
    center: options.center,
    zoom: options.zoom,
    minZoom: options.minZoom,
    maxZoom: options.maxZoom,
    mapId: GOOGLE_MAPS_MAP_ID,
    restriction: { latLngBounds: literal(options.limits), strictBounds: false },
    gestureHandling: options.gestures,
    // Points of interest open Google's own cards; on Danpa HQ a tap means a rental.
    clickableIcons: false,
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: { position: core.ControlPosition.RIGHT_BOTTOM },
  });
  const panorama = map.getStreetView();
  panorama.setOptions({
    addressControl: false,
    fullscreenControl: false,
    motionTracking: false,
    panControl: false,
  });

  // A move is the tenant's unless Danpa HQ asked for it. Danpa HQ's own camera
  // changes mark themselves, and a mark no change consumed within a moment — a
  // fit that moved nothing — expires, so the next drag is not taken for ours.
  let ours = true;
  let changed = false;
  let expiry = 0;
  const expectOurMove = () => {
    ours = true;
    changed = false;
    window.clearTimeout(expiry);
    expiry = window.setTimeout(() => {
      if (!changed) ours = false;
    }, 700);
  };

  const moveListeners = new Set<(move: MapMove) => void>();
  const clickListeners = new Set<() => void>();
  const streetViewListeners = new Set<(visible: boolean) => void>();
  const bindings: google.maps.MapsEventListener[] = [
    map.addListener("bounds_changed", () => {
      changed = true;
    }),
    map.addListener("idle", () => {
      const box = map.getBounds();
      if (!box) return;
      const northEast = box.getNorthEast();
      const southWest = box.getSouthWest();
      const move: MapMove = {
        bounds: { west: southWest.lng(), south: southWest.lat(), east: northEast.lng(), north: northEast.lat() },
        zoom: map.getZoom() ?? options.zoom,
        byUser: !ours,
      };
      ours = false;
      changed = false;
      for (const listener of moveListeners) listener(move);
    }),
    map.addListener("click", (event: google.maps.MapMouseEvent) => {
      const target = event.domEvent?.target;
      if (target instanceof Element && target.closest("gmp-advanced-marker")) return;
      for (const listener of clickListeners) listener();
    }),
    panorama.addListener("visible_changed", () => {
      for (const listener of streetViewListeners) listener(panorama.getVisible());
    }),
  ];

  const addMarker = ({ position, element, anchor, zIndex, title, onClick }: MarkerOptions): MapMarker => {
    // Anchored by a wrapper rather than the element, whose own CSS stays Danpa HQ's.
    const wrapper = document.createElement("div");
    wrapper.className = "danpahq-map-marker";
    wrapper.append(element);
    const pin = new marker.AdvancedMarkerElement({
      map,
      position,
      content: wrapper,
      anchorLeft: "-50%",
      anchorTop: anchor === "bottom" ? "-100%" : "-50%",
      collisionBehavior: marker.CollisionBehavior.REQUIRED,
      zIndex: zIndex ?? null,
      gmpClickable: Boolean(onClick),
      ...(title ? { title } : {}),
    });
    if (onClick) pin.addEventListener("gmp-click", () => onClick());
    return {
      setPosition: (next) => {
        pin.position = next;
      },
      setTitle: (next) => {
        pin.title = next;
      },
      setZIndex: (next) => {
        pin.zIndex = next;
      },
      setPressed: (pressed) => {
        if (onClick) pin.setAttribute("aria-pressed", String(pressed));
      },
      remove: () => {
        pin.map = null;
      },
    };
  };

  const addArea = ({ center, radiusMeters, color, fillOpacity, dashed }: AreaOptions): MapShape => {
    const fill = new maps.Circle({
      map,
      center,
      radius: radiusMeters,
      fillColor: color,
      fillOpacity,
      strokeWeight: 0,
      clickable: false,
    });
    const edge = new maps.Polyline({
      map,
      path: ring(center, radiusMeters),
      clickable: false,
      strokeColor: color,
      strokeOpacity: dashed ? 0 : 0.75,
      strokeWeight: 2,
      icons: dashed
        ? [{ icon: { path: "M 0,-1 0,1", strokeColor: color, strokeOpacity: 0.75, scale: 2 }, offset: "0", repeat: "10px" }]
        : [],
    });
    return {
      remove: () => {
        fill.setMap(null);
        edge.setMap(null);
      },
    };
  };

  return {
    capabilities: { satellite: true, streetView: true },
    fitBounds: (bounds, { padding, maxZoom }) => {
      expectOurMove();
      map.fitBounds(literal(bounds), padding);
      if (maxZoom === undefined) return;
      core.event.addListenerOnce(map, "idle", () => {
        if ((map.getZoom() ?? 0) <= maxZoom) return;
        expectOurMove();
        map.setZoom(maxZoom);
      });
    },
    panBy: (dx, dy) => {
      expectOurMove();
      map.panBy(dx, dy);
    },
    setBaseMap: (style) => {
      map.setMapTypeId(style === "satellite" ? maps.MapTypeId.HYBRID : maps.MapTypeId.ROADMAP);
    },
    setStreetView: (visible) => {
      if (visible) {
        const center = map.getCenter();
        if (center) panorama.setPosition(center);
        panorama.setPov({ heading: 0, pitch: 0 });
      }
      panorama.setVisible(visible);
    },
    addMarker,
    addArea,
    onMove: (listener) => {
      moveListeners.add(listener);
      return () => {
        moveListeners.delete(listener);
      };
    },
    onStreetViewChange: (listener) => {
      streetViewListeners.add(listener);
      return () => {
        streetViewListeners.delete(listener);
      };
    },
    onBackgroundClick: (listener) => {
      clickListeners.add(listener);
      return () => {
        clickListeners.delete(listener);
      };
    },
    destroy: () => {
      window.clearTimeout(expiry);
      for (const binding of bindings) binding.remove();
      moveListeners.clear();
      clickListeners.clear();
      streetViewListeners.clear();
      panorama.setVisible(false);
      core.event.clearInstanceListeners(map);
      core.event.clearInstanceListeners(panorama);
    },
  };
}
