import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel, ViewAll } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  CHEVRON,
  ChoiceRow,
  DEEP,
  EDGE,
  EmptyState,
  FilterGroup,
  GLASS,
  GroupLabel,
  INK,
  KOLA,
  KOLA_DEEP,
  ListHead,
  MUTED,
  PANEL_RADIUS,
  PRESSED,
  QuietAction,
  RULE,
  SheetFooter,
  Thumb,
  WHITE,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, Type, radius, space } from "@/components/ui";
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";
import {
  bySoonest,
  matchesViewingFilter,
  placeOf,
  standing,
  viewingFilters,
  whenLabel,
  type ViewingFilter,
  type ViewingGroup,
  type ViewingStanding,
} from "@/viewingMeaning";
import { listMyViewings, type Viewing } from "@/viewings";

const FILTER_TITLE: Record<ViewingFilter, string> = {
  all: "All viewings",
  upcoming: "Upcoming",
  action: "Needs you",
  past: "Past",
};
const FILTER_ICON: Record<ViewingFilter, IconName> = {
  all: "calendar-outline",
  upcoming: "time-outline",
  action: "hand-right-outline",
  past: "checkmark-done-outline",
};
const EMPTY: Record<ViewingFilter, { title: string; hint: string }> = {
  all: { title: "No viewings here", hint: "Your viewing requests will appear here." },
  upcoming: { title: "No upcoming visits", hint: "Confirmed visits and requests waiting for a time appear here." },
  action: { title: "Nothing needs you", hint: "You are up to date on every viewing." },
  past: { title: "No past viewings", hint: "Completed and cancelled visits stay here." },
};
/** How many past visits the whole schedule shows before the rest are one tap away. */
const PAST_SHOWN = 3;

/**
 * The tenant's schedule.
 *
 * A viewing is an appointment, not a status. So a row says the two things
 * somebody standing at a junction needs — where, and when — and everything the
 * lifecycle might allow at that moment lives one tap away, on the record.
 *
 * Refined on review (2026-09-15): the very next visit leads as a card with its
 * photograph and its day, because it is what somebody opened the page to check.
 * The rest of the schedule is one glass list per group; the past shows its
 * latest few, and "View all" turns the one green Filter to it.
 */
