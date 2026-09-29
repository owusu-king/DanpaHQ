/**
 * Explore's Buy side on a phone: every property for sale that is public now.
 * The twin of the web `SaleBrowser`.
 *
 * Public means verified and on the market — the backend's rule, which this only
 * reads. The filters are the ones a buyer here decides on first: what kind of
 * thing, the budget, and the tenure — freehold, leasehold or customary land is a
 * question of what is actually being bought. No map yet: a sale is found by
 * area and budget, and the list says both.
 */

import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";

import { ApiFailure } from "@/api";
import { ExploreHero, ExploreResults, HERO_FLARE, HeroSearch, type ExploreMode } from "@/components/explore/ExploreHero";
import { SegmentedField, SelectField } from "@/components/filters/FilterFields";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { SheetCard, SheetGlassButton, SheetPrimaryButton } from "@/components/sheet/SheetParts";
import { Notice, Type, space } from "@/components/ui";
import {
  searchSales,
  searchSalesPage,
  type SaleCard as Sale,
  type SaleFilters,
  type SaleKind,
  type SaleSort,
  type Tenure,
} from "@/sales";
import { theme } from "@/theme";

import { SaleCard } from "./SaleCard";

const KINDS = [
  { value: "", label: "All" },
  { value: "residential", label: "Houses" },
  { value: "commercial", label: "Commercial" },
  { value: "land", label: "Land" },
] as const;

/** Cedis, sent as pesewas. Upper bounds only: "what can I afford" is the question. */
const BUDGETS = [
  { value: "", label: "Any budget" },
  { value: "20000000", label: "Up to GH₵200k" },
  { value: "50000000", label: "Up to GH₵500k" },
  { value: "100000000", label: "Up to GH₵1m" },
  { value: "250000000", label: "Up to GH₵2.5m" },
  { value: "500000000", label: "Up to GH₵5m" },
];

const TENURES = [
  { value: "", label: "Any tenure" },
  { value: "freehold", label: "Freehold" },
  { value: "leasehold", label: "Leasehold" },
  { value: "customary", label: "Customary land" },
];

const BEDROOMS = [
  { value: "", label: "Any" },
  { value: "1", label: "1+" },
  { value: "2", label: "2+" },
  { value: "3", label: "3+" },
  { value: "4", label: "4+" },
];

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

type Menu = "budget" | "tenure" | "sort";


