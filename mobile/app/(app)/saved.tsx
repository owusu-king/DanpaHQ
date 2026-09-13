import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";

import { ApiFailure } from "@/api";
import { Notice, Surface, Type, space } from "@/components/ui";
import { listSaved, type SavedListing, unsaveListing } from "@/listings";
import { theme } from "@/theme";
import { ListingCard } from "@/components/listings/ListingCard";

/**
 * The shortlist.
 *
 * Kept server-side against the account rather than on the handset, because
 * losing a phone is common and re-finding six rooms you had narrowed down to is
 * miserable. It follows the number, like everything else here.
 */
export default function SavedScreen() {
  const router = useRouter();
  const [items, setItems] = useState<SavedListing[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listSaved());
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not load your shortlist.",
      );
      setItems([]);
    }
  }, []);

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

  return (
    <FlatList
      data={items ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: space[5], gap: space[4] }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={theme.color.kola["600"]}
        />
      }
      ListHeaderComponent={
        <View style={{ marginBottom: space[2], gap: space[2] }}>
          <Type variant="display2">Your shortlist</Type>
          {error ? <Notice tone="error" title={error} /> : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ gap: space[2] }}>
          <ListingCard
            listing={item.listing}
            saved
            onSave={() => void removeSaved(item.listing.id)}
            onPress={() => router.push({ pathname: "/(app)/listing/[id]", params: { id: item.listing.id } })}
          />
          {item.note ? (
            <Type variant="caption" style={{ paddingHorizontal: space[2] }}>
              Your note: {item.note}
            </Type>
          ) : null}
        </View>
      )}
      ListEmptyComponent={
        items === null ? (
          <Type variant="caption">Loading…</Type>
        ) : error ? null : (
          <Surface style={{ gap: space[2] }}>
            <Type variant="bodyStrong">Nothing saved yet</Type>
            <Type variant="caption">
              Tap “Save this place” on anything you are considering. Keeping three or four here
              makes them easy to compare before you spend a day travelling to viewings.
            </Type>
          </Surface>
        )
      }
    />
  );
}
