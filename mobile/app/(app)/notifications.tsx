import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Notice, Type, space } from "@/components/ui";
import { destination, needsYou } from "@/notificationMeaning";
import { listNotifications, markRead, timeAgo, type Notification } from "@/notifications";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

type Filter = "all" | "waiting";

/**
 * What has happened while you were not looking.
 *
 * A log — Home is what knows the state of the business. The one thing this adds
 * is that some of these wanted a reply, and the feed used to render a viewing
 * request waiting on you exactly like a receipt for a payment that already went
 * through.
 *
 * Tapping one takes you to the thing it is about. Three of the seven target
 * types the backend emits used to move you nowhere at all: a Portfolio
 * invitation, a Team change and a tenancy request each fell off the end of the
 * routing table and left a dead tap.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { state } = useAuth();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [view, setView] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await listNotifications();
      setItems(page.results);
      setUnread(page.unread_count);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load these.");
      setItems([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const isProvider = state.status === "signed_in"
    && state.me.capabilities.active_workspace === "provider"
    && state.me.capabilities.provider.workspace_access;

  const waiting = useMemo(() => (items ?? []).filter(needsYou), [items]);
  const visible = view === "waiting" ? waiting : items ?? [];

  async function open(item: Notification) {
    if (!item.is_read) await markRead([item.id]);
    router.push(destination(item, isProvider) as never);
    void load();
  }

  return (
    <FlatList
      data={visible}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12] }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          tintColor={theme.color.kola["600"]}
        />
      }
      ItemSeparatorComponent={() => (
        <View style={{ height: 1, backgroundColor: theme.color.field["200"] }} />
      )}
      ListHeaderComponent={
        <View style={{ marginBottom: space[3], gap: space[3] }}>
          <View style={{ gap: space[1] }}>
            <Type variant="label">UPDATES</Type>
            <Type variant="display2" accessibilityRole="header">What happened</Type>
            <Type variant="body">Home is where you see what is still outstanding.</Type>
          </View>
          {error ? <Notice tone="error" title={error} /> : null}
          {unread > 0 ? (
            <Button
              label={`Mark all ${unread} as read`}
              variant="secondary"
              onPress={async () => { await markRead(); await load(); }}
            />
          ) : null}
          {items?.length ? (
            <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: space[2] }}>
              <Tab
                label={`Everything ${items.length}`}
                selected={view === "all"}
                onPress={() => setView("all")}
              />
              <Tab
                label={`Waiting on you ${waiting.length}`}
                selected={view === "waiting"}
                onPress={() => setView("waiting")}
              />
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item }) => {
        const flagged = needsYou(item);
        return (
          <Pressable
            onPress={() => void open(item)}
            accessibilityRole="link"
            accessibilityLabel={`${flagged ? "Needs a reply. " : ""}${item.title}. ${item.body}. ${timeAgo(item.created_at)}${item.is_read ? "" : ". Unread"}`}
            {...pressableFeedback(theme.color.field["200"])}
            style={({ pressed }) => ({
              minHeight: 76,
              gap: space[1],
              paddingVertical: space[4],
              paddingLeft: space[3],
              // A rule rather than a coloured dot: it survives being read out and
              // does not rely on colour alone.
              borderLeftWidth: 3,
              borderLeftColor: item.is_read ? "transparent" : theme.color.kola["600"],
              opacity: pressed ? 0.82 : 1,
            })}
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
              <Type variant={item.is_read ? "body" : "bodyStrong"} style={{ flexShrink: 1 }}>
                {item.title}
              </Type>
              {flagged ? (
                <Type
                  variant="caption"
                  style={{
                    color: theme.color.laterite["600"],
                    fontWeight: "700",
                    textTransform: "uppercase",
                  }}
                >Needs a reply</Type>
              ) : null}
            </View>
            <Type variant="caption">{item.body}</Type>
            <Type variant="caption" style={{ color: theme.color.ink["300"] }}>
              {timeAgo(item.created_at)}
            </Type>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        items === null ? (
          <Type variant="caption">Loading…</Type>
        ) : error ? null : view === "waiting" ? (
          <View style={{ paddingVertical: space[6], gap: space[2] }}>
            <Type variant="bodyStrong">Nothing is waiting on you</Type>
            <Type variant="caption">Updates that asked for a reply stay here until you open them.</Type>
          </View>
        ) : (
          <View style={{ paddingVertical: space[6], gap: space[2] }}>
            <Type variant="bodyStrong">Nothing yet</Type>
            <Type variant="caption">
              When someone asks about a place, responds to a request, or a rent record changes, it
              appears here.
            </Type>
          </View>
        )
      }
    />
  );
}

function Tab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={{
        minHeight: 48,
        justifyContent: "center",
        paddingHorizontal: space[3],
        borderBottomWidth: 3,
        borderBottomColor: selected ? theme.color.kola["600"] : "transparent",
      }}
    >
      <Type variant="bodyStrong" style={{ color: selected ? theme.color.ink["900"] : theme.color.ink["500"] }}>
        {label}
      </Type>
    </Pressable>
  );
}
