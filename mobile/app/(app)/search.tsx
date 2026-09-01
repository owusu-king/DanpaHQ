import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";

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

export default function SearchScreen() {
  const router = useRouter();
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [place, setPlace] = useState("");
  const [matches, setMatches] = useState<Locality[]>([]);
  const [locality, setLocality] = useState<Locality | null>(null);
  const [bedrooms, setBedrooms] = useState("");
  const [rentMax, setRentMax] = useState("");
  const [advanceMax, setAdvanceMax] = useState("");
  const [furnished, setFurnished] = useState(false);
  const [sort, setSort] = useState<ListingSort>("newest");
  const [filtering, setFiltering] = useState<"bedrooms" | "price" | "advance" | "sort" | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const requestId = useRef(0);

  const filters = useMemo<SearchFilters>(() => ({
    locality_id: locality?.id,
    bedrooms_min: bedrooms === "" ? undefined : Number(bedrooms),
    rent_max: rentMax ? Math.round(Number(rentMax) * 100) : undefined,
    advance_max: advanceMax ? Number(advanceMax) : undefined,
    furnished: furnished || undefined,
    sort,
  }), [locality, bedrooms, rentMax, advanceMax, furnished, sort]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
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
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!signedIn) return;
    void listSaved().then((rows) => setSaved(new Set(rows.map((row) => row.listing.id)))).catch(() => undefined);
  }, [signedIn]);

  useEffect(() => {
    if (locality || place.trim().length < 2) { setMatches([]); return; }
    const timer = setTimeout(() => {
      void searchLocalities(place.trim()).then(setMatches).catch(() => setMatches([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [place, locality]);

  const active = [
    bedrooms !== "" && { label: `${BEDROOMS.find(([value]) => value === bedrooms)?.[1]} bed`, clear: () => setBedrooms("") },
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

  function clearAll() {
    setLocality(null); setPlace(""); setBedrooms("");
    setRentMax(""); setAdvanceMax(""); setFurnished(false); setSort("newest");
    setFiltering(null);
  }

  const bedroomLabel = bedrooms === ""
    ? "Bedrooms"
    : `${BEDROOMS.find(([value]) => value === bedrooms)?.[1] ?? bedrooms} bed`;
  const advanceLabel = advanceMax === ""
    ? "Advance"
    : ADVANCE.find(([value]) => value === advanceMax)?.[1] ?? "Advance";
  const sortLabel = sort === "newest"
    ? "Sort"
    : SORTS.find(([value]) => value === sort)?.[1] ?? "Sort";

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

            <Field
              label="Where"
              value={locality ? locality.name : place}
              onChangeText={(text) => { setLocality(null); setPlace(text); }}
              placeholder="East Legon, Adenta, Asokwa…"
              returnKeyType="search"
            />

            {matches.length ? (
              <View style={{ borderWidth: 1, borderColor: theme.color.field["200"], borderRadius: 8 }}>
                {matches.slice(0, 5).map((row) => (
                  <Pressable
                    key={row.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.name}, ${row.district_name}`}
                    onPress={() => { setLocality(row); setMatches([]); }}
                    {...pressableFeedback(theme.color.field["200"])}
                    style={{ minHeight: 52, justifyContent: "center", paddingHorizontal: space[3] }}
                  >
                    <Type variant="bodyStrong">{row.name}</Type>
                    <Type variant="caption">{row.district_name}</Type>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space[2], paddingRight: space[2] }}
              accessibilityRole="toolbar"
              accessibilityLabel="Rental filters"
            >
              <CompactFilter
                label={bedroomLabel}
                selected={bedrooms !== ""}
                expanded={filtering === "bedrooms"}
                onPress={() => setFiltering((value) => value === "bedrooms" ? null : "bedrooms")}
              />
              <CompactFilter
                label={rentMax ? `Up to GH₵${Number(rentMax).toLocaleString("en-GH")}` : "Price"}
                selected={Boolean(rentMax)}
                expanded={filtering === "price"}
                onPress={() => setFiltering((value) => value === "price" ? null : "price")}
              />
              <CompactFilter
                label={advanceLabel}
                selected={advanceMax !== ""}
                expanded={filtering === "advance"}
                onPress={() => setFiltering((value) => value === "advance" ? null : "advance")}
              />
              <CompactFilter
                label="Furnished"
                selected={furnished}
                onPress={() => setFurnished((value) => !value)}
              />
              <CompactFilter
                label={sortLabel}
                selected={sort !== "newest"}
                expanded={filtering === "sort"}
                onPress={() => setFiltering((value) => value === "sort" ? null : "sort")}
              />
              {active.length ? <CompactFilter label="Reset" quiet onPress={clearAll} /> : null}
            </ScrollView>

            {filtering ? (
              <View
                style={{
                  gap: space[3], padding: space[4], backgroundColor: theme.color.field["0"],
                  borderWidth: 1, borderColor: theme.color.field["200"], borderRadius: 10,
                  shadowColor: theme.color.ink["900"], shadowOpacity: 0.06,
                  shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 2,
                }}
              >
                {filtering === "bedrooms" ? <>
                  <Type variant="label">BEDROOMS</Type>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                    {BEDROOMS.map(([value, label]) => (
                      <FilterChip
                        key={value || "any"}
                        label={label}
                        selected={bedrooms === value}
                        onPress={() => { setBedrooms(value); setFiltering(null); }}
                      />
                    ))}
                  </View>
                </> : null}

                {filtering === "price" ? <>
                  <Field
                    label="Maximum monthly rent (GH₵)"
                    value={rentMax}
                    onChangeText={(text) => setRentMax(text.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                    placeholder="3000"
                  />
                  <Button label="Done" onPress={() => setFiltering(null)} />
                </> : null}

                {filtering === "advance" ? <>
                  <Type variant="label">ADVANCE</Type>
                  <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
                    {ADVANCE.map(([value, label]) => (
                      <ChoiceRow
                        key={value || "any"}
                        label={label}
                        selected={advanceMax === value}
                        onPress={() => { setAdvanceMax(value); setFiltering(null); }}
                      />
                    ))}
                  </View>
                </> : null}

                {filtering === "sort" ? <>
                  <Type variant="label">SORT</Type>
                  <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
                    {SORTS.map(([value, label]) => (
                      <ChoiceRow
                        key={value}
                        label={label}
                        selected={sort === value}
                        onPress={() => { setSort(value); setFiltering(null); }}
                      />
                    ))}
                  </View>
                </> : null}
              </View>
            ) : null}

            {error ? <Notice tone="error" title={error} /> : null}

            <Type variant="caption">
              {listings === null
                ? "Finding rentals…"
                : `${listings.length}${next ? "+" : ""} place${listings.length === 1 ? "" : "s"}`}
            </Type>
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

    </>
  );
}

function CompactFilter({
  label,
  selected = false,
  expanded,
  quiet = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  expanded?: boolean;
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
      <Type
        variant="bodyStrong"
        style={{ color: quiet || selected || expanded ? theme.color.kola["600"] : theme.color.ink["700"] }}
      >{label}</Type>
      {expanded !== undefined ? (
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