export default function ViewingsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const scroll = useRef<ScrollView>(null);
  const [viewings, setViewings] = useState<Viewing[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ViewingFilter>("all");
  const [filtering, setFiltering] = useState(false);

  const load = useCallback(async () => {
    try {
      setViewings(await listMyViewings());
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not load your viewings.",
      );
      setViewings([]);
    }
  }, []);

  // Confirming, cancelling and checking in all happen on the detail screen, so
  // the schedule has to be right when it comes back into view.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const rows = (viewings ?? []).map((viewing) => ({ viewing, state: standing(viewing) }));
  const sections: readonly {
    id: ViewingGroup;
    label: string;
    rows: typeof rows;
  }[] = [
    {
      id: "upcoming",
      label: FILTER_TITLE.upcoming,
      rows: rows
        .filter((row) => row.state.group === "upcoming")
        .sort((a, b) => bySoonest(a.viewing, b.viewing)),
    },
    { id: "action", label: FILTER_TITLE.action, rows: rows.filter((row) => row.state.group === "action") },
    { id: "past", label: FILTER_TITLE.past, rows: rows.filter((row) => row.state.group === "past") },
  ];
  const visibleSections = sections
    .filter((section) => matchesViewingFilter(section.id, filter))
    .filter((section) => section.rows.length > 0);
  const counts: Record<ViewingFilter, number> = {
    all: rows.length,
    upcoming: rows.filter((row) => row.state.group === "upcoming").length,
    action: rows.filter((row) => row.state.group === "action").length,
    past: rows.filter((row) => row.state.group === "past").length,
  };

  const open = (viewing: Viewing) =>
    router.push({ pathname: "/(app)/viewing/[id]", params: { id: viewing.id } });
  // A new filter starts at the top of what it shows.
  const choose = (next: ViewingFilter) => {
    setFilter(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  return (
    <IndexGround>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: density.sectionGap + space[2] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
      >
        {error ? <Notice tone="error" title={error} /> : null}

        {viewings === null ? (
          <ScheduleSkeleton />
        ) : viewings.length === 0 ? (
          error ? null : (
            <EmptyState
              icon="calendar-outline"
              hero
              title="No viewings yet"
              hint="Ask to see a place and the landlord offers you times."
              action={<View style={styles.emptyAction}><QuietAction icon="compass-outline" label="Explore homes" onPress={() => router.push("/(app)/(tabs)/explore" as never)} /></View>}
            />
          )
        ) : (
          <>
            <ListHead title={FILTER_TITLE[filter]} count={counts[filter]} filters={filter === "all" ? 0 : 1} filterTone="kola" onFilter={() => setFiltering(true)} />

            {visibleSections.length ? (
              visibleSections.map((section) => {
                // The next timed visit leads as a card; a request still waiting for a time never does.
                const lead = section.id === "upcoming" && section.rows[0]?.viewing.confirmed_starts_at ? section.rows[0] : null;
                const rest = lead ? section.rows.slice(1) : section.rows;
                const cut = section.id === "past" && filter === "all" && rest.length > PAST_SHOWN;
                const shown = cut ? rest.slice(0, PAST_SHOWN) : rest;
                return (
                  <View key={section.id} style={styles.section}>
                    {filter === "all" ? (
                      <GroupLabel count={section.rows.length} tone={section.id === "action" ? KOLA_DEEP : undefined}>{section.label}</GroupLabel>
                    ) : null}
                    {lead ? <NextVisit viewing={lead.viewing} state={lead.state} onPress={() => open(lead.viewing)} /> : null}
                    {shown.length ? (
                      <Panel>
                        {shown.map((row, index) => (
                          <ScheduleRow key={row.viewing.id} viewing={row.viewing} state={row.state} first={index === 0} onPress={() => open(row.viewing)} />
                        ))}
                        {cut ? <ViewAll count={section.rows.length} noun="past viewings" onPress={() => choose("past")} /> : null}
                      </Panel>
                    ) : null}
                  </View>
                );
              })
            ) : (
              <EmptyState icon={FILTER_ICON[filter]} title={EMPTY[filter].title} hint={EMPTY[filter].hint} />
            )}
          </>
        )}
      </ScrollView>

      <BottomSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        title="Filter"
        hideTitle
        closeLabel="Close filter"
        footer={<SheetFooter
          canReset={filter !== "all"}
          onReset={() => choose("all")}
          results={counts[filter]}
          onShow={() => setFiltering(false)}
        />}
      >
        <FilterGroup title="Show">
          {viewingFilters.map((option, index) => (
            <ChoiceRow
              key={option.id}
              first={index === 0}
              icon={FILTER_ICON[option.id]}
              label={option.label}
              count={counts[option.id]}
              selected={filter === option.id}
              onPress={() => choose(option.id)}
            />
          ))}
        </FilterGroup>
      </BottomSheet>
    </IndexGround>
  );
}

/**
 * The next visit, as a card: its photograph with the day on it, then the time
 * large, the place, and how it stands beside the one thing to do.
 */
function NextVisit({ viewing, state, onPress }: { viewing: Viewing; state: ViewingStanding; onPress: () => void }) {
  const density = useHomeDensity();
  const when = whenLabel(viewing.confirmed_starts_at);
  const day = dayTile(viewing.confirmed_starts_at);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${viewing.listing_headline}. ${placeOf(viewing)}. ${when ?? state.line}. ${state.callToAction ?? "View details"}.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.card, isAndroid ? null : styles.lift, pressed && !isAndroid ? { opacity: 0.94 } : null]}
    >
      <View style={[styles.cover, { height: density.compact ? 132 : 150 }]}>
        {viewing.photo_url ? (
          <Image source={{ uri: viewing.photo_url }} accessible={false} resizeMode="cover" style={styles.coverImage} />
        ) : (
          <Ionicons name="image-outline" size={28} color={CHEVRON} />
        )}
        {day ? (
          <View style={styles.tile}>
            <Type variant="label" style={styles.tileMonth}>{day.month}</Type>
            <Type variant="bodyStrong" style={styles.tileDay}>{day.date}</Type>
          </View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        {when ? (
          <Type variant="title2" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={styles.cardWhen}>{when}</Type>
        ) : null}
        <Type variant="bodyStrong" numberOfLines={2} style={rowStyles.rowTitle}>{viewing.listing_headline}</Type>
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{placeOf(viewing) || "Ghana"}</Type>
        <Standing state={state} />
      </View>
    </Pressable>
  );
}

/**
 * Where, when, and one way in. A timed visit leads with its time, the largest
 * words on the row; a request still waiting for one leads with the place.
 */
