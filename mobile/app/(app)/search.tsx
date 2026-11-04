import { useGuestSignIn } from "@/components/auth/GuestSignIn";
import Ionicons from "@expo/vector-icons/Ionicons";
import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,

  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { PriceRange, SegmentedField, SelectField, ToggleField } from "@/components/filters/FilterFields";
import { ListingCard, advanceTerm, rentPeriod } from "@/components/listings/ListingCard";
import { ExploreHero, ExploreResults, HERO_FLARE, HeroSearch, type ExploreMode } from "@/components/explore/ExploreHero";
import { ExploreHeaderActions } from "@/components/nav/ExploreHeaderActions";
import { AllExplore } from "@/components/explore/AllExplore";
import { SaleCard } from "@/components/sales/SaleCard";
import { SaleExplore } from "@/components/sales/SaleExplore";
import {
  NO_SALE_CHOICES,
  SaleFilterCards,
  saleFiltersFrom,
  saleRefinements,
  type SaleChoices,
} from "@/components/sales/SaleFilterSheet";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { SheetCard, SheetGlassButton, SheetPrimaryButton } from "@/components/sheet/SheetParts";
import { AllFilterCards, ShowField } from "@/components/explore/ExploreShow";
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
import { DanpaHQMap, mapAvailable, type MapMarker, type MapMove } from "@/maps";
import { compactRent, getListingsById, roundCoordinate, searchListingMap, type MapFeature } from "@/mapSearch";
import { useReduceMotion } from "@/motion";
import {
  getMapConfig,
  type GeoBounds,
  type MapConfig,
} from "@/places";
import { pressableFeedback, useFloatingTabBarClearance, useInTabs } from "@/platform";
import { loadPropertyTypes, type PropertyTypeOption } from "@/propertyTypes";
import { searchSales, searchSalesPage, type SaleCard as Sale, type SaleKind } from "@/sales";
import { locationSearchArea, uniqueLocationMatch } from "@/exploreLocation";
import { searchLocations, type LocationReference } from "@/locations";
import { theme } from "@/theme";

/**
 * Finding a place to rent, on a map.
 *
 * Search → scan → compare → open, with the map as the ground it happens on.
 * One search bar and one Filters button float over the map. The map and the
 * list are two views, switched with a button — List floats over the map,
 * Map sits beside the count over the list — and never dragged between (owner,
 * 2026-10-06: the sliding sheet is gone). A marker previews its
 * rental without leaving the map, and the list and the markers are one search —
 * the same filters and the same box, built once (`listingQuery`).
 *
 * Where you are looking is the first question a Ghanaian tenant asks, so it
 * leads. Typed names search our own listings database without geocoding. Everything else — rent,
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
  ["36", "Up to 3 years"],
];

const SORTS: readonly (readonly [ListingSort, string])[] = [
  ["newest", "Newest first"],
  ["rent_asc", "Rent: low to high"],
  ["rent_desc", "Rent: high to low"],
];

type SearchArea = { name: string; bounds: GeoBounds; ref: string };
type Selection = { key: string; ids: string[] };
type MapFeedback = { message: string; tone: "danger" | "success" };
type AreaSearchProgress = {
  key: string;
  waitRent: boolean;
  waitSale: boolean;
  rent: number | null;
  sale: number | null;
};
/** What the List button keeps of the map's foot: its height and its margin. */
const LIST_BUTTON_ROOM = 76;

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
/** How long the map waits for the server's settings before opening on its own. */
const MAP_CONFIG_WAIT_MS = 1500;


/** What kind of place it is, told by colour as well: lagoon, gold, kola. */

const markerKey = (feature: MapFeature) =>
  feature.type === "listing" ? `listing:${feature.id}` : `cluster:${feature.key}`;

function grow(bounds: GeoBounds, by: number): GeoBounds {
  const dx = (bounds.east - bounds.west) * by;
  const dy = (bounds.north - bounds.south) * by;
  return { west: bounds.west - dx, south: bounds.south - dy, east: bounds.east + dx, north: bounds.north + dy };
}

const boundsKey = (bounds: GeoBounds | null) => bounds
  ? [bounds.west, bounds.south, bounds.east, bounds.north].join(":")
  : null;

/**
 * Rent or Buy — the first choice on Explore (owner, 2026-09-28).
 *
 * Properties for sale are their own search: sold whole, priced in the hundreds
 * of thousands, filtered by tenure. So Buy swaps the screen under the switch
 * rather than adding filters to Rent's, and switching starts the other side's
 * search fresh — a rent range means nothing to a sale.
 */
