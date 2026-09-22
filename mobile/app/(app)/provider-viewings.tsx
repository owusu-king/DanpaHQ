import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel, ViewAll } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  ChoiceRow,
  EmptyState,
  FilterGroup,
  GroupLabel,
  HARMATTAN,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  ListHead,
  ListRow,
  MUTED,
  PRESSED,
  QuietAction,
  RULE,
  RowLine,
  SearchField,
  SheetFooter,
  SummaryPanel,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, Type, space } from "@/components/ui";
import { timeAgo } from "@/notifications";
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { theme } from "@/theme";
import { placeOf, whenLabel } from "@/viewingMeaning";
import { formatSlot, listReceivedViewings, type Viewing } from "@/viewings";

type ViewingView = "action" | "upcoming" | "history";
type Show = "all" | ViewingView;
type Tone = "attention" | "waiting" | "good" | "neutral";
type Entry =
  | { kind: "group"; key: string; title: string; count: number; tone?: string; first: boolean }
  | { kind: "day"; key: string; title: string }
  | { kind: "row"; key: string; viewing: Viewing; first: boolean; last: boolean }
  | { kind: "more"; key: string; count: number };

const TITLE: Record<Show, string> = {
  all: "All viewings",
  action: "Needs action",
  upcoming: "Upcoming",
  history: "History",
};
const ICON: Record<Show, IconName> = {
  all: "albums-outline",
  action: "flash-outline",
  upcoming: "calendar-outline",
  history: "time-outline",
};
/** Waiting on the host in laterite, on somebody else in harmattan, a visit in hand in kola. */
const TONE: Record<Tone, { text: string; ink: string; wash: string }> = {
  attention: { text: LATERITE, ink: LATERITE, wash: theme.color.laterite["100"] },
  waiting: { text: HARMATTAN, ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  good: { text: KOLA, ink: KOLA_DEEP, wash: theme.color.kola["50"] },
  neutral: { text: MUTED, ink: theme.color.ink["700"], wash: theme.color.field["100"] },
};
/** How many finished visits the whole queue shows before the rest are one tap away. */
const HISTORY_SHOWN = 3;

/**
 * A host's viewings: a queue worked through across a day, with one Viewing
 * opening into its own workflow screen.
 *
 * Refined on review (2026-09-15). Today leads — how many visits, what needs the
 * host, when the next one is and how many wait on a tenant. Then one list in the
 * order somebody works it: what needs action, what is coming (by day, so it reads
 * as a schedule), and the latest of what is done. One green Filter and a search
 * replace the three tabs.
 */
export default function ProviderViewingsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const list = useRef<FlatList<Entry>>(null);
  const { activeContext } = useAuth();
  const preferred = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";
  const [items, setItems] = useState<Viewing[] | null>(null);
  const [view, setView] = useState<Show>("all");
  const [query, setQuery] = useState("");
  const [filtering, setFiltering] = useState(false);
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

  const all = useMemo(() => items ?? [], [items]);
  const counts = useMemo(() => ({
    all: all.length,
    action: all.filter((item) => viewingView(item) === "action").length,
    upcoming: all.filter((item) => viewingView(item) === "upcoming").length,
    history: all.filter((item) => viewingView(item) === "history").length,
  }), [all]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => all
    .filter((item) => view === "all" || viewingView(item) === view)
    .filter((item) => !normalizedQuery || [item.tenant_name, item.listing_headline, item.locality_name, item.landmark]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery)), [all, normalizedQuery, view]);
  const entries = useMemo(() => entriesFor(visible, view), [visible, view]);

  // Today, as the host plans it: visits in hand, and the next one to be at.
  const today = dayKeyOf(new Date());
  const visitsToday = all.filter((item) => item.confirmed_starts_at && ["confirmed", "checked_in"].includes(item.status)
    && dayKeyOf(new Date(item.confirmed_starts_at)) === today).length;
  const next = all
    .filter((item) => item.status === "confirmed" && item.confirmed_starts_at && new Date(item.confirmed_starts_at).getTime() >= Date.now() - 60 * 60 * 1000)
    .sort((a, b) => (a.confirmed_starts_at ?? "").localeCompare(b.confirmed_starts_at ?? ""))[0];
  const waiting = all.filter((item) => item.status === "offered").length;

  const open = (viewing: Viewing) =>
    router.push({ pathname: "/(app)/provider-viewing", params: { viewingId: viewing.id } } as never);
  // A new filter starts at the top of what it shows.
  const choose = (next: Show) => {
    setView(next);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };

  return (
    <IndexGround>
      <FlatList
        ref={list}
        data={entries}
        keyExtractor={(entry) => entry.key}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={(
          <View style={{ gap: density.sectionGap + space[2], marginBottom: space[4] }}>
            {error ? <Notice tone="error" title={error} /> : null}
            {all.length ? (
              <SummaryPanel
                label="Visits today"
                value={String(visitsToday)}
                note={counts.action ? { text: `${counts.action} ${counts.action === 1 ? "needs" : "need"} action`, tone: "alert" } : { text: "Nothing needs you", tone: "calm" }}
                facts={[
                  { label: "Next visit", value: next?.confirmed_starts_at ? nextVisitLabel(next.confirmed_starts_at, density.veryCompact) : "None booked" },
                  { label: "Waiting for tenant", value: String(waiting) },
                ]}
              />
            ) : null}
            {all.length ? (
              <View style={{ gap: space[3] }}>
                <ListHead title={TITLE[view]} count={visible.length} filters={view === "all" ? 0 : 1} filterTone="kola" onFilter={() => setFiltering(true)} />
                <SearchField label="Search viewings" placeholder="Tenant, Property or location" value={query} onChangeText={setQuery} />
              </View>
            ) : null}
          </View>
        )}
        renderItem={({ item: entry }) => {
          if (entry.kind === "group") {
            return (
              <View style={[styles.group, entry.first ? null : styles.groupGap]}>
                <GroupLabel count={entry.count} tone={entry.tone}>{entry.title}</GroupLabel>
              </View>
            );
          }
          if (entry.kind === "day") return <Type variant="label" style={styles.day}>{entry.title.toUpperCase()}</Type>;
          if (entry.kind === "more") {
            return (
              <ListRow first={false} last>
                <ViewAll count={entry.count} noun="in history" onPress={() => choose("history")} />
              </ListRow>
            );
          }
          return (
            <ListRow first={entry.first} last={entry.last}>
              {entry.first ? null : <View style={styles.rule} />}
              <ViewingRow viewing={entry.viewing} narrow={density.veryCompact} onPress={() => open(entry.viewing)} />
            </ListRow>
          );
        }}
        ListEmptyComponent={items === null ? <QueueSkeleton /> : error ? null : (
          <QueueEmpty
            view={view}
            searching={Boolean(normalizedQuery)}
            hasAny={all.length > 0}
            upcoming={counts.upcoming}
            onUpcoming={() => choose("upcoming")}
            onProperties={() => router.push("/(app)/(provider-tabs)/properties" as never)}
          />
        )}
      />

      <BottomSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        title="Filter"
        closeLabel="Close filter"
        footer={<SheetFooter
          canReset={view !== "all" || Boolean(query)}
          onReset={() => { choose("all"); setQuery(""); }}
          results={visible.length}
          onShow={() => setFiltering(false)}
        />}
      >
        <FilterGroup title="Show">
          <ChoiceRow first icon={ICON.all} label="All viewings" count={counts.all} selected={view === "all"} onPress={() => choose("all")} />
          <ChoiceRow first={false} icon={ICON.action} label="Needs action" count={counts.action} selected={view === "action"} onPress={() => choose("action")} />
          <ChoiceRow first={false} icon={ICON.upcoming} label="Upcoming" count={counts.upcoming} selected={view === "upcoming"} onPress={() => choose("upcoming")} />
          <ChoiceRow first={false} icon={ICON.history} label="History" count={counts.history} selected={view === "history"} onPress={() => choose("history")} />
        </FilterGroup>
      </BottomSheet>
    </IndexGround>
  );
}

