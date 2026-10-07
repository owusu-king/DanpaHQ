import Constants, { ExecutionEnvironment } from "expo-constants";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { captureRef } from "react-native-view-shot";

import { radius } from "@/components/ui";
import type { GeoBounds } from "@/places";
import { theme } from "@/theme";

import type { MapMarker, RooomlyMapProps } from "./types";

/**
 * Rooomly's map on a phone: react-native-maps drawing Google Maps (ADR 0034).
 *
 * The only file in the app that imports a map library. Markers are Rooomly's
 * own faces — price pills, cluster discs and stacks in the product's colours —
 * sized by their own text, so they come out the same on every screen density
 * and font size.
 *
 * On Android each face is drawn once, offscreen, into an image the map places
 * pixel for pixel. The library can snapshot a marker's live views instead, but
 * under the New Architecture it never learns their size and snapshots every one
 * into a fixed 100×100-pixel square: a cropped pill on a dense screen. iOS draws
 * the live views as they are.
 *
 * Expo Go on an iPhone cannot load Google's SDK, so there the same component
 * draws Apple Maps: development still shows a working map, and every build
 * Rooomly ships draws Google's.
 */

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const PROVIDER = Platform.OS === "ios" && inExpoGo ? PROVIDER_DEFAULT : PROVIDER_GOOGLE;
/** Android places images of the faces; iOS places the faces themselves. */
const DRAWS_IMAGES = Platform.OS === "android";

/** Room left around a fitted area, inside what the screen leaves uncovered. */
const FIT_MARGIN = 32;

/** Marker text grows with the system font size, but only this far: a map is not a page. */
const MARKER_FONT_SCALE = 1.3;
/** Line heights of marker text, before the system font size applies. */
const LABEL_LINE = 16;
const COUNT_LINE = 14;
const CLUSTER_BORDER = 2;
/** Room around a cluster's number, by how many rentals it holds. */
const CLUSTER_ROOM = { small: 8, medium: 11, large: 14 } as const;

const PRICE_ANCHOR = { x: 0.5, y: 1 };
const CENTER_ANCHOR = { x: 0.5, y: 0.5 };

/** Faces drawn at once, so a large search never mounts hundreds offscreen together. */
const DRAW_BATCH = 24;
const FACE_CACHE_LIMIT = 400;
/** Drawn faces, kept for the session: a label in a state is drawn once. */
const faceImages = new Map<string, string>();

const IDLE = { fill: theme.color.field["0"], edge: "rgba(33,26,21,0.22)", text: theme.color.ink["900"] };
const VISITED = { fill: theme.color.field["100"], edge: "rgba(33,26,21,0.16)", text: theme.color.ink["500"] };
const SELECTED = { fill: theme.color.kola["800"], edge: theme.color.kola["800"], text: theme.color.field["0"] };
/** A property for sale: gold, so a price in the hundreds of thousands is never read as rent. */
const SALE_IDLE = { fill: theme.color.gold["100"], edge: theme.color.gold["500"], text: theme.color.ink["900"] };
const SALE_VISITED = { fill: theme.color.gold["50"], edge: theme.color.gold["300"], text: theme.color.ink["500"] };
const SALE_SELECTED = { fill: theme.color.gold["600"], edge: theme.color.gold["600"], text: theme.color.field["0"] };
/** Pills with a tail point at their place from below; discs sit on it. */
const tailed = (kind: MapMarker["kind"]) => kind === "price" || kind === "sale";

type Face = { key: string; marker: MapMarker };

/** Whether this build can draw a map: Expo Go always can; a build needs its platform's key. */
export function mapAvailable(): boolean {
  if (inExpoGo) return true;
  const keys = Constants.expoConfig?.extra?.googleMaps as { android?: boolean; ios?: boolean } | undefined;
  return Platform.OS === "ios" ? Boolean(keys?.ios) : Boolean(keys?.android);
}

function regionFor(lat: number, lng: number, zoom: number): Region {
  const longitudeDelta = 360 / 2 ** zoom;
  return { latitude: lat, longitude: lng, latitudeDelta: longitudeDelta * 0.9, longitudeDelta };
}

