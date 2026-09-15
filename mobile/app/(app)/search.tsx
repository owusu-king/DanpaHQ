import Ionicons from "@expo/vector-icons/Ionicons";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { useRouter } from "expo-router";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type PanResponderGestureState,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { PriceRange, SegmentedField, SelectField, ToggleField } from "@/components/filters/FilterFields";
import { ListingCard, advanceTerm, rentPeriod } from "@/components/listings/ListingCard";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Button, Notice, Type, radius, space } from "@/components/ui";
import {
  formatMinor,
  listSaved,
  saveListing,
  searchListings,
  searchListingsPage,
  unsaveListing,
  type Listing,
  type ListingSort,
  type SearchFilters,
} from "@/listings";
import { RooomlyMap, mapAvailable, type MapMarker, type MapMove } from "@/maps";
import { compactRent, getListingsById, roundCoordinate, searchListingMap, type MapFeature } from "@/mapSearch";
import { useReduceMotion } from "@/motion";
import {
  getMapConfig,
  newPlacesSession,
  resolvePlace,
  suggestPlaces,
  type GeoBounds,
  type MapConfig,
  type PlaceKind,
  type PlaceSuggestion,
} from "@/places";
import { pressableFeedback } from "@/platform";
import { loadPropertyTypes, type PropertyTypeOption } from "@/propertyTypes";
import { theme } from "@/theme";

/**
 * Finding a place to rent, on a map.
 *
 * Search → scan → compare → open, with the map as the ground it happens on.
 * One search bar and one Filters button float over the map. The rentals rise
 * in a sheet from the bottom: collapsed to its count, halfway to compare beside
 * the map, or over the whole map to read like any list. A marker previews its
 * rental without leaving the map, and the list and the markers are one search —
 * the same filters and the same box, built once (`listingQuery`).
 *
 * Where you are looking is the first question a Ghanaian tenant asks, so it
 * leads. Typing asks Rooomly's API for places (ADR 0034), and one search is one
 * Places session, spent by the place it chooses. Everything else — rent,
 * advance, type, bedrooms, furnishing and order — lives in the Filters sheet,
 * and the button carries the count of what is on.
 *
 * A build without a map shows the same search as the whole list.
 */

/** `bedrooms_min=0` matched every listing — the backend filters `>=` — so a
 * "Single room" choice was Any under another name. Rooms are a Unit type. */
const BEDROOMS: readonly (readonly [string, string])[] = [
  ["", "Any"],
  ["1", "1+"],
  ["2", "2+"],
  ["3", "3+"],
];

const ADVANCE: readonly (readonly [string, string])[] = [
  ["", "Any"],
  ["6", "Up to 6 months"],
  ["12", "Up to 1 year"],
  ["24", "Up to 2 years"],
];

const SORTS: readonly (readonly [ListingSort, string])[] = [
  ["newest", "Newest first"],
  ["rent_asc", "Rent: low to high"],
  ["rent_desc", "Rent: high to low"],
];

type SearchArea = { name: string; bounds: GeoBounds; ref: string };
type Selection = { key: string; ids: string[] };
type SheetStop = "peek" | "half" | "full";

/** From least of the screen to most: a flick up moves along it, a flick down back. */
const SHEET_ORDER: readonly SheetStop[] = ["peek", "half", "full"];

/** The collapsed sheet before its header has been measured. */
const FALLBACK_PEEK = 76;

/** How far a released drag carries on: this many milliseconds of its velocity. */
const FLICK_MS = 200;

/** Controls floating over the map carry a soft shadow, so they read on any tile. */
const FLOATING = {
  shadowColor: theme.color.ink["950"],
  shadowOpacity: 0.14,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 4,
} as const;

/** Where the map opens when its shared configuration cannot be fetched: Accra. */
const FALLBACK_MAP: MapConfig = {
  bounds: [-3.35, 4.6, 1.3, 11.25],
  default_view: { lat: 5.6037, lng: -0.187, zoom: 11 },
  min_zoom: 6,
  max_zoom: 20,
};

const KIND_ICON: Record<PlaceKind, keyof typeof Ionicons.glyphMap> = {
  area: "map-outline",
  landmark: "business-outline",
  address: "location-outline",
};

/** What kind of place it is, told by colour as well: lagoon, gold, kola. */
const KIND_TINT: Record<PlaceKind, { color: string; background: string }> = {
  area: { color: theme.color.lagoon["600"], background: theme.color.lagoon["100"] },
  landmark: { color: theme.color.gold["700"], background: theme.color.gold["100"] },
  address: { color: theme.color.kola["600"], background: theme.color.kola["50"] },
};

const markerKey = (feature: MapFeature) =>
  feature.type === "listing" ? `listing:${feature.id}` : `cluster:${feature.key}`;

function grow(bounds: GeoBounds, by: number): GeoBounds {
  const dx = (bounds.east - bounds.west) * by;
  const dy = (bounds.north - bounds.south) * by;
  return { west: bounds.west - dx, south: bounds.south - dy, east: bounds.east + dx, north: bounds.north + dy };
}

/**
 * Whether the tenant has moved the map far enough from where the results were
 * shown for a search of it to mean something: a quarter of the view away, or
 * most of a zoom level in or out.
 */
