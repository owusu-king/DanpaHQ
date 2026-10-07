import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  GroupLabel,
  HARMATTAN,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  MUTED,
  PRESSED,
  QuietAction,
  RULE,
  Thumb,
  rowStyles,
} from "@/components/portfolio/PortfolioList";
import { Act, Acts, Calm, Empty, Fold } from "@/components/work/WorkParts";
import { Type, Notice, radius, space } from "@/components/ui";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";
import { bySoonest, placeOf, standing, whenLabel, type ViewingStanding } from "@/viewingMeaning";
import { listMyViewings, type Viewing } from "@/viewings";

type Row = { viewing: Viewing; state: ViewingStanding };
const WHITE = theme.color.field["0"];

/**
 * The tenant's viewings, read as where they have to be (owner, 2026-10-06).
 *
 * A viewing is an appointment, not a status. The next visit leads on its own
 * card — the photograph, when, how long until, where — with the one thing to do
 * there (check in, once the window opens). Then anything that waits on the
 * tenant, with its step on the row (choose a time, say what happened, what
 * next); the rest of the schedule by day; the requests still waiting on a
 * landlord; and the past, folded. The Filter sheet is gone.
 *
 * What the tenant may do is `standing()`'s answer, shared with web; this screen
 * only arranges it.
 */
