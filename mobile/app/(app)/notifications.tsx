import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
} from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Notice, Type, radius, space } from "@/components/ui";
import {
  destination,
  needsYou,
  notificationCategory,
  notificationSource,
  notificationStatus,
  notificationTone,
  type NotificationCategory,
  type NotificationTone,
} from "@/notificationMeaning";
import { listNotifications, markRead, timeAgo, type Notification } from "@/notifications";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

type Filter = "all" | "unread" | "action" | NotificationCategory;
type UpdateSection = { key: string; title: string; urgent?: boolean; data: Notification[] };
const PAGE_SIZE = 10;

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  rental: "Rental",
  applications: "Applications",
  payments: "Payments",
  system: "System",
};

/** Mobile's communication centre. Home remains the live source of outstanding work. */
export default function NotificationsScreen() {
  const router = useRouter();
  const listRef = useRef<SectionList<Notification, UpdateSection>>(null);
  const { state } = useAuth();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [view, setView] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await listNotifications();
      setItems(page.results);
      setUnread(page.unread_count);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load your updates.");
      setItems([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const isProvider = state.status === "signed_in"
    && state.me.capabilities.active_workspace === "provider"
    && state.me.capabilities.provider.workspace_access;

  const counts = useMemo(() => {
    const source = items ?? [];
    return {
      unread: source.filter((item) => !item.is_read).length,
      action: source.filter(needsYou).length,
      rental: source.filter((item) => notificationCategory(item.kind) === "rental").length,
      applications: source.filter((item) => notificationCategory(item.kind) === "applications").length,
      payments: source.filter((item) => notificationCategory(item.kind) === "payments").length,
      system: source.filter((item) => notificationCategory(item.kind) === "system").length,
    };
  }, [items]);

  const visible = useMemo(() => {
    const source = items ?? [];
    if (view === "unread") return source.filter((item) => !item.is_read);
    if (view === "action") return source.filter(needsYou);
    if (view !== "all") return source.filter((item) => notificationCategory(item.kind) === view);
    return source;
  }, [items, view]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const orderedVisible = useMemo(
    () => view === "all" ? [...visible.filter(needsYou), ...visible.filter((item) => !needsYou(item))] : visible,
    [view, visible],
  );
  const paged = useMemo(
    () => orderedVisible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, orderedVisible],
  );
  const sections = useMemo(() => groupUpdates(paged, view === "all"), [paged, view]);

  function selectView(next: Filter) {
    setView(next);
    setPage(1);
  }

  function changePage(next: number) {
    setPage(next);
    requestAnimationFrame(() => {
      if (sections.length) {
        listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: true });
      }
    });
  }

  function open(item: Notification) {
    if (!item.is_read) {
      setItems((current) => current?.map((row) => row.id === item.id ? { ...row, is_read: true } : row) ?? null);
      setUnread((current) => Math.max(0, current - 1));
      void markRead([item.id]).catch(() => void load());
    }
    router.push(destination(item, isProvider) as never);
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await markRead();
      setItems((current) => current?.map((item) => ({ ...item, is_read: true })) ?? null);
      setUnread(0);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not mark these as read.");
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <SectionList
      ref={listRef}
      sections={sections}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.content}
      style={styles.screen}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          tintColor={theme.color.kola["600"]}
        />
      )}
      ListHeaderComponent={(
        <View style={styles.header}>
          {error ? <Notice tone="error" title={error} /> : null}

          {items?.length ? (
            <View style={styles.controls}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterScroller}
                contentContainerStyle={styles.filters}
                accessibilityRole="toolbar"
                accessibilityLabel="Filter updates"
              >
                <FilterButton label="All" count={items.length} selected={view === "all"} onPress={() => selectView("all")} />
                <FilterButton label="Unread" count={counts.unread} selected={view === "unread"} onPress={() => selectView("unread")} />
                <FilterButton label="Action needed" count={counts.action} selected={view === "action"} onPress={() => selectView("action")} />
                {(Object.keys(CATEGORY_LABEL) as NotificationCategory[]).map((category) => counts[category] > 0 ? (
                  <FilterButton
                    key={category}
                    label={CATEGORY_LABEL[category]}
                    count={counts[category]}
                    selected={view === category}
                    onPress={() => selectView(category)}
                  />
                ) : null)}
              </ScrollView>
              {unread > 0 ? (
                <Pressable
                  onPress={() => void markAllRead()}
                  disabled={markingAll}
                  accessibilityRole="button"
                  accessibilityLabel="Mark all updates as read"
                  accessibilityState={{ disabled: markingAll, busy: markingAll }}
                  {...pressableFeedback(theme.color.kola["600"])}
                  style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}
                >
                  {markingAll ? (
                    <ActivityIndicator size="small" color={theme.color.kola["600"]} />
                  ) : (
                    <Ionicons name="checkmark-done" size={16} color={theme.color.kola["600"]} />
                  )}
                  <Type variant="captionStrong" style={styles.markAllText}>Read all</Type>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeading}>
          <Type variant="label" style={section.urgent ? styles.urgentHeading : undefined}>{section.title.toUpperCase()}</Type>
          <Type variant="caption" style={styles.sectionCount}>{section.data.length}</Type>
        </View>
      )}
      renderItem={({ item, index, section }) => (
        <UpdateRow
          item={item}
          first={index === 0}
          last={index === section.data.length - 1}
          onPress={() => open(item)}
        />
      )}
      ListFooterComponent={visible.length > PAGE_SIZE ? (
        <MobilePagination
          page={currentPage}
          pages={pageCount}
          total={visible.length}
          onPage={changePage}
        />
      ) : null}
      ListEmptyComponent={(
        items === null ? (
          <View style={styles.loading} accessibilityLabel="Loading updates">
            <ActivityIndicator color={theme.color.kola["600"]} />
            <Type variant="caption">Gathering your updates…</Type>
          </View>
        ) : error ? null : items.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title="Nothing here yet"
            body="Rental, application, agreement and payment updates will appear here."
          />
        ) : (
          <EmptyState
            icon="checkmark-circle-outline"
            title={view === "action" ? "Nothing needs your attention" : "No updates in this view"}
            body="Choose another filter to see the rest of your update history."
          />
        )
      )}
    />
  );
}

function MobilePagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  return (
    <View style={styles.pagination} accessibilityRole="toolbar" accessibilityLabel="Updates pages">
      <Type variant="caption"><Type variant="captionStrong">{first}–{last}</Type> of {total}</Type>
      <View style={styles.paginationActions}>
        <PageButton icon="chevron-back" label="Previous page" disabled={page === 1} onPress={() => onPage(page - 1)} />
        <Type variant="captionStrong" style={styles.pageNumber}>{page} / {pages}</Type>
        <PageButton icon="chevron-forward" label="Next page" disabled={page === pages} onPress={() => onPage(page + 1)} />
      </View>
    </View>
  );
}

function PageButton({ icon, label, disabled, onPress }: { icon: "chevron-back" | "chevron-forward"; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      {...pressableFeedback(theme.color.kola["600"])}
      style={({ pressed }) => [styles.pageButton, disabled && styles.pageButtonDisabled, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color={theme.color.ink["700"]} />
    </Pressable>
  );
}

function FilterButton({ label, count, selected, onPress }: { label: string; count: number; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${count}`}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => [
        styles.filter,
        selected && styles.filterSelected,
        pressed && styles.pressed,
      ]}
    >
      <Type variant="captionStrong" style={selected ? styles.filterTextSelected : styles.filterText}>{label}</Type>
      <View style={[styles.filterCount, selected && styles.filterCountSelected]}>
        <Type variant="caption" style={selected ? styles.filterTextSelected : styles.filterText}>{count}</Type>
      </View>
    </Pressable>
  );
}

function UpdateRow({ item, first, last, onPress }: { item: Notification; first: boolean; last: boolean; onPress: () => void }) {
  const tone = notificationTone(item);
  const palette = tonePalette(tone);
  const actionable = needsYou(item);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${notificationSource(item.kind)}. ${item.title}. ${item.body}. ${notificationStatus(item)}. ${timeAgo(item.created_at)}`}
      {...pressableFeedback(palette.bg)}
      style={({ pressed }) => [
        styles.row,
        first && styles.firstRow,
        last && styles.lastRow,
        !item.is_read && { borderLeftColor: palette.fg, backgroundColor: palette.wash },
        pressed && styles.rowPressed,
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: palette.bg }]}>
        <Ionicons name={iconFor(item.kind, tone)} size={18} color={palette.fg} />
      </View>
      <View style={styles.rowContent}>
        <View style={styles.metaRow}>
          <Type variant="label" style={{ color: palette.fg }}>{notificationSource(item.kind).toUpperCase()}</Type>
          <Type variant="caption" style={styles.metaDot}>·</Type>
          <Type variant="caption" style={styles.time}>{timeAgo(item.created_at)}</Type>
        </View>
        <Type variant={item.is_read ? "body" : "bodyStrong"}>{item.title}</Type>
        <Type variant="caption" numberOfLines={2}>{item.body}</Type>
        <View style={styles.rowFooter}>
          <Type variant="captionStrong" style={{ color: palette.fg }}>{notificationStatus(item)}</Type>
          {actionable ? <Type variant="captionStrong" style={styles.review}>Review now</Type> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.color.ink["300"]} />
    </Pressable>
  );
}