function movedMeaningfully(view: MapMove, anchor: MapMove): boolean {
  const width = Math.max(anchor.bounds.east - anchor.bounds.west, 1e-9);
  const height = Math.max(anchor.bounds.north - anchor.bounds.south, 1e-9);
  const across = Math.abs(view.bounds.west + view.bounds.east - anchor.bounds.west - anchor.bounds.east) / 2 / width;
  const along = Math.abs(view.bounds.south + view.bounds.north - anchor.bounds.south - anchor.bounds.north) / 2 / height;
  return across > 0.25 || along > 0.25 || Math.abs(view.zoom - anchor.zoom) >= 0.8;
}

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Inside the tabs the tab bar already keeps clear of the home indicator; a
  // pushed search has no bar, so its list keeps clear itself.
  const inTabs = useContext(BottomTabBarHeightContext) !== undefined;
  const { width: screenWidth } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";
  const showMap = mapAvailable();

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Where: what is typed, the place it chose, and an area searched from the map.
  const [place, setPlace] = useState("");
  const [area, setArea] = useState<SearchArea | null>(null);
  const [bbox, setBbox] = useState<GeoBounds | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [attribution, setAttribution] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  /** The Places session this search's requests share; none until a request goes. */
  const session = useRef<string | null>(null);
  const suggestionRequest = useRef(0);
  const resolveRequest = useRef(0);

  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[]>([]);
  const [propertyType, setPropertyType] = useState("");
  const [spaceType, setSpaceType] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [rentMin, setRentMin] = useState("");
  const [rentMax, setRentMax] = useState("");
  const [advanceMax, setAdvanceMax] = useState("");
  const [furnished, setFurnished] = useState(false);
  const [sort, setSort] = useState<ListingSort>("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const requestId = useRef(0);

  // The map: what it draws, where it is, and what was tapped.
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [extent, setExtent] = useState<GeoBounds | null>(null);
  const [view, setView] = useState<MapMove | null>(null);
  /** Where the map was when it last showed these results, before the tenant moved it. */
  const [anchor, setAnchor] = useState<MapMove | null>(null);
  const [userMoved, setUserMoved] = useState(false);
  const movedRef = useRef(false);
  const [fit, setFit] = useState<{ key: string; bounds: GeoBounds } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [preview, setPreview] = useState<Listing[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const markerRequest = useRef(0);
  const summaryRequest = useRef(0);
  const viewRef = useRef<MapMove | null>(null);
  const extentFitted = useRef(false);

  // The sheet the rentals rise in, and where it rests.
  const [stop, setStop] = useState<SheetStop>("peek");
  const stopRef = useRef<SheetStop>("peek");
  const [screenHeight, setScreenHeight] = useState(0);
  const [controlsHeight, setControlsHeight] = useState(0);
  const [sheetHeaderHeight, setSheetHeaderHeight] = useState(0);
  const [pillHeight, setPillHeight] = useState(44);
  const offset = useRef(new Animated.Value(showMap ? 2000 : 0)).current;
  const resting = useRef(showMap ? 2000 : 0);
  const dragStart = useRef(0);
  const list = useRef<FlatList<Listing>>(null);

  const spaceTypes = useMemo(() => {
    const source = propertyType
      ? propertyTypes.filter((type) => type.value === propertyType)
      : propertyTypes;
    const unique = new Map<string, string>();
    for (const type of source) {
      for (const space_ of type.space_types) unique.set(space_.value, space_.label);
    }
    return [...unique].map(([value, label]) => ({ value, label }));
  }, [propertyType, propertyTypes]);

  // The box both the list and the markers search: one searched from the map, else the chosen place's.
  const box = bbox ?? area?.bounds ?? null;
  const filters = useMemo<SearchFilters>(() => ({
    q: area ? undefined : place.trim() || undefined,
    west: box?.west,
    south: box?.south,
    east: box?.east,
    north: box?.north,
    property_type: propertyType || undefined,
    space_type: spaceType || undefined,
    bedrooms_min: bedrooms === "" ? undefined : Number(bedrooms),
    rent_min: rentMin ? Math.round(Number(rentMin) * 100) : undefined,
    rent_max: rentMax ? Math.round(Number(rentMax) * 100) : undefined,
    advance_max: advanceMax ? Number(advanceMax) : undefined,
    furnished: furnished || undefined,
    sort,
  }), [place, area, box, propertyType, spaceType, bedrooms, rentMin, rentMax, advanceMax, furnished, sort]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setQuerying(true);
    try {
      const page = await searchListings(filters);
      // A slower earlier request must never overwrite a newer answer.
      if (id !== requestId.current) return;
      setListings(page.results);
      setNext(page.next);
      setError("");
    } catch (cause) {
      if (id !== requestId.current) return;
      // The last results stay: a failed request is not a search that found nothing.
      setListings((current) => current ?? []);
      setNext(null);
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load rentals right now.");
    } finally {
      if (id === requestId.current) setQuerying(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!signedIn) return;
    void listSaved().then((rows) => setSaved(new Set(rows.map((row) => row.listing.id)))).catch(() => undefined);
  }, [signedIn]);

  useEffect(() => {
    void loadPropertyTypes().then(setPropertyTypes).catch(() => setPropertyTypes([]));
  }, []);

  useEffect(() => {
    if (!showMap) return;
    void getMapConfig().then(setConfig).catch(() => setConfig(FALLBACK_MAP));
  }, [showMap]);

  // Places while somebody types. The first request opens a Places session, and
  // every one after it in this search carries the same token.
  useEffect(() => {
    const typed = place.trim();
    if (area || typed.length < 2) {
      suggestionRequest.current += 1;
      setSuggestions([]);
      return;
    }
    const id = ++suggestionRequest.current;
    const timer = setTimeout(() => {
      session.current ??= newPlacesSession();
      suggestPlaces(typed, session.current)
        .then((answer) => {
          if (id !== suggestionRequest.current) return;
          setSuggestions(answer.suggestions);
          setAttribution(answer.attribution);
        })
        .catch(() => {
          if (id === suggestionRequest.current) setSuggestions([]);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [place, area]);

  const fetchMarkers = useCallback((move: MapMove | null, withSummary: boolean) => {
    const id = ++markerRequest.current;
    const summaryId = withSummary ? ++summaryRequest.current : 0;
    searchListingMap(filters, { window: move?.bounds ?? null, zoom: move?.zoom ?? 12, summary: withSummary })
      .then((answer) => {
        // The extent belongs to the search, so a newer window's markers never discard it.
        if (withSummary && summaryId === summaryRequest.current) setExtent(answer.extent ?? null);
        // A slower, older answer must never replace a newer one.
        if (id !== markerRequest.current) return;
        setFeatures(answer.features);
      })
      // The markers already drawn stay; the list says what failed.
      .catch(() => undefined);
  }, [filters]);

  // The search changed: new markers and a new extent for the window on screen.
  useEffect(() => {
    if (!showMap) return;
    const timer = setTimeout(() => fetchMarkers(viewRef.current, true), 250);
    return () => clearTimeout(timer);
  }, [fetchMarkers, showMap]);

  // Only the window moved: redraw its markers, and leave the search alone.
  useEffect(() => {
    if (!showMap || !view) return;
    const timer = setTimeout(() => fetchMarkers(view, false), 250);
    return () => clearTimeout(timer);
    // Keyed on the window; a new search is the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // A new search is a new set of rentals: whatever was selected may not be in
  // it, and what the map shows now is what the results describe.
  useEffect(() => {
    setSelection(null);
    movedRef.current = false;
    setUserMoved(false);
    setAnchor(viewRef.current);
  }, [filters]);

  // A chosen place: the map goes there, even when it is the place chosen last time.
  useEffect(() => {
    if (area) setFit({ key: `area:${area.ref}:${Date.now()}`, bounds: area.bounds });
  }, [area]);

  // Arriving with no place, the map shows where this search's rentals are — once.
  useEffect(() => {
    if (extentFitted.current || area || bbox || !extent) return;
    extentFitted.current = true;
    setFit({ key: "extent", bounds: extent });
  }, [extent, area, bbox]);

  // What a selected marker shows: the loaded cards first, the API for the rest.
  useEffect(() => {
    if (!selection) {
      setPreview([]);
      return;
    }
    const known = new Map((listings ?? []).map((row) => [row.id, row]));
    const found = selection.ids.flatMap((id) => known.get(id) ?? []);
    if (found.length === selection.ids.length) {
      setPreview(found);
      return;
    }
    let live = true;
    getListingsById(selection.ids)
      .then((rows) => { if (live) setPreview(rows); })
      .catch(() => { if (live) setPreview([]); });
    return () => { live = false; };
  }, [selection, listings]);

  // The sheet's geometry. It hangs below the controls, so full is the whole
  // content area under them; collapsed shows exactly its measured header.
  const peek = sheetHeaderHeight > 0 ? Math.ceil(sheetHeaderHeight) : FALLBACK_PEEK;
  const sheetHeight = Math.max(0, screenHeight - controlsHeight);
  const stops = useMemo<Record<SheetStop, number>>(() => {
    const collapsed = Math.max(0, sheetHeight - peek);
    return { full: 0, half: Math.min(Math.round(sheetHeight * 0.45), collapsed), peek: collapsed };
  }, [sheetHeight, peek]);

  const moveSheet = useCallback((toValue: number, velocity = 0) => {
    resting.current = toValue;
    if (reduceMotion) offset.setValue(toValue);
    else {
      Animated.spring(offset, {
        toValue,
        velocity,
        useNativeDriver: true,
        speed: 16,
        bounciness: 0,
        // It snaps to the stop and stays there, rather than bouncing past it.
        overshootClamping: true,
      }).start();
    }
  }, [offset, reduceMotion]);

  useEffect(() => {
    stopRef.current = stop;
    if (!sheetHeight) return;
    const toValue = showMap ? stops[stop] : 0;
    // A release has already sent the sheet here, carrying its own velocity.
    if (toValue !== resting.current) moveSheet(toValue);
  }, [stop, stops, showMap, sheetHeight, moveSheet]);

  // A list left scrolled down would sit mid-way in a sheet that cannot scroll.
  useEffect(() => {
    if (stop !== "full") list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [stop]);

  // The sheet follows a drag and snaps to the stop the release is heading for;
  // a deliberate flick always moves at least one stop. Its header always drags
  // it, and the rentals drag it too until it is full — then they scroll.
  const [handleDrag, listDrag] = useMemo(() => {
    const nearest = (value: number) => SHEET_ORDER.reduce<SheetStop>(
      (best, candidate) => (Math.abs(stops[candidate] - value) < Math.abs(stops[best] - value) ? candidate : best),
      "half",
    );
    const settle = (gesture: PanResponderGestureState) => {
      const from = nearest(dragStart.current);
      let target = nearest(dragStart.current + gesture.dy + gesture.vy * FLICK_MS);
      if (target === from && Math.abs(gesture.vy) > 0.3) {
        const index = SHEET_ORDER.indexOf(from) + (gesture.vy < 0 ? 1 : -1);
        target = SHEET_ORDER[Math.max(0, Math.min(SHEET_ORDER.length - 1, index))] ?? from;
      }
      setStop(target);
      // The spring takes the finger's speed with it: points per second.
      moveSheet(stops[target], gesture.vy * 1000);
    };
    const drag = (allowed: () => boolean) => PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        allowed() && Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        Keyboard.dismiss();
        dragStart.current = resting.current;
        offset.stopAnimation((value) => { dragStart.current = value; });
      },
      onPanResponderMove: (_, gesture) => {
        offset.setValue(Math.min(stops.peek, Math.max(stops.full, dragStart.current + gesture.dy)));
      },
      // Once the sheet is moving, nothing inside it may take the drag away.
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, gesture) => settle(gesture),
      onPanResponderTerminate: (_, gesture) => settle(gesture),
    });
    return [drag(() => true), drag(() => stopRef.current !== "full")] as const;
  }, [offset, stops, moveSheet]);

  // Over the map the controls float; as the sheet reaches them they sit on the page.
  const controlsGround = useMemo(
    () => offset.interpolate({ inputRange: [0, space[8]], outputRange: [1, 0], extrapolate: "clamp" }),
    [offset],
  );
  // "Search this area" rides a step above the sheet, and fades before the sheet
  // can crowd it against the controls — it never sits over the rentals.
  const areaPillOpacity = useMemo(
    () => offset.interpolate({
      inputRange: [pillHeight + space[6], pillHeight + space[12]],
      outputRange: [0, 1],
      extrapolate: "clamp",
    }),
    [offset, pillHeight],
  );

  // Everything the sheet holds, counted once for the Filters button. Place is
  // not one of them: the search bar owns it, and the one clear for it.
  const refinementCount = [
    rentMin || rentMax,
    propertyType,
    spaceType,
    bedrooms,
    advanceMax,
    furnished,
    sort !== "newest",
  ].filter(Boolean).length;

  const resultCount = listings === null ? "" : `${listings.length}${next ? "+" : ""}`;
  const resultWord = listings?.length === 1 && !next ? "rental" : "rentals";
  const areaName = bbox ? " in this map area" : area ? ` in ${area.name.split(",")[0]}` : "";
  const sheetOpen = stop !== "peek";
  // The rentals scroll once the sheet is full; below that, dragging them moves the sheet.
  const listScrolls = !showMap || stop === "full";
  // A narrow phone keeps the search bar wide: the Filters button drops its word.
  const compactControls = screenWidth < 340;

  // What the screen covers of the map. Full keeps half's: the map is out of sight then.
  const mapInsets = useMemo(() => ({
    top: controlsHeight,
    right: 0,
    bottom: stop === "peek" ? peek : Math.max(peek, sheetHeight - stops.half),
    left: 0,
  }), [controlsHeight, stop, peek, sheetHeight, stops.half]);

  const markers = useMemo(() => features.map((feature): MapMarker => {
    const key = markerKey(feature);
    const ids = feature.type === "listing" ? [feature.id] : feature.ids ?? [];
    const selected = selection !== null
      && (selection.key === key || (feature.type === "listing" && selection.ids.includes(feature.id)));
    const seen = ids.length > 0 && ids.every((id) => visited.has(id));
    const position = { lat: feature.lat, lng: feature.lng };
    if (feature.type === "listing") {
      const rent = feature.rent_minor === null ? "Rent not stated" : formatMinor(feature.rent_minor, feature.rent_currency);
      return {
        key, position, kind: "price", selected, visited: seen,
        label: compactRent(feature.rent_minor, feature.rent_period),
        accessibilityLabel: `${rent} per ${rentPeriod(feature.rent_period)}. Approximate location. Show this rental.`,
      };
    }
    const from = feature.min_rent_minor === null ? "" : `, from ${formatMinor(feature.min_rent_minor, feature.rent_currency)}`;
    return feature.stacked
      ? {
        key, position, kind: "stack", count: feature.count, selected, visited: seen,
        label: `from ${compactRent(feature.min_rent_minor)}`,
        accessibilityLabel: `${feature.count} rentals at this spot${from}. Show them.`,
      }
      : {
        key, position, kind: "cluster", count: feature.count, selected, visited: seen,
        label: feature.count > 999 ? "999+" : String(feature.count),
        accessibilityLabel: `${feature.count} rentals nearby${from}. Zoom in to see them.`,
      };
  }), [features, selection, visited]);

  const showSearchArea = Boolean(showMap && userMoved && view && anchor && movedMeaningfully(view, anchor));
  const previewListing = preview[Math.min(previewIndex, Math.max(preview.length - 1, 0))];
  const previewing = Boolean(showMap && selection && previewListing && stop === "peek");

  function pressMarker(key: string) {
    Keyboard.dismiss();
    const feature = features.find((row) => markerKey(row) === key);
    if (!feature) return;
    if (feature.type === "listing") {
      setPreviewIndex(0);
      setSelection({ key, ids: [feature.id] });
      setStop("peek");
      return;
    }
    // A stack never separates by zooming, so it opens its rentals instead.
    if (feature.stacked && feature.ids?.length) {
      setPreviewIndex(0);
      setSelection({ key, ids: feature.ids });
      setStop("peek");
      return;
    }
    setSelection(null);
    setFit({ key: `${key}:${Date.now()}`, bounds: grow(feature.bounds, 0.35) });
  }

  // A tap on the ground puts the keyboard and the preview away.
  function pressBackground() {
    Keyboard.dismiss();
    setSelection(null);
  }

  function moveMap(move: MapMove) {
    viewRef.current = move;
    setView(move);
    if (move.byUser) {
      movedRef.current = true;
      setUserMoved(true);
    } else if (!movedRef.current) {
      // Until the tenant moves the map, wherever Rooomly puts it is what the results describe.
      setAnchor(move);
    }
  }

  // Asked for, never automatic: moving the map is looking, not searching.
  function searchThisArea() {
    if (!view) return;
    setBbox({
      west: roundCoordinate(view.bounds.west),
      south: roundCoordinate(view.bounds.south),
      east: roundCoordinate(view.bounds.east),
      north: roundCoordinate(view.bounds.north),
    });
    setUserMoved(false);
  }

  function stepSheet(by: 1 | -1) {
    setStop((current) => SHEET_ORDER[Math.max(0, Math.min(SHEET_ORDER.length - 1, SHEET_ORDER.indexOf(current) + by))] ?? current);
  }

  // Typing over a place, or over an area searched from the map, asks a new question.
  function editPlace(text: string) {
    resolveRequest.current += 1;
    setResolving(false);
    setArea(null);
    setBbox(null);
    setPlace(text);
  }

  function clearPlace() {
    resolveRequest.current += 1;
    setResolving(false);
    // An abandoned session is never picked up again: the next search opens its own.
    session.current = null;
    setArea(null);
    setBbox(null);
    setPlace("");
    setSuggestions([]);
  }

  async function choosePlace(row: PlaceSuggestion) {
    Keyboard.dismiss();
    const id = ++resolveRequest.current;
    setResolving(true);
    try {
      const chosen = await resolvePlace(row, session.current);
      // Resolving spends the session; the next search starts another.
      session.current = null;
      // Typed over or cleared while it was on its way: the tenant has moved on.
      if (id !== resolveRequest.current) return;
      suggestionRequest.current += 1;
      setSuggestions([]);
      setBbox(null);
      setArea({ name: chosen.display_name, bounds: chosen.bounds, ref: `${chosen.provider}:${chosen.reference}` });
      setPlace(chosen.display_name);
      setStop("peek");
      setError("");
    } catch {
      if (id === resolveRequest.current) setError("That place did not open. Choose it again, or search the text.");
    } finally {
      if (id === resolveRequest.current) setResolving(false);
    }
  }

  function openListing(listing: Listing) {
    setVisited((current) => new Set(current).add(listing.id));
    router.push({ pathname: "/(app)/listing/[id]", params: { id: listing.id } } as never);
  }

  async function toggleSave(listing: Listing) {
    if (!signedIn) { router.push("/(auth)/welcome" as never); return; }
    const has = saved.has(listing.id);
    // Optimistic: shortlisting is private and reversible, so a wrong guess costs
    // nothing and waiting costs the feel of the whole screen.
    setSaved((current) => {
      const nextSet = new Set(current);
      if (has) nextSet.delete(listing.id); else nextSet.add(listing.id);
      return nextSet;
    });
    try {
      await (has ? unsaveListing(listing.id) : saveListing(listing.id));
    } catch {
      setSaved((current) => {
        const nextSet = new Set(current);
        if (has) nextSet.add(listing.id); else nextSet.delete(listing.id);
        return nextSet;
      });
    }
  }

  // Filters, not place: the search bar keeps the one clear for that.
  function clearFilters() {
    setPropertyType(""); setSpaceType(""); setBedrooms("");
    setRentMin(""); setRentMax(""); setAdvanceMax(""); setFurnished(false); setSort("newest");
  }

  function changePropertyType(value: string) {
    setPropertyType(value);
    if (!spaceType) return;
    const allowed = propertyTypes.find((type) => type.value === value)?.space_types ?? [];
    if (value && !allowed.some((space_) => space_.value === spaceType)) setSpaceType("");
  }

  return (
    <View
      style={{ flex: 1, overflow: "hidden", backgroundColor: theme.color.field["100"] }}
      onLayout={(event) => setScreenHeight(event.nativeEvent.layout.height)}
    >
      {showMap && config ? (
        <RooomlyMap
          initialView={config.default_view}
          fit={fit}
          insets={mapInsets}
          markers={markers}
          onMove={moveMap}
          onMarkerPress={pressMarker}
          onBackgroundPress={pressBackground}
        />
      ) : null}

      {/* One search bar and one Filters button: over the map while it shows,
          on the page once the rentals cover it. */}
      <View
        pointerEvents="box-none"
        onLayout={(event) => setControlsHeight(event.nativeEvent.layout.height)}
        style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 4 }}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderBottomWidth: 1,
              borderBottomColor: theme.color.field["200"],
              backgroundColor: theme.color.field["50"],
              opacity: showMap ? controlsGround : 1,
            },
          ]}
        />
        <View
          pointerEvents="box-none"
          style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: 10 }}
        >
          <SearchBox
            value={place}
            placeChosen={Boolean(area)}
            onChangeText={editPlace}
            onClear={clearPlace}
          />
          <FiltersButton count={refinementCount} compact={compactControls} onPress={() => { Keyboard.dismiss(); setFiltersOpen(true); }} />
        </View>
      </View>

      {/* Beside the controls rather than inside them: Android delivers no touch
          to a child drawn outside its parent's bounds. */}
      {suggestions.length || resolving ? (
        <PlaceSuggestions
          suggestions={suggestions}
          attribution={attribution}
          resolving={resolving}
          onChoose={(row) => void choosePlace(row)}
          style={{ position: "absolute", top: controlsHeight - space[1], left: space[3], right: space[3], zIndex: 8 }}
        />
      ) : null}

      {showSearchArea && stop !== "full" && !previewing ? (
        <Animated.View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            // Placed against the sheet's top edge, and carried with it.
            top: controlsHeight - pillHeight - space[3],
            zIndex: 3,
            alignItems: "center",
            opacity: areaPillOpacity,
            transform: [{ translateY: offset }],
          }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={searchThisArea}
            onLayout={(event) => setPillHeight(event.nativeEvent.layout.height)}
            {...pressableFeedback(theme.color.kola["50"])}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: space[2],
              paddingLeft: space[3],
              paddingRight: space[4],
              borderWidth: 1,
              borderColor: theme.color.kola["300"],
              borderRadius: radius.pill,
              backgroundColor: pressed && Platform.OS !== "android" ? theme.color.kola["50"] : theme.color.field["0"],
              ...FLOATING,
            })}
          >
            <Ionicons name="search" size={16} color={theme.color.kola["600"]} />
            <Type variant="captionStrong" style={{ color: theme.color.kola["800"] }}>Search this area</Type>
          </Pressable>
        </Animated.View>
      ) : null}

      {previewing ? (
        <MapPreview
          listings={preview}
          index={Math.min(previewIndex, preview.length - 1)}
          onStep={setPreviewIndex}
          onOpen={openListing}
          onClose={() => setSelection(null)}
          style={{ position: "absolute", left: space[3], right: space[3], bottom: peek + space[3], zIndex: 5 }}
        />
      ) : null}

      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: controlsHeight,
          height: sheetHeight,
          zIndex: 2,
          borderTopLeftRadius: showMap ? 20 : 0,
          borderTopRightRadius: showMap ? 20 : 0,
          backgroundColor: theme.color.field["50"],
          shadowColor: theme.color.ink["950"],
          shadowOpacity: showMap ? 0.14 : 0,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: -4 },
          elevation: showMap ? 12 : 0,
          transform: [{ translateY: offset }],
        }}
      >
        <View
          {...(showMap ? handleDrag.panHandlers : {})}
          onLayout={(event) => setSheetHeaderHeight(event.nativeEvent.layout.height)}
          style={{ paddingHorizontal: space[4], paddingBottom: space[2] }}
        >
          {showMap ? (
            <Pressable
              accessibilityRole="adjustable"
              accessibilityLabel="Rentals list"
              accessibilityValue={{ text: stop === "full" ? "Whole screen" : stop === "half" ? "Half the screen" : "Below the map" }}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(event) => stepSheet(event.nativeEvent.actionName === "increment" ? 1 : -1)}
              hitSlop={{ top: 8, bottom: 4, left: 48, right: 48 }}
              onPress={() => setStop(sheetOpen ? "peek" : "half")}
              style={{ alignSelf: "center", paddingTop: space[2], paddingBottom: space[1], paddingHorizontal: space[6] }}
            >
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.color.field["300"] }} />
            </Pressable>
          ) : (
            <Type variant="caption" style={{ paddingTop: space[2], paddingBottom: space[1] }}>
              The map is not available in this build. Every rental is in the list.
            </Type>
          )}

          {/* The count and the one Clear all share a line: what the filters
              produce, beside the way to undo them. */}
          <View style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: space[2] }}>
            {listings === null || querying ? <ActivityIndicator size="small" color={theme.color.kola["600"]} /> : null}
            <Type
              variant="bodyStrong"
              accessibilityLiveRegion="polite"
              numberOfLines={1}
              style={{ flex: 1, color: theme.color.ink["900"] }}
            >
              {listings === null ? "Finding rentals…" : querying ? "Updating rentals…" : `${resultCount} ${resultWord}${areaName}`}
            </Type>
            {refinementCount ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
                hitSlop={6}
                onPress={clearFilters}
                {...pressableFeedback(theme.color.kola["50"])}
                style={({ pressed }) => ({
                  minHeight: 36,
                  justifyContent: "center",
                  paddingHorizontal: space[2],
                  borderRadius: radius.md,
                  backgroundColor: pressed && Platform.OS !== "android" ? theme.color.kola["50"] : "transparent",
                })}
              >
                <Type variant="captionStrong" style={{ color: theme.color.kola["800"] }}>Clear all</Type>
              </Pressable>
            ) : null}
            {showMap && stop === "full" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show the map"
                hitSlop={6}
                onPress={() => setStop("peek")}
                {...pressableFeedback("rgba(255,255,255,0.24)")}
                style={({ pressed }) => ({
                  minHeight: 36,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: space[3],
                  borderRadius: radius.pill,
                  backgroundColor: pressed && Platform.OS !== "android" ? theme.color.kola["800"] : theme.color.kola["600"],
                })}
              >
                <Ionicons name="map" size={15} color={theme.color.field["0"]} />
                <Type variant="captionStrong" style={{ color: theme.color.field["0"] }}>Map</Type>
              </Pressable>
            ) : null}
          </View>

          {bbox ? (
            <View style={{ flexDirection: "row", paddingBottom: space[1] }}>
              <AreaChip onPress={() => setBbox(null)} />
            </View>
          ) : null}

          {error ? <Notice tone="error" title={error} /> : null}
        </View>

        <View style={{ flex: 1 }} {...(showMap ? listDrag.panHandlers : {})}>
          <FlatList
            ref={list}
            data={listings ?? []}
            keyExtractor={(item) => item.id}
            scrollEnabled={listScrolls}
            contentContainerStyle={{
              paddingHorizontal: space[4],
              paddingTop: space[1],
              paddingBottom: space[8] + (inTabs ? 0 : insets.bottom),
              gap: space[4],
            }}
            refreshControl={
              <RefreshControl
                // Android's pull-to-refresh would otherwise take the drag that moves the sheet.
                enabled={listScrolls}
                refreshing={refreshing}
                onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
                tintColor={theme.color.kola["600"]}
              />
            }
            // Discovery keeps going rather than stopping at the first twenty.
            onEndReachedThreshold={0.6}
            onEndReached={async () => {
              if (!next || loadingMore) return;
              setLoadingMore(true);
              try {
                const page = await searchListingsPage(next);
                setListings((current) => [...(current ?? []), ...page.results]);
                setNext(page.next);
              } catch {
                // A failed page must never empty the ones already scrolled past.
              } finally {
                setLoadingMore(false);
              }
            }}
            renderItem={({ item }) => (
              <ListingCard
                listing={item}
                saved={saved.has(item.id)}
                onSave={() => void toggleSave(item)}
                onPress={() => openListing(item)}
                // Photos swipe once the list is the screen; below that a swipe moves the sheet.
                photoSwipe={listScrolls}
              />
            )}
            ListFooterComponent={
              loadingMore ? (
                <View style={{ paddingVertical: space[5] }}>
                  <ActivityIndicator color={theme.color.kola["600"]} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              listings === null && !error ? null : (
                // Guidance only: the one Clear all sits just above, beside the count.
                <View style={{ paddingVertical: space[8], gap: space[2] }}>
                  <Type variant="bodyStrong">Nothing matches yet</Type>
                  <Type variant="caption">Try a wider rent, a longer advance, or a nearby area.</Type>
                </View>
              )
            }
          />
        </View>
      </Animated.View>

      <FilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        propertyTypes={propertyTypes}
        propertyType={propertyType}
        onPropertyTypeChange={changePropertyType}
        spaceTypes={spaceTypes}
        spaceType={spaceType}
        onSpaceTypeChange={setSpaceType}
        bedrooms={bedrooms}
        onBedroomsChange={setBedrooms}
        rentMin={rentMin}
        onRentMinChange={setRentMin}
        rentMax={rentMax}
        onRentMaxChange={setRentMax}
        advanceMax={advanceMax}
        onAdvanceMaxChange={setAdvanceMax}
        furnished={furnished}
        onFurnishedChange={setFurnished}
        sort={sort}
        onSortChange={setSort}
        canClear={refinementCount > 0}
        onClear={clearFilters}
        resultLabel={listings === null || querying ? "Updating rentals…" : `Show ${resultCount} ${resultWord}`}
      />
    </View>
  );
}

