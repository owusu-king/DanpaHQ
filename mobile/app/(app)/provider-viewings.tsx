import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Field, Notice, Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";
import { formatSlot, listReceivedViewings, type Viewing } from "@/viewings";

type ViewingView = "action" | "upcoming" | "history";

/** A scannable provider queue. One Viewing opens into its own workflow screen. */
export default function ProviderViewingsScreen() {
  const router = useRouter();
  const { activeContext } = useAuth();
  const preferred = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";
  const [items, setItems] = useState<Viewing[] | null>(null);
  const [view, setView] = useState<ViewingView>("action");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // A viewing is asked of a listing on a Property, so it belongs to that
    // Property's Portfolio — this list is about the one being operated.
    setItems(null);
    try {
      setItems(
        await listReceivedViewings(false, preferred ? { organization: preferred } : undefined),
      );
      setError("");
    } catch (cause) {
      setItems([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load Viewings.");
    }
  }, [preferred]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const counts = useMemo(() => ({
    action: (items ?? []).filter((item) => viewingView(item) === "action").length,
    upcoming: (items ?? []).filter((item) => viewingView(item) === "upcoming").length,
    history: (items ?? []).filter((item) => viewingView(item) === "history").length,
  }), [items]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => (items ?? [])
    .filter((item) => viewingView(item) === view)
    .filter((item) => !normalizedQuery || [item.tenant_name, item.listing_headline, item.locality_name, item.landmark]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery))
    .sort(viewingSort(view)), [items, normalizedQuery, view]);

  return (
    <FlatList
      data={visible}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12] }}
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
      ListHeaderComponent={(
        <View style={{ gap: space[4], paddingBottom: space[4] }}>
          <Field label="Search viewings" placeholder="Tenant, Property or location" value={query} onChangeText={setQuery} />
          <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: space[2] }}>
            <ViewingTab label="Action" count={counts.action} selected={view === "action"} onPress={() => setView("action")} />
            <ViewingTab label="Upcoming" count={counts.upcoming} selected={view === "upcoming"} onPress={() => setView("upcoming")} />
            <ViewingTab label="History" count={counts.history} selected={view === "history"} onPress={() => setView("history")} />
          </View>
          {error ? <Notice tone="error" title={error} /> : null}
        </View>
      )}
      renderItem={({ item }) => (
        <ViewingRow
          viewing={item}
          onPress={() => router.push({ pathname: "/(app)/provider-viewing", params: { viewingId: item.id } } as never)}
        />
      )}
      ListEmptyComponent={
        items === null ? (
          <Type variant="caption">Loading Viewings…</Type>
        ) : error ? null : (
          <View style={{ paddingVertical: space[10], gap: space[2], alignItems: "center" }}>
            <Type variant="bodyStrong">{query ? "No matching Viewings" : emptyTitle(view)}</Type>
            <Type variant="caption" style={{ textAlign: "center" }}>{query ? "Try another tenant, Property or location." : emptyBody(view)}</Type>
            {view === "action" && counts.upcoming ? (
              <Pressable accessibilityRole="button" onPress={() => setView("upcoming")} style={{ minHeight: 48, justifyContent: "center" }}>
                <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>View upcoming visits →</Type>
              </Pressable>
            ) : null}
          </View>
        )
      }
    />
  );
}

function ViewingTab({ label, count, selected, onPress }: { label: string; count: number; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 48,
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space[2],
        borderWidth: 1,
        borderColor: selected ? theme.color.kola["600"] : theme.color.field["300"],
        borderRadius: 8,
        backgroundColor: selected ? theme.color.kola["50"] : theme.color.field["0"],
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["700"], textAlign: "center" }}>{label} {count}</Type>
    </Pressable>
  );
}

function ViewingRow({ viewing, onPress }: { viewing: Viewing; onPress: () => void }) {
  const summary = viewingSummary(viewing);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open Viewing for ${viewing.tenant_name} at ${viewing.listing_headline}. ${summary.label}.`}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 96,
        paddingVertical: space[4],
        borderTopWidth: 1,
        borderTopColor: theme.color.field["200"],
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <View style={{ flex: 1, gap: space[1] }}>
        <Type variant="bodyStrong">{viewing.tenant_name}</Type>
        <Type variant="caption">{viewing.listing_headline}</Type>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: summary.color }} />
          <Type variant="caption" style={{ color: summary.color, fontWeight: "600" }}>{summary.label}</Type>
          <Type variant="caption">· {viewingMoment(viewing)}</Type>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={22} color={theme.color.ink["300"]} />
    </Pressable>
  );
}

function viewingView(viewing: Viewing): ViewingView {
  if (
    viewing.status === "requested" ||
    viewing.status === "checked_in" ||
    (viewing.status === "attendance_pending" && viewing.attendance.can_respond) ||
    (viewing.status === "confirmed" && viewing.check_in.can_validate)
  ) return "action";
  if (["offered", "confirmed", "attendance_pending"].includes(viewing.status)) return "upcoming";
  return "history";
}

function viewingSummary(viewing: Viewing) {
  if (viewing.status === "requested") return { label: "Needs a reply", color: theme.color.laterite["600"] };
  if (viewing.status === "offered") return { label: "Waiting for tenant", color: theme.color.harmattan["600"] };
  if (viewing.status === "confirmed" && viewing.check_in.can_validate) return { label: "Ready for check-in", color: theme.color.laterite["600"] };
  if (viewing.status === "confirmed") return { label: "Confirmed", color: theme.color.kola["600"] };
  if (viewing.status === "checked_in") return { label: "Checked in", color: theme.color.laterite["600"] };
  if (viewing.status === "attendance_pending" && viewing.attendance.can_respond) return { label: "Response needed", color: theme.color.laterite["600"] };
  if (viewing.status === "attendance_pending") return { label: "Attendance pending", color: theme.color.harmattan["600"] };
  if (viewing.status === "completed") return { label: "Completed", color: theme.color.kola["600"] };
  return { label: viewing.status_display, color: theme.color.ink["500"] };
}

function viewingMoment(viewing: Viewing) {
  if (viewing.confirmed_starts_at) return formatSlot(viewing.confirmed_starts_at);
  if (viewing.status === "offered") {
    const next = viewing.slots.find((slot) => !slot.is_past);
    return next ? formatSlot(next.starts_at) : "New times needed";
  }
  return new Date(viewing.created_at).toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

function viewingSort(view: ViewingView) {
  return (a: Viewing, b: Viewing) => {
    const aDate = a.confirmed_starts_at || a.created_at;
    const bDate = b.confirmed_starts_at || b.created_at;
    return view === "history" ? new Date(bDate).getTime() - new Date(aDate).getTime() : new Date(aDate).getTime() - new Date(bDate).getTime();
  };
}

function emptyTitle(view: ViewingView) {
  if (view === "action") return "Nothing needs action";
  if (view === "upcoming") return "No upcoming visits";
  return "No Viewing history yet";
}

function emptyBody(view: ViewingView) {
  if (view === "action") return "New requests, ready check-ins and attendance responses appear here.";
  if (view === "upcoming") return "Offered and confirmed Viewing times appear here.";
  return "Completed, cancelled and declined Viewings remain available here.";
}