/**
 * The queue as rows the list can virtualise: a group's name, a day's name inside
 * Upcoming, the rows that sit in one glass frame, and the way to the rest of the
 * history. Groups appear only when every view is on screen.
 */
function entriesFor(rows: Viewing[], show: Show): Entry[] {
  const out: Entry[] = [];
  const frame = (group: Viewing[], prefix: string, open = false) => group.forEach((viewing, index) => {
    out.push({ kind: "row", key: `${prefix}:${viewing.id}`, viewing, first: index === 0, last: !open && index === group.length - 1 });
  });
  for (const view of show === "all" ? (["action", "upcoming", "history"] as const) : [show]) {
    const group = rows.filter((viewing) => viewingView(viewing) === view).sort(viewingSort(view));
    if (!group.length) continue;
    if (show === "all") {
      out.push({ kind: "group", key: `group:${view}`, title: TITLE[view], count: group.length, tone: view === "action" ? LATERITE : undefined, first: out.length === 0 });
    }
    if (view === "upcoming") {
      for (const [day, visits] of byDay(group)) {
        out.push({ kind: "day", key: `day:${day}`, title: dayTitle(day) });
        frame(visits, day);
      }
    } else if (view === "history" && show === "all" && group.length > HISTORY_SHOWN) {
      frame(group.slice(0, HISTORY_SHOWN), view, true);
      out.push({ kind: "more", key: "more:history", count: group.length });
    } else {
      frame(group, view);
    }
  }
  return out;
}