/**
 * The places a typed name might mean, from Rooomly's API. Google's carry its
 * name beneath them: here they are shown with no Google map in sight.
 */
function PlaceSuggestions({
  suggestions,
  attribution,
  resolving,
  onChoose,
  style,
}: {
  suggestions: PlaceSuggestion[];
  attribution: string | null;
  resolving: boolean;
  onChoose: (row: PlaceSuggestion) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          overflow: "hidden",
          borderWidth: 1,
          borderColor: theme.color.field["200"],
          borderRadius: radius.lg,
          backgroundColor: theme.color.field["0"],
          shadowColor: theme.color.ink["950"],
          shadowOpacity: 0.16,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          // Above the sheet's own elevation, which Android draws by before zIndex.
          elevation: 20,
        },
        style,
      ]}
    >
      {resolving ? (
        <View style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4] }}>
          <ActivityIndicator size="small" color={theme.color.kola["600"]} />
          <Type variant="caption" accessibilityLiveRegion="polite">Opening that place…</Type>
        </View>
      ) : null}
      {suggestions.map((row, index) => (
        <Pressable
          key={`${row.provider}:${row.reference}`}
          accessibilityRole="button"
          accessibilityLabel={row.context ? `${row.name}, ${row.context}` : row.name}
          disabled={resolving}
          onPress={() => onChoose(row)}
          {...pressableFeedback(theme.color.kola["50"])}
          style={({ pressed }) => ({
            minHeight: 58,
            flexDirection: "row",
            alignItems: "center",
            gap: space[3],
            paddingHorizontal: space[3],
            borderTopWidth: index || resolving ? 1 : 0,
            borderTopColor: theme.color.field["100"],
            backgroundColor: pressed && Platform.OS !== "android" ? theme.color.kola["50"] : "transparent",
          })}
        >
          <View
            style={{
              width: 32,
              height: 32,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 16,
              backgroundColor: KIND_TINT[row.kind].background,
            }}
          >
            <Ionicons name={KIND_ICON[row.kind]} size={17} color={KIND_TINT[row.kind].color} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Type variant="bodyStrong" numberOfLines={1}>{row.name}</Type>
            {row.context ? <Type variant="caption" numberOfLines={1}>{row.context}</Type> : null}
          </View>
        </Pressable>
      ))}
      {attribution === "google" && suggestions.length ? (
        <Type variant="caption" style={{ alignSelf: "flex-end", paddingHorizontal: space[3], paddingVertical: space[1], color: theme.color.ink["700"], fontSize: 12 }}>
          Google Maps
        </Type>
      ) : null}
    </View>
  );
}