function EmptyState({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name={icon} size={22} color={theme.color.kola["600"]} /></View>
      <Type variant="bodyStrong">{title}</Type>
      <Type variant="caption" style={styles.emptyBody}>{body}</Type>
    </View>
  );
}

function iconFor(kind: string, tone: NotificationTone): keyof typeof Ionicons.glyphMap {
  if (tone === "critical" || tone === "warning" || tone === "action") return "alert-circle-outline";
  if (kind.startsWith("payment.") || kind.startsWith("rent.") || kind.startsWith("billing.")) return "wallet-outline";
  if (kind.startsWith("application.") || kind.startsWith("tenancy_request.")) return "document-text-outline";
  if (kind.startsWith("viewing.")) return "calendar-outline";
  if (kind.startsWith("lease.")) return "reader-outline";
  if (tone === "success") return "checkmark-circle-outline";
  return "notifications-outline";
}

function tonePalette(tone: NotificationTone) {
  return {
    success: { fg: theme.color.kola["600"], bg: theme.color.kola["50"], wash: "#F5F9F7" },
    action: { fg: theme.color.harmattan["600"], bg: theme.color.harmattan["100"], wash: "#FEFAF1" },
    warning: { fg: theme.color.harmattan["600"], bg: theme.color.harmattan["100"], wash: "#FEFAF1" },
    critical: { fg: theme.color.laterite["600"], bg: theme.color.laterite["100"], wash: "#FEF5F2" },
    info: { fg: theme.color.lagoon["600"], bg: theme.color.lagoon["100"], wash: "#F5F8FB" },
    neutral: { fg: theme.color.ink["500"], bg: theme.color.field["100"], wash: theme.color.field["50"] },
  }[tone];
}