export default function SearchScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  // Explore opens on everything; Rent and Buy are chosen (owner, 2026-09-29).
  const [side, setSide] = useState<ExploreMode>(mode === "buy" ? "buy" : mode === "rent" ? "rent" : "all");
  const insets = useSafeAreaInsets();
  const inTabs = useInTabs();
  const barClearance = useFloatingTabBarClearance();
  // Inside the tabs the hero is the header, and carries Saved and profile.
  const actions = inTabs ? <ExploreHeaderActions /> : undefined;
  const bottomPadding = space[8] + (inTabs ? barClearance : insets.bottom);
  // With a map every side is the map screen, and sales stand on it beside the
  // rentals (owner, 2026-09-29). A build without one lists each side instead.
  if (mapAvailable()) {
    return <MapExplore inTabs={inTabs} actions={actions} mode={side} onModeChange={setSide} />;
  }
  if (side === "all") return <AllExplore inTabs={inTabs} actions={actions} onModeChange={setSide} bottomPadding={bottomPadding} />;
  return side === "buy"
    ? <SaleExplore inTabs={inTabs} actions={actions} onModeChange={setSide} bottomPadding={bottomPadding} />
    : <MapExplore inTabs={inTabs} actions={actions} mode="rent" onModeChange={setSide} />;
}

/** One row of the list: a rental or a property for sale. */
type Item =
  | { side: "rent"; at: string; listing: Listing }
  | { side: "sale"; at: string; sale: Sale };

/** "₵850k", "₵1.2m": a sale's price, short enough for a marker. */
function compactSalePrice(minor: number | null): string {
  if (minor === null) return "For sale";
  const cedis = minor / 100;
  if (cedis >= 1_000_000) return `₵${Number((cedis / 1_000_000).toFixed(1))}m`;
  if (cedis >= 1_000) return `₵${Math.round(cedis / 1_000)}k`;
  return `₵${Math.round(cedis)}`;
}

