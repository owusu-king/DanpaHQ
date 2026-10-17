import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  FAINT,
  GroupLabel,
  HARMATTAN,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  ListRow,
  MUTED,
  PRESSED,
  QuietAction,
  RULE,
  RowLine,
  SearchField,
  rowStyles,
} from "@/components/portfolio/PortfolioList";
import { Act, Acts, Briefing, BriefingButton, Calm, Empty, Fold, MoreRow } from "@/components/work/WorkParts";
import { Notice, Type, radius, space } from "@/components/ui";
import { timeAgo } from "@/notifications";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";
import { placeOf } from "@/viewingMeaning";
import {
  actOf,
  countdown,
  dayKey,
  laneOf,
  lineOf,
  startsAt,
  upNext,
  viewingWork,
  week,
  type ViewingLane,
} from "@/viewingWork";
import { listReceivedViewings, type Viewing } from "@/viewings";

type Entry =
  | { kind: "label"; key: string; title: string; count?: number; tone?: string; first: boolean }
  | { kind: "day"; key: string; title: string; first: boolean }
  | { kind: "row"; key: string; viewing: Viewing; first: boolean; last: boolean; agenda: boolean }
  | { kind: "more"; key: string; section: "yours" | "waiting"; hidden: number }
  | { kind: "fold"; key: string; count: number; viewed: number; open: boolean }
  | { kind: "calm"; key: string }
  | { kind: "free"; key: string; title: string };

