import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { apiBaseUrl } from "@/api";
import { Field, Type, space } from "@/components/ui";
import { searchLocations, type LocationReference } from "@/locations";
import { theme } from "@/theme";

export function LocationSuggestions({ query, enabled, onSelect, onUseText, search = false }: {
  query: string; enabled: boolean; onSelect: (row: LocationReference) => void;
  onUseText: () => void; search?: boolean;
}) {
  const [rows, setRows] = useState<LocationReference[]>([]);
  const [answeredQuery, setAnsweredQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true); setFailed(false);
      searchLocations(query, controller.signal).then((answer) => {
        if (!controller.signal.aborted) { setRows(answer.results); setAnsweredQuery(query); }
      }).catch(() => { if (!controller.signal.aborted) { setRows([]); setFailed(true); } })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, enabled]);
  if (!enabled || query.trim().length < 2) return null;
  return <View style={{ backgroundColor: theme.color.field["0"], borderRadius: 12, borderWidth: 1, borderColor: theme.color.field["200"], marginTop: space[2], overflow: "hidden" }}>
    {busy ? <Type variant="caption" accessibilityLiveRegion="polite" style={{ padding: space[2] }}>Searching Ghana locations…</Type> : null}
    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 240 }}>
      {(answeredQuery === query ? rows : []).map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={row.label}
        onPress={() => onSelect(row)} style={({ pressed }) => ({ minHeight: 52, padding: space[3], backgroundColor: pressed ? theme.color.kola["50"] : "transparent", borderBottomWidth: 1, borderBottomColor: theme.color.field["100"] })}>
        <Type variant="bodyStrong">{row.name}</Type>
        <Type variant="caption">{row.district_name || "District unverified"} · {row.region_name || "Region unverified"}</Type>
      </Pressable>)}
    </ScrollView>
    <Pressable accessibilityRole="button" onPress={onUseText} style={{ minHeight: 44, padding: space[3] }}>
      <Type variant="caption">{search ? `Search listings for “${query}”` : `Use “${query}” — unverified location`}</Type>
    </Pressable>
    {failed ? <Type variant="caption" accessibilityLiveRegion="polite" style={{ padding: space[2] }}>Location search is unavailable. You can still enter the name.</Type> : null}
    <Type variant="caption" style={{ padding: space[2], fontSize: 10 }}>Data: <Type variant="caption" accessibilityRole="link" onPress={() => void Linking.openURL("https://www.geonames.org/")}>GeoNames (CC BY)</Type> · <Type variant="caption" accessibilityRole="link" onPress={() => void Linking.openURL("https://www.openstreetmap.org/copyright")}>OSM (ODbL)</Type> · <Type variant="caption" accessibilityRole="link" onPress={() => void Linking.openURL("https://data.humdata.org/dataset/cod-ab-gha")}>GSS/HDX</Type>. District matches use 2021 boundaries, not current verification. <Type variant="caption" accessibilityRole="link" onPress={() => void Linking.openURL(`${apiBaseUrl()}/geo/dataset/`)}>Download location data</Type>.</Type>
  </View>;
}

export function LocationAutocomplete({ value, onChange, onSelect, selected, onShowArea, error }: {
  value: string; onChange: (value: string) => void; onSelect: (row: LocationReference) => void;
  selected: LocationReference | null; onShowArea: (row: LocationReference) => void; error?: string;
}) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: space[2] }}>
    <Field label="Town or neighbourhood" value={value} onFocus={() => setOpen(true)}
      onChangeText={(text) => { onChange(text); setOpen(true); }} error={error}
      placeholder="Search Ghana's towns and communities…" autoCorrect={false} />
    <LocationSuggestions query={value} enabled={open} onSelect={(row) => { setOpen(false); onSelect(row); }} onUseText={() => { setOpen(false); onChange(value); }} />
    <Type variant="caption">{selected ? `${selected.label}${selected.parent_status === "boundary_2021" ? " · District inferred from 2021 boundaries" : ""}` : value ? "Unverified location: entered by you, not in the reference database." : "Choose a reference location, or enter an unverified name."}</Type>
    {selected?.latitude != null && selected.longitude != null ? <Pressable accessibilityRole="button" onPress={() => onShowArea(selected)} style={{ minHeight: 44, justifyContent: "center" }}><Type variant="caption">Show area on map</Type></Pressable> : null}
  </View>;
}
