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
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { ListingCard } from "@/components/listings/ListingCard";
import { Button, Field, Notice, Type, space } from "@/components/ui";
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
 */

const BEDROOMS: readonly (readonly [string, string])[] = [
  ["", "Any"],
  ["0", "Single room"],
  ["1", "1+"],
  ["2", "2+"],
  ["3", "3+"],
];

const ADVANCE: readonly (readonly [string, string])[] = [
  ["", "Any advance"],
  ["6", "6 months or less"],
  ["12", "1 year or less"],
  ["24", "2 years or less"],
];

const SORTS: readonly (readonly [ListingSort, string])[] = [
  ["newest", "Newest first"],
  ["rent_asc", "Rent: low to high"],
  ["rent_desc", "Rent: high to low"],
];

type FilterMode = "all" | "price" | "type" | "bedrooms";

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

  const active = [
    propertyType && { label: propertyTypes.find((row) => row.value === propertyType)?.label ?? propertyType, clear: () => setPropertyType("") },
    spaceType && { label: spaceTypes.find((row) => row.value === spaceType)?.label ?? spaceType, clear: () => setSpaceType("") },
    bedrooms !== "" && { label: `${BEDROOMS.find(([value]) => value === bedrooms)?.[1]} bed`, clear: () => setBedrooms("") },
    rentMin && { label: `From GH₵${rentMin}`, clear: () => setRentMin("") },
    rentMax && { label: `Up to GH₵${rentMax}`, clear: () => setRentMax("") },
    advanceMax && { label: ADVANCE.find(([value]) => value === advanceMax)?.[1] ?? "", clear: () => setAdvanceMax("") },
    furnished && { label: "Furnished", clear: () => setFurnished(false) },
    sort !== "newest" && { label: SORTS.find(([value]) => value === sort)?.[1] ?? "", clear: () => setSort("newest") },
  ].filter(Boolean) as { label: string; clear: () => void }[];

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

  function resetFilters() {
    setLocality(null); setPlace(""); setPropertyType(""); setSpaceType(""); setBedrooms("");
    setRentMin(""); setRentMax(""); setAdvanceMax(""); setFurnished(false); setSort("newest");
  }

  function clearAll() {
    resetFilters();
    setFilterMode(null);
  }

  function changePropertyType(value: string) {
    setPropertyType(value);
    if (!spaceType) return;
    const allowed = propertyTypes.find((type) => type.value === value)?.space_types ?? [];
    if (value && !allowed.some((space_) => space_.value === spaceType)) setSpaceType("");
  }

  const bedroomLabel = bedrooms === ""
    ? "Bedrooms"
    : `${BEDROOMS.find(([value]) => value === bedrooms)?.[1] ?? bedrooms} bed`;
  const propertyLabel = propertyType
    ? propertyTypes.find((row) => row.value === propertyType)?.label ?? "Type"
    : spaceType
      ? spaceTypes.find((row) => row.value === spaceType)?.label ?? "Type"
      : "Type";

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
              onChangeText={(text) => { setLocality(null); setPlace(text); }}
              onClear={() => { setLocality(null); setPlace(""); setMatches([]); }}
            />

            {matches.length ? (
              <View style={{ overflow: "hidden", borderWidth: 1, borderColor: theme.color.field["200"], borderRadius: 12, backgroundColor: theme.color.field["0"] }}>
                {matches.slice(0, 5).map((row) => (
                  <Pressable
                    key={row.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.name}, ${row.district_name}`}
                    onPress={() => { setLocality(row); setMatches([]); }}
                    {...pressableFeedback(theme.color.field["200"])}
                    style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], borderBottomWidth: 1, borderBottomColor: theme.color.field["100"] }}
                  >
                    <Ionicons name="location-outline" size={18} color={theme.color.kola["600"]} />
                    <View style={{ flex: 1 }}>
                      <Type variant="bodyStrong">{row.name}</Type>
                      <Type variant="caption">{row.district_name}</Type>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space[2], paddingRight: space[2] }}
              accessibilityRole="toolbar"
              accessibilityLabel="Quick rental filters"
            >
              <CompactFilter
                label={rentMax ? `Up to GH₵${Number(rentMax).toLocaleString("en-GH")}` : "Price"}
                selected={Boolean(rentMin || rentMax)}
                disclosure
                onPress={() => setFilterMode("price")}
              />
              <CompactFilter
                label={propertyLabel}
                selected={Boolean(propertyType || spaceType)}
                disclosure
                onPress={() => setFilterMode("type")}
              />
              <CompactFilter
                label={bedroomLabel}
                selected={bedrooms !== ""}
                disclosure
                onPress={() => setFilterMode("bedrooms")}
              />
              <CompactFilter
                label="Furnished"
                selected={furnished}
                onPress={() => setFurnished((value) => !value)}
              />
              <CompactFilter
                label="Filters"
                icon="options-outline"
                count={active.length}
                selected={filterMode === "all"}
                onPress={() => setFilterMode("all")}
              />
            </ScrollView>

            {active.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: space[2], paddingRight: space[2] }}
                accessibilityLabel="Active rental filters"
              >
                {active.map((item) => <ActiveFilter key={item.label} label={item.label} onPress={item.clear} />)}
                <Pressable accessibilityRole="button" accessibilityLabel="Clear all filters" onPress={clearAll} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: space[2] }}>
                  <Type variant="captionStrong" style={{ color: theme.color.kola["600"] }}>Clear all</Type>
                </Pressable>
              </ScrollView>
            ) : null}

            {error ? <Notice tone="error" title={error} /> : null}

            <View style={{ minHeight: 24, flexDirection: "row", alignItems: "center", gap: space[2] }}>
              {listings === null || querying ? <ActivityIndicator size="small" color={theme.color.kola["600"]} /> : null}
              <Type variant="caption">
                {listings === null ? "Finding rentals…" : querying ? "Updating results…" : `${listings.length}${next ? "+" : ""} home${listings.length === 1 ? "" : "s"}`}
              </Type>
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
            <View style={{ paddingVertical: space[8], gap: space[3] }}>
              <Type variant="bodyStrong">Nothing matches yet</Type>
              <Type variant="caption">Try a wider rent, a longer advance, or a nearby area.</Type>
              {active.length || locality ? (
                <Button label="Clear filters" variant="secondary" onPress={clearAll} />
              ) : null}
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
        onReset={resetFilters}
        resultLabel={listings === null || querying ? "Updating homes…" : `Show ${listings.length}${next ? "+" : ""} homes`}
      />

    </>
  );
}

function SearchBox({
  value,
  onChangeText,
  onClear,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onClear: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingLeft: space[4],
        paddingRight: space[2],
        borderWidth: focused ? 2 : 1,
        borderColor: focused ? theme.color.kola["600"] : theme.color.field["300"],
        borderRadius: 13,
        backgroundColor: theme.color.field["0"],
      }}
    >
      <Ionicons name="search-outline" size={20} color={focused ? theme.color.kola["600"] : theme.color.ink["500"]} />
      <TextInput
        accessibilityLabel="Search area, neighbourhood or property"
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search area, neighbourhood or property"
        placeholderTextColor={theme.color.ink["300"]}
        returnKeyType="search"
        maxFontSizeMultiplier={1.35}
        style={{ flex: 1, minWidth: 0, minHeight: 52, paddingVertical: 0, color: theme.color.ink["900"], fontSize: 16, fontWeight: "600" }}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={6}
          onPress={onClear}
          {...pressableFeedback(theme.color.field["100"])}
          style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 }}
        >
          <Ionicons name="close" size={19} color={theme.color.ink["500"]} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ActiveFilter({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove ${label} filter`}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={{
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: space[1],
        paddingHorizontal: space[3],
        borderWidth: 1,
        borderColor: theme.color.kola["300"],
        borderRadius: 18,
        backgroundColor: theme.color.kola["50"],
      }}
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
  onReset,
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
  onReset: () => void;
  resultLabel: string;
}) {
  const visible = mode !== null;
  const heading = mode === "price" ? "Rent" : mode === "type" ? "Property & unit" : mode === "bedrooms" ? "Bedrooms" : "All filters";
  const showPrice = mode === "all" || mode === "price";
  const showType = mode === "all" || mode === "type";
  const showBedrooms = mode === "all" || mode === "bedrooms";

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(22,17,14,0.42)" }} />
        <View
          style={{
            maxHeight: "88%",
            overflow: "hidden",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            backgroundColor: theme.color.field["0"],
            shadowColor: theme.color.ink["950"],
            shadowOpacity: 0.22,
            shadowRadius: 28,
            shadowOffset: { width: 0, height: -8 },
            elevation: 16,
          }}
        >
          <View style={{ alignSelf: "center", width: 36, height: 4, marginTop: space[2], borderRadius: 2, backgroundColor: theme.color.field["300"] }} />
          <View style={{ minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space[5], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
            <View style={{ gap: 2 }}>
              <Type variant="label" style={{ color: theme.color.kola["600"] }}>REFINE YOUR SEARCH</Type>
              <Type variant="title2" accessibilityRole="header">{heading}</Type>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close filters" hitSlop={6} onPress={onClose} {...pressableFeedback(theme.color.field["100"])} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 }}>
              <Ionicons name="close" size={22} color={theme.color.ink["700"]} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space[5], gap: space[6] }}>
            {showPrice ? (
              <SheetGroup title="Price">
                <View style={{ gap: space[3] }}>
                  <Field label="Minimum rent" prefix="GH₵" value={rentMin} onChangeText={(text) => onRentMinChange(text.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="No minimum" />
                  <Field label="Maximum rent" prefix="GH₵" value={rentMax} onChangeText={(text) => onRentMaxChange(text.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="No maximum" />
                </View>
              </SheetGroup>
            ) : null}

            {showType ? (
              <SheetGroup title="Property type">
                <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
                  <ChoiceRow label="Any property type" selected={!propertyType} onPress={() => onPropertyTypeChange("")} />
                  {propertyTypes.map((type) => <ChoiceRow key={type.value} label={type.label} selected={propertyType === type.value} onPress={() => onPropertyTypeChange(type.value)} />)}
                </View>
                <Type variant="captionStrong" style={{ marginTop: space[2], color: theme.color.ink["700"] }}>Unit type</Type>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                  <FilterChip label="Any" selected={!spaceType} onPress={() => onSpaceTypeChange("")} />
                  {spaceTypes.map((space_) => <FilterChip key={space_.value} label={space_.label} selected={spaceType === space_.value} onPress={() => onSpaceTypeChange(space_.value)} />)}
                </View>
              </SheetGroup>
            ) : null}

            {showBedrooms ? (
              <SheetGroup title="Bedrooms">
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                  {BEDROOMS.map(([value, label]) => <FilterChip key={value || "any"} label={label} selected={bedrooms === value} onPress={() => onBedroomsChange(value)} />)}
                </View>
              </SheetGroup>
            ) : null}

            {mode === "all" ? (
              <>
                <SheetGroup title="Rental terms">
                  <Type variant="captionStrong" style={{ color: theme.color.ink["700"] }}>Maximum advance</Type>
                  <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
                    {ADVANCE.map(([value, label]) => <ChoiceRow key={value || "any"} label={label} selected={advanceMax === value} onPress={() => onAdvanceMaxChange(value)} />)}
                  </View>
                  <FilterToggle label="Furnished only" selected={furnished} onPress={() => onFurnishedChange(!furnished)} />
                </SheetGroup>
                <SheetGroup title="Order results">
                  <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
                    {SORTS.map(([value, label]) => <ChoiceRow key={value} label={label} selected={sort === value} onPress={() => onSortChange(value)} />)}
                  </View>
                </SheetGroup>
              </>
            ) : null}
          </ScrollView>

          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingTop: space[3], paddingHorizontal: space[5], paddingBottom: Math.max(bottomInset, space[4]), borderTopWidth: 1, borderTopColor: theme.color.field["200"], backgroundColor: theme.color.field["50"] }}>
            <Pressable accessibilityRole="button" onPress={onReset} {...pressableFeedback(theme.color.field["100"])} style={{ minWidth: 72, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 10 }}>
              <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>Reset</Type>
            </Pressable>
            <View style={{ flex: 1 }}><Button label={resultLabel} onPress={onClose} /></View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[3] }}>
      <Type variant="bodyStrong">{title}</Type>
      {children}
    </View>
  );
}

function FilterToggle({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: selected }} accessibilityLabel={label} onPress={onPress} {...pressableFeedback(theme.color.field["100"])} style={{ minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], paddingHorizontal: space[3], borderWidth: 1, borderColor: selected ? theme.color.kola["300"] : theme.color.field["300"], borderRadius: 10, backgroundColor: selected ? theme.color.kola["50"] : theme.color.field["0"] }}>
      <Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["800"] : theme.color.ink["900"] }}>{label}</Type>
      <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: selected ? theme.color.kola["600"] : theme.color.field["300"], borderRadius: 6, backgroundColor: selected ? theme.color.kola["600"] : theme.color.field["0"] }}>
        {selected ? <Ionicons name="checkmark" size={16} color={theme.color.field["0"]} /> : null}
      </View>
    </Pressable>
  );
}