/**
 * One visit: who, and how it stands; where, then the one detail that matters for
 * this state. The tile holds the time of a visit in hand, the date of one that is
 * done, or what kind of wait it is.
 */
function ViewingRow({ viewing, narrow, onPress }: { viewing: Viewing; narrow: boolean; onPress: () => void }) {
  const summary = viewingSummary(viewing);
  const tone = TONE[summary.tone];
  const tile = timeTile(viewing);
  const detail = [placeOf(viewing), viewingDetail(viewing)].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${viewing.tenant_name}. ${viewing.listing_headline}. ${summary.label}. ${viewingMoment(viewing)}. Open viewing.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.tile, { backgroundColor: tone.wash }]}>
        {tile ? (
          <>
            <Type variant="captionStrong" style={[styles.tileTop, { color: tone.ink }]}>{tile.top}</Type>
            <Type variant="label" style={[styles.tileBottom, { color: tone.ink }]}>{tile.bottom}</Type>
          </>
        ) : (
          <Ionicons name={summary.icon} size={17} color={tone.ink} />
        )}
      </View>
      <View style={rowStyles.rowBody}>
        {narrow ? (
          <Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{viewing.tenant_name}</Type>
        ) : (
          <RowLine
            start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{viewing.tenant_name}</Type>}
            end={<Type variant="caption" numberOfLines={1} style={[rowStyles.rowStatus, { color: tone.text }]}>{summary.label}</Type>}
          />
        )}
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{viewing.listing_headline}</Type>
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowMeta}>
          {narrow ? <Type variant="caption" style={[rowStyles.rowStatus, { color: tone.text }]}>{`${summary.label}${detail ? " · " : ""}`}</Type> : null}
          {detail}
        </Type>
      </View>
    </Pressable>
  );
}

function QueueEmpty({ view, searching, hasAny, upcoming, onUpcoming, onProperties }: {
  view: Show;
  searching: boolean;
  hasAny: boolean;
  upcoming: number;
  onUpcoming: () => void;
  onProperties: () => void;
}) {
  if (searching) return <EmptyState icon="search-outline" title="No matching viewings" hint="Try another tenant, Property or location." />;
  if (!hasAny) {
    return (
      <EmptyState
        icon="calendar-outline"
        hero
        title="No viewings yet"
        hint="When somebody asks to see one of your places, the request arrives here."
        action={<View style={styles.emptyAction}><QuietAction icon="business-outline" label="Your Properties" onPress={onProperties} /></View>}
      />
    );
  }
  if (view === "action") {
    return (
      <EmptyState
        icon={ICON.action}
        title="Nothing needs action"
        hint="New requests, ready check-ins and attendance responses appear here."
        action={upcoming ? <View style={styles.emptyAction}><QuietAction icon="calendar-outline" label="Upcoming visits" onPress={onUpcoming} /></View> : undefined}
      />
    );
  }
  if (view === "upcoming") return <EmptyState icon={ICON.upcoming} title="No upcoming visits" hint="Offered and confirmed times appear here." />;
  return <EmptyState icon={ICON.history} title="No viewing history yet" hint="Completed, cancelled and declined viewings stay here." />;
}

/** Shaped like the summary and the first rows, so nothing jumps when they arrive. */
function QueueSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading viewings" style={styles.skeleton}>
      <Panel style={styles.skeletonPanel}>
        <Bone width="30%" height={11} />
        <Bone width="18%" height={30} />
        <Bone height={34} />
      </Panel>
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={44} height={44} round={12} />
            <View style={styles.skeletonLines}>
              <Bone width="46%" height={14} />
              <Bone width="70%" />
              <Bone width="52%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
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

