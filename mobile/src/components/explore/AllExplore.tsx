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
import { Button, Notice, Type, space } from "@/components/ui";
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
  const paging = useRef(false);

  // Typing settles before it searches, the way Rent's area box does.
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 400);
    return () => clearTimeout(timer);
  }, [text]);

  const [previousQuery, setPreviousQuery] = useState(q);
  if (previousQuery !== q) {
    setPreviousQuery(q);
    setListings(null);
    setSales(null);
    setNextListings(null);
    setNextSales(null);
    setError("");
    setLoadingMore(false);
  }

  function load(query: string) {
    const id = ++request.current;
    const filters = query ? { q: query } : {};
    paging.current = false;
    function failed(reason: unknown) {
      if (id === request.current) {
        setError(reason instanceof ApiFailure ? reason.error.message : "Some places could not be loaded.");
      }
    }
    return Promise.all([
      searchListings(filters).then((rent) => {
        if (id !== request.current) return;
        setListings(rent.results);
        setNextListings(rent.next);
      }, (reason) => {
        if (id === request.current) setListings([]);
        failed(reason);
      }),
      searchSales(filters).then((sale) => {
        if (id !== request.current) return;
        setSales(sale.results);
        setNextSales(sale.next);
      }, (reason) => {
        if (id === request.current) setSales([]);
        failed(reason);
      }),
    ]);
  }

  useEffect(() => {
    void load(q);
    return () => { request.current += 1; };
  }, [q]);

  const querying = listings === null || sales === null;

  async function loadMore() {
    if (querying || paging.current || !(nextListings || nextSales)) return;
    paging.current = true;
    setLoadingMore(true);
    const id = request.current;
    const pages = await Promise.allSettled([
      nextListings ? searchListingsPage(nextListings).then((rent) => {
        if (id !== request.current) return;
        setListings((current) => [...(current ?? []), ...rent.results]);
        setNextListings(rent.next);
      }) : null,
      nextSales ? searchSalesPage(nextSales).then((sale) => {
        if (id !== request.current) return;
        setSales((current) => [...(current ?? []), ...sale.results]);
        setNextSales(sale.next);
      }) : null,
    ]);
    if (id !== request.current) return;
    if (pages.some((page) => page.status === "rejected")) {
      setError("We could not load more places.");
    } else {
      setError((previous) => previous === "We could not load more places." ? "" : previous);
    }
    paging.current = false;
    setLoadingMore(false);
  }

  const items = useMemo(() => (listings || sales ? merge(listings ?? [], sales ?? []) : null), [listings, sales]);
  const line = items === null
    ? "Finding places…"
    : !q || querying || error ? "Explore properties" : `${listings?.length ?? 0}${nextListings ? "+" : ""} to rent · ${sales?.length ?? 0}${nextSales ? "+" : ""} for sale`;

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
            onRefresh={async () => {
              setRefreshing(true);
              setListings(null);
              setSales(null);
              setNextListings(null);
              setNextSales(null);
              setError("");
              setLoadingMore(false);
              await load(q);
              setRefreshing(false);
            }}
            tintColor={theme.color.kola["600"]}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space[2] }}>
            <ExploreResults
              mode="all"
              busy={querying}
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
          querying || error ? null : (
            <View style={{ paddingVertical: space[8], gap: space[2] }}>
              <Type variant="bodyStrong">{q ? "No places match your search" : "No places yet"}</Type>
              {q ? <Button label="Clear search" onPress={() => setText("")} /> : null}
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
