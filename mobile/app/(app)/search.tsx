import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { ListingCard } from "@/components/listings/ListingCard";
import { Button, Field, Notice, Type, radius, space } from "@/components/ui";
import {
  listSaved,
  saveListing,
  searchListings,
  searchListingsPage,
  searchLocalities,
  unsaveListing,
  type Listing,
  type ListingSort,
  type Locality,
  type SearchFilters,
} from "@/listings";
import { pressableFeedback } from "@/platform";
import { loadPropertyTypes, type PropertyTypeOption } from "@/propertyTypes";
import { theme } from "@/theme";

/**
 * Finding a place to rent.
 *
 * Search → scan → compare → open. The photograph does the recognizing and the
 * rent does the comparing, so those get the room; everything else is one line.
 *
 * Where you are looking stays on the screen because it is the first question a
 * Ghanaian tenant asks. Rent, advance, bedrooms and furnishing go in a focused
 * sheet so the first rental stays close while the active choices remain visible.
 *
 * Every choice is shown once and removed one way. Place lives in the search box
 * and its clear; rent, type, bedrooms and furnishing show on their own pills;
 * the chips carry only what no pill shows. Chips used to repeat every pill, so
 * each choice was on screen twice with two ways to remove it.
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

type FilterMode = "all" | "price" | "type" | "bedrooms";

const cedis = (value: string) => Number(value).toLocaleString("en-GH");

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [place, setPlace] = useState("");
  const [matches, setMatches] = useState<Locality[]>([]);
  const [locality, setLocality] = useState<Locality | null>(null);
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[]>([]);
  const [propertyType, setPropertyType] = useState("");
  const [spaceType, setSpaceType] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [rentMin, setRentMin] = useState("");
  const [rentMax, setRentMax] = useState("");
  const [advanceMax, setAdvanceMax] = useState("");
  const [furnished, setFurnished] = useState(false);
  const [sort, setSort] = useState<ListingSort>("newest");
  const [filterMode, setFilterMode] = useState<FilterMode | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const requestId = useRef(0);

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

  const filters = useMemo<SearchFilters>(() => ({
    q: locality ? undefined : place.trim() || undefined,
    locality_id: locality?.id,
    property_type: propertyType || undefined,
    space_type: spaceType || undefined,
    bedrooms_min: bedrooms === "" ? undefined : Number(bedrooms),
    rent_min: rentMin ? Math.round(Number(rentMin) * 100) : undefined,
    rent_max: rentMax ? Math.round(Number(rentMax) * 100) : undefined,
    advance_max: advanceMax ? Number(advanceMax) : undefined,
    furnished: furnished || undefined,
    sort,
  }), [place, locality, propertyType, spaceType, bedrooms, rentMin, rentMax, advanceMax, furnished, sort]);

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
      setListings([]);
      setNext(null);
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load places right now.");
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
    if (locality || place.trim().length < 2) { setMatches([]); return; }
    const timer = setTimeout(() => {
      void searchLocalities(place.trim()).then(setMatches).catch(() => setMatches([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [place, locality]);

  const propertyLabel = propertyTypes.find((row) => row.value === propertyType)?.label ?? propertyType;
  const spaceLabel = spaceTypes.find((row) => row.value === spaceType)?.label ?? spaceType;
  const rentLabel = rentMin && rentMax
    ? `GH₵${cedis(rentMin)}–${cedis(rentMax)}`
    : rentMax
      ? `Up to GH₵${cedis(rentMax)}`
      : rentMin
        ? `From GH₵${cedis(rentMin)}`
        : "Rent";

  // Everything the sheet holds, counted once for the Filters pill. Place is not
  // one of them: the search box owns it, and the one clear for it.
  const refinementCount = [
    rentMin || rentMax,
    propertyType,
    spaceType,
    bedrooms,
    advanceMax,
    furnished,
    sort !== "newest",
  ].filter(Boolean).length;

  // Chips for the refinements no pill shows, and only those.
  const unshown = [
    spaceType && { key: "space_type", label: spaceLabel, clear: () => setSpaceType("") },
    advanceMax && {
      key: "advance_max",
      label: `Advance ${(ADVANCE.find(([value]) => value === advanceMax)?.[1] ?? advanceMax).toLowerCase()}`,
      clear: () => setAdvanceMax(""),
    },
    sort !== "newest" && {
      key: "sort",
      label: SORTS.find(([value]) => value === sort)?.[1] ?? sort,
      clear: () => setSort("newest"),
    },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const resultCount = listings === null ? "" : `${listings.length}${next ? "+" : ""}`;
  const resultWord = listings?.length === 1 && !next ? "rental" : "rentals";

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

  // Filters, not place: the search box keeps the one clear for that.
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
    <>
      <FlatList
        data={listings ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[4] }}
        refreshControl={
          <RefreshControl
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
        ListHeaderComponent={
          <View style={{ gap: space[3] }}>
            <View style={{ gap: space[1] }}>
              <Type variant="label">RENTALS IN GHANA</Type>
              <Type variant="display2" accessibilityRole="header">Find a place</Type>
            </View>

            <SearchBox
              value={locality ? locality.name : place}
              placeChosen={Boolean(locality)}
              onChangeText={(text) => { setLocality(null); setPlace(text); }}
              onClear={() => { setLocality(null); setPlace(""); setMatches([]); }}
            />

            {matches.length ? (
              <View
                style={{
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: theme.color.field["200"],
                  borderRadius: radius.lg,
                  backgroundColor: theme.color.field["0"],
                }}
              >
                {matches.slice(0, 5).map((row, index) => (
                  <Pressable
                    key={row.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.name}, ${row.district_name}`}
                    onPress={() => { setLocality(row); setMatches([]); }}
                    {...pressableFeedback(theme.color.kola["50"])}
                    style={({ pressed }) => ({
                      minHeight: 58,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space[3],
                      paddingHorizontal: space[3],
                      borderTopWidth: index ? 1 : 0,
                      borderTopColor: theme.color.field["100"],
                      backgroundColor: pressed && Platform.OS !== "android" ? theme.color.kola["50"] : "transparent",
                    })}
                  >
                    <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: theme.color.kola["50"] }}>
                      <Ionicons name="location-outline" size={17} color={theme.color.kola["600"]} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Type variant="bodyStrong" numberOfLines={1}>{row.name}</Type>
                      <Type variant="caption" numberOfLines={1}>{row.district_name}</Type>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ alignItems: "center", gap: space[2], paddingRight: space[2] }}
              accessibilityRole="toolbar"
              accessibilityLabel="Quick rental filters"
            >
              {/* Filters leads the rail. At the end it sat past the right edge of
                  a phone, taking the count of hidden choices with it. */}
              <CompactFilter
                label="Filters"
                icon="options-outline"
                count={refinementCount}
                onPress={() => setFilterMode("all")}
              />
              <View style={{ width: 1, height: 24, marginHorizontal: space[1], backgroundColor: theme.color.field["300"] }} />
              <CompactFilter
                label={rentLabel}
                selected={Boolean(rentMin || rentMax)}
                disclosure
                onPress={() => setFilterMode("price")}
              />
              <CompactFilter
                label={propertyType ? propertyLabel : "Type"}
                selected={Boolean(propertyType)}
                disclosure
                onPress={() => setFilterMode("type")}
              />
              <CompactFilter
                label={bedrooms ? `${BEDROOMS.find(([value]) => value === bedrooms)?.[1] ?? bedrooms} bed` : "Bedrooms"}
                selected={Boolean(bedrooms)}
                disclosure
                onPress={() => setFilterMode("bedrooms")}
              />
              <CompactFilter
                label="Furnished"
                selected={furnished}
                onPress={() => setFurnished((value) => !value)}
              />
            </ScrollView>

            {unshown.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: space[2], paddingRight: space[2] }}
                accessibilityLabel="Other active filters"
              >
                {unshown.map((item) => <ActiveFilter key={item.key} label={item.label} onPress={item.clear} />)}
              </ScrollView>
            ) : null}

            {error ? <Notice tone="error" title={error} /> : null}

            {/* The count and the one Clear all share a line: what the filters
                produce, beside the way to undo them. */}
            <View style={{ minHeight: 36, flexDirection: "row", alignItems: "center", gap: space[2] }}>
              {listings === null || querying ? <ActivityIndicator size="small" color={theme.color.kola["600"]} /> : null}
              <Type variant="caption" accessibilityLiveRegion="polite" style={{ flex: 1 }}>
                {listings === null ? "Finding rentals…" : querying ? "Updating results…" : (
                  <>
                    <Type variant="captionStrong" style={{ color: theme.color.ink["900"] }}>{resultCount}</Type>
                    {` ${resultWord}`}
                  </>
                )}
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
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            saved={saved.has(item.id)}
            onSave={() => void toggleSave(item)}
            onPress={() => router.push({ pathname: "/(app)/listing/[id]", params: { id: item.id } } as never)}
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

      <FilterSheet
        mode={filterMode}
        onClose={() => setFilterMode(null)}
        bottomInset={insets.bottom}
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

    </>
  );
}

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
    // The ring is a padded box behind the field, the construction `Field` uses.
    // The border used to thicken from one pixel to two on focus, nudging the
    // text and everything below it.
    <View
      style={{
        margin: -3,
        padding: 3,
        borderRadius: radius.md + 3,
        backgroundColor: focused ? theme.color.kola["50"] : "transparent",
      }}
    >
      <View
        style={{
          minHeight: 52,
          flexDirection: "row",
          alignItems: "center",
          gap: space[3],
          paddingLeft: space[4],
          paddingRight: space[1],
          borderWidth: 1,
          borderColor: focused ? theme.color.kola["600"] : theme.color.field["300"],
          borderRadius: radius.md,
          backgroundColor: theme.color.field["0"],
        }}
      >
        {/* A pin once a real place is chosen, a magnifier while it is free text. */}
        <Ionicons name={placeChosen ? "location" : "search-outline"} size={20} color={theme.color.kola["600"]} />
        <TextInput
          accessibilityLabel="Search area"
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search area"
          placeholderTextColor={theme.color.ink["300"]}
          returnKeyType="search"
          // One clear: iOS can draw its own, which would sit beside this one.
          clearButtonMode="never"
          maxFontSizeMultiplier={1.35}
          style={{ flex: 1, minWidth: 0, minHeight: 50, paddingVertical: 0, color: theme.color.ink["900"], fontSize: 16, fontWeight: "500" }}
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={4}
            onPress={onClear}
            {...pressableFeedback(theme.color.field["200"])}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 22,
              backgroundColor: pressed && Platform.OS !== "android" ? theme.color.field["100"] : "transparent",
            })}
          >
            <Ionicons name="close" size={18} color={theme.color.ink["500"]} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ActiveFilter({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove ${label} filter`}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["300"])}
      style={({ pressed }) => ({
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: space[3],
        paddingRight: 10,
        borderWidth: 1,
        borderColor: theme.color.kola["300"],
        borderRadius: radius.pill,
        backgroundColor: theme.color.kola["50"],
        opacity: pressed && Platform.OS !== "android" ? 0.72 : 1,
      })}
    >
      <Type variant="captionStrong" style={{ color: theme.color.kola["800"] }}>{label}</Type>
      <Ionicons name="close" size={14} color={theme.color.kola["600"]} />
    </Pressable>
  );
}

function FilterSheet({
  mode,
  onClose,
  bottomInset,
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
  mode: FilterMode | null;
  onClose: () => void;
  bottomInset: number;
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
  const visible = mode !== null;
  const heading = mode === "price" ? "Rent" : mode === "type" ? "Property & unit" : mode === "bedrooms" ? "Bedrooms" : "Filters";
  // A focused sheet is titled by its one group, so the group does not repeat it.
  const grouped = mode === "all";
  const showPrice = grouped || mode === "price";
  const showType = grouped || mode === "type";
  const showBedrooms = grouped || mode === "bedrooms";

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(22,17,14,0.44)" }} />
        <View
          style={{
            maxHeight: "88%",
            overflow: "hidden",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            backgroundColor: theme.color.field["0"],
            shadowColor: theme.color.ink["950"],
            shadowOpacity: 0.22,
            shadowRadius: 28,
            shadowOffset: { width: 0, height: -8 },
            elevation: 16,
          }}
        >
          <View style={{ alignSelf: "center", width: 36, height: 4, marginTop: space[2], borderRadius: 2, backgroundColor: theme.color.field["300"] }} />
          <View style={{ minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: space[5], paddingRight: space[3], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
            <Type variant="title2" accessibilityRole="header">{heading}</Type>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close filters"
              hitSlop={6}
              onPress={onClose}
              {...pressableFeedback(theme.color.field["200"])}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 20,
                backgroundColor: theme.color.field["100"],
                opacity: pressed && Platform.OS !== "android" ? 0.72 : 1,
              })}
            >
              <Ionicons name="close" size={20} color={theme.color.ink["700"]} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space[5], paddingVertical: space[1] }}>
            {showPrice ? (
              <SheetGroup title={grouped ? "Price" : undefined} first>
                <View style={{ flexDirection: "row", gap: space[3] }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Minimum rent" prefix="GH₵" value={rentMin} onChangeText={(text) => onRentMinChange(text.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="No minimum" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Maximum rent" prefix="GH₵" value={rentMax} onChangeText={(text) => onRentMaxChange(text.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="No maximum" />
                  </View>
                </View>
              </SheetGroup>
            ) : null}

            {showType || showBedrooms ? (
              <SheetGroup title={grouped ? "Property & unit" : undefined} first={!showPrice}>
                {showType ? (
                  <>
                    <ChoiceSet label="Property type">
                      <FilterChip label="Any" selected={!propertyType} onPress={() => onPropertyTypeChange("")} />
                      {propertyTypes.map((type) => <FilterChip key={type.value} label={type.label} selected={propertyType === type.value} onPress={() => onPropertyTypeChange(type.value)} />)}
                    </ChoiceSet>
                    <ChoiceSet label="Unit type">
                      <FilterChip label="Any" selected={!spaceType} onPress={() => onSpaceTypeChange("")} />
                      {spaceTypes.map((space_) => <FilterChip key={space_.value} label={space_.label} selected={spaceType === space_.value} onPress={() => onSpaceTypeChange(space_.value)} />)}
                    </ChoiceSet>
                  </>
                ) : null}
                {showBedrooms ? (
                  <ChoiceSet label={grouped ? "Bedrooms" : undefined}>
                    {BEDROOMS.map(([value, label]) => <FilterChip key={value || "any"} label={label} selected={bedrooms === value} onPress={() => onBedroomsChange(value)} />)}
                  </ChoiceSet>
                ) : null}
              </SheetGroup>
            ) : null}

            {grouped ? (
              <>
                <SheetGroup title="Rental terms">
                  <ChoiceSet label="Maximum advance">
                    {ADVANCE.map(([value, label]) => <FilterChip key={value || "any"} label={label} selected={advanceMax === value} onPress={() => onAdvanceMaxChange(value)} />)}
                  </ChoiceSet>
                  <FilterToggle label="Furnished only" selected={furnished} onPress={() => onFurnishedChange(!furnished)} />
                </SheetGroup>
                <SheetGroup title="Order results">
                  <View>
                    {SORTS.map(([value, label], index) => <ChoiceRow key={value} label={label} first={index === 0} selected={sort === value} onPress={() => onSortChange(value)} />)}
                  </View>
                </SheetGroup>
              </>
            ) : null}
          </ScrollView>

          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingTop: space[3], paddingLeft: space[2], paddingRight: space[5], paddingBottom: Math.max(bottomInset, space[4]), borderTopWidth: 1, borderTopColor: theme.color.field["200"], backgroundColor: theme.color.field["50"] }}>
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
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A group in the sheet: a kola heading over its choices, a hairline between groups. */
function SheetGroup({ title, first = false, children }: { title?: string; first?: boolean; children: ReactNode }) {
  return (
    <View style={{ gap: space[4], paddingVertical: space[4], borderTopWidth: first ? 0 : 1, borderTopColor: theme.color.field["200"] }}>
      {title ? <Type variant="captionStrong" accessibilityRole="header" style={{ color: theme.color.kola["800"] }}>{title}</Type> : null}
      {children}
    </View>
  );
}

/** A caption over a wrapping set of chips: every answer visible at once. */
function ChoiceSet({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: space[2] }}>
      {label ? <Type variant="caption" style={{ color: theme.color.ink["700"] }}>{label}</Type> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>{children}</View>
    </View>
  );
}

/**
 * On or off, so a switch — the platform's own, in kola.
 *
 * It was a drawn tick box announcing itself as a switch: a checkbox to the eye,
 * a switch to a screen reader. The whole row is the target, so the switch
 * itself takes no touches of its own and cannot toggle twice.
 */
function FilterToggle({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] }}
    >
      <Type variant="body" style={{ color: theme.color.ink["900"] }}>{label}</Type>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch
          value={selected}
          trackColor={{ false: theme.color.field["300"], true: theme.color.kola["600"] }}
          thumbColor={theme.color.field["0"]}
          ios_backgroundColor={theme.color.field["300"]}
        />
      </View>
    </Pressable>
  );
}

/**
 * A rail pill: every one the same height and the chip radius.
 *
 * A pill that opens a sheet carries a chevron; a toggle carries nothing,
 * because it opens nothing. Chosen doubles the kola edge, and the padding gives
 * the pixel back so a pill turning on never shoves the pills after it.
 */
function CompactFilter({
  label,
  selected = false,
  disclosure = false,
  icon,
  count = 0,
  onPress,
}: {
  label: string;
  selected?: boolean;
  disclosure?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  count?: number;
  onPress: () => void;
}) {
  const edge = selected ? 1 : 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={count ? `${label}, ${count} active` : label}
      onPress={onPress}
      {...pressableFeedback(selected ? theme.color.kola["300"] : theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: (icon ? space[3] : space[4]) - edge,
        paddingRight: (disclosure ? space[3] : count ? space[2] : space[4]) - edge,
        borderWidth: 1 + edge,
        borderRadius: radius.pill,
        borderColor: selected ? theme.color.kola["600"] : theme.color.field["300"],
        backgroundColor: selected ? theme.color.kola["50"] : theme.color.field["0"],
        opacity: pressed && Platform.OS !== "android" ? 0.72 : 1,
      })}
    >
      {icon ? <Ionicons name={icon} size={18} color={theme.color.kola["600"]} /> : null}
      <Type
        variant="captionStrong"
        numberOfLines={1}
        style={{ maxWidth: 176, color: selected ? theme.color.kola["800"] : theme.color.ink["900"] }}
      >{label}</Type>
      {count ? (
        <View style={{ minWidth: 22, height: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, borderRadius: 11, backgroundColor: theme.color.kola["600"] }}>
          <Type variant="label" style={{ color: theme.color.field["0"], fontSize: 12, lineHeight: 14, letterSpacing: 0 }}>{count}</Type>
        </View>
      ) : null}
      {disclosure ? (
        <Ionicons name="chevron-down" size={15} color={selected ? theme.color.kola["600"] : theme.color.ink["500"]} />
      ) : null}
    </Pressable>
  );
}

/** One of a short, comparable set. Chosen reads as chosen — kola tint, a doubled
 * kola edge, kola text — and the padding gives back the extra pixel, so a chip
 * turning on never re-wraps the chips after it under the thumb. */
function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => ({
        minHeight: 40,
        justifyContent: "center",
        paddingHorizontal: selected ? space[4] - 1 : space[4],
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.color.kola["600"] : theme.color.field["300"],
        borderRadius: radius.pill,
        backgroundColor: selected ? theme.color.kola["50"] : theme.color.field["0"],
        opacity: pressed && Platform.OS !== "android" ? 0.72 : 1,
      })}
    >
      <Type
        variant="captionStrong"
        style={{ color: selected ? theme.color.kola["800"] : theme.color.ink["900"] }}
      >
        {label}
      </Type>
    </Pressable>
  );
}

/** One answer from a list whose labels are too long to sit side by side. */
function ChoiceRow({
  label,
  selected,
  first = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  first?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.color.field["100"],
        opacity: pressed && Platform.OS !== "android" ? 0.72 : 1,
      })}
    >
      <Type
        variant={selected ? "bodyStrong" : "body"}
        style={{ flex: 1, color: selected ? theme.color.kola["800"] : theme.color.ink["900"] }}
      >
        {label}
      </Type>
      {selected ? <Ionicons name="checkmark" size={20} color={theme.color.kola["600"]} /> : null}
    </Pressable>
  );
}
