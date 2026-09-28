import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
} from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  CHEVRON,
  ChoiceRow,
  EDGE,
  EmptyState,
  FilterButton,
  FilterGroup,
  GLASS,
  GroupLabel,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  ListRow,
  MUTED,
  PANEL_RADIUS,
  PRESSED,
  RULE,
  SheetFooter,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
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
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
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
const CATEGORY_ICON: Record<NotificationCategory, IconName> = {
  rental: "home-outline",
  applications: "document-text-outline",
  payments: "wallet-outline",
  system: "business-outline",
};
const VIEW_TITLE: Record<"all" | "unread" | "action", string> = {
  all: "All",
  unread: "Unread",
  action: "Action needed",
};

/**
 * Mobile's communication centre. Home remains the live source of outstanding work.
 *
 * Refined on review (2026-09-15): the feed stands on the hub ground as glass, and
 * the rail of filter chips became one toolbar — what is showing and how many, Read
 * all, and one green Filter whose sheet holds the same vocabulary with its counts.
 * Still a log: no summary card above it, and the shell's title is not repeated.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const listRef = useRef<SectionList<Notification, UpdateSection>>(null);
  const { state } = useAuth();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [view, setView] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [filtering, setFiltering] = useState(false);
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
  // A topic with nothing in it does not take up a line of the sheet.
  const topics = (Object.keys(CATEGORY_LABEL) as NotificationCategory[]).filter((category) => counts[category] > 0);

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
    <IndexGround>
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={KOLA}
          />
        )}
        ListHeaderComponent={(
          <View style={styles.header}>
            {error ? <Notice tone="error" title={error} /> : null}

            {items?.length ? (
              <View style={styles.toolbar} accessibilityRole="toolbar" accessibilityLabel="Filter updates">
                <View style={styles.toolbarTitle}>
                  <Type variant="title2" accessibilityRole="header" numberOfLines={1} style={styles.toolbarTitleText}>
                    {view === "all" || view === "unread" || view === "action" ? VIEW_TITLE[view] : CATEGORY_LABEL[view]}
                  </Type>
                  <Type variant="caption" style={styles.toolbarCount}>{visible.length}</Type>
                </View>
                {unread > 0 ? (
                  <Pressable
                    onPress={() => void markAllRead()}
                    disabled={markingAll}
                    accessibilityRole="button"
                    accessibilityLabel="Mark all updates as read"
                    aria-disabled={markingAll} aria-busy={markingAll}
                    hitSlop={space[1]}
                    {...pressableFeedback(theme.color.kola["50"])}
                    style={({ pressed }) => [styles.readAll, pressed && !isAndroid ? styles.pressed : null]}
                  >
                    {markingAll ? (
                      <ActivityIndicator size="small" color={KOLA} />
                    ) : (
                      <Ionicons name="checkmark-done" size={16} color={KOLA} />
                    )}
                    {density.veryCompact ? null : <Type variant="captionStrong" style={styles.readAllText}>Read all</Type>}
                  </Pressable>
                ) : null}
                <FilterButton count={view === "all" ? 0 : 1} tone="kola" onPress={() => setFiltering(true)} />
              </View>
            ) : null}
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeading}>
            <GroupLabel count={section.data.length} tone={section.urgent ? LATERITE : undefined}>{section.title}</GroupLabel>
          </View>
        )}
        renderSectionFooter={() => <View style={styles.sectionFooter} />}
        renderItem={({ item, index, section }) => (
          <ListRow first={index === 0} last={index === section.data.length - 1}>
            <UpdateRow item={item} onPress={() => open(item)} />
            {/* Drawn over the row rather than between rows, so an unread rule runs unbroken. */}
            {index === 0 ? null : <View pointerEvents="none" style={styles.rule} />}
          </ListRow>
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
            <UpdatesSkeleton />
          ) : error ? null : items.length === 0 ? (
            <EmptyState
              icon="notifications-outline"
              hero
              title="Nothing here yet"
              hint="Rental, application, agreement and payment news will appear here."
            />
          ) : (
            <EmptyState
              icon="checkmark-circle-outline"
              title={view === "action" ? "Nothing needs your attention" : "Nothing in this view"}
              hint="Choose another filter to see the rest of your history."
            />
          )
        )}
      />

      <BottomSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        title="Filter"
        hideTitle
        closeLabel="Close filter"
        footer={<SheetFooter
          canReset={view !== "all"}
          onReset={() => selectView("all")}
          results={visible.length}
          onShow={() => setFiltering(false)}
        />}
      >
        <FilterGroup title="Show">
          <ChoiceRow first icon="albums-outline" label="All" count={items?.length ?? 0} selected={view === "all"} onPress={() => selectView("all")} />
          <ChoiceRow first={false} icon="mail-unread-outline" label="Unread" count={counts.unread} selected={view === "unread"} onPress={() => selectView("unread")} />
          <ChoiceRow first={false} icon="flash-outline" label="Action needed" count={counts.action} selected={view === "action"} onPress={() => selectView("action")} />
        </FilterGroup>
        {topics.length ? (
          <FilterGroup title="Topic">
            {topics.map((category, index) => (
              <ChoiceRow
                key={category}
                first={index === 0}
                icon={CATEGORY_ICON[category]}
                label={CATEGORY_LABEL[category]}
                count={counts[category]}
                selected={view === category}
                onPress={() => selectView(category)}
              />
            ))}
          </FilterGroup>
        ) : null}
      </BottomSheet>
    </IndexGround>
  );
}

function MobilePagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  return (
    <View style={styles.pagination} accessibilityRole="toolbar" accessibilityLabel="Updates pages">
      <Type variant="caption" style={styles.pageRange}><Type variant="captionStrong" style={styles.pageRangeStrong}>{first}–{last}</Type> of {total}</Type>
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
      aria-disabled={disabled}
      {...pressableFeedback(alpha(KOLA, 0.14))}
      style={({ pressed }) => [styles.pageButton, disabled && styles.pageButtonDisabled, pressed && !isAndroid ? styles.pressed : null]}
    >
      <Ionicons name={icon} size={18} color={KOLA_DEEP} />
    </Pressable>
  );
}

/**
 * One update: where it came from and when, what happened, a line of it, and how
 * it stands in words. Unread keeps its left rule in the update's colour — never a
 * dot — and a heavier title; what wants a reply says so beside its status.
 */
function UpdateRow({ item, onPress }: { item: Notification; onPress: () => void }) {
  const tone = notificationTone(item);
  const palette = tonePalette(tone);
  const actionable = needsYou(item);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${notificationSource(item.kind)}. ${item.title}. ${item.body}. ${notificationStatus(item)}. ${timeAgo(item.created_at)}`}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [
        styles.row,
        !item.is_read && { borderLeftColor: palette.fg, backgroundColor: palette.wash },
        pressed && !isAndroid ? { backgroundColor: PRESSED } : null,
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: palette.bg }]}>
        <Ionicons name={iconFor(item.kind, tone)} size={17} color={palette.fg} />
      </View>
      <View style={rowStyles.rowBody}>
        <View style={styles.metaRow}>
          <Type variant="label" numberOfLines={1} style={[styles.source, { color: palette.fg }]}>{notificationSource(item.kind).toUpperCase()}</Type>
          <Type variant="caption" numberOfLines={1} style={styles.time}>{`· ${timeAgo(item.created_at)}`}</Type>
        </View>
        <Type variant={item.is_read ? "body" : "bodyStrong"} style={styles.title}>{item.title}</Type>
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{item.body}</Type>
        <View style={styles.rowFooter}>
          <Type variant="captionStrong" style={[styles.status, { color: palette.fg }]}>{notificationStatus(item)}</Type>
          {actionable ? (
            <View style={styles.review}>
              <Type variant="captionStrong" style={styles.reviewText}>Review now</Type>
              <Ionicons name="arrow-forward" size={13} color={KOLA_DEEP} />
            </View>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={15} color={CHEVRON} style={styles.chevron} />
    </Pressable>
  );
}

/** Shaped like the toolbar and the first rows, so nothing jumps when they arrive. */
function UpdatesSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading updates" style={styles.skeleton}>
      <Bone width="34%" height={20} />
      <Panel>
        {[0, 1, 2, 3].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={36} height={36} round={11} />
            <View style={styles.skeletonLines}>
              <Bone width="30%" height={10} />
              <Bone width="76%" height={14} />
              <Bone width="92%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

function iconFor(kind: string, tone: NotificationTone): IconName {
  if (tone === "critical" || tone === "warning" || tone === "action") return "alert-circle-outline";
  if (kind.startsWith("payment.") || kind.startsWith("rent.") || kind.startsWith("billing.")) return "wallet-outline";
  if (kind.startsWith("application.") || kind.startsWith("tenancy_request.")) return "document-text-outline";
  if (kind.startsWith("viewing.")) return "calendar-outline";
  if (kind.startsWith("lease.")) return "reader-outline";
  if (tone === "success") return "checkmark-circle-outline";
  return "notifications-outline";
}

/** Each tone's ink, the well its glyph sits in, and the faint wash of an unread row on glass. */
function tonePalette(tone: NotificationTone) {
  return {
    success: { fg: theme.color.kola["600"], bg: theme.color.kola["50"], wash: alpha(theme.color.kola["600"], 0.05) },
    action: { fg: theme.color.harmattan["600"], bg: theme.color.harmattan["100"], wash: alpha(theme.color.harmattan["600"], 0.06) },
    warning: { fg: theme.color.harmattan["600"], bg: theme.color.harmattan["100"], wash: alpha(theme.color.harmattan["600"], 0.06) },
    critical: { fg: theme.color.laterite["600"], bg: theme.color.laterite["100"], wash: alpha(theme.color.laterite["600"], 0.05) },
    info: { fg: theme.color.lagoon["600"], bg: theme.color.lagoon["100"], wash: alpha(theme.color.lagoon["600"], 0.05) },
    neutral: { fg: theme.color.ink["500"], bg: theme.color.field["100"], wash: alpha(INK, 0.03) },
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
  header: {
    gap: space[3],
    marginBottom: space[4],
  },
  toolbar: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingLeft: space[1],
  },
  toolbarTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[2],
  },
  toolbarTitleText: {
    flexShrink: 1,
    fontSize: 17.5,
    lineHeight: 23,
    letterSpacing: -0.2,
    color: INK,
  },
  toolbarCount: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  readAll: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  readAllText: {
    fontSize: 13.5,
    lineHeight: 18,
    color: KOLA_DEEP,
  },
  sectionHeading: {
    paddingBottom: space[2],
  },
  sectionFooter: {
    height: space[5],
  },
  rule: {
    position: "absolute",
    top: 0,
    left: 14,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: RULE,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingLeft: 11,
    paddingRight: 14,
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  source: {
    flexShrink: 1,
    letterSpacing: 0.4,
  },
  time: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
  title: {
    marginTop: 2,
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  rowFooter: {
    marginTop: space[2],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space[3],
    rowGap: space[1],
  },
  status: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  review: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["50"],
  },
  reviewText: {
    fontSize: 12.5,
    lineHeight: 17,
    color: KOLA_DEEP,
  },
  chevron: {
    alignSelf: "center",
  },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingVertical: space[2],
    paddingLeft: 14,
    paddingRight: space[2],
    borderRadius: PANEL_RADIUS,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  pageRange: {
    color: MUTED,
  },
  pageRangeStrong: {
    color: INK,
  },
  paginationActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  pageButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: theme.color.kola["50"],
  },
  pageButtonDisabled: {
    opacity: 0.4,
  },
  pageNumber: {
    minWidth: 44,
    textAlign: "center",
    color: KOLA_DEEP,
    fontVariant: ["tabular-nums"],
  },
  pressed: {
    opacity: 0.72,
  },
  skeleton: {
    gap: space[4],
  },
  skeletonRow: {
    flexDirection: "row",
    gap: space[3],
    padding: 14,
  },
  skeletonLines: {
    flex: 1,
    justifyContent: "center",
    gap: space[2],
  },
});