export default function ViewingsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const [viewings, setViewings] = useState<Viewing[] | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setViewings(await listMyViewings());
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load your viewings.");
      setViewings([]);
    }
  }, []);

  // Confirming, cancelling and checking in all happen on the detail screen, so
  // the schedule has to be right when it comes back into view.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const lanes = useMemo(() => {
    const rows: Row[] = (viewings ?? []).map((viewing) => ({ viewing, state: standing(viewing) }));
    const upcoming = rows.filter((row) => row.state.group === "upcoming").sort((a, b) => bySoonest(a.viewing, b.viewing));
    const timed = upcoming.filter((row) => row.viewing.confirmed_starts_at);
    return {
      next: timed[0] ?? null,
      yours: rows.filter((row) => row.state.group === "action"),
      later: timed.slice(1),
      waiting: upcoming.filter((row) => !row.viewing.confirmed_starts_at),
      past: rows.filter((row) => row.state.group === "past").sort((a, b) => (b.viewing.confirmed_starts_at ?? b.viewing.created_at).localeCompare(a.viewing.confirmed_starts_at ?? a.viewing.created_at)),
    };
  }, [viewings]);

  const open = (viewing: Viewing) => router.push({ pathname: "/(app)/viewing/[id]", params: { id: viewing.id } });
  const byDay = groupByDay(lanes.later);

  return (
    <IndexGround>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: space[5] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
      >
        {error ? <Notice tone="error" title={error} /> : null}

        {viewings === null ? (
          <ScheduleSkeleton />
        ) : viewings.length === 0 ? (
          error ? null : (
            <Empty
              icon="calendar-outline"
              title="No viewings yet"
              hint="Ask to see a place and the landlord offers you times."
              action={<QuietAction icon="compass-outline" label="Explore homes" onPress={() => router.push("/(app)/(tabs)/explore" as never)} />}
            />
          )
        ) : (
          <>
            {lanes.next ? <NextVisit row={lanes.next} onPress={() => open(lanes.next!.viewing)} /> : null}

            {lanes.yours.length ? (
              <View style={styles.section}>
                <GroupLabel count={lanes.yours.length} tone={LATERITE}>Needs you</GroupLabel>
                <Panel>
                  {lanes.yours.map((row, index) => <VisitRow key={row.viewing.id} row={row} first={index === 0} onPress={() => open(row.viewing)} />)}
                </Panel>
              </View>
            ) : lanes.next || lanes.later.length || lanes.waiting.length ? (
              <Calm text="Nothing waits on you. A landlord’s offer of times shows here first." />
            ) : null}

            {byDay.length ? (
              <View style={styles.section}>
                <GroupLabel count={lanes.later.length}>Coming up</GroupLabel>
                {byDay.map(([day, rows]) => (
                  <View key={day} style={styles.day}>
                    <Type variant="label" style={styles.dayTitle}>{day.toUpperCase()}</Type>
                    <Panel>
                      {rows.map((row, index) => <VisitRow key={row.viewing.id} row={row} first={index === 0} onPress={() => open(row.viewing)} />)}
                    </Panel>
                  </View>
                ))}
              </View>
            ) : null}

            {lanes.waiting.length ? (
              <View style={styles.section}>
                <GroupLabel count={lanes.waiting.length}>Waiting on a landlord</GroupLabel>
                <Panel>
                  {lanes.waiting.map((row, index) => <VisitRow key={row.viewing.id} row={row} first={index === 0} onPress={() => open(row.viewing)} />)}
                </Panel>
              </View>
            ) : null}

            {lanes.past.length ? (
              <View>
                <Fold
                  title="Past"
                  icon="calendar-clear-outline"
                  summary={`${lanes.past.filter((row) => row.viewing.status === "completed").length} viewed`}
                  count={lanes.past.length}
                  open={pastOpen}
                  onToggle={() => setPastOpen((current) => !current)}
                />
                {pastOpen ? (
                  <View style={styles.foldBody}>
                    <Panel>
                      {lanes.past.map((row, index) => <VisitRow key={row.viewing.id} row={row} first={index === 0} onPress={() => open(row.viewing)} />)}
                    </Panel>
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </IndexGround>
  );
}

/**
 * The next visit: its photograph with the countdown on it, then when, the place
 * and where it is — and the one thing to do there, when the lifecycle offers it.
 */
function NextVisit({ row, onPress }: { row: Row; onPress: () => void }) {
  const { viewing, state } = row;
  const when = whenLabel(viewing.confirmed_starts_at);
  const until = countdown(viewing.confirmed_starts_at as string);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Next viewing: ${viewing.listing_headline}. ${placeOf(viewing)}. ${when ?? ""}, ${until}. ${state.line}.`}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["900"])}
      style={({ pressed }) => [styles.next, pressed ? { backgroundColor: theme.color.kola["900"] } : null]}
    >
      <View style={styles.cover}>
        {viewing.photo_url ? (
          <Image source={{ uri: viewing.photo_url }} accessible={false} resizeMode="cover" style={styles.coverImage} />
        ) : (
          <Ionicons name="home-outline" size={30} color={alpha(WHITE, 0.5)} />
        )}
        <View style={styles.countdown}>
          <View style={styles.countdownDot} />
          <Type variant="label" style={styles.countdownText}>{`UP NEXT · ${until.toUpperCase()}`}</Type>
        </View>
      </View>
      <View style={styles.nextBody}>
        {when ? <Type variant="title2" numberOfLines={1} style={styles.nextWhen}>{when}</Type> : null}
        <Type variant="bodyStrong" numberOfLines={2} style={styles.nextTitle}>{viewing.listing_headline}</Type>
        {placeOf(viewing) ? <Type variant="caption" numberOfLines={1} style={styles.nextPlace}>{placeOf(viewing)}</Type> : null}
        {state.callToAction ? (
          <View style={styles.nextAct}>
            <Ionicons name="arrow-forward-circle-outline" size={17} color={KOLA_DEEP} />
            <Type variant="bodyStrong" style={{ color: KOLA_DEEP }}>{state.callToAction}</Type>
          </View>
        ) : (
          <Type variant="captionStrong" style={styles.nextLine}>{state.line}</Type>
        )}
      </View>
    </Pressable>
  );
}

/** Where, when, how it stands, and the one thing to do — on the row, when there is one. */
function VisitRow({ row, first, onPress }: { row: Row; first: boolean; onPress: () => void }) {
  const { viewing, state } = row;
  const when = whenLabel(viewing.confirmed_starts_at);
  const past = state.group === "past";
  // Waiting on the tenant in laterite; a visit with a time in kola; one still waiting for a time in harmattan.
  const tone = state.group === "action" ? LATERITE : past ? MUTED : viewing.confirmed_starts_at ? KOLA_DEEP : HARMATTAN;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${viewing.listing_headline}. ${placeOf(viewing)}. ${when ?? state.line}. ${state.line}.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, first ? null : styles.ruled, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Thumb uri={viewing.photo_url} size={56} />
      <View style={[rowStyles.rowBody, styles.body]}>
        {when ? <Type variant="bodyStrong" numberOfLines={1} style={[styles.when, past ? { color: MUTED } : null]}>{when}</Type> : null}
        <Type variant="bodyStrong" numberOfLines={2} style={when ? styles.headline : rowStyles.rowTitle}>{viewing.listing_headline}</Type>
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{placeOf(viewing) || "Ghana"}</Type>
        <Type variant="captionStrong" numberOfLines={2} style={[styles.line, { color: tone }]}>{state.line}</Type>
        {state.callToAction && !past ? (
          <Acts>
            <Act label={state.callToAction} icon="arrow-forward" primary={state.group === "action"} onPress={onPress} />
          </Acts>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Shaped like the next-visit card and a row, so nothing jumps when they arrive. */
function ScheduleSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your viewings" style={styles.skeleton}>
      <Bone height={240} round={22} />
      <Panel>
        {[0, 1].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={56} height={56} round={12} />
            <View style={styles.skeletonLines}>
              <Bone width="40%" height={14} />
              <Bone width="72%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

/** The schedule by day, in the order the days come: "Today", "Tomorrow", then the date. */
function groupByDay(rows: Row[]): [string, Row[]][] {
  const days = new Map<string, Row[]>();
  for (const row of rows) {
    const day = (whenLabel(row.viewing.confirmed_starts_at) ?? "").split(" · ")[0] || "Later";
    days.set(day, [...(days.get(day) ?? []), row]);
  }
  return [...days.entries()];
}

/** "in 2h 15m", "in 3 days", "now". */
function countdown(iso: string) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (minutes <= 5) return minutes < -5 ? "started" : "now";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  day: { gap: space[2], marginTop: space[1] },
  dayTitle: { paddingHorizontal: space[1], color: MUTED },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  foldBody: { marginTop: space[3] },
  body: { gap: 2 },
  when: { fontSize: 15.5, lineHeight: 21, color: INK },
  headline: { fontSize: 14, lineHeight: 19, color: INK },
  line: { marginTop: 2, fontSize: 12.5, lineHeight: 17 },
  // The next visit: Rooomly's deepest green, as the host's Up next card is.
  next: { overflow: "hidden", borderRadius: 22, backgroundColor: theme.color.kola["800"] },
  cover: { height: 140, alignItems: "center", justifyContent: "center", backgroundColor: alpha(WHITE, 0.06) },
  coverImage: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  countdown: { position: "absolute", top: space[3], left: space[3], flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space[2], paddingVertical: 4, borderRadius: radius.pill, backgroundColor: alpha(theme.color.kola["900"], 0.72) },
  countdownDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.color.kola["300"] },
  countdownText: { color: WHITE, letterSpacing: 0.5 },
  nextBody: { gap: 3, padding: space[4] },
  nextWhen: { fontSize: 21, lineHeight: 27, letterSpacing: -0.3, color: WHITE },
  nextTitle: { fontSize: 15, lineHeight: 20, color: alpha(WHITE, 0.92) },
  nextPlace: { fontSize: 13, lineHeight: 18, color: alpha(WHITE, 0.7) },
  nextLine: { marginTop: space[2], fontSize: 13, lineHeight: 18, color: theme.color.kola["50"] },
  nextAct: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2], marginTop: space[3], borderRadius: radius.pill, backgroundColor: WHITE },
  skeleton: { gap: space[4] },
  skeletonRow: { flexDirection: "row", gap: space[3], padding: 14 },
  skeletonLines: { flex: 1, justifyContent: "center", gap: space[2] },
});

