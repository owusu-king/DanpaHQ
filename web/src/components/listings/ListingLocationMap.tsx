"use client";

import { useEffect, useRef, useState } from "react";

import { createMap, mapSetupHint, mapsConfigured, onMapRefused, type RooomlyMap } from "@/lib/maps";
import { getMapConfig } from "@/lib/places";

/** The box around a circle of `radius` metres, for the map to fit. */
function around(latitude: number, longitude: number, radius: number) {
  const dLat = radius / 110_574;
  const dLng = radius / (111_320 * Math.cos((latitude * Math.PI) / 180));
  return { west: longitude - dLng, south: latitude - dLat, east: longitude + dLng, north: latitude + dLat };
}

/**
 * The listing's approximate area, drawn as an area.
 *
 * Embedded in a long page, so it asks for two fingers or a modifier key before
 * it moves ("cooperative" gestures): scrolling past it must still scroll the
 * page. Without a map in this build, or when the map fails, it says so in words;
 * the section around it already says where the rental is.
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
  const [state, setState] = useState<"drawing" | "unavailable" | "failed">(() =>
    mapsConfigured() ? "drawing" : "unavailable",
  );

  useEffect(() => {
    const element = container.current;
    if (!element || !mapsConfigured()) return;
    let map: RooomlyMap | null = null;
    let cancelled = false;
    const fail = () => {
      if (!cancelled) setState("failed");
    };

    getMapConfig()
      .then((config) => {
        const [west, south, east, north] = config.bounds;
        return createMap(element, {
          center: { lat: latitude, lng: longitude },
          zoom: 15,
          minZoom: config.min_zoom,
          maxZoom: 17,
          limits: { west: west - 1, south: south - 1, east: east + 1, north: north + 1 },
          gestures: "cooperative",
        });
      })
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        map = created;
        map.fitBounds(around(latitude, longitude, radius), {
          padding: { top: 48, right: 48, bottom: 48, left: 48 },
          maxZoom: 16,
        });
        map.addArea({
          center: { lat: latitude, lng: longitude },
          radiusMeters: radius,
          color: "#1B6B4F",
          fillOpacity: precision === "area" ? 0.16 : 0.1,
          dashed: precision !== "area",
        });
        if (precision === "area") {
          const dot = document.createElement("span");
          dot.className = "listing-location-dot";
          dot.setAttribute("aria-hidden", "true");
          map.addMarker({ position: { lat: latitude, lng: longitude }, element: dot, anchor: "center" });
        }
      })
      .catch(fail);
    const stopRefused = onMapRefused(fail);

    return () => {
      cancelled = true;
      stopRefused();
      map?.destroy();
    };
  }, [latitude, longitude, radius, precision]);

  if (state !== "drawing") {
    const hint = state === "unavailable" ? mapSetupHint() : null;
    return (
      <div className="listing-location-map is-failed" role="status">
        {state === "unavailable" ? "The map is not available here yet." : "The map could not load right now."}
        {hint ? ` ${hint}` : null}
      </div>
    );
  }
  return <div ref={container} className="listing-location-map" role="img" aria-label={label} />;
}
