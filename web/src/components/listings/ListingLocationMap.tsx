"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { AttributionControl, Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { prepareMapLibre } from "@/components/explore/maplibreSetup";
import { rooomlyMapStyle } from "@/components/explore/mapStyle";
import { getMapConfig } from "@/lib/places";

/** A circle of `radius` metres as a polygon: an area, drawn as one. */
function circle(longitude: number, latitude: number, radius: number, steps = 72) {
  const dLat = radius / 110_574;
  const dLng = radius / (111_320 * Math.cos((latitude * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    ring.push([longitude + dLng * Math.cos(angle), latitude + dLat * Math.sin(angle)]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
}

/**
 * The listing's approximate area on Rooomly's basemap.
 *
 * Embedded in a long page, so it asks for a modifier key before the wheel zooms
 * it (MapLibre's cooperative gestures): scrolling past it must still scroll the
 * page.
 */
export function ListingLocationMap({
  latitude,
  longitude,
  radius,
  precision,
  label,
}: {
  latitude: number;
  longitude: number;
  radius: number;
  precision: "area" | "locality";
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;

    getMapConfig()
      .then((config) => {
        if (cancelled || !container.current) return;
        prepareMapLibre();
        const area = circle(longitude, latitude, radius);
        const ring = area.geometry.coordinates[0] ?? [];
        const lngs = ring.map((point) => point[0]);
        const lats = ring.map((point) => point[1]);

        map = new MapLibreMap({
          container: container.current,
          style: rooomlyMapStyle(config),
          bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          fitBoundsOptions: { padding: 48, maxZoom: 16 },
          minZoom: config.min_zoom,
          maxZoom: 17,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          cooperativeGestures: true,
          attributionControl: false,
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new AttributionControl({ compact: true, customAttribution: config.attribution }), "bottom-right");

        map.on("load", () => {
          if (!map) return;
          map.addSource("listing-area", { type: "geojson", data: area });
          map.addLayer({
            id: "listing-area-fill",
            type: "fill",
            source: "listing-area",
            paint: { "fill-color": "#1B6B4F", "fill-opacity": precision === "area" ? 0.16 : 0.1 },
          });
          map.addLayer({
            id: "listing-area-edge",
            type: "line",
            source: "listing-area",
            paint: { "line-color": "#1B6B4F", "line-width": 2, "line-opacity": 0.75, "line-dasharray": precision === "area" ? [1, 0] : [2, 1.5] },
          });
          if (precision === "area") {
            const dot = document.createElement("span");
            dot.className = "listing-location-dot";
            dot.setAttribute("aria-hidden", "true");
            new Marker({ element: dot }).setLngLat([longitude, latitude]).addTo(map);
          }
        });
        map.on("error", () => {
          if (map && !map.loaded()) setFailed(true);
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [latitude, longitude, radius, precision]);

  if (failed) {
    return (
      <div className="listing-location-map is-failed" role="status">
        The map could not load right now.
      </div>
    );
  }
  return <div ref={container} className="listing-location-map" role="img" aria-label={label} />;
}
