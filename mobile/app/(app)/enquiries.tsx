/**
 * Conversations about properties for sale — the twin of the web `/enquiries`.
 *
 * A buyer never sees a seller's phone number (owner, 2026-09-28); they send an
 * enquiry, and the conversation lives here. A provider can be on both sides —
 * selling one plot while asking about another — so theirs has both. A tenant
 * account owns no property, so it has only what it asked about (owner,
 * 2026-09-29): no Selling side to be empty.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { EDGE, EmptyState, GLASS, INK, KOLA, MUTED, PRESSED, QuietAction } from "@/components/portfolio/PortfolioList";
import { PillSwitch } from "@/components/sales/PillSwitch";
import { Notice, Type, space } from "@/components/ui";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { listEnquiries, type Enquiry } from "@/sales";
import { theme } from "@/theme";

type Side = "buyer" | "seller";

export default function EnquiriesScreen() {
  const router = useRouter();
  const pageBottom = useSafeBottom(space[12]);
  const { as } = useLocalSearchParams<{ as?: string }>();
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";
  // Selling needs property, and only a provider account holds any.
  const canSell = signedIn && state.me.capabilities.provider.workspace_access;
  const provider = canSell && state.me.capabilities.active_workspace === "provider";
  const [chosen, setSide] = useState<Side>(as === "seller" || as === "buyer" ? as : provider ? "seller" : "buyer");
  const side: Side = canSell ? chosen : "buyer";
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      setRows(await listEnquiries(side));
      setError("");
    } catch (cause) {
      setRows([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load enquiries.");
    }
  }, [side, signedIn]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  if (!signedIn) {
    return (
      <AuthPrompt
        icon="chatbubbles-outline"
        title="Your enquiries"
        body="Conversations with buyers and sellers, without sharing your phone number."
        next="/(app)/enquiries"
      />
    );
  }

  return (
    <IndexGround>
      <FlatList
        data={rows ?? []}
        keyExtractor={(row) => row.id}
        contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={KOLA}
          />
        }
        ListHeaderComponent={
          <View style={styles.head}>
            {canSell ? (
              <PillSwitch
                label="Which side"
                value={side}
                options={[{ value: "seller", label: "Selling" }, { value: "buyer", label: "Buying" }]}
                onChange={setSide}
              />
            ) : null}
            {error ? <Notice tone="error" title={error} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <EnquiryRow
            row={item}
            side={side}
            onOpen={() => router.push({ pathname: "/(app)/enquiry/[id]", params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          rows === null ? (
            <View style={{ gap: space[3] }}>
              <Bone height={84} />
              <Bone height={84} />
            </View>
          ) : error ? null : side === "seller" ? (
            <EmptyState
              icon="chatbubbles-outline"
              hero
              title="No enquiries yet"
              hint="When a buyer asks about a property you are selling, it arrives here."
            />
          ) : (
            <EmptyState
              icon="pricetag-outline"
              hero
              title="You have not asked about anything yet"
              hint="Find a property under Buy on Explore and send the seller a message."
              action={
                <View style={{ marginTop: space[2] }}>
                  <QuietAction
                    icon="compass-outline"
                    label="Browse properties for sale"
                    onPress={() => router.push({ pathname: "/(app)/search", params: { mode: "buy" } })}
                  />
                </View>
              }
            />
          )
        }
      />
    </IndexGround>
  );
}

function EnquiryRow({ row, side, onOpen }: { row: Enquiry; side: Side; onOpen: () => void }) {
  const closed = row.status === "closed" || row.sale.status === "sold";
  const meta = [side === "seller" ? row.buyer_name : null, row.sale.price_formatted, row.sale.locality_name]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.sale.headline || "Property for sale"}. ${meta}. ${row.unread ? "New." : ""}`}
      onPress={onOpen}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.row, row.unread ? styles.unread : null, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={styles.rowBody}>
        <Type variant="bodyStrong" numberOfLines={1} style={styles.title}>
          {row.sale.headline || "Property for sale"}
        </Type>
        {meta ? <Type variant="caption" numberOfLines={1} style={styles.meta}>{meta}</Type> : null}
        {row.last_message ? (
          <Type variant="caption" numberOfLines={1} style={styles.last}>{row.last_message}</Type>
        ) : null}
      </View>
      <View style={styles.rowEnd}>
        {row.last_message_at ? <Type variant="caption" style={styles.when}>{when(row.last_message_at)}</Type> : null}
        {closed ? (
          <View style={styles.tag}><Type variant="captionStrong" style={styles.tagText}>{row.sale.status === "sold" ? "Sold" : "Closed"}</Type></View>
        ) : row.unread ? (
          <View style={[styles.tag, styles.tagNew]}><Type variant="captionStrong" style={styles.tagNewText}>New</Type></View>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={MUTED} />
        )}
      </View>
    </Pressable>
  );
}

function when(value: string): string {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  page: {
    padding: space[4],
    gap: space[3],
  },
  head: {
    gap: space[3],
    marginBottom: space[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 76,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  unread: {
    borderLeftWidth: 3,
    borderLeftColor: KOLA,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  meta: {
    fontSize: 13,
    lineHeight: 17,
    color: MUTED,
  },
  last: {
    fontSize: 13,
    lineHeight: 17,
    color: theme.color.ink["500"],
  },
  rowEnd: {
    alignItems: "flex-end",
    gap: space[1],
  },
  when: {
    fontSize: 12,
    color: theme.color.ink["500"],
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: theme.color.field["100"],
  },
  tagText: {
    fontSize: 12,
    color: theme.color.ink["700"],
  },
  tagNew: {
    backgroundColor: KOLA,
  },
  tagNewText: {
    fontSize: 12,
    color: theme.color.field["0"],
  },
});