function groupUpdates(items: Notification[], pullActionForward: boolean): UpdateSection[] {
  const action = pullActionForward ? items.filter(needsYou) : [];
  const timeline = pullActionForward ? items.filter((item) => !needsYou(item)) : items;
  const buckets = new Map<string, Notification[]>();
  for (const item of timeline) {
    const key = timeBucket(item.created_at);
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  const groups: UpdateSection[] = [];
  if (action.length) groups.push({ key: "attention", title: "Needs your attention", urgent: true, data: action });
  for (const [key, title] of [["today", "Today"], ["week", "This week"], ["earlier", "Earlier"]] as const) {
    const grouped = buckets.get(key);
    if (grouped?.length) groups.push({ key, title, data: grouped });
  }
  return groups;
}

function timeBucket(value: string): "today" | "week" | "earlier" {
  const at = new Date(value);
  const now = new Date();
  if (at.toDateString() === now.toDateString()) return "today";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return startOfToday - at.getTime() < 7 * 24 * 60 * 60 * 1000 ? "week" : "earlier";
}

const styles = StyleSheet.create({
  // The ivory every pushed page stands on (`src/shell.ts`).
  screen: { backgroundColor: theme.color.field["50"] },
  content: { paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[12] },
  header: { gap: space[3], marginBottom: space[2] },
  controls: { flexDirection: "row", alignItems: "center", gap: space[2], paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] },
  filterScroller: { flex: 1 },
  markAll: { minHeight: 42, paddingHorizontal: space[2], flexDirection: "row", alignItems: "center", gap: space[1], borderRadius: radius.sm },
  markAllText: { color: theme.color.kola["600"], fontSize: 12 },
  filters: { gap: space[2], paddingRight: space[5] },
  filter: { minHeight: 42, paddingHorizontal: space[3], flexDirection: "row", alignItems: "center", gap: space[2], backgroundColor: theme.color.field["0"], borderWidth: 1, borderColor: theme.color.field["300"], borderRadius: radius.pill },
  filterSelected: { backgroundColor: theme.color.kola["50"], borderColor: theme.color.kola["600"] },
  filterText: { color: theme.color.ink["500"] },
  filterTextSelected: { color: theme.color.kola["800"] },
  filterCount: { minWidth: 20, height: 20, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.field["100"], borderRadius: radius.pill },
  filterCountSelected: { backgroundColor: "#D8E9E0" },
  sectionHeading: { marginTop: space[5], marginBottom: space[2], paddingHorizontal: space[1], flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  urgentHeading: { color: theme.color.laterite["600"] },
  sectionCount: { color: theme.color.ink["300"] },
  row: { minHeight: 104, paddingVertical: space[4], paddingLeft: space[3] - 3, paddingRight: space[3], flexDirection: "row", alignItems: "center", gap: space[3], backgroundColor: theme.color.field["0"], borderWidth: 1, borderTopWidth: 0, borderColor: theme.color.field["200"], borderLeftWidth: 3, borderLeftColor: "transparent" },
  firstRow: { borderTopWidth: 1, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  lastRow: { borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
  rowPressed: { opacity: 0.78 },
  rowIcon: { width: 40, height: 40, flexShrink: 0, alignSelf: "flex-start", alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  rowContent: { flex: 1, minWidth: 0, gap: space[1] },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1] },
  metaDot: { color: theme.color.ink["300"] },
  time: { color: theme.color.ink["500"] },
  rowFooter: { marginTop: 2, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3] },
  review: { color: theme.color.ink["900"], textDecorationLine: "underline" },
  loading: { paddingVertical: space[12], alignItems: "center", gap: space[3] },
  empty: { paddingVertical: space[10], paddingHorizontal: space[6], alignItems: "center", gap: space[2] },
  emptyIcon: { width: 44, height: 44, marginBottom: space[1], alignItems: "center", justifyContent: "center", backgroundColor: theme.color.kola["50"], borderRadius: radius.md },
  emptyBody: { maxWidth: 300, textAlign: "center" },
  pagination: { marginTop: space[5], flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  paginationActions: { flexDirection: "row", alignItems: "center", gap: space[2] },
  pageButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.field["0"], borderWidth: 1, borderColor: theme.color.field["300"], borderRadius: radius.sm },
  pageButtonDisabled: { opacity: 0.4 },
  pageNumber: { minWidth: 48, textAlign: "center", color: theme.color.kola["800"] },
  pressed: { opacity: 0.72 },
});
