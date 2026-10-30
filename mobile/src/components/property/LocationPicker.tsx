import { useState } from "react";
import { View } from "react-native";
import { LeafletView, type PinLocation } from "@/maps/LeafletView";
import { Button, Type, space } from "@/components/ui";

export type { PinLocation };
export function pinFromAddress(address: { latitude?: string | null; longitude?: string | null } | null): PinLocation {
  if (address?.latitude == null || address.longitude == null) return null;
  const latitude = Number(address.latitude), longitude = Number(address.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 ? { latitude, longitude } : null;
}
const INSETS = { top: 0, right: 0, bottom: 20, left: 0 };
const MARKERS: [] = [];
export function LocationPicker({ value, onChange, disabled = false, focus }: { value: PinLocation; focus?: PinLocation; onChange: (value: PinLocation) => void; disabled?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <View style={{ gap: space[2] }}>
    {!disabled ? <Type variant="caption">Selecting a town sets an approximate pin. Tap the map or drag the pin to refine it.</Type> : null}
    <LeafletView
      initialView={value ? { lat: value.latitude, lng: value.longitude, zoom: 16 } : { lat: 5.6037, lng: -0.187, zoom: 7 }}
      fit={focus ? { key: `${focus.latitude}:${focus.longitude}`, bounds: { west: focus.longitude - .02, east: focus.longitude + .02, south: focus.latitude - .02, north: focus.latitude + .02 } } : null} baseMap="standard" insets={INSETS} markers={MARKERS}
      onMove={() => {}} onMarkerPress={() => {}} onBackgroundPress={() => {}}
      onUnavailable={() => setFailed(true)} selecting pin={value} disabled={disabled} onPinChange={onChange} style={{ height: disabled ? 190 : 280, borderRadius: 12, overflow: "hidden" }}
    />
    {failed ? <Type variant="caption" accessibilityRole="alert">{disabled ? "The map is unavailable. Your saved address has not changed." : "Map tiles could not load. You can save your draft without a pin and retry later."}</Type> : null}
    {!disabled ? <Type variant="caption">{value ? `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}` : "No map pin selected. Published units and direct-sale properties will appear in the list only until you add a pin."}</Type> : null}
    {value && !disabled ? <Button label="Clear map location" variant="quiet" onPress={() => onChange(null)} /> : null}
  </View>;
}