function ScheduleRow({ viewing, state, first, onPress }: { viewing: Viewing; state: ViewingStanding; first: boolean; onPress: () => void }) {
  const when = whenLabel(viewing.confirmed_starts_at);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${viewing.listing_headline}. ${placeOf(viewing)}. ${when ?? state.line}. ${state.callToAction ?? "View details"}.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, first ? null : styles.ruled, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
    >
      <Thumb uri={viewing.photo_url} />
      <View style={rowStyles.rowBody}>
        {when ? (
          <Type variant="bodyStrong" numberOfLines={1} style={[styles.rowWhen, state.group === "past" ? { color: MUTED } : null]}>{when}</Type>
        ) : null}
        <Type variant="bodyStrong" numberOfLines={2} style={when ? styles.rowHeadline : rowStyles.rowTitle}>{viewing.listing_headline}</Type>
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{placeOf(viewing) || "Ghana"}</Type>
        <Standing state={state} />
      </View>
    </Pressable>
  );
}

/**
 * How it stands, and — when the lifecycle offers one — the one thing to do, as a
 * pill. Where the two do not fit side by side the pill drops under the line
 * rather than cutting it short.
 */
function Standing({ state }: { state: ViewingStanding }) {
  const act = state.group === "action";
  const dot = act ? KOLA : state.group === "upcoming" ? theme.color.kola["300"] : alpha(INK, 0.3);
  return (
    <View style={styles.standing}>
      <View style={styles.standingLine}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Type variant="captionStrong" style={[styles.standingText, { color: act ? KOLA_DEEP : MUTED }]}>{state.line}</Type>
      </View>
      {state.callToAction ? (
        <View style={[styles.act, act ? null : styles.actQuiet]}>
          <Type variant="captionStrong" style={[styles.actText, act ? null : { color: KOLA_DEEP }]}>{state.callToAction}</Type>
          <Ionicons name="arrow-forward" size={13} color={act ? WHITE : KOLA_DEEP} />
        </View>
      ) : null}
    </View>
  );
}

/** Shaped like the card and the rows, so nothing jumps when they arrive. */
function ScheduleSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your viewings" style={styles.skeleton}>
      <Panel>
        <Bone height={132} round={0} />
        <View style={styles.skeletonBody}>
          <Bone width="46%" height={20} />
          <Bone width="70%" />
          <Bone width="38%" />
        </View>
      </Panel>
      <Panel>
        {[0, 1].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={60} height={60} round={12} />
            <View style={styles.skeletonLines}>
              <Bone width="40%" height={14} />
              <Bone width="72%" />
              <Bone width="50%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

/** The day on the card's photograph, as a calendar tile reads: month over date. */
function dayTile(iso: string | null) {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return {
    month: at.toLocaleDateString("en-GH", { month: "short" }).toUpperCase(),
    date: String(at.getDate()),
  };
}

const styles = StyleSheet.create({
  section: {
    gap: space[2],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  card: {
    overflow: "hidden",
    borderRadius: PANEL_RADIUS,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  // A whisper of green shadow, off Android, where elevation smudges through glass.
  lift: {
    shadowColor: DEEP,
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  cover: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: alpha(DEEP, 0.06),
  },
  coverImage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  tile: {
    position: "absolute",
    top: space[3],
    left: space[3],
    minWidth: 46,
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: space[2],
    borderRadius: 12,
    backgroundColor: alpha(WHITE, 0.92),
  },
  tileMonth: {
    color: KOLA_DEEP,
    letterSpacing: 0.6,
  },
  tileDay: {
    fontSize: 19,
    lineHeight: 23,
    color: INK,
    fontVariant: ["tabular-nums"],
  },
  cardBody: {
    gap: 2,
    paddingHorizontal: 14,
    paddingTop: space[3],
    paddingBottom: 14,
  },
  cardWhen: {
    marginBottom: 2,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.2,
    color: INK,
  },
  rowWhen: {
    fontSize: 15.5,
    lineHeight: 21,
    color: INK,
  },
  rowHeadline: {
    fontSize: 14,
    lineHeight: 19,
    color: INK,
  },
  standing: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space[2],
    rowGap: space[2],
    marginTop: space[2],
  },
  standingLine: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 110,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  standingText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    lineHeight: 17,
  },
  act: {
    marginLeft: "auto",
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: KOLA,
  },
  actQuiet: {
    backgroundColor: theme.color.kola["50"],
  },
  actText: {
    fontSize: 13,
    lineHeight: 17,
    color: WHITE,
  },
  emptyAction: {
    marginTop: space[2],
  },
  skeleton: {
    gap: space[5],
  },
  skeletonBody: {
    gap: space[2],
    padding: 14,
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