function CompactFilter({
  label,
  selected = false,
  expanded,
  disclosure = false,
  icon,
  count,
  quiet = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  expanded?: boolean;
  disclosure?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  count?: number;
  quiet?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, expanded }}
      accessibilityLabel={label}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 46, flexDirection: "row", alignItems: "center", gap: space[2],
        paddingHorizontal: space[4], borderWidth: quiet ? 0 : 1, borderRadius: 10,
        borderColor: selected || expanded ? theme.color.kola["300"] : theme.color.field["300"],
        backgroundColor: selected || expanded ? theme.color.kola["50"] : theme.color.field["0"],
        opacity: pressed ? 0.82 : 1,
      })}
    >
      {icon ? <Ionicons name={icon} size={17} color={selected || expanded ? theme.color.kola["600"] : theme.color.ink["500"]} /> : null}
      <Type
        variant="bodyStrong"
        style={{ color: quiet || selected || expanded ? theme.color.kola["600"] : theme.color.ink["700"] }}
      >{label}</Type>
      {count ? (
        <View style={{ minWidth: 21, height: 21, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, borderRadius: 11, backgroundColor: theme.color.kola["600"] }}>
          <Type variant="label" style={{ color: theme.color.field["0"], fontSize: 10, lineHeight: 12 }}>{count}</Type>
        </View>
      ) : null}
      {expanded !== undefined || disclosure ? (
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={15}
          color={selected || expanded ? theme.color.kola["600"] : theme.color.ink["500"]}
        />
      ) : null}
    </Pressable>
  );
}

/** One of a short, comparable set. Selected reads as chosen, not just ticked. */
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
      style={{
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: space[4],
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.color.kola["600"] : theme.color.field["300"],
        borderRadius: 22,
        backgroundColor: selected ? theme.color.kola["50"] : "transparent",
      }}
    >
      <Type
        variant="bodyStrong"
        style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["700"] }}
      >
        {label}
      </Type>
    </Pressable>
  );
}

/** One answer from a longer list, the way a native picker reads it. */
function ChoiceRow({
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
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingVertical: space[2],
        borderTopWidth: 1,
        borderTopColor: theme.color.field["200"],
        opacity: pressed ? 0.82 : 1,
      })}
    >
      <Type
        variant={selected ? "bodyStrong" : "body"}
        style={{ flex: 1, color: selected ? theme.color.kola["600"] : theme.color.ink["900"] }}
      >
        {label}
      </Type>
      {selected ? <Ionicons name="checkmark" size={20} color={theme.color.kola["600"]} /> : null}
    </Pressable>
  );
}
