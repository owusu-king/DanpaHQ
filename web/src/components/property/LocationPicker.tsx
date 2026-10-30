"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { onMapRefused, createMap, type DanpaHQMap, type LatLng, type MapMarker } from "@/lib/maps";

export type PinLocation = { latitude: number; longitude: number } | null;
export function pinFromAddress(address: { latitude?: string | null; longitude?: string | null } | null): PinLocation {
  if (address?.latitude == null || address.longitude == null) return null;
  const latitude = Number(address.latitude), longitude = Number(address.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 ? { latitude, longitude } : null;
}
export function LocationPicker({ value, onChange, disabled = false, focus }: { value: PinLocation; focus?: PinLocation; onChange: (value: PinLocation) => void; disabled?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<DanpaHQMap | null>(null);
  const pin = useRef<MapMarker | null>(null);
  const latest = useRef({ onChange, disabled });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { latest.current = { onChange, disabled }; }, [onChange, disabled]);
  useEffect(() => {
    if (!container.current) return;
    let active = true;
    const controller = new AbortController();
    let created: DanpaHQMap | null = null;
    const unsubscribe = onMapRefused(() => { if (active) setFailed(true); });
    const select = (point: LatLng) => {
      if (!latest.current.disabled) latest.current.onChange({ latitude: Math.round(point.lat * 1e6) / 1e6, longitude: Math.round(point.lng * 1e6) / 1e6 });
    };
    createMap(container.current, {
      signal: controller.signal,
      center: value ? { lat: value.latitude, lng: value.longitude } : { lat: 5.6037, lng: -0.187 },
      zoom: value ? 16 : 7, minZoom: 4, maxZoom: 19,
      limits: { west: -4.35, south: 3.6, east: 2.3, north: 12.25 }, gestures: "greedy",
    }).then((instance) => {
      if (!active) { instance.destroy(); return; }
      created = instance; map.current = instance;
      instance.onCoordinateClick?.(select); setReady(true);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; controller.abort(); unsubscribe(); pin.current = null; created?.destroy(); map.current = null; };
    // Initial position only; moving the selected pin does not remount the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!ready || !map.current) return;
    pin.current?.remove(); pin.current = null;
    if (!value) return;
    const element = document.createElement("span");
    element.textContent = "📍"; element.style.fontSize = "32px";
    pin.current = map.current.addMarker({
      position: { lat: value.latitude, lng: value.longitude }, element, anchor: "bottom",
      title: "Selected property location", draggable: !disabled,
      onDragEnd: (point) => latest.current.onChange({ latitude: Math.round(point.lat * 1e6) / 1e6, longitude: Math.round(point.lng * 1e6) / 1e6 }),
    });
  }, [value, disabled, ready]);
  useEffect(() => {
    if (!ready || !focus || !map.current) return;
    map.current.fitBounds({ west: focus.longitude - .02, east: focus.longitude + .02, south: focus.latitude - .02, north: focus.latitude + .02 }, { padding: { top: 24, right: 24, bottom: 24, left: 24 }, maxZoom: 14 });
  }, [focus, ready]);
  return <section className="cw-map-picker" aria-label="Property map location">
    <div className="cw-map-head">
      <span className="type-caption">{disabled ? "Saved location" : "Map location"}</span>
      {value && !disabled ? <Button type="button" variant="quiet" onClick={() => onChange(null)}>Clear pin</Button> : null}
    </div>
    <div ref={container} className="cw-map-canvas" />
    {failed ? <p role="alert" className="type-caption">Map unavailable.</p> : null}
    <span className="sr-only" role="status">{value ? "Location selected" : "No location selected"}</span>
  </section>;
}