function boundsOf(region: Region): GeoBounds {
  return {
    west: region.longitude - region.longitudeDelta / 2,
    south: region.latitude - region.latitudeDelta / 2,
    east: region.longitude + region.longitudeDelta / 2,
    north: region.latitude + region.latitudeDelta / 2,
  };
}

/** Everything a face's pixels depend on: what it says, its state, and the font size. */
function faceKey(marker: Pick<MapMarker, "kind" | "label" | "count" | "selected" | "visited">, fontScale: number): string {
  const state = marker.selected ? "selected" : marker.visited ? "visited" : "idle";
  return [marker.kind, marker.label, marker.count ?? "", state, fontScale.toFixed(2)].join("|");
}

function remember(key: string, uri: string) {
  faceImages.set(key, uri);
  // The oldest go first once a session has drawn a great many; a later map draws them again.
  if (faceImages.size > FACE_CACHE_LIMIT) {
    const oldest = faceImages.keys().next().value;
    if (oldest !== undefined) faceImages.delete(oldest);
  }
}

export function RooomlyMap({
  initialView,
  fit,
  insets,
  markers,
  onMove,
  onMarkerPress,
  onBackgroundPress,
  style,
}: RooomlyMapProps) {
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  // A move is the tenant's unless Rooomly asked for it; the first settle is ours.
  const ours = useRef(true);
  const size = useRef({ width: 0, height: 0 });
  const covering = useRef(insets);
  const settles = useRef(0);
  const { fontScale } = useWindowDimensions();
  // The faces drawn so far, starting from earlier visits: a marker is placed once its face is here.
  const [images, setImages] = useState<ReadonlyMap<string, string>>(() => new Map(faceImages));
  const initialRegion = useMemo(
    () => regionFor(initialView.lat, initialView.lng, initialView.zoom),
    // The map opens once; later views are fits and gestures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    covering.current = insets;
  }, [insets]);

  useEffect(() => {
    if (!ready || !fit) return;
    ours.current = true;
    // Google's map keeps a fit inside its padding already; Apple's is told the insets here.
    const edge = (inset: number) => FIT_MARGIN + (PROVIDER === PROVIDER_GOOGLE ? 0 : inset);
    map.current?.fitToCoordinates(
      [
        { latitude: fit.bounds.south, longitude: fit.bounds.west },
        { latitude: fit.bounds.north, longitude: fit.bounds.east },
      ],
      {
        edgePadding: { top: edge(insets.top), right: edge(insets.right), bottom: edge(insets.bottom), left: edge(insets.left) },
        animated: true,
      },
    );
    // Fit when the area changes, never because the insets moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.key, ready]);

  // The faces this search needs that nobody has drawn yet.
  const undrawn = useMemo<Face[]>(() => {
    if (!DRAWS_IMAGES) return [];
    const needed = new Map<string, MapMarker>();
    for (const marker of markers) {
      const key = faceKey(marker, fontScale);
      if (!images.has(key) && !needed.has(key)) needed.set(key, marker);
    }
    return [...needed].slice(0, DRAW_BATCH).map(([key, marker]) => ({ key, marker }));
  }, [markers, fontScale, images]);

  /**
   * What the tenant can see: the map between the edges the screen covers,
   * measured on the screen. Whether a provider's reported region leaves out its
   * padding varies; a point on the screen means the same on every one.
   */
  async function visibleBounds(region: Region): Promise<GeoBounds> {
    const whole = boundsOf(region);
    const view = map.current;
    const { width, height } = size.current;
    const covered = covering.current;
    if (!view || width <= covered.left + covered.right || height <= covered.top + covered.bottom) return whole;
    try {
      const [topLeft, bottomRight] = await Promise.all([
        view.coordinateForPoint({ x: covered.left, y: covered.top }),
        view.coordinateForPoint({ x: width - covered.right, y: height - covered.bottom }),
      ]);
      return { west: topLeft.longitude, south: bottomRight.latitude, east: bottomRight.longitude, north: topLeft.latitude };
    } catch {
      return whole;
    }
  }

  return (
    <>
      <MapView
        ref={map}
        style={style ?? StyleSheet.absoluteFill}
        provider={PROVIDER}
        initialRegion={initialRegion}
        // What the screen covers: fits land in the rest, and the logo stays above the sheet.
        mapPadding={insets}
        onLayout={(event) => {
          size.current = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
        }}
        onMapReady={() => setReady(true)}
        onRegionChangeComplete={(region, details) => {
          const byUser = details?.isGesture ?? !ours.current;
          ours.current = false;
          const zoom = Math.log2(360 / Math.max(region.longitudeDelta, 1e-6));
          const settle = ++settles.current;
          void visibleBounds(region).then((bounds) => {
            // A newer settle is already being measured; only the last one reports.
            if (settle === settles.current) onMove({ bounds, zoom, byUser });
          });
        }}
        onPress={(event) => {
          // On Android a marker tap also reaches the map; it is not a tap on the ground.
          if (event.nativeEvent.action === "marker-press") return;
          onBackgroundPress();
        }}
        moveOnMarkerPress={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsBuildings={false}
        showsPointsOfInterests={false}
        showsIndoors={false}
      >
        {markers.map((marker) => {
          if (!DRAWS_IMAGES) {
            return (
              <RentalMarker
                // A live face is redrawn only when the map is told, so a new state is a new marker.
                key={`${marker.key}:${marker.selected ? "selected" : marker.visited ? "visited" : "idle"}`}
                marker={marker}
                onPress={() => onMarkerPress(marker.key)}
              />
            );
          }
          // While a new state's face is being drawn, the marker keeps its plain one.
          const image = images.get(faceKey(marker, fontScale))
            ?? images.get(faceKey({ ...marker, selected: false, visited: false }, fontScale));
          if (!image) return null;
          return (
            <Marker
              key={marker.key}
              coordinate={{ latitude: marker.position.lat, longitude: marker.position.lng }}
              anchor={tailed(marker.kind) ? PRICE_ANCHOR : CENTER_ANCHOR}
              image={{ uri: image }}
              tracksViewChanges={false}
              zIndex={marker.selected ? 3 : 1}
              onPress={() => onMarkerPress(marker.key)}
            />
          );
        })}
      </MapView>
      {undrawn.length ? (
        <FaceStudio
          faces={undrawn}
          onDrawn={(key, uri) => {
            remember(key, uri);
            setImages((current) => new Map(current).set(key, uri));
          }}
        />
      ) : null}
    </>
  );
}

function RentalMarker({ marker, onPress }: { marker: MapMarker; onPress: () => void }) {
  // Tracked for a moment so the map captures the finished face, then frozen.
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Marker
      coordinate={{ latitude: marker.position.lat, longitude: marker.position.lng }}
      anchor={tailed(marker.kind) ? PRICE_ANCHOR : CENTER_ANCHOR}
      tracksViewChanges={tracking}
      zIndex={marker.selected ? 3 : 1}
      onPress={onPress}
    >
      <MarkerFace marker={marker} />
    </Marker>
  );
}

/**
 * A marker's face. Its size comes from its text and the system font size, never
 * from dimensions set by hand, and nothing reaches outside its frame — no
 * shadow, no rotated tail — so the image Android captures holds all of it.
 */
function MarkerFace({ marker }: { marker: MapMarker }) {
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(fontScale, MARKER_FONT_SCALE);
  const { selected, visited } = marker;
  const described = { accessible: !DRAWS_IMAGES, accessibilityLabel: marker.accessibilityLabel };

  if (marker.kind === "cluster") {
    const count = marker.count ?? 0;
    const room = CLUSTER_ROOM[count >= 100 ? "large" : count >= 10 ? "medium" : "small"];
    // As wide as it is tall until its number needs more: a disc, never an egg.
    const round = LABEL_LINE * scale + room * 2 + CLUSTER_BORDER * 2;
    return (
      <View style={styles.frame} {...described}>
        <View style={[styles.halo, selected && styles.haloSelected]}>
          <View style={[styles.cluster, { minWidth: round, padding: room }, selected && styles.clusterSelected]}>
            <Text maxFontSizeMultiplier={MARKER_FONT_SCALE} numberOfLines={1} style={styles.clusterLabel}>
              {marker.label}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  const palette = marker.kind === "sale"
    ? selected ? SALE_SELECTED : visited ? SALE_VISITED : SALE_IDLE
    : selected ? SELECTED : visited ? VISITED : IDLE;
  return (
    <View style={styles.frame} {...described}>
      <View style={[styles.pill, marker.kind === "stack" && styles.stackPill, { backgroundColor: palette.fill, borderColor: palette.edge }]}>
        {marker.kind === "stack" ? (
          <View style={[styles.count, { minWidth: COUNT_LINE * scale + 4, backgroundColor: selected ? theme.color.field["0"] : theme.color.kola["600"] }]}>
            <Text
              maxFontSizeMultiplier={MARKER_FONT_SCALE}
              numberOfLines={1}
              style={[styles.countLabel, { color: selected ? theme.color.kola["800"] : theme.color.field["0"] }]}
            >
              {marker.count}
            </Text>
          </View>
        ) : null}
        <Text maxFontSizeMultiplier={MARKER_FONT_SCALE} numberOfLines={1} style={[styles.priceLabel, { color: palette.text }]}>
          {marker.label}
        </Text>
      </View>
      {tailed(marker.kind) ? (
        // The tail points at the place: an outline, then the fill a pixel inside it.
        <View style={styles.tail}>
          <View style={[styles.tailEdge, { borderTopColor: palette.edge }]} />
          <View style={[styles.tailFill, { borderTopColor: palette.fill }]} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Where Android's marker faces are drawn: offscreen, each at its natural size,
 * then captured to an image the map can place.
 */
function FaceStudio({ faces, onDrawn }: { faces: Face[]; onDrawn: (key: string, uri: string) => void }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.studio}
    >
      {faces.map((face) => <FaceShot key={face.key} face={face} onDrawn={onDrawn} />)}
    </View>
  );
}

function FaceShot({ face, onDrawn }: { face: Face; onDrawn: (key: string, uri: string) => void }) {
  const frame = useRef<View>(null);
  const started = useRef(false);

  function capture(attempt = 0) {
    captureRef(frame, { format: "png", quality: 1, result: "data-uri" })
      .then((uri) => onDrawn(face.key, uri))
      // A face caught mid-mount gets another try on a later frame.
      .catch(() => {
        if (attempt < 2) requestAnimationFrame(() => capture(attempt + 1));
      });
  }

  return (
    <View
      ref={frame}
      collapsable={false}
      style={styles.shot}
      onLayout={() => {
        if (started.current) return;
        started.current = true;
        // Laid out is not yet drawn: the capture waits a frame.
        requestAnimationFrame(() => capture());
      }}
    >
      <MarkerFace marker={face.marker} />
    </View>
  );
}

const styles = StyleSheet.create({
  studio: { position: "absolute", top: 0, left: -10000, alignItems: "flex-start" },
  shot: { alignSelf: "flex-start" },
  // A pixel of room, so no antialiased edge is cut where the face meets its image.
  frame: { alignItems: "center", padding: 1 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  stackPill: { paddingLeft: 4 },
  priceLabel: {
    fontSize: 13,
    lineHeight: LABEL_LINE,
    fontWeight: "600",
    letterSpacing: 0,
    fontVariant: ["tabular-nums"],
    // Android pads text for accents it never draws here, which pushes it off centre.
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  count: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  countLabel: {
    fontSize: 11,
    lineHeight: COUNT_LINE,
    fontWeight: "600",
    letterSpacing: 0,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  tail: { width: 14, height: 7, marginTop: -1 },
  tailEdge: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  tailFill: {
    position: "absolute",
    top: 0,
    left: 1,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  halo: { padding: 4, borderRadius: radius.pill, backgroundColor: "rgba(27,107,79,0.22)" },
  haloSelected: { backgroundColor: "rgba(18,80,59,0.3)" },
  cluster: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: CLUSTER_BORDER,
    borderColor: theme.color.field["0"],
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["600"],
  },
  clusterSelected: { backgroundColor: theme.color.kola["800"] },
  clusterLabel: {
    fontSize: 13,
    lineHeight: LABEL_LINE,
    fontWeight: "600",
    letterSpacing: 0,
    fontVariant: ["tabular-nums"],
    color: theme.color.field["0"],
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});