export function SaleExplore({
  inTabs,
  actions,
  onModeChange,
  bottomPadding,
}: {
  inTabs: boolean;
  actions?: ReactNode;
  onModeChange: (mode: ExploreMode) => void;
  bottomPadding: number;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | SaleKind>("");
  const [budget, setBudget] = useState("");
  const [tenure, setTenure] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [sort, setSort] = useState<SaleSort>("newest");
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const request = useRef(0);

  // Typing settles before it searches, the way Rent's area box does.
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 400);
    return () => clearTimeout(timer);
  }, [text]);

  const filters: SaleFilters = {
    q: q || undefined,
    kind: kind || undefined,
    price_max: budget ? Number(budget) : undefined,
    // Rooms mean nothing for land or a commercial building.
    bedrooms_min: kind === "residential" && bedrooms ? Number(bedrooms) : undefined,
    tenure: (tenure as Tenure) || undefined,
    sort: sort === "newest" ? undefined : sort,
  };
  const key = JSON.stringify(filters);

  const load = useCallback(async () => {
    const id = ++request.current;
    setQuerying(true);
    try {
      const page = await searchSales(JSON.parse(key) as SaleFilters);
      if (id !== request.current) return;
      setSales(page.results);
      setNext(page.next);
      setError("");
    } catch (cause) {
      if (id !== request.current) return;
      setSales((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load properties for sale.");
    } finally {
      if (id === request.current) setQuerying(false);
    }
  }, [key]);

  useEffect(() => { void load(); }, [load]);

  const refinements = [kind, budget, tenure, kind === "residential" ? bedrooms : ""].filter(Boolean).length;
  const count = sales?.length ?? 0;
  const countLine = sales === null ? "Finding properties…" : querying
    ? "Updating…"
    : `${count}${next ? "+" : ""} ${count === 1 ? "property" : "properties"} for sale`;

  function clearFilters() {
    setKind("");
    setBudget("");
    setTenure("");
    setBedrooms("");
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.field["50"] }}>
      {/* The same hero as Rent, so switching sides changes the search and never the frame. */}
      <View style={{ zIndex: 2 }}>
        <ExploreHero
          inTabs={inTabs}
          actions={actions}
          mode="buy"
          onModeChange={onModeChange}
          filterCount={refinements}
          onFilters={() => setFiltersOpen(true)}
          search={(
            <HeroSearch
              label="Search properties for sale"
              placeholder="Area or description"
              value={text}
              onChangeText={setText}
              onClear={() => setText("")}
            />
          )}
        />
      </View>

      <FlatList
        data={sales ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: space[5] + 2, paddingTop: HERO_FLARE - space[1], paddingBottom: bottomPadding, gap: space[4] }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={theme.color.kola["600"]}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space[2] }}>
            <ExploreResults
              mode="buy"
              busy={sales === null || querying}
              line={countLine}
              detail={q ? `Matching “${q}”` : "Title checked by our team"}
              onClear={refinements ? clearFilters : undefined}
            />
            {error ? <Notice tone="error" title={error} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <SaleCard compact sale={item} onPress={() => router.push({ pathname: "/(app)/sale/[id]", params: { id: item.id } })} />
        )}
        onEndReachedThreshold={0.6}
        onEndReached={async () => {
          if (!next || loadingMore) return;
          setLoadingMore(true);
          try {
            const page = await searchSalesPage(next);
            setSales((current) => [...(current ?? []), ...page.results]);
            setNext(page.next);
          } catch {
            // A failed page must never empty the ones already scrolled past.
          } finally {
            setLoadingMore(false);
          }
        }}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ paddingVertical: space[5] }} color={theme.color.kola["600"]} /> : null}
        ListEmptyComponent={
          sales === null || error ? null : (
            <View style={{ paddingVertical: space[8], gap: space[2] }}>
              <Type variant="bodyStrong">Nothing for sale matches yet</Type>
              <Type variant="caption">Try a higher budget, another kind of property, or a wider area.</Type>
            </View>
          )
        }
      />

      <BottomSheet
        visible={filtersOpen}
        onClose={() => { setFiltersOpen(false); setMenu(null); }}
        title="Filters"
        hideTitle
        closeLabel="Close filters"
        footer={(
          <>
            <SheetGlassButton label="Clear all" icon="refresh" disabled={!refinements} onPress={clearFilters} />
            <SheetPrimaryButton label={querying ? "Updating…" : `Show ${count}${next ? "+" : ""}`} onPress={() => setFiltersOpen(false)} />
          </>
        )}
      >
        <SheetCard>
          <SegmentedField label="What" value={kind} options={KINDS} onChange={(value) => setKind(value as "" | SaleKind)} />
          {kind === "residential" ? (
            <SegmentedField label="Bedrooms" value={bedrooms} options={BEDROOMS} onChange={setBedrooms} />
          ) : null}
        </SheetCard>
        <SheetCard>
          <SelectField
            label="Budget"
            value={budget}
            options={BUDGETS}
            open={menu === "budget"}
            onToggle={() => setMenu((current) => (current === "budget" ? null : "budget"))}
            onChange={(value) => { setBudget(value); setMenu(null); }}
          />
          <SelectField
            label="Tenure"
            value={tenure}
            options={TENURES}
            open={menu === "tenure"}
            onToggle={() => setMenu((current) => (current === "tenure" ? null : "tenure"))}
            onChange={(value) => { setTenure(value); setMenu(null); }}
          />
        </SheetCard>
        <SheetCard>
          <SelectField
            label="Sort by"
            value={sort}
            options={SORTS}
            open={menu === "sort"}
            onToggle={() => setMenu((current) => (current === "sort" ? null : "sort"))}
            onChange={(value) => { setSort(value as SaleSort); setMenu(null); }}
          />
        </SheetCard>
      </BottomSheet>
    </View>
  );
}
