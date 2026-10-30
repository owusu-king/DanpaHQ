import { getMapConfig } from "@/places";
import Constants from "expo-constants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import { parseMapMessage, safeScriptJSON, validPoint } from "./bridge";
import { leafletHTML, MAP_ORIGIN, type TileConfig } from "./leafletHtml";
import type { DanpaHQMapProps } from "./types";

export type PinLocation = { latitude: number; longitude: number } | null;
type Props = DanpaHQMapProps & { pin?: PinLocation; selecting?: boolean; disabled?: boolean; onPinChange?: (pin: PinLocation) => void };
const extra = Constants.expoConfig?.extra?.mapTiles as Partial<TileConfig> | undefined;
const tiles: TileConfig = {
  url: process.env.EXPO_PUBLIC_MAP_TILE_URL || extra?.url || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION || extra?.attribution || "© OpenStreetMap contributors",
  attributionUrl: process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION_URL || extra?.attributionUrl || "https://www.openstreetmap.org/copyright",
};
function validTiles(config: TileConfig): boolean {
  try { return new URL(config.url).protocol === "https:" && ["{z}", "{x}", "{y}"].every((token) => config.url.includes(token)) && new URL(config.attributionUrl).protocol === "https:"; }
  catch { return false; }
}

/** Accept only the local HTML document's base URL, including native URL normalization. */
export function isMapDocumentURL(value: string): boolean {
  if (value === "about:blank") return true;
  try { const url = new URL(value); return url.origin === new URL(MAP_ORIGIN).origin && url.pathname === "/" && !url.search; }
  catch { return false; }
}

// Availability is resolved from Management when the bundled map mounts.
export const mapAvailable = () => true;

/** Local HTML and JS, public tiles only. The bridge never receives credentials or API access. */
export function LeafletView({ initialView, fit, insets, markers, onMove, onMarkerPress, onBackgroundPress, onUnavailable, style, pin = null, selecting = false, disabled = false, onPinChange }: Props) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [html, setHtml] = useState("");
  const activeTiles = useRef(tiles);
  const initial = useRef({ initialView, selecting });
  const validMarkers = useMemo(() => markers.filter(({ position }) => validPoint(position.lat, position.lng)), [markers]);
  const payload = useMemo(() => ({ markers: validMarkers, fit, insets, pin: pin && validPoint(pin.latitude, pin.longitude) ? pin : null, selectable: !disabled }), [validMarkers, fit, insets, pin, disabled]);
  const latestPayload = useRef(payload);
  useEffect(() => { latestPayload.current = payload; }, [payload]);
  const sync = useCallback(() => {
    web.current?.injectJavaScript(`window.DanpaMap&&window.DanpaMap.update(${safeScriptJSON(latestPayload.current)});true;`);
  }, []);
  const unavailable = useRef(onUnavailable);
  useEffect(() => { unavailable.current = onUnavailable; }, [onUnavailable]);
  useEffect(() => {
    let live = true;
    getMapConfig().then((config) => {
      if (!live) return;
      if (config.enabled === false) { unavailable.current?.(); return; }
      const chosen = config.tiles?.url ? config.tiles : tiles;
      if (!validTiles(chosen)) { unavailable.current?.(); return; }
      const resolved = { ...chosen, attributionUrl: new URL(chosen.attributionUrl).href };
      activeTiles.current = resolved;
      setHtml(leafletHTML(resolved, initial.current.initialView, initial.current.selecting, latestPayload.current));
    }).catch(() => { if (live) unavailable.current?.(); });
    return () => { live = false; };
  }, []);
  const source = useMemo(() => ({ html, baseUrl: MAP_ORIGIN }), [html]);
  const keys = useMemo(() => new Set(validMarkers.map(({ key }) => key)), [validMarkers]);
  useEffect(() => { if (ready) sync(); }, [ready, payload, sync]);
  function message(event: WebViewMessageEvent) {
    if (!isMapDocumentURL(event.nativeEvent.url)) return;
    const data = parseMapMessage(event.nativeEvent.data, keys, selecting && !disabled);
    if (!data) return;
    if (data.type === "ready") { setReady(true); sync(); }
    else if (data.type === "unavailable") onUnavailable?.();
    else if (data.type === "move") onMove({ bounds: data.bounds, zoom: data.zoom, byUser: data.byUser });
    else if (data.type === "marker") onMarkerPress(data.key);
    else if (data.type === "background") onBackgroundPress();
    else if (data.type === "pin") onPinChange?.({ latitude: data.latitude, longitude: data.longitude });
  }
  return <View style={style ?? StyleSheet.absoluteFill}>
    {html ? <WebView ref={web} source={source} style={{ flex: 1, backgroundColor: "#f5f3ee" }}
      originWhitelist={["*"]} onShouldStartLoadWithRequest={({ url }) => isMapDocumentURL(url)}
      onOpenWindow={({ nativeEvent }) => { if (nativeEvent.targetUrl === activeTiles.current.attributionUrl) void Linking.openURL(activeTiles.current.attributionUrl); }}
      applicationNameForUserAgent="DanpaHQ/0.1 (https://danpahq.com)"
      javaScriptEnabled cacheEnabled allowFileAccess={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
      mixedContentMode="never" setSupportMultipleWindows nestedScrollEnabled
      onLoadStart={() => setReady(false)} onLoadEnd={sync}
      onMessage={message} onError={() => onUnavailable?.()} onHttpError={() => onUnavailable?.()}
    /> : null}
  </View>;
}