/** Each lane in the colour of who holds it: the host in laterite, the tenant in harmattan, a visit in hand in kola. */
const LANE: Record<ViewingLane, { ink: string; wash: string }> = {
  yours: { ink: LATERITE, wash: theme.color.laterite["100"] },
  scheduled: { ink: KOLA_DEEP, wash: theme.color.kola["50"] },
  waiting: { ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  past: { ink: theme.color.ink["700"], wash: theme.color.field["100"] },
};
const SHOWN = { yours: 8, waiting: 4 } as const;
const SEARCH_FROM = 9;
const WHITE = theme.color.field["0"];

/**
 * A host's viewings, as a day to plan (owner, 2026-10-06).
 *
 * The visit to be at next leads, on its own dark card with how long until it
 * starts and — once the window opens — the check-in. Then a sentence about what
 * waits on the host, a week strip that is the page's only filter (a day shows
 * that day's visits), what the host must answer with the step on the row, the
 * schedule as an agenda by day, the visits waiting on a tenant to pick a time,
 * and the past folded into one line.
 *
 * Gone: the summary panel of counts, the Filter sheet and the standing search.
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
  const [day, setDay] = useState<string | null>(null);
  const [expanded, setExpanded] = useState({ yours: false, waiting: false, past: false });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // A viewing is asked of a listing on a Property, so it belongs to that
    // Property's Portfolio — this list is about the one being operated.
    setItems(null);
    try {
      setItems(await listReceivedViewings(false, preferred ? { organization: preferred } : undefined));
      setError("");
    } catch (cause) {
      setItems([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load Viewings.");
    }
  }, [preferred]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const all = useMemo(() => items ?? [], [items]);
  const work = useMemo(() => viewingWork(all), [all]);
  const next = useMemo(() => upNext(all), [all]);
  const days = useMemo(() => week(all), [all]);
  const needle = query.trim().toLocaleLowerCase("en-GH");
  const entries = useMemo(() => entriesFor(work, all, { day, expanded, needle, nextId: next?.id ?? null }), [work, all, day, expanded, needle, next]);

  const openRecord = (viewing: Viewing) => router.push({ pathname: "/(app)/provider-viewing", params: { viewingId: viewing.id } } as never);
  const runAct = (viewing: Viewing) => {
    const act = actOf(viewing);
    if (act?.to === "check-in") router.push({ pathname: "/(app)/provider-viewing-check-in", params: { viewingId: viewing.id } } as never);
    else openRecord(viewing);
  };
  const chooseDay = (key: string) => {
    setDay((current) => (current === key ? null : key));
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const loading = items === null;
  const nothingAtAll = !loading && !error && all.length === 0;
  const thisWeek = days.reduce((sum, row) => sum + row.count, 0);
  const parts = [
    work.yours.length ? null : { text: "Nothing to answer", tone: KOLA_DEEP },
    { text: thisWeek ? `${thisWeek} ${thisWeek === 1 ? "visit" : "visits"} this week` : "No visits booked this week", tone: MUTED },
    work.waiting.length ? { text: `${work.waiting.length} waiting on a tenant`, tone: HARMATTAN } : null,
  ].filter((part): part is NonNullable<typeof part> => part !== null);

  return (
    <IndexGround>
      <FlatList
        ref={list}
        data={loading || nothingAtAll ? [] : entries}
        keyExtractor={(entry) => entry.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={loading || nothingAtAll ? (error ? <Notice tone="error" title={error} /> : null) : (
          <View style={styles.header}>
            {error ? <Notice tone="error" title={error} /> : null}
            {next && !searching ? <UpNext viewing={next} onOpen={() => openRecord(next)} onAct={() => runAct(next)} /> : null}
            <Briefing
              title={work.yours.length ? `${work.yours.length} ${work.yours.length === 1 ? "viewing needs" : "viewings need"} you` : "Your week"}
              parts={parts}
              trailing={all.length >= SEARCH_FROM
                ? <BriefingButton icon={searching ? "close" : "search"} label={searching ? "Close search" : "Search viewings"} onPress={() => { setSearching((current) => !current); setQuery(""); }} />
                : undefined}
            />
            {searching
              ? <SearchField label="Search viewings" placeholder="Tenant, Property or location" value={query} onChangeText={setQuery} />
              : <WeekStrip days={days} selected={day} onChoose={chooseDay} />}
          </View>
        )}
        renderItem={({ item: entry }) => {
          if (entry.kind === "label") {
            return (
              <View style={[styles.label, entry.first ? null : styles.labelGap]}>
                <GroupLabel count={entry.count} tone={entry.tone}>{entry.title}</GroupLabel>
              </View>
            );
          }
          if (entry.kind === "day") return <Type variant="label" style={[styles.day, entry.first ? null : styles.dayGap]}>{entry.title.toUpperCase()}</Type>;
          if (entry.kind === "free") return <Empty compact icon="calendar-clear-outline" title={entry.title} hint="Nothing is booked for this day." />;
          if (entry.kind === "more") {
            return (
              <ListRow first={false} last>
                <View style={styles.rule} />
                <MoreRow label={`Show ${entry.hidden} more`} onPress={() => setExpanded((current) => ({ ...current, [entry.section]: true }))} />
              </ListRow>
            );
          }
          if (entry.kind === "fold") {
            return (
              <View style={styles.labelGap}>
                <Fold
                  title="Past"
                  summary={`${entry.viewed} viewed · ${entry.count - entry.viewed} cancelled or missed`}
                  count={entry.count}
                  open={entry.open}
                  onToggle={() => setExpanded((current) => ({ ...current, past: !current.past }))}
                />
              </View>
            );
          }
          if (entry.kind === "calm") return <Calm text="No requests to answer or check-ins to do. New requests will appear here first." />;
          return (
            <ListRow first={entry.first} last={entry.last}>
              {entry.first ? null : <View style={[styles.rule, entry.agenda ? styles.agendaRule : null]} />}
              {entry.agenda
                ? <AgendaRow viewing={entry.viewing} onOpen={() => openRecord(entry.viewing)} />
                : <ViewingRow viewing={entry.viewing} onOpen={() => openRecord(entry.viewing)} onAct={() => runAct(entry.viewing)} />}
            </ListRow>
          );
        }}
        ListEmptyComponent={loading ? <ViewingsSkeleton /> : nothingAtAll ? (
          <Empty
            icon="calendar-outline"
            title="No viewings yet"
            hint="When somebody asks to see one of your places, the request arrives here."
            action={<QuietAction icon="business-outline" label="Your Properties" onPress={() => router.push("/(app)/(provider-tabs)/properties" as never)} />}
          />
        ) : needle ? (
          <Empty icon="search-outline" title="No matching viewings" hint="Try another tenant, Property or location." />
        ) : null}
      />
    </IndexGround>
  );
}

function entriesFor(
  work: ReturnType<typeof viewingWork>,
  all: Viewing[],
  { day, expanded, needle, nextId }: { day: string | null; expanded: { yours: boolean; waiting: boolean; past: boolean }; needle: string; nextId: string | null },
): Entry[] {
  const out: Entry[] = [];
  const rows = (list: Viewing[], prefix: string, agenda: boolean, open = false) => list.forEach((viewing, index) => {
    out.push({ kind: "row", key: `${prefix}:${viewing.id}`, viewing, first: index === 0, last: !open && index === list.length - 1, agenda });
  });

  if (needle) {
    const found = all
      .filter((viewing) => [viewing.tenant_name, viewing.listing_headline, viewing.locality_name, viewing.landmark].filter(Boolean).join(" ").toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => (b.confirmed_starts_at ?? b.created_at).localeCompare(a.confirmed_starts_at ?? a.created_at));
    rows(found, "found", false);
    return out;
  }

  // A chosen day shows that day's visits, and only them.
  if (day) {
    const onDay = all
      .filter((viewing) => { const at = startsAt(viewing); return at && dayKey(at) === day && laneOf(viewing) !== "past" && viewing.status !== "offered"; })
      .sort((a, b) => (a.confirmed_starts_at ?? "").localeCompare(b.confirmed_starts_at ?? ""));
    out.push({ kind: "label", key: "label:day", title: dayTitle(day), count: onDay.length || undefined, first: true });
    if (onDay.length) rows(onDay, "day", true);
    else out.push({ kind: "free", key: "free", title: "A free day" });
    return out;
  }

  const capped = (key: "yours" | "waiting", list: Viewing[]) => {
    const cut = !expanded[key] && list.length > SHOWN[key] + 1;
    const shown = cut ? list.slice(0, SHOWN[key]) : list;
    rows(shown, key, false, cut);
    if (cut) out.push({ kind: "more", key: `more:${key}`, section: key, hidden: list.length - shown.length });
  };

  // The visit on the Up next card carries its own step there; it is not offered twice.
  const yours = work.yours.filter((viewing) => viewing.id !== nextId);
  if (yours.length) {
    out.push({ kind: "label", key: "label:yours", title: "Your move", count: yours.length, tone: LATERITE, first: true });
    capped("yours", yours);
  } else if (!work.yours.length) {
    out.push({ kind: "calm", key: "calm" });
  }

  // The schedule, as an agenda by day — without the visit already on the Up next card.
  const booked = work.scheduled.filter((viewing) => viewing.id !== nextId && startsAt(viewing));
  if (booked.length) {
    out.push({ kind: "label", key: "label:schedule", title: "Schedule", count: booked.length, first: false });
    const byDay = new Map<string, Viewing[]>();
    for (const viewing of booked) {
      const key = dayKey(startsAt(viewing) as Date);
      byDay.set(key, [...(byDay.get(key) ?? []), viewing]);
    }
    [...byDay.entries()].forEach(([key, visits], index) => {
      out.push({ kind: "day", key: `day:${key}`, title: dayTitle(key), first: index === 0 });
      rows(visits, key, true);
    });
  }

  if (work.waiting.length) {
    out.push({ kind: "label", key: "label:waiting", title: "Waiting on a tenant", count: work.waiting.length, first: false });
    capped("waiting", work.waiting);
  }

  if (work.past.length) {
    out.push({ kind: "fold", key: "fold", count: work.past.length, viewed: work.past.filter((viewing) => viewing.status === "completed").length, open: expanded.past });
    if (expanded.past) rows(work.past.slice(0, 24), "past", false);
  }
  return out;
}

/**
 * The visit to be at next, on its own dark card: when, how long until, who and
 * where — and once the check-in window is open, the check-in itself.
 */
function UpNext({ viewing, onOpen, onAct }: { viewing: Viewing; onOpen: () => void; onAct: () => void }) {
  const at = startsAt(viewing) as Date;
  const act = actOf(viewing);
  const time = at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" });
  const when = dayTitle(dayKey(at));
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Up next: ${viewing.tenant_name}, ${when} at ${time}, ${countdown(at)}. ${viewing.listing_headline}. ${placeOf(viewing)}.`}
      onPress={onOpen}
      {...pressableFeedback(theme.color.kola["900"])}
      style={({ pressed }) => [styles.next, pressed ? styles.nextPressed : null]}
    >
      <View style={styles.nextTop}>
        <View style={styles.nextLive}>
          <View style={styles.nextDot} />
          <Type variant="label" style={styles.nextEyebrow}>{`UP NEXT · ${countdown(at).toUpperCase()}`}</Type>
        </View>
        <Ionicons name="chevron-forward" size={16} color={alpha(WHITE, 0.6)} />
      </View>
      <View style={styles.nextMain}>
        <View style={styles.nextWhen}>
          <Type variant="display2" style={styles.nextTime}>{time}</Type>
          <Type variant="caption" style={styles.nextDay}>{when}</Type>
        </View>
        <View style={styles.nextWho}>
          <Type variant="bodyStrong" numberOfLines={1} style={styles.nextName}>{viewing.tenant_name}</Type>
          <Type variant="caption" numberOfLines={2} style={styles.nextPlace}>{viewing.listing_headline}</Type>
          {placeOf(viewing) ? <Type variant="caption" numberOfLines={1} style={styles.nextPlace}>{placeOf(viewing)}</Type> : null}
        </View>
      </View>
      {act ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={act.label}
          onPress={onAct}
          {...pressableFeedback(theme.color.kola["50"])}
          style={({ pressed }) => [styles.nextAct, pressed ? { backgroundColor: theme.color.kola["50"] } : null]}
        >
          <Ionicons name={act.icon} size={16} color={KOLA_DEEP} />
          <Type variant="bodyStrong" style={styles.nextActText}>{act.label}</Type>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/**
 * The next seven days. Each day carries how many visits are booked as dots;
 * tapping one shows that day, and tapping it again shows the week.
 */
function WeekStrip({ days, selected, onChoose }: { days: ReturnType<typeof week>; selected: string | null; onChoose: (key: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.week} accessibilityRole="tablist">
      {days.map((row, index) => {
        const chosen = selected === row.key;
        const weekday = index === 0 ? "Today" : row.date.toLocaleDateString("en-GH", { weekday: "short" });
        return (
          <Pressable
            key={row.key}
            accessibilityRole="tab"
            aria-selected={chosen}
            accessibilityLabel={`${index === 0 ? "Today" : row.date.toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "long" })}: ${row.count ? `${row.count} ${row.count === 1 ? "visit" : "visits"}` : "nothing booked"}.`}
            onPress={() => onChoose(row.key)}
            {...pressableFeedback(PRESSED)}
            style={({ pressed }) => [styles.weekDay, chosen ? styles.weekDayChosen : null, pressed && !chosen ? { backgroundColor: PRESSED } : null]}
          >
            <Type variant="caption" style={[styles.weekName, chosen ? styles.onDark : null]}>{weekday}</Type>
            <Type variant="bodyStrong" style={[styles.weekDate, chosen ? styles.onDark : null]}>{row.date.getDate()}</Type>
            <View style={styles.weekDots}>
              {Array.from({ length: Math.min(row.count, 3) }, (_, dot) => (
                <View key={dot} style={[styles.weekDot, { backgroundColor: chosen ? WHITE : KOLA }]} />
              ))}
              {row.count > 3 ? <Type variant="caption" style={[styles.weekMore, chosen ? styles.onDark : null]}>+</Type> : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** One request or response the host must give: who, where, how long it has waited, and the step. */
function ViewingRow({ viewing, onOpen, onAct }: { viewing: Viewing; onOpen: () => void; onAct: () => void }) {
  const lane = laneOf(viewing);
  const look = LANE[lane];
  const act = actOf(viewing);
  const at = startsAt(viewing);
  const meta = at
    ? `${dayTitle(dayKey(at))} · ${at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })}`
    : lane === "past" ? "" : `Asked ${timeAgo(viewing.created_at)}`;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${viewing.tenant_name}. ${viewing.listing_headline}. ${lineOf(viewing)}. ${meta}. Open viewing.`}
      onPress={onOpen}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, styles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.mark, { backgroundColor: look.wash }]}>
        <Ionicons name={act?.icon ?? (lane === "waiting" ? "hourglass-outline" : lane === "past" ? "calendar-clear-outline" : "calendar-outline")} size={17} color={look.ink} />
      </View>
      <View style={[rowStyles.rowBody, styles.body]}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{viewing.tenant_name}</Type>}
          end={meta ? <Type variant="caption" numberOfLines={1} style={styles.meta}>{meta}</Type> : undefined}
        />
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{viewing.listing_headline}</Type>
        <Type variant="caption" numberOfLines={2} style={[styles.line, { color: lane === "past" ? MUTED : look.ink }]}>{lineOf(viewing)}</Type>
        {act ? (
          <Acts>
            <Act label={act.label} icon={act.icon} primary onPress={onAct} />
          </Acts>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A booked visit on the agenda: the time in its own column, then who and where. */
function AgendaRow({ viewing, onOpen }: { viewing: Viewing; onOpen: () => void }) {
  const at = startsAt(viewing) as Date;
  const [clock = "", half = ""] = at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" }).split(" ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${clock} ${half}. ${viewing.tenant_name}. ${viewing.listing_headline}. ${lineOf(viewing)}. Open viewing.`}
      onPress={onOpen}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.agenda, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={styles.agendaTime}>
        <Type variant="bodyStrong" style={styles.agendaClock}>{clock}</Type>
        <Type variant="label" style={styles.agendaHalf}>{half.toUpperCase()}</Type>
      </View>
      <View style={styles.agendaRail} />
      <View style={[rowStyles.rowBody, styles.body]}>
        <Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{viewing.tenant_name}</Type>
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{viewing.listing_headline}</Type>
        {placeOf(viewing) ? <Type variant="caption" numberOfLines={1} style={styles.meta}>{placeOf(viewing)}</Type> : null}
      </View>
    </Pressable>
  );
}

function ViewingsSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading viewings" style={styles.skeleton}>
      <Bone height={150} round={20} />
      <Bone width="52%" height={22} />
      <View style={styles.skeletonWeek}>
        {[0, 1, 2, 3, 4, 5].map((key) => <Bone key={key} width={46} height={64} round={14} />)}
      </View>
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={38} height={38} round={12} />
            <View style={styles.skeletonLines}>
              <Bone width="46%" height={14} />
              <Bone width="70%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

function dayTitle(key: string) {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(tomorrow)) return "Tomorrow";
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-GH", { weekday: "short", day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  header: {
    gap: space[4],
    marginBottom: space[5],
  },
  label: {
    paddingBottom: space[2],
  },
  labelGap: {
    marginTop: space[5],
  },
  day: {
    marginBottom: space[2],
    paddingHorizontal: space[1],
    color: MUTED,
  },
  dayGap: {
    marginTop: space[3],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 64,
    backgroundColor: RULE,
  },
  agendaRule: {
    marginLeft: 82,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  // Up next: the one dark surface on the page, Danpa HQ's deepest green.
  next: {
    gap: space[3],
    padding: space[4],
    borderRadius: 20,
    backgroundColor: theme.color.kola["800"],
  },
  nextPressed: {
    backgroundColor: theme.color.kola["900"],
  },
  nextTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nextLive: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  nextDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.color.kola["300"],
  },
  nextEyebrow: {
    color: alpha(WHITE, 0.82),
    letterSpacing: 0.6,
  },
  nextMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[4],
  },
  nextWhen: {
    minWidth: 92,
  },
  nextTime: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: WHITE,
    fontVariant: ["tabular-nums"],
  },
  nextDay: {
    fontSize: 13,
    lineHeight: 18,
    color: alpha(WHITE, 0.72),
  },
  nextWho: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingTop: 2,
  },
  nextName: {
    fontSize: 16,
    lineHeight: 21,
    color: WHITE,
  },
  nextPlace: {
    fontSize: 13,
    lineHeight: 18,
    color: alpha(WHITE, 0.72),
  },
  nextAct: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius.pill,
    backgroundColor: WHITE,
  },
  nextActText: {
    color: KOLA_DEEP,
  },
  week: {
    gap: 6,
    paddingRight: space[2],
  },
  weekDay: {
    width: 50,
    alignItems: "center",
    gap: 1,
    paddingTop: space[2],
    paddingBottom: 7,
    borderRadius: 14,
    backgroundColor: WHITE,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RULE,
  },
  weekDayChosen: {
    backgroundColor: theme.color.kola["800"],
    borderColor: theme.color.kola["800"],
  },
  weekName: {
    fontSize: 11.5,
    lineHeight: 15,
    color: MUTED,
  },
  weekDate: {
    fontSize: 17,
    lineHeight: 22,
    color: INK,
    fontVariant: ["tabular-nums"],
  },
  onDark: {
    color: WHITE,
  },
  weekDots: {
    height: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  weekDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  weekMore: {
    fontSize: 10,
    lineHeight: 10,
    color: KOLA,
  },
  row: {
    paddingVertical: 14,
  },
  body: {
    gap: 3,
  },
  mark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  meta: {
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
  },
  line: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "500",
    marginTop: 1,
  },
  agenda: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  agendaTime: {
    width: 44,
    alignItems: "flex-end",
  },
  agendaClock: {
    fontSize: 15,
    lineHeight: 19,
    color: INK,
    fontVariant: ["tabular-nums"],
  },
  agendaHalf: {
    fontSize: 10,
    lineHeight: 13,
    color: MUTED,
    letterSpacing: 0.5,
  },
  agendaRail: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
    backgroundColor: theme.color.kola["300"],
  },
  skeleton: {
    gap: space[3],
  },
  skeletonWeek: {
    flexDirection: "row",
    gap: 6,
    marginBottom: space[3],
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