function MapExplore({
  inTabs: heroInTabs,
  actions,
  mode,
  onModeChange,
}: {
  inTabs: boolean;
  actions?: ReactNode;
  mode: ExploreMode;
  onModeChange: (mode: ExploreMode) => void;
}) {
  const router = useRouter();
  // Which sides this view shows. All shows both; each side shows itself.
  const showRent = mode !== "buy";
  const showSale = mode !== "rent";
  const insets = useSafeAreaInsets();
  // Inside the tabs the tab bar already keeps clear of the home indicator; a
  // pushed search has no bar, so its list keeps clear itself.
  const inTabs = useInTabs();
  // On iOS the glass bar floats over the map, so whatever sits at the map's
  // foot rides above it.
  const barClearance = useFloatingTabBarClearance();
  const reduceMotion = useReduceMotion();
  const { state } = useAuth();
  const requestSignIn = useGuestSignIn();
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
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[]>([]);
  const [propertyType, setPropertyType] = useState("");
  // All asks only the kinds both sides know; a hostel is only let, land only sold.
  const allType = propertyType === "residential" || propertyType === "commercial" ? propertyType : "";
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
  const locationLookup = useRef<AbortController | null>(null);
  useEffect(() => () => locationLookup.current?.abort(), []);

  // The map: what it draws, where it is, and what was tapped.
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [extent, setExtent] = useState<GeoBounds | null>(null);
  const [unmapped, setUnmapped] = useState(0);
  const [view, setView] = useState<MapMove | null>(null);
  const [userMoved, setUserMoved] = useState(false);
  const [fit, setFit] = useState<{ key: string; bounds: GeoBounds } | null>(null);
  const [mapFeedback, setMapFeedback] = useState<MapFeedback | null>(null);
  // A load that failed is said on the map too, not only inside the closed list.
  const [dismissedError, setDismissedError] = useState("");
  const areaSearchProgress = useRef<AreaSearchProgress | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [fetchedPreview, setFetchedPreview] = useState<{ selection: Selection; rows: Listing[] } | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const markerRequest = useRef(0);
  const summaryRequest = useRef(0);
  const viewRef = useRef<MapMove | null>(null);
  const [extentFitted, setExtentFitted] = useState(false);

  // Map or list. A build without a map is only ever the list.
  const [listOpen, setListOpen] = useState(!showMap);
  // Google never drew the map on this phone. Said briefly on the map itself.
  const [mapFailed, setMapFailed] = useState(false);
  const [screenHeight, setScreenHeight] = useState(0);
  const [controlsHeight, setControlsHeight] = useState(0);
  const [previewHeight, setPreviewHeight] = useState(0);
  const [listFade] = useState(() => new Animated.Value(showMap ? 0 : 1));
  const list = useRef<FlatList<Item>>(null);

  // Properties for sale: their own search, over the same place and area.
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [saleError, setSaleError] = useState("");
  const [saleQuerying, setSaleQuerying] = useState(false);
  const [nextSales, setNextSales] = useState<string | null>(null);
  const [saleChoices, setSaleChoices] = useState<SaleChoices>(NO_SALE_CHOICES);
  const saleRequest = useRef(0);

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
  const boxRequestKey = boundsKey(box);
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

  const recordAreaResult = useCallback((key: string | null, side: "rent" | "sale", count: number) => {
    const progress = areaSearchProgress.current;
    if (!key || !progress || progress.key !== key) return;
    progress[side] = count;
    const ready = (!progress.waitRent || progress.rent !== null)
      && (!progress.waitSale || progress.sale !== null);
    if (!ready) return;
    areaSearchProgress.current = null;
    if ((progress.rent ?? 0) + (progress.sale ?? 0) === 0) {
      setMapFeedback({
        message: "No properties found in this area. Move the map or adjust your filters.",
        tone: "danger",
      });
    } else {
      setMapFeedback({
        message: "Properties found in this area. Tap a marker or open the list.",
        tone: "success",
      });
    }
  }, []);

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
      recordAreaResult(boxRequestKey, "rent", page.results.length);
    } catch (cause) {
      if (id !== requestId.current) return;
      // The last results stay: a failed request is not a search that found nothing.
      setListings((current) => current ?? []);
      setNext(null);
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load rentals right now.");
    } finally {
      if (id === requestId.current) setQuerying(false);
    }
  }, [boxRequestKey, filters, recordAreaResult]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  // Sales over the same place and area as the rentals. Buy adds its own filters;
  // All shows every sale there, since its filters belong to one side each.
  const saleFilters = useMemo(() => ({
    q: filters.q,
    west: filters.west,
    south: filters.south,
    east: filters.east,
    north: filters.north,
    ...(mode === "buy" ? saleFiltersFrom(saleChoices) : {}),
    // All's shared filters reach the sales too: the kind both sides know, and bedrooms.
    ...(mode === "all" && (propertyType === "residential" || propertyType === "commercial")
      ? { kind: propertyType as SaleKind }
      : {}),
    ...(mode === "all" && bedrooms ? { bedrooms_min: Number(bedrooms) } : {}),
  }), [filters.q, filters.west, filters.south, filters.east, filters.north, mode, saleChoices, propertyType, bedrooms]);

  const loadSales = useCallback(async () => {
    const id = ++saleRequest.current;
    setSaleQuerying(true);
    setSaleError("");
    try {
      const page = await searchSales(saleFilters);
      if (id !== saleRequest.current) return;
      setSales(page.results);
      setNextSales(page.next);
      recordAreaResult(boxRequestKey, "sale", page.results.length);
    } catch {
      if (id === saleRequest.current) {
        setSales((current) => current ?? []);
        setSaleError("We could not load properties for sale. Please try again.");
      }
    } finally {
      if (id === saleRequest.current) setSaleQuerying(false);
    }
  }, [boxRequestKey, recordAreaResult, saleFilters]);

  useEffect(() => {
    if (!showSale) return;
    const timer = setTimeout(() => { void loadSales(); }, 250);
    return () => clearTimeout(timer);
  }, [loadSales, showSale]);

  useEffect(() => {
    if (!signedIn) return;
    void listSaved().then((rows) => setSaved(new Set(rows.map((row) => row.listing.id)))).catch(() => undefined);
  }, [signedIn]);

  useEffect(() => {
    void loadPropertyTypes().then(setPropertyTypes).catch(() => setPropertyTypes([]));
  }, []);

  // The map never waits long for its settings. It used to wait for this one
  // request, and on a phone that could not reach the API — retried three times,
  // twenty seconds each — Explore stood blank for over a minute with no word of
  // why. Past a moment the built-in Accra view opens it; the real settings
  // still arrive for everything after the first view.
  useEffect(() => {
    if (!showMap) return;
    let live = true;
    const late = setTimeout(() => {
      if (live) setConfig((current) => current ?? FALLBACK_MAP);
    }, MAP_CONFIG_WAIT_MS);
    void getMapConfig()
      .then((value) => { if (live) setConfig(value); })
      .catch(() => { if (live) setConfig((current) => current ?? FALLBACK_MAP); });
    return () => {
      live = false;
      clearTimeout(late);
    };
  }, [showMap]);

  const fetchMarkers = useCallback((move: MapMove | null, withSummary: boolean) => {
    const id = ++markerRequest.current;
    const summaryId = withSummary ? ++summaryRequest.current : 0;
    searchListingMap(filters, { window: move?.bounds ?? null, zoom: move?.zoom ?? 12, summary: withSummary })
      .then((answer) => {
        // The extent belongs to the search, so a newer window's markers never discard it.
        if (withSummary && summaryId === summaryRequest.current) setExtent(answer.extent ?? null);
        if (withSummary && summaryId === summaryRequest.current) setUnmapped(answer.unmapped ?? 0);
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
  }, [view, showMap, fetchMarkers]);

  // A different rental query invalidates the selected marker and map movement.
  const [previousFilters, setPreviousFilters] = useState(filters);
  if (previousFilters !== filters) {
    setPreviousFilters(filters);
    setSelection(null);
    setUserMoved(false);
  }

  // With no chosen place, fit the first extent returned for the search.
  if (!extentFitted && !area && !bbox && extent) {
    setExtentFitted(true);
    setFit({ key: "extent", bounds: extent });
  }

  // Use loaded cards when possible and ask the API for missing marker details.
  const knownPreview = useMemo(() => {
    if (!selection) return [];
    const known = new Map((listings ?? []).map((row) => [row.id, row]));
    return selection.ids.flatMap((id) => known.get(id) ?? []);
  }, [selection, listings]);
  const needsPreview = selection !== null && knownPreview.length !== selection.ids.length;
  const preview = needsPreview
    ? fetchedPreview?.selection === selection ? fetchedPreview.rows : []
    : knownPreview;
  useEffect(() => {
    if (!selection || !needsPreview) return;
    let live = true;
    getListingsById(selection.ids)
      .then((rows) => { if (live) setFetchedPreview({ selection, rows }); })
      .catch(() => { if (live) setFetchedPreview({ selection, rows: [] }); });
    return () => { live = false; };
  }, [selection, needsPreview, knownPreview]);

  // The list covers everything below the hero. It fades over the map rather
  // than sliding up it: the two views are switched, not dragged between.
  const listHeight = Math.max(0, screenHeight - controlsHeight);
  useEffect(() => {
    const toValue = listOpen ? 1 : 0;
    if (reduceMotion) {
      listFade.setValue(toValue);
      return;
    }
    const fade = Animated.timing(listFade, { toValue, duration: 180, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [listOpen, listFade, reduceMotion]);

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
  const saleCount = sales === null ? "" : `${sales.length}${nextSales ? "+" : ""}`;

  // What the list holds on this side: rentals, sales, or both newest first.
  const items = useMemo<Item[] | null>(() => {
    const rent = (listings ?? []).map((listing): Item => ({ side: "rent", at: listing.created_at, listing }));
    const sale = (sales ?? []).map((row): Item => ({ side: "sale", at: row.listed_at, sale: row }));
    if (mode === "rent") return listings === null ? null : rent;
    if (mode === "buy") return sales === null ? null : sale;
    return listings === null || sales === null ? null : [...rent, ...sale].sort((a, b) => b.at.localeCompare(a.at));
  }, [listings, sales, mode]);
  const hasSearch = Boolean(place.trim() || area || bbox || refinementCount || saleRefinements(saleChoices) || allType || bedrooms);
  const resultBusy = (showRent && querying) || (showSale && saleQuerying);
  const resultError = (showRent && error) || (showSale && saleError);
  const resultLine = items === null || resultBusy
    ? "Finding places…"
    : !hasSearch || resultError ? "Explore properties" : mode === "rent"
      ? querying ? "Updating rentals…" : `${resultCount} ${resultWord}`
      : mode === "buy"
        ? `${saleCount} for sale`
        : `${resultCount} to rent · ${saleCount} for sale`;
  // All counts the two filters both sides answer; Rent and Buy count their own.
  const allCount = [allType, bedrooms].filter(Boolean).length;
  const filterCountForSide = mode === "buy" ? saleRefinements(saleChoices) : mode === "all" ? allCount : refinementCount;
  const areaName = bbox ? " in this map area" : area ? ` in ${area.name.split(",")[0]}` : "";
  // What the screen covers of the map: the hero above, the List button below.
  const mapInsets = useMemo(() => ({
    top: controlsHeight,
    // The right rail is part of the usable map chrome, not map content.
    right: 76,
    bottom: LIST_BUTTON_ROOM + barClearance,
    left: 0,
  }), [barClearance, controlsHeight]);

  const rentMarkers = useMemo(() => features.map((feature): MapMarker => {
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

  // Each sale with a place is a gold pill on the map (owner, 2026-09-29).
  const saleMarkers = useMemo(() => (sales ?? []).flatMap((sale): MapMarker[] => {
    if (!sale.location) return [];
    const key = `sale:${sale.id}`;
    return [{
      key,
      kind: "sale",
      position: { lat: sale.location.latitude, lng: sale.location.longitude },
      label: compactSalePrice(sale.price_minor),
      selected: selection?.key === key,
      visited: visited.has(sale.id),
      accessibilityLabel: `${sale.kind_label} for sale, ${sale.price_formatted ?? "price on request"}. Approximate location. Open it.`,
    }];
  }), [sales, selection, visited]);

  const markers = useMemo(
    () => [...(showRent ? rentMarkers : []), ...(showSale ? saleMarkers : [])],
    [rentMarkers, saleMarkers, showRent, showSale],
  );

  // As soon as the native map reports its visible window it can be searched.
  // Movement adds emphasis; it is no longer a hidden threshold that can leave
  // the action permanently disabled on a particular provider.
  const canSearchArea = Boolean(showMap && view && !querying);
  const previewListing = preview[Math.min(previewIndex, Math.max(preview.length - 1, 0))];
  const previewing = Boolean(showMap && selection && previewListing && !listOpen);

  function openSaleMarker(id: string) {
    setVisited((current) => new Set(current).add(id));
    router.push({ pathname: "/(app)/sale/[id]", params: { id } });
  }

  function pressMarker(key: string) {
    Keyboard.dismiss();
    // A sale opens its own page: its preview is the page.
    if (key.startsWith("sale:")) {
      openSaleMarker(key.slice("sale:".length));
      return;
    }
    const feature = features.find((row) => markerKey(row) === key);
    if (!feature) return;
    if (feature.type === "listing") {
      setPreviewIndex(0);
      setSelection({ key, ids: [feature.id] });
      return;
    }
    // A stack never separates by zooming, so it opens its rentals instead.
    if (feature.stacked && feature.ids?.length) {
      setPreviewIndex(0);
      setSelection({ key, ids: feature.ids });
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
      areaSearchProgress.current = null;
      setMapFeedback(null);
      setUserMoved(true);
    }
  }

  // Asked for, never automatic: moving the map is looking, not searching.
  function searchThisArea() {
    if (!view) return;
    const nextBounds = {
      west: roundCoordinate(view.bounds.west),
      south: roundCoordinate(view.bounds.south),
      east: roundCoordinate(view.bounds.east),
      north: roundCoordinate(view.bounds.north),
    };
    areaSearchProgress.current = {
      key: boundsKey(nextBounds)!,
      waitRent: showRent,
      waitSale: showSale,
      rent: null,
      sale: null,
    };
    setMapFeedback(null);
    setBbox(nextBounds);
    setUserMoved(false);
  }

  function recenterResults() {
    const fallback = config ? {
      west: config.bounds[0], south: config.bounds[1], east: config.bounds[2], north: config.bounds[3],
    } : null;
    const target = bbox ?? area?.bounds ?? extent ?? fallback;
    if (!target) return;
    setUserMoved(false);
    setSelection(null);
    setFit({ key: `recenter:${Date.now()}`, bounds: target });
  }

  // Typing over a place, or over an area searched from the map, asks a new question.
  function editPlace(text: string) {
    locationLookup.current?.abort();
    markerRequest.current += 1;
    summaryRequest.current += 1;
    setExtentFitted(false);
    setExtent(null);
    setFit(null);
    setMapFeedback(null);
    setArea(null);
    setBbox(null);
    setPlace(text);
  }

  function selectLocation(row: LocationReference) {
    editPlace(row.name);
    Keyboard.dismiss();
    const target = locationSearchArea(row);
    if (target) {
      setArea(target);
      setFit({ key: `area:${target.ref}:${Date.now()}`, bounds: target.bounds });
    } else setMapFeedback({ message: "This location has no map coordinates yet. You can still search its listings by name.", tone: "danger" });
  }

  async function submitLocation(query: string) {
    locationLookup.current?.abort();
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    locationLookup.current = controller;
    try {
      const answer = await searchLocations(query, controller.signal);
      if (controller.signal.aborted) return;
      const match = uniqueLocationMatch(query, answer.results);
      if (match) selectLocation(match);
      else setMapFeedback({ message: "Choose a suggested location to focus the map. Text searches also show matching listings.", tone: "danger" });
    } catch {
      if (!controller.signal.aborted) setMapFeedback({ message: "Location lookup is unavailable. Listing search still works by name.", tone: "danger" });
    }
  }

  function clearPlace() {
    locationLookup.current?.abort();
    markerRequest.current += 1;
    summaryRequest.current += 1;
    setMapFeedback(null);
    setExtentFitted(false);
    setExtent(null);
    setFit(null);
    setArea(null);
    setBbox(null);
    setPlace("");
  }

  function openListing(listing: Listing) {
    setVisited((current) => new Set(current).add(listing.id));
    router.push({ pathname: "/(app)/listing/[id]", params: { id: listing.id } } as never);
  }

  async function toggleSave(listing: Listing) {
    if (!signedIn) { requestSignIn(); return; }
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
    setBbox(null);
    setExtentFitted(false);
    setExtent(null);
    setFit(area ? { key: `clear:${Date.now()}`, bounds: area.bounds } : null);
    setPropertyType(""); setSpaceType(""); setBedrooms("");
    setRentMin(""); setRentMax(""); setAdvanceMax(""); setFurnished(false); setSort("newest");
  }

  function changePropertyType(value: string) {
    setPropertyType(value);
    if (!spaceType) return;
    const allowed = propertyTypes.find((type) => type.value === value)?.space_types ?? [];
    if (value && !allowed.some((space_) => space_.value === spaceType)) setSpaceType("");
  }

  const mapBanner: MapFeedback | null = mapFeedback
    ?? (resultError && resultError !== dismissedError ? { message: resultError, tone: "danger" } : null)
    ?? (mapFailed ? { message: "Maps not loading", tone: "danger" } : null);
  const dismissMapBanner = () => {
    if (mapFeedback) setMapFeedback(null);
    else if (resultError && resultError !== dismissedError) setDismissedError(resultError);
    else setMapFailed(false);
  };

  return (
    <View
      style={{ flex: 1, overflow: "hidden", backgroundColor: showMap ? theme.color.field["100"] : theme.color.field["50"] }}
      onLayout={(event) => setScreenHeight(event.nativeEvent.layout.height)}
    >
      {showMap && config ? (
        <DanpaHQMap
          initialView={config.default_view}
          fit={fit}
          baseMap="standard"
          insets={mapInsets}
          markers={markers}
          onMove={moveMap}
          onMarkerPress={pressMarker}
          onBackgroundPress={pressBackground}
          onUnavailable={() => setMapFailed(true)}
        />
      ) : null}

      {/* The hero: the page's name, Rent or Buy, where, and the filters, as
          one green piece over the map or the page — see `ExploreHero`. */}
      <View
        pointerEvents="box-none"
        onLayout={(event) => setControlsHeight(event.nativeEvent.layout.height)}
        style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 4 }}
      >
        <ExploreHero
          inTabs={heroInTabs}
          actions={actions}
          mode={mode}
          filterCount={filterCountForSide}
          onFilters={() => { Keyboard.dismiss(); setFiltersOpen(true); }}
          search={(
            <HeroSearch
              label="Search area"
              placeholder="Search area"
              // A pin once a real place is chosen, a magnifier while it is free text.
              icon={area ? "location" : "search"}
              value={place}
              onChangeText={editPlace}
              onSelectLocation={selectLocation}
              onSubmit={(query) => { void submitLocation(query); }}
              onClear={clearPlace}
            />
          )}
        />
      </View>

      {showMap && config && !listOpen ? (
        // Three stable, thumb-sized controls. Their translucent circles echo the
        // reference without copying its unrelated filters or navigation.
        <View
          accessibilityLabel="Map view controls"
          style={{
            position: "absolute",
            top: controlsHeight + space[5],
            right: space[3],
            zIndex: 5,
            borderRadius: 30,
            ...(Platform.OS === "android" ? {} : FLOATING),
          }}
        >
          <View
            style={{
              width: 58,
              overflow: "hidden",
              gap: 8,
              padding: 6,
              borderWidth: Platform.OS === "android" ? 0 : 1,
              borderColor: Platform.OS === "android" ? "transparent" : "rgba(255,255,255,0.21)",
              borderRadius: 30,
              backgroundColor: Platform.OS === "android" ? "transparent" : "rgba(255,255,255,0.03)",
            }}
          >
            {Platform.OS === "android" ? null : (
              <>
                <BlurView
                  pointerEvents="none"
                  tint="systemChromeMaterialLight"
                  intensity={17}
                  style={StyleSheet.absoluteFill}
                />
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(255,255,255,0.02)" }]} />
              </>
            )}
            <MapTool
              label="Search this area"
              icon="scan-outline"
              emphasized={userMoved}
              disabled={!canSearchArea}
              onPress={searchThisArea}
            />
            <MapTool label="Recenter map on these results" icon="locate-outline" disabled={!config} onPress={recenterResults} />
          </View>
        </View>
      ) : null}

      {showMap && !listOpen && !mapBanner && unmapped > 0 ? (
        <View style={{ position: "absolute", top: controlsHeight + space[5], left: space[3], right: 88, zIndex: 6 }}>
          <Notice tone="info" title={`${unmapped} rentals have no map location yet`} body="Open the list to see them." />
        </View>
      ) : null}
      {showMap && !listOpen && mapBanner ? (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", top: controlsHeight + space[5], left: space[3], right: 88, zIndex: 6 }}
        >
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityRole={mapBanner.tone === "danger" ? "alert" : undefined}
            style={{
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: space[2],
              paddingHorizontal: space[3],
              paddingVertical: space[2],
              borderWidth: 1,
              borderColor: mapBanner.tone === "danger" ? theme.color.laterite["600"] : theme.color.kola["300"],
              borderRadius: radius.lg,
              backgroundColor: mapBanner.tone === "danger" ? theme.color.laterite["100"] : theme.color.kola["50"],
              ...FLOATING,
            }}
          >
            <Ionicons
              name={mapBanner.tone === "danger" ? "alert-circle-outline" : "checkmark-circle-outline"}
              size={19}
              color={mapBanner.tone === "danger" ? theme.color.laterite["600"] : theme.color.kola["600"]}
            />
            <Type
              variant="captionStrong"
              style={{ flex: 1, color: mapBanner.tone === "danger" ? theme.color.laterite["600"] : theme.color.kola["800"] }}
            >
              {mapBanner.message}
            </Type>
            {mapFeedback?.tone === "danger" ? <Button label="Clear Filters" variant="quiet" onPress={() => { clearPlace(); clearFilters(); setSaleChoices(NO_SALE_CHOICES); }} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss map search message"
              hitSlop={8}
              onPress={dismissMapBanner}
              {...pressableFeedback(theme.color.field["100"])}
            >
              <Ionicons
                name="close"
                size={18}
                color={mapBanner.tone === "danger" ? theme.color.laterite["600"] : theme.color.kola["600"]}
              />
            </Pressable>
          </View>
        </View>
      ) : null}

      {previewing ? (
        <View
          pointerEvents="box-none"
          onLayout={(event) => setPreviewHeight(event.nativeEvent.layout.height)}
          style={{ position: "absolute", left: space[3], right: space[3], bottom: space[3] + barClearance, zIndex: 5 }}
        >
          <MapPreview
            listings={preview}
            index={Math.min(previewIndex, preview.length - 1)}
            onStep={setPreviewIndex}
            onOpen={openListing}
            onClose={() => setSelection(null)}
          />
        </View>
      ) : null}

      {/* The way to the list: centred at the map's foot, over the Services tab,
          and lifted above a marker's preview while one is open. */}
      {showMap && !listOpen ? (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: (previewing ? previewHeight + space[3] * 2 : space[5]) + barClearance,
            zIndex: 6,
            alignItems: "center",
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`List. ${resultLine}`}
            onPress={() => { Keyboard.dismiss(); setListOpen(true); }}
            hitSlop={4}
            style={({ pressed }) => ({
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: space[2],
              paddingHorizontal: space[5],
              borderRadius: radius.pill,
              borderWidth: 1.5,
              borderColor: "rgba(255,255,255,0.7)",
              backgroundColor: pressed ? theme.color.kola["900"] : theme.color.kola["800"],
              ...FLOATING,
            })}
          >
            <Ionicons name="list" size={18} color={theme.color.field["0"]} />
            <Type variant="bodyStrong" style={{ color: theme.color.field["0"] }}>List</Type>
          </Pressable>
        </View>
      ) : null}

      <Animated.View
        pointerEvents={listOpen ? "auto" : "none"}
        accessibilityElementsHidden={!listOpen}
        importantForAccessibility={listOpen ? "auto" : "no-hide-descendants"}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: controlsHeight,
          height: listHeight,
          zIndex: 2,
          backgroundColor: theme.color.field["50"],
          opacity: listFade,
        }}
      >
        <View style={{ paddingHorizontal: space[4], paddingTop: HERO_FLARE - space[1], paddingBottom: space[1] }}>

          {/* What the search produced: the count and where, beside the one way
              to undo the filters and, over a full list, the way back to the map. */}
          <ExploreResults
            mode={mode}
            busy={items === null || resultBusy}
            line={resultLine}
            detail={areaName
              ? areaName.trim().replace(/^in /, "In ")
              : mode === "all"
                ? "To rent and to buy, every one verified"
                : mode === "buy"
                  ? "Title checked by our team"
                  : showMap ? "Verified and ready to let" : "Verified and ready to let · map not in this build"}
            onClear={mode === "buy"
              ? saleRefinements(saleChoices) ? () => setSaleChoices(NO_SALE_CHOICES) : undefined
              : mode === "rent" && refinementCount ? clearFilters : undefined}
            trailing={showMap ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show the map"
                hitSlop={6}
                onPress={() => setListOpen(false)}
                {...pressableFeedback("rgba(255,255,255,0.24)")}
                style={({ pressed }) => ({
                  minHeight: 36,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: space[3],
                  borderRadius: radius.pill,
                  backgroundColor: pressed ? theme.color.kola["800"] : theme.color.kola["600"],
                })}
              >
                <Ionicons name="map" size={15} color={theme.color.field["0"]} />
                <Type variant="captionStrong" style={{ color: theme.color.field["0"] }}>Map</Type>
              </Pressable>
            ) : undefined}
          />

          {bbox ? (
            <View style={{ flexDirection: "row", paddingBottom: space[1] }}>
              <AreaChip onPress={() => setBbox(null)} />
            </View>
          ) : null}

          {listOpen && resultError ? <Notice tone="error" title={resultError} /> : null}
        </View>

        <View style={{ flex: 1 }}>
          <FlatList
            ref={list}
            data={items ?? []}
            keyExtractor={(item) => (item.side === "rent" ? `rent-${item.listing.id}` : `sale-${item.sale.id}`)}
            contentContainerStyle={{
              // A little narrower than the screen (owner, 2026-09-29).
              paddingHorizontal: space[5] + 2,
              paddingTop: space[1],
              paddingBottom: space[8] + (inTabs ? barClearance : insets.bottom),
              gap: space[4],
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => { setRefreshing(true); await Promise.all([load(), showSale ? loadSales() : null]); setRefreshing(false); }}
                tintColor={theme.color.kola["600"]}
              />
            }
            // Discovery keeps going rather than stopping at the first twenty.
            onEndReachedThreshold={0.6}
            onEndReached={async () => {
              const moreRent = showRent ? next : null;
              const moreSale = showSale ? nextSales : null;
              if ((!moreRent && !moreSale) || loadingMore) return;
              setLoadingMore(true);
              try {
                const [page, salePage] = await Promise.all([
                  moreRent ? searchListingsPage(moreRent) : Promise.resolve(null),
                  moreSale ? searchSalesPage(moreSale) : Promise.resolve(null),
                ]);
                if (page) { setListings((current) => [...(current ?? []), ...page.results]); setNext(page.next); }
                if (salePage) { setSales((current) => [...(current ?? []), ...salePage.results]); setNextSales(salePage.next); }
              } catch {
                // A failed page must never empty the ones already scrolled past.
              } finally {
                setLoadingMore(false);
              }
            }}
            renderItem={({ item }) => item.side === "rent" ? (
              <ListingCard
                listing={item.listing}
                saved={saved.has(item.listing.id)}
                onSave={() => void toggleSave(item.listing)}
                onPress={() => openListing(item.listing)}
                compact
              />
            ) : (
              <SaleCard compact sale={item.sale} onPress={() => router.push({ pathname: "/(app)/sale/[id]", params: { id: item.sale.id } })} />
            )}
            ListFooterComponent={
              loadingMore ? (
                <View style={{ paddingVertical: space[5] }}>
                  <ActivityIndicator color={theme.color.kola["600"]} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              items === null || resultBusy || resultError ? null : (
                <View style={{ paddingVertical: space[8], gap: space[2] }}>
                  <Type variant="bodyStrong">Nothing matches yet</Type>
                  <Button label="Adjust filters" onPress={() => setFiltersOpen(true)} />
                  <Button label="Clear Filters" variant="quiet" onPress={() => { clearPlace(); clearFilters(); setSaleChoices(NO_SALE_CHOICES); }} />
                </View>
              )
            }
          />
        </View>
      </Animated.View>

      <FilterSheet
        visible={filtersOpen}
        mode={mode}
        onApplySide={onModeChange}
        saleCards={<SaleFilterCards choices={saleChoices} onChange={(patch) => setSaleChoices((current) => ({ ...current, ...patch }))} />}
        saleClear={{ can: saleRefinements(saleChoices) > 0, onClear: () => setSaleChoices(NO_SALE_CHOICES) }}
        allCards={<AllFilterCards type={allType} onTypeChange={setPropertyType} bedrooms={bedrooms} onBedroomsChange={setBedrooms} />}
        allClear={{ can: allCount > 0, onClear: () => { setPropertyType(""); setBedrooms(""); } }}
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

function MapTool({
  label,
  icon,
  selected,
  emphasized = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  emphasized?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const iconColor = selected ? theme.color.field["0"] : theme.color.kola["800"];
  return (
    <View style={{ width: 46, height: 46, borderRadius: 23, opacity: disabled ? 0.72 : 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        aria-pressed={selected}
        aria-disabled={disabled}
        disabled={disabled}
        hitSlop={4}
        onPress={onPress}
        style={({ pressed }) => ({
          width: 46,
          height: 46,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: selected || emphasized ? theme.color.kola["300"] : "rgba(255,255,255,0.92)",
          borderRadius: 23,
          backgroundColor: "rgba(255,255,255,0.90)",
          transform: [{ scale: pressed ? 0.95 : 1 }],
        })}
      >
        {Platform.OS === "android" ? null : (
          <BlurView
            pointerEvents="none"
            tint="systemChromeMaterialLight"
            intensity={44}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: selected ? "rgba(18,80,59,0.92)" : emphasized ? "rgba(232,241,236,0.90)" : "transparent" },
          ]}
        />
        <Ionicons name={icon} size={21} color={iconColor} />
      </Pressable>
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
          opacity: pressed ? 0.86 : 1,
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
            aria-disabled={index === 0}
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
            aria-disabled={index >= listings.length - 1}
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
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <Ionicons name="scan-outline" size={14} color={theme.color.lagoon["600"]} />
      <Type variant="captionStrong" style={{ color: theme.color.lagoon["600"] }}>Map area</Type>
      <Ionicons name="close" size={14} color={theme.color.lagoon["600"]} />
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
  mode,
  onApplySide,
  saleCards,
  saleClear,
  allCards,
  allClear,
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
  /** The side on screen; the Show row picks a draft that the button applies. */
  mode: ExploreMode;
  onApplySide: (mode: ExploreMode) => void;
  /** Buy's and All's cards, shown when Show is set to them. */
  saleCards: ReactNode;
  saleClear: { can: boolean; onClear: () => void };
  allCards: ReactNode;
  allClear: { can: boolean; onClear: () => void };
}) {
  // One dropdown open at a time, and none left open when the sheet comes back.
  const [open, setOpen] = useState<FilterMenu | null>(null);
  // Show is a draft until the button (owner, 2026-10-05: switching "just
  // applies" and "is not smooth"). One sheet, its cards swapped in place —
  // never one native sheet closing while another opens.
  const [draft, setDraft] = useState<ExploreMode>(mode);
  const [previous, setPrevious] = useState({ visible, mode });
  if (previous.visible !== visible || previous.mode !== mode) {
    setPrevious({ visible, mode });
    if (visible) setDraft(mode);
    else setOpen(null);
  }
  const clear = draft === "buy" ? saleClear : draft === "all" ? allClear : { can: canClear, onClear };
  const applyLabel = draft === mode
    ? resultLabel
    : draft === "rent" ? "Show rentals" : draft === "buy" ? "Show properties for sale" : "Show everything";
  function apply() {
    if (draft !== mode) onApplySide(draft);
    onClose();
  }
  const toggle = (field: FilterMenu) => setOpen((current) => (current === field ? null : field));

  // The sheet itself — its drag, its way back, its safe edges, its grey and its
  // two pill actions — is the shared `BottomSheet` and its parts. This says only
  // what Explore's filters are, on four white cards: what it costs, what it is,
  // what it asks up front, and the order.
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      hideTitle
      closeLabel="Close filters"
      footer={(
        <>
          <SheetGlassButton label="Clear all" icon="refresh" disabled={!clear.can} onPress={clear.onClear} />
          <SheetPrimaryButton label={applyLabel} onPress={apply} />
        </>
      )}
    >
      <SheetCard>
        <ShowField mode={draft} onChange={setDraft} />
      </SheetCard>
      {draft === "buy" ? saleCards : draft === "all" ? allCards : (
      <>
      <SheetCard>
        <PriceRange
          minimum={rentMin}
          maximum={rentMax}
          onChange={(minimum, maximum) => {
            onRentMinChange(minimum);
            onRentMaxChange(maximum);
          }}
        />
      </SheetCard>
      <SheetCard>
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
      </SheetCard>
      <SheetCard>
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
      </SheetCard>
      <SheetCard>
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
      </SheetCard>
      </>
      )}
    </BottomSheet>
  );
}