function viewingSummary(viewing: Viewing): { label: string; tone: Tone; icon: IconName } {
  if (viewing.status === "requested") return { label: "Needs a reply", tone: "attention", icon: "mail-unread-outline" };
  if (viewing.status === "offered") return { label: "Waiting for tenant", tone: "waiting", icon: "hourglass-outline" };
  if (viewing.status === "confirmed" && viewing.check_in.can_validate) return { label: "Ready for check-in", tone: "attention", icon: "qr-code-outline" };
  if (viewing.status === "confirmed") return { label: "Confirmed", tone: "good", icon: "checkmark-circle-outline" };
  if (viewing.status === "checked_in") return { label: "Checked in", tone: "attention", icon: "enter-outline" };
  if (viewing.status === "attendance_pending" && viewing.attendance.can_respond) return { label: "Response needed", tone: "attention", icon: "chatbubble-ellipses-outline" };
  if (viewing.status === "attendance_pending") return { label: "Attendance pending", tone: "waiting", icon: "hourglass-outline" };
  if (viewing.status === "completed") return { label: "Completed", tone: "good", icon: "checkmark-done-outline" };
  return { label: viewing.status_display, tone: "neutral", icon: "calendar-clear-outline" };
}

/** The whole moment, for a screen reader: the rows say less because the tile and the day already say it. */
function viewingMoment(viewing: Viewing) {
  if (viewing.confirmed_starts_at) return formatSlot(viewing.confirmed_starts_at);
  if (viewing.status === "offered") {
    const next = viewing.slots.find((slot) => !slot.is_past);
    return next ? `First option ${formatSlot(next.starts_at)}` : "New times needed";
  }
  return new Date(viewing.created_at).toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

/** What a row adds after the place, only where the tile and the day do not already say it. */
function viewingDetail(viewing: Viewing) {
  if (viewing.confirmed_starts_at) return "";
  if (viewing.status === "requested") return `Asked ${timeAgo(viewing.created_at)}`;
  return viewingMoment(viewing);
}

function timeTile(viewing: Viewing): { top: string; bottom: string } | null {
  if (!viewing.confirmed_starts_at) return null;
  const at = new Date(viewing.confirmed_starts_at);
  if (Number.isNaN(at.getTime())) return null;
  if (viewingView(viewing) === "history") {
    return { top: String(at.getDate()), bottom: at.toLocaleDateString("en-GH", { month: "short" }).toUpperCase() };
  }
  const [clock = "", half = ""] = at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" }).split(" ");
  return { top: clock, bottom: half.toUpperCase() };
}

function viewingSort(view: ViewingView) {
  return (a: Viewing, b: Viewing) => {
    const aDate = a.confirmed_starts_at || a.created_at;
    const bDate = b.confirmed_starts_at || b.created_at;
    return view === "history" ? new Date(bDate).getTime() - new Date(aDate).getTime() : new Date(aDate).getTime() - new Date(bDate).getTime();
  };
}

/** Upcoming visits by the day they happen; times the tenant has still to pick come last. */
function byDay(visits: Viewing[]): [string, Viewing[]][] {
  const days = new Map<string, Viewing[]>();
  for (const viewing of visits) {
    const key = viewing.confirmed_starts_at ? dayKeyOf(new Date(viewing.confirmed_starts_at)) : "open";
    days.set(key, [...(days.get(key) ?? []), viewing]);
  }
  return [...days.entries()].sort(([a], [b]) => (a === "open" ? 1 : b === "open" ? -1 : a.localeCompare(b)));
}

function dayKeyOf(at: Date) {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

function dayTitle(day: string) {
  if (day === "open") return "Times offered";
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (day === dayKeyOf(now)) return "Today";
  if (day === dayKeyOf(tomorrow)) return "Tomorrow";
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-GH", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The next visit as a figure, short enough never to be cut: the time when it is
 * today; "Tomorrow" and the time where there is room, and otherwise the weekday.
 */
function nextVisitLabel(iso: string, compact: boolean) {
  const [day = "", time = ""] = (whenLabel(iso) ?? "").split(" · ");
  if (day === "Today") return time;
  if (day === "Tomorrow" && !compact) return `${day} ${time}`;
  return `${new Date(iso).toLocaleDateString("en-GH", { weekday: "short" })} ${time}`;
}

const styles = StyleSheet.create({
  group: {
    paddingBottom: space[2],
  },
  groupGap: {
    marginTop: space[5],
  },
  day: {
    marginTop: space[2],
    marginBottom: space[2],
    paddingHorizontal: space[1],
    color: MUTED,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
    backgroundColor: RULE,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  tileTop: {
    fontSize: 13.5,
    lineHeight: 17,
    fontVariant: ["tabular-nums"],
  },
  tileBottom: {
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.5,
  },
  emptyAction: {
    marginTop: space[2],
  },
  skeleton: {
    gap: space[5],
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
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
