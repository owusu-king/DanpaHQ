import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { useHomeDensity } from "@/components/home/plinth";
import { ListingCard } from "@/components/listings/ListingCard";
import {
  EDGE,
  EmptyState,
  Footnote,
  GLASS,
  INK,
  KOLA,
  MUTED,
  QuietAction,
} from "@/components/portfolio/PortfolioList";
import { Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { listSaved, type SavedListing, unsaveListing } from "@/listings";

/**
 * The shortlist.
 *
 * Kept server-side against the account rather than on the handset, because
 * losing a phone is common and re-finding six rooms you had narrowed down to is
 * miserable. It follows the number, like everything else here.
 *
 * Refined on review (2026-09-15): a pushed screen of its own rather than a hidden
 * tab, so it carries a back arrow and no tab bar — the shortlist is somewhere you
 * go from Explore or More, not a place the product parks you. The cards are the
 * shared recognition card; a note somebody wrote sits under its own card as a
 * quiet strip, and the stack header names the page, so nothing repeats it.
 */
export default function SavedScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";
  const [items, setItems] = useState<SavedListing[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      setItems(await listSaved());
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not load your shortlist.",
      );
      setItems([]);
    }
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeSaved = useCallback(async (listingId: string) => {
    if (!items) return;
    const previous = items;
    setItems((current) => current?.filter((item) => item.listing.id !== listingId) ?? []);
    setError("");
    try {
      await unsaveListing(listingId);
    } catch (cause) {
      setItems(previous);
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not update your shortlist.",
      );
    }
  }, [items]);

  if (!signedIn) {
    return (
      <AuthPrompt
        title="Saved places"
        body="Sign in to see your saved places."
        next="/(app)/saved"
      />
    );
  }

  return (
    <IndexGround>
      <FlatList
        data={items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: density.sectionGap + space[2] }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={KOLA}
          />
        }
        ListHeaderComponent={error ? <View style={styles.head}><Notice tone="error" title={error} /></View> : null}
        renderItem={({ item }) => (
          <View>
            <ListingCard
              listing={item.listing}
              saved
              onSave={() => void removeSaved(item.listing.id)}
              onPress={() => router.push({ pathname: "/(app)/listing/[id]", params: { id: item.listing.id } })}
            />
            {item.note ? (
              <View style={styles.note}>
                <Type variant="caption" numberOfLines={3} style={styles.noteText}>
                  <Type variant="captionStrong" style={styles.noteLabel}>Your note · </Type>
                  {item.note}
                </Type>
              </View>
            ) : null}
          </View>
        )}
        ListFooterComponent={items?.length ? (
          <Footnote>The heart on a card takes it off this list. Three or four kept here are easy to compare.</Footnote>
        ) : null}
        ListEmptyComponent={
          items === null ? (
            <ShortlistSkeleton />
          ) : error ? null : (
            <EmptyState
              icon="bookmark-outline"
              hero
              title="Nothing saved yet"
              hint="Save anything you are considering, and compare them here before you spend a day travelling to viewings."
              action={<View style={styles.emptyAction}><QuietAction icon="compass-outline" label="Explore homes" onPress={() => router.push("/(app)/(tabs)/explore" as never)} /></View>}
            />
          )
        }
      />
    </IndexGround>
  );
}

/** Shaped like the cards it becomes, so nothing jumps when the shortlist arrives. */
function ShortlistSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your shortlist" style={styles.skeleton}>
      {[0, 1].map((key) => (
        <View key={key} style={styles.skeletonCard}>
          <Bone height={180} round={0} />
          <View style={styles.skeletonBody}>
            <Bone width="46%" height={20} />
            <Bone width="78%" />
            <Bone width="52%" />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    marginBottom: space[2],
  },
  // A note belongs to the card above it, so it is drawn as that card's foot.
  note: {
    marginTop: -space[2],
    paddingTop: space[3] + space[1],
    paddingBottom: space[3],
    paddingHorizontal: 14,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  noteText: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  noteLabel: {
    color: INK,
  },
  emptyAction: {
    marginTop: space[2],
  },
  skeleton: {
    gap: space[5],
  },
  skeletonCard: {
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  skeletonBody: {
    gap: space[2],
    padding: space[4],
  },
});