/** The rental a marker stands for, over the map; a stack pages through its rentals. */
function MapPreview({
  listings,
  index,
  onStep,
  onOpen,
  onClose,
  style,
}: {
  listings: Listing[];
  index: number;
  onStep: (index: number) => void;
  onOpen: (listing: Listing) => void;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const listing = listings[index];
  if (!listing) return null;
  const photo = listing.card_media?.find((item) => Boolean(item.download_url))?.download_url ?? listing.cover_url;
  const rent = listing.rent_formatted ?? formatMinor(listing.rent_minor ?? 0);
  const period = rentPeriod(listing.rent_period);
  // Never the rent without the lump sum it takes to move in.
  const advance = advanceTerm(listing.advance_label);
  const where = [listing.locality_name, listing.district_name].filter(Boolean).join(", ");

  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: theme.color.field["200"],
          borderRadius: radius.lg,
          backgroundColor: theme.color.field["0"],
          shadowColor: theme.color.ink["950"],
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
        },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${listing.headline}. ${rent} per ${period}. ${advance}. ${where || "Ghana"}.`}
        onPress={() => onOpen(listing)}
        {...pressableFeedback(theme.color.field["100"])}
        style={({ pressed }) => ({
          minHeight: 116,
          flexDirection: "row",
          overflow: "hidden",
          borderRadius: radius.lg,
          opacity: pressed && Platform.OS !== "android" ? 0.86 : 1,
        })}
      >
        {photo ? (
          <Image source={{ uri: photo }} accessible={false} resizeMode="cover" style={{ width: 112, backgroundColor: theme.color.field["100"] }} />
        ) : (
          <View style={{ width: 112, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.field["100"] }}>
            <Ionicons name="image-outline" size={24} color={theme.color.ink["300"]} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0, justifyContent: "center", gap: 3, paddingVertical: space[3], paddingLeft: space[3], paddingRight: space[10] }}>
          <Type variant="bodyStrong" numberOfLines={1} style={{ color: theme.color.ink["950"] }}>
            {rent}
            <Type variant="caption" style={{ color: theme.color.ink["500"] }}>{` / ${period}`}</Type>
          </Type>
          <View style={{ alignSelf: "flex-start", maxWidth: "100%", paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.pill, backgroundColor: theme.color.gold["50"] }}>
            <Type variant="captionStrong" numberOfLines={1} style={{ color: theme.color.gold["700"], fontSize: 12 }}>{advance}</Type>
          </View>
          <Type variant="caption" numberOfLines={1} style={{ color: theme.color.ink["900"] }}>{listing.headline}</Type>
          <Type variant="caption" numberOfLines={1}>{where || "Ghana"}</Type>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close preview"
        hitSlop={8}
        onPress={onClose}
        {...pressableFeedback(theme.color.field["200"])}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 32,
          height: 32,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 16,
          backgroundColor: theme.color.field["100"],
        }}
      >
        <Ionicons name="close" size={16} color={theme.color.ink["700"]} />
      </Pressable>
      {listings.length > 1 ? (
        <View
          style={{
            minHeight: 40,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: space[1],
            borderTopWidth: 1,
            borderTopColor: theme.color.field["200"],
            borderBottomLeftRadius: radius.lg,
            borderBottomRightRadius: radius.lg,
            backgroundColor: theme.color.kola["50"],
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous rental here"
            accessibilityState={{ disabled: index === 0 }}
            disabled={index === 0}
            hitSlop={6}
            onPress={() => onStep(index - 1)}
            style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: index === 0 ? 0.35 : 1 }}
          >
            <Ionicons name="chevron-back" size={18} color={theme.color.kola["800"]} />
          </Pressable>
          <Type variant="captionStrong" style={{ color: theme.color.kola["800"] }}>{`${index + 1} of ${listings.length} here`}</Type>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next rental here"
            accessibilityState={{ disabled: index >= listings.length - 1 }}
            disabled={index >= listings.length - 1}
            hitSlop={6}
            onPress={() => onStep(index + 1)}
            style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: index >= listings.length - 1 ? 0.35 : 1 }}
          >
            <Ionicons name="chevron-forward" size={18} color={theme.color.kola["800"]} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** The map area a search was narrowed to, and its one way back to the whole place. */
function AreaChip({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Remove the map area"
      hitSlop={6}
      onPress={onPress}
      {...pressableFeedback(theme.color.lagoon["100"])}
      style={({ pressed }) => ({
        minHeight: 32,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: space[3],
        paddingRight: 10,
        borderRadius: radius.pill,
        backgroundColor: theme.color.lagoon["100"],
        opacity: pressed && Platform.OS !== "android" ? 0.72 : 1,
      })}
    >
      <Ionicons name="scan-outline" size={14} color={theme.color.lagoon["600"]} />
      <Type variant="captionStrong" style={{ color: theme.color.lagoon["600"] }}>Map area</Type>
      <Ionicons name="close" size={14} color={theme.color.lagoon["600"]} />
    </Pressable>
  );
}

/**
 * The search bar: the "Search this area" pill grown into a field, so the two
 * controls floating over the map read as one family.
 */
function SearchBox({
  value,
  placeChosen,
  onChangeText,
  onClear,
}: {
  value: string;
  placeChosen: boolean;
  onChangeText: (value: string) => void;
  onClear: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {/* The ring is drawn behind the bar, the construction `Field` uses: the
          border never thickens, so focusing moves nothing. */}
      {focused ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: -3, right: -3, bottom: -3, left: -3, borderRadius: radius.pill, backgroundColor: theme.color.kola["50"] }}
        />
      ) : null}
      <View
        style={{
          minHeight: 46,
          flexDirection: "row",
          alignItems: "center",
          gap: space[2],
          paddingLeft: space[3] + 2,
          paddingRight: value ? space[1] : space[4],
          borderWidth: 1,
          borderColor: focused ? theme.color.kola["600"] : theme.color.kola["300"],
          borderRadius: radius.pill,
          backgroundColor: theme.color.field["0"],
          ...FLOATING,
        }}
      >
        {/* A pin once a real place is chosen, a magnifier while it is free text. */}
        <Ionicons name={placeChosen ? "location" : "search"} size={18} color={theme.color.kola["600"]} />
        <TextInput
          accessibilityLabel="Search area"
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search area"
          placeholderTextColor={theme.color.ink["500"]}
          returnKeyType="search"
          // Place names are not dictionary words; autocorrect only mangles them.
          autoCorrect={false}
          // One clear: iOS can draw its own, which would sit beside this one.
          clearButtonMode="never"
          maxFontSizeMultiplier={1.3}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 44,
            paddingVertical: 0,
            color: theme.color.ink["900"],
            fontSize: 15,
            fontWeight: "600",
            includeFontPadding: false,
          }}
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={4}
            onPress={onClear}
            {...pressableFeedback(theme.color.field["200"])}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 19,
              backgroundColor: pressed && Platform.OS !== "android" ? theme.color.field["100"] : "transparent",
            })}
          >
            <Ionicons name="close" size={16} color={theme.color.ink["500"]} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** The one way into every filter, carrying the count of what is on. */
function FiltersButton({ count, compact, onPress }: { count: number; compact: boolean; onPress: () => void }) {
  const active = count > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? `Filters, ${count} active` : "Filters"}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => ({
        minWidth: 46,
        minHeight: 46,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: compact ? space[3] : space[4],
        borderWidth: 1,
        borderColor: active ? theme.color.kola["600"] : theme.color.kola["300"],
        borderRadius: radius.pill,
        backgroundColor: pressed && Platform.OS !== "android" ? theme.color.kola["50"] : theme.color.field["0"],
        ...FLOATING,
      })}
    >
      <Ionicons name="options-outline" size={18} color={theme.color.kola["600"]} />
      {compact ? null : (
        <Type variant="captionStrong" numberOfLines={1} style={{ color: theme.color.kola["800"] }}>Filters</Type>
      )}
      {active ? (
        <View
          style={{
            minWidth: 20,
            minHeight: 20,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 5,
            paddingVertical: 2,
            borderRadius: radius.pill,
            backgroundColor: theme.color.kola["600"],
          }}
        >
          <Type variant="label" style={{ color: theme.color.field["0"], fontSize: 11, lineHeight: 13, letterSpacing: 0 }}>{count}</Type>
        </View>
      ) : null}
    </Pressable>
  );
}

/** The dropdowns in the filter sheet, of which one at most is open. */
type FilterMenu = "property" | "unit" | "advance" | "sort";

const ANY = { value: "", label: "Any" };
const BEDROOM_OPTIONS = BEDROOMS.map(([value, label]) => ({ value, label }));
const ADVANCE_OPTIONS = ADVANCE.map(([value, label]) => ({ value, label }));
const SORT_OPTIONS = SORTS.map(([value, label]) => ({ value, label }));

function FilterSheet({
  visible,
  onClose,
  propertyTypes,
  propertyType,
  onPropertyTypeChange,
  spaceTypes,
  spaceType,
  onSpaceTypeChange,
  bedrooms,
  onBedroomsChange,
  rentMin,
  onRentMinChange,
  rentMax,
  onRentMaxChange,
  advanceMax,
  onAdvanceMaxChange,
  furnished,
  onFurnishedChange,
  sort,
  onSortChange,
  canClear,
  onClear,
  resultLabel,
}: {
  visible: boolean;
  onClose: () => void;
  propertyTypes: PropertyTypeOption[];
  propertyType: string;
  onPropertyTypeChange: (value: string) => void;
  spaceTypes: { value: string; label: string }[];
  spaceType: string;
  onSpaceTypeChange: (value: string) => void;
  bedrooms: string;
  onBedroomsChange: (value: string) => void;
  rentMin: string;
  onRentMinChange: (value: string) => void;
  rentMax: string;
  onRentMaxChange: (value: string) => void;
  advanceMax: string;
  onAdvanceMaxChange: (value: string) => void;
  furnished: boolean;
  onFurnishedChange: (value: boolean) => void;
  sort: ListingSort;
  onSortChange: (value: ListingSort) => void;
  canClear: boolean;
  onClear: () => void;
  resultLabel: string;
}) {
  // One dropdown open at a time, and none left open when the sheet comes back.
  const [open, setOpen] = useState<FilterMenu | null>(null);
  useEffect(() => {
    if (!visible) setOpen(null);
  }, [visible]);
  const toggle = (field: FilterMenu) => setOpen((current) => (current === field ? null : field));

  // The sheet itself — its drag, its way back, its safe edges — is the shared
  // `BottomSheet`. This says only what Explore's filters are, in as few rows as
  // they fit: a rent range, dropdowns for the longer lists, a segmented choice
  // for bedrooms and a switch.
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      closeLabel="Close filters"
      footer={(
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canClear }}
            disabled={!canClear}
            onPress={onClear}
            {...pressableFeedback(theme.color.kola["50"])}
            style={({ pressed }) => ({
              minHeight: 48,
              justifyContent: "center",
              paddingHorizontal: space[3],
              borderRadius: radius.md,
              opacity: pressed && Platform.OS !== "android" ? 0.72 : 1,
            })}
          >
            <Type variant="bodyStrong" style={{ color: canClear ? theme.color.kola["800"] : theme.color.ink["300"] }}>Clear all</Type>
          </Pressable>
          <View style={{ flex: 1 }}><Button label={resultLabel} onPress={onClose} /></View>
        </>
      )}
    >
      <PriceRange
        minimum={rentMin}
        maximum={rentMax}
        onChange={(minimum, maximum) => {
          onRentMinChange(minimum);
          onRentMaxChange(maximum);
        }}
      />
      <SelectField
        label="Property type"
        value={propertyType}
        options={[ANY, ...propertyTypes]}
        open={open === "property"}
        onToggle={() => toggle("property")}
        onChange={(value) => {
          onPropertyTypeChange(value);
          setOpen(null);
        }}
      />
      <SelectField
        label="Unit type"
        value={spaceType}
        options={[ANY, ...spaceTypes]}
        open={open === "unit"}
        onToggle={() => toggle("unit")}
        onChange={(value) => {
          onSpaceTypeChange(value);
          setOpen(null);
        }}
      />
      <SegmentedField
        label="Bedrooms"
        value={bedrooms}
        options={BEDROOM_OPTIONS}
        onChange={onBedroomsChange}
      />
      <SelectField
        label="Maximum advance"
        value={advanceMax}
        options={ADVANCE_OPTIONS}
        open={open === "advance"}
        onToggle={() => toggle("advance")}
        onChange={(value) => {
          onAdvanceMaxChange(value);
          setOpen(null);
        }}
      />
      <ToggleField
        label="Furnished only"
        value={furnished}
        onChange={onFurnishedChange}
      />
      <SelectField
        label="Sort by"
        value={sort}
        options={SORT_OPTIONS}
        open={open === "sort"}
        onToggle={() => toggle("sort")}
        onChange={(value) => {
          onSortChange(value);
          setOpen(null);
        }}
      />
    </BottomSheet>
  );
}
