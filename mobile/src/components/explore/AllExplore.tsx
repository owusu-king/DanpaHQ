/**
 * Explore's first view on a phone: everything on the market, to rent and to
 * buy, in one list (owner, 2026-09-29). The twin of the web `AllBrowser`.
 *
 * Nobody has said which side they are on yet, so neither is chosen for them:
 * rentals and properties for sale arrive together, newest first, each card
 * saying which it is, and the search narrows both. Rent or Buy in the switch
 * goes further — the filters and the map belong to one side each.
 */

import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";

import { ApiFailure } from "@/api";
import { ListingCard } from "@/components/listings/ListingCard";
import { SaleCard } from "@/components/sales/SaleCard";
import { Notice, Type, space } from "@/components/ui";
import { searchListings, searchListingsPage, type Listing } from "@/listings";
import { searchSales, searchSalesPage, type SaleCard as Sale } from "@/sales";
import { theme } from "@/theme";

import { ExploreHero, ExploreResults, HERO_FLARE, HeroSearch, type ExploreMode } from "./ExploreHero";
import { AllFilterSheet } from "./ExploreShow";

type Item =
  | { side: "rent"; at: string; listing: Listing }
  | { side: "sale"; at: string; sale: Sale };

/** Newest first across both, so neither side is always at the bottom. */
function merge(listings: Listing[], sales: Sale[]): Item[] {
  return [
    ...listings.map((listing): Item => ({ side: "rent", at: listing.created_at, listing })),
    ...sales.map((sale): Item => ({ side: "sale", at: sale.listed_at, sale })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

export function AllExplore({
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [nextListings, setNextListings] = useState<string | null>(null);
  const [nextSales, setNextSales] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  // Typing settles before it searches, the way Rent's area box does.
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 400);
    return () => clearTimeout(timer);
  }, [text]);

  async function load(query: string) {
    const id = ++request.current;
    const filters = query ? { q: query } : {};
    const [rent, sale] = await Promise.allSettled([searchListings(filters), searchSales(filters)]);
    if (id !== request.current) return;
    setListings(rent.status === "fulfilled" ? rent.value.results : []);
    setNextListings(rent.status === "fulfilled" ? rent.value.next : null);
    setSales(sale.status === "fulfilled" ? sale.value.results : []);
    setNextSales(sale.status === "fulfilled" ? sale.value.next : null);
    const failed = [rent, sale].find((row) => row.status === "rejected") as PromiseRejectedResult | undefined;
    setError(failed
      ? failed.reason instanceof ApiFailure ? failed.reason.error.message : "Some places could not be loaded."
      : "");
  }

  useEffect(() => { void load(q); }, [q]);

  async function loadMore() {
    if (loadingMore || !(nextListings || nextSales)) return;
    setLoadingMore(true);
    try {
      const [rent, sale] = await Promise.all([
        nextListings ? searchListingsPage(nextListings) : Promise.resolve(null),
        nextSales ? searchSalesPage(nextSales) : Promise.resolve(null),
      ]);
      if (rent) { setListings((current) => [...(current ?? []), ...rent.results]); setNextListings(rent.next); }
      if (sale) { setSales((current) => [...(current ?? []), ...sale.results]); setNextSales(sale.next); }
    } catch {
      // A failed page must never empty the ones already scrolled past.
    } finally {
      setLoadingMore(false);
    }
  }

  const items = useMemo(() => (listings && sales ? merge(listings, sales) : null), [listings, sales]);
  const line = items === null
    ? "Finding places…"
    : `${listings?.length ?? 0}${nextListings ? "+" : ""} to rent · ${sales?.length ?? 0}${nextSales ? "+" : ""} for sale`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.field["50"] }}>
      <View style={{ zIndex: 2 }}>
        <ExploreHero
          inTabs={inTabs}
          actions={actions}
          mode="all"
          filterCount={0}
          onFilters={() => setFiltersOpen(true)}
          search={(
            <HeroSearch
              label="Search places to rent or buy"
              placeholder="Search area"
              value={text}
              onChangeText={setText}
              onClear={() => setText("")}
            />
          )}
        />
      </View>

      <FlatList
        data={items ?? []}
        keyExtractor={(item) => (item.side === "rent" ? `rent-${item.listing.id}` : `sale-${item.sale.id}`)}
        contentContainerStyle={{ paddingHorizontal: space[5] + 2, paddingTop: HERO_FLARE - space[1], paddingBottom: bottomPadding, gap: space[4] }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(q); setRefreshing(false); }}
            tintColor={theme.color.kola["600"]}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space[2] }}>
            <ExploreResults
              mode="all"
              busy={items === null}
              line={line}
              detail="To rent and to buy, every one verified"
            />
            {error ? <Notice tone="error" title={error} /> : null}
          </View>
        }
        renderItem={({ item }) =>
          item.side === "rent" ? (
            <ListingCard
              compact
              listing={item.listing}
              onPress={() => router.push({ pathname: "/(app)/listing/[id]", params: { id: item.listing.id } })}
            />
          ) : (
            <SaleCard compact sale={item.sale} onPress={() => router.push({ pathname: "/(app)/sale/[id]", params: { id: item.sale.id } })} />
          )
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => void loadMore()}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ paddingVertical: space[5] }} color={theme.color.kola["600"]} /> : null}
        ListEmptyComponent={
          items === null || error ? null : (
            <View style={{ paddingVertical: space[8], gap: space[2] }}>
              <Type variant="bodyStrong">Nothing matches yet</Type>
              <Type variant="caption">Try a nearby area, or a shorter search.</Type>
            </View>
          )
        }
      />
      <AllFilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onModeChange={(next) => { setFiltersOpen(false); onModeChange(next); }}
        resultLabel={items === null ? "Updating…" : "Show results"}
      />
    </View>
  );
}
