import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, View } from "react-native";

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
  KOLA,
  LAGOON,
  LATERITE,
  ListRow,
  MUTED,
  PRESSED,
  RULE,
  RowLine,
  SearchField,
  rowStyles,
} from "@/components/portfolio/PortfolioList";
import { Act, Acts, Age, Briefing, BriefingButton, Calm, Empty, Fold, MoreRow, Segments } from "@/components/work/WorkParts";
import { Notice, Type, space } from "@/components/ui";
import { categoryIcon, listOrganizationMaintenance, type MaintenanceRequest } from "@/maintenance";
import { STALLED_DAYS, daysSince, laneOf, lineOf, repairWork, stepOf, stopsDone, type RepairLane, type RepairWork } from "@/maintenanceWork";
import { listOrganizations } from "@/organizations";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { shortAge } from "@/requestQueue";
import { theme } from "@/theme";

type Live = Exclude<RepairLane, "done">;
type Entry =
  | { kind: "label"; key: string; title: string; count: number; tone?: string; first: boolean }
  | { kind: "row"; key: string; request: MaintenanceRequest; first: boolean; last: boolean }
  | { kind: "more"; key: string; lane: Live; hidden: number }
  | { kind: "fold"; key: string; count: number; open: boolean }
  | { kind: "calm"; key: string };

/** Each lane in the colour of who holds it: the provider in laterite and harmattan, the tenant in lagoon. */
const LANE: Record<RepairLane, { title: string; ink: string; wash: string }> = {
  start: { title: "To start", ink: LATERITE, wash: theme.color.laterite["100"] },
  fixing: { title: "Being fixed", ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  confirming: { title: "Waiting on a tenant", ink: LAGOON, wash: theme.color.lagoon["100"] },
  done: { title: "Fixed", ink: theme.color.ink["700"], wash: theme.color.field["100"] },
};
const SHOWN: Record<Live, number> = { start: 8, fixing: 6, confirming: 4 };
const SEARCH_FROM = 9;

/**
 * A Portfolio's repairs, as work (owner, 2026-10-06).
 *
 * How many repairs wait to be started leads, with how long the oldest has
 * waited and any the tenant has reopened. Then the lanes in the order a
 * landlord works them — to start, being fixed, waiting on a tenant — each
 * repair with its photo, the place and tenant, the four stops it walks, how
 * long it has waited, and the provider's step where there is one. Fixed repairs
 * fold into one line.
 *
 * Gone: the summary panel of counts and the Filter sheet.
 */
export function ProviderMaintenanceScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { activeContext } = useAuth();
  const [requests, setRequests] = useState<MaintenanceRequest[] | null>(null);
  const [expanded, setExpanded] = useState<Record<RepairLane, boolean>>({ start: false, fixing: false, confirming: false, done: false });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      // The Portfolio being operated; the first one when none is chosen yet.
      const preferred = activeContext?.startsWith("organization:") ? activeContext.slice("organization:".length) : "";
      const organization = preferred || (await listOrganizations())[0]?.id;
      setRequests(organization ? await listOrganizationMaintenance({ organization }) : []);
      setError("");
    } catch (cause) {
      setRequests((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load maintenance requests.");
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const all = useMemo(() => requests ?? [], [requests]);
  const work = useMemo(() => repairWork(all), [all]);
  const needle = query.trim().toLocaleLowerCase("en-GH");
  const entries = useMemo(() => entriesFor(work, all, expanded, needle), [work, all, expanded, needle]);
  const open = (request: MaintenanceRequest) => router.push({ pathname: "/(app)/maintenance-request", params: { id: request.id } } as never);

  const loading = requests === null;
  const nothingAtAll = !loading && !error && all.length === 0;
  const oldest = work.start[0] ? daysSince(work.start[0].status_changed_at) : 0;
  const reopened = work.start.filter((request) => request.status === "reopened").length;
  const parts = [
    work.start.length ? { text: oldest >= 1 ? `Oldest ${oldest} ${oldest === 1 ? "day" : "days"}` : "All reported today", tone: oldest >= STALLED_DAYS ? LATERITE : MUTED, strong: oldest >= STALLED_DAYS } : null,
    reopened ? { text: `${reopened} reopened`, tone: LATERITE } : null,
    work.fixing.length ? { text: `${work.fixing.length} being fixed`, tone: HARMATTAN } : null,
    work.confirming.length ? { text: `${work.confirming.length} waiting on a tenant`, tone: LAGOON } : null,
  ].filter((part): part is NonNullable<typeof part> => part !== null);

  return (
    <IndexGround>
      <FlatList
        data={loading || nothingAtAll ? [] : entries}
        keyExtractor={(entry) => entry.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={loading || nothingAtAll ? (error ? <Notice tone="error" title={error} /> : null) : (
          <View style={styles.header}>
            {error ? <Notice tone="error" title={error} /> : null}
            <Briefing
              title={work.start.length
                ? `${work.start.length} ${work.start.length === 1 ? "repair waits" : "repairs wait"} to be started`
                : work.fixing.length ? `${work.fixing.length} ${work.fixing.length === 1 ? "repair" : "repairs"} in hand` : "Nothing to fix right now"}
              parts={parts}
              trailing={all.length >= SEARCH_FROM
                ? <BriefingButton icon={searching ? "close" : "search"} label={searching ? "Close search" : "Search repairs"} onPress={() => { setSearching((current) => !current); setQuery(""); }} />
                : undefined}
            />
            {searching ? <SearchField label="Search repairs" placeholder="Tenant, Property, Unit or problem" value={query} onChangeText={setQuery} /> : null}
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
          if (entry.kind === "more") {
            return (
              <ListRow first={false} last>
                <View style={styles.rule} />
                <MoreRow label={`Show ${entry.hidden} more`} onPress={() => setExpanded((current) => ({ ...current, [entry.lane]: true }))} />
              </ListRow>
            );
          }
          if (entry.kind === "fold") {
            return (
              <View style={styles.labelGap}>
                <Fold
                  title="Fixed"
                  icon="checkmark-done-outline"
                  summary="Confirmed by the tenant"
                  count={entry.count}
                  open={entry.open}
                  onToggle={() => setExpanded((current) => ({ ...current, done: !current.done }))}
                />
              </View>
            );
          }
          if (entry.kind === "calm") return <Calm text="Nothing waits to be started or fixed. New reports arrive here with the tenant's photo." />;
          return (
            <ListRow first={entry.first} last={entry.last}>
              {entry.first ? null : <View style={styles.rule} />}
              <RepairRow request={entry.request} onOpen={() => open(entry.request)} />
            </ListRow>
          );
        }}
        ListEmptyComponent={loading ? <RepairsSkeleton /> : nothingAtAll ? (
          <Empty
            icon="construct-outline"
            title="No repairs reported"
            hint="When a tenant reports a problem it arrives here with their photo, and you are notified."
          />
        ) : needle ? (
          <Empty icon="search-outline" title="No matching repairs" hint="Try another tenant, Property, Unit or problem." />
        ) : null}
      />
    </IndexGround>
  );
}

function entriesFor(work: RepairWork, all: MaintenanceRequest[], expanded: Record<RepairLane, boolean>, needle: string): Entry[] {
  const out: Entry[] = [];
  const rows = (list: MaintenanceRequest[], open = false) => list.forEach((request, index) => {
    out.push({ kind: "row", key: request.id, request, first: index === 0, last: !open && index === list.length - 1 });
  });
  if (needle) {
    const found = all
      .filter((request) => `${request.tenant.name} ${request.place.property_title} ${request.place.unit_label} ${request.place.bed_label ?? ""} ${request.category_display} ${request.description}`.toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at));
    rows(found);
    return out;
  }
  for (const lane of ["start", "fixing", "confirming"] as const) {
    const list = work[lane];
    if (!list.length) continue;
    out.push({ kind: "label", key: `label:${lane}`, title: LANE[lane].title, count: list.length, tone: lane === "start" ? LATERITE : undefined, first: out.length === 0 });
    const cut = !expanded[lane] && list.length > SHOWN[lane] + 1;
    const shown = cut ? list.slice(0, SHOWN[lane]) : list;
    rows(shown, cut);
    if (cut) out.push({ kind: "more", key: `more:${lane}`, lane, hidden: list.length - shown.length });
  }
  if (!work.start.length && !work.fixing.length && out.length) out.unshift({ kind: "calm", key: "calm" });
  if (work.done.length) {
    out.push({ kind: "fold", key: "fold", count: work.done.length, open: expanded.done });
    if (expanded.done) rows(work.done.slice(0, 24));
  }
  return out;
}

/**
 * One repair: its photo (or the problem's glyph), the problem and how long it
 * has waited, where and for whom, the four stops, and the provider's step.
 */
function RepairRow({ request, onOpen }: { request: MaintenanceRequest; onOpen: () => void }) {
  const lane = laneOf(request);
  const look = LANE[lane];
  const step = stepOf(request);
  const days = daysSince(request.status_changed_at);
  const where = [request.tenant.name, [request.place.property_title, request.place.unit_label, request.place.bed_label].filter(Boolean).join(" · ")].join(" — ");
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${request.category_display}. ${where}. ${lineOf(request)}. ${lane === "done" ? "" : `Waiting ${days} ${days === 1 ? "day" : "days"}. `}Open request.`}
      onPress={onOpen}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, styles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.thumb, { backgroundColor: look.wash }]}>
        {request.photo ? (
          <Image source={{ uri: request.photo.url }} style={styles.thumbImage} accessibilityIgnoresInvertColors />
        ) : (
          <Ionicons name={categoryIcon(request.category) as never} size={20} color={look.ink} />
        )}
        {request.video ? <View style={styles.thumbVideo}><Ionicons name="videocam" size={10} color="#fff" /></View> : null}
      </View>
      <View style={[rowStyles.rowBody, styles.body]}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{request.category_display}</Type>}
          end={lane === "done" ? undefined : <Age text={shortAge(days)} late={(lane === "start" || lane === "fixing") && days >= STALLED_DAYS} />}
        />
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{where}</Type>
        {request.description ? <Type variant="caption" numberOfLines={2} style={styles.quote}>{`“${request.description}”`}</Type> : null}
        <View style={styles.progress}>
          <Segments total={4} done={stopsDone(request)} tone={look.ink} current={lane !== "done"} />
          <Type variant="caption" numberOfLines={2} style={[styles.line, { color: lane === "done" ? MUTED : look.ink }]}>{lineOf(request)}</Type>
        </View>
        {step ? (
          <Acts>
            <Act label={step.label} icon={step.icon} primary onPress={onOpen} />
          </Acts>
        ) : null}
      </View>
    </Pressable>
  );
}

function RepairsSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading maintenance" style={styles.skeleton}>
      <Bone width="64%" height={22} />
      <Bone width="44%" height={12} />
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={52} height={52} round={14} />
            <View style={styles.skeletonLines}>
              <Bone width="46%" height={14} />
              <Bone width="70%" />
              <Bone height={4} />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: space[4], marginBottom: space[5] },
  label: { paddingBottom: space[2] },
  labelGap: { marginTop: space[5] },
  rule: { height: StyleSheet.hairlineWidth, marginLeft: 78, backgroundColor: RULE },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  row: { paddingVertical: 14 },
  body: { gap: 3 },
  thumb: { width: 52, height: 52, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  thumbImage: { width: "100%", height: "100%" },
  thumbVideo: { position: "absolute", right: 4, bottom: 4, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  quote: { fontSize: 12.5, lineHeight: 17, color: FAINT, fontStyle: "italic" },
  progress: { gap: 6, marginTop: 6 },
  line: { fontSize: 12.5, lineHeight: 17, fontWeight: "500" },
  skeleton: { gap: space[3] },
  skeletonRow: { flexDirection: "row", gap: space[3], padding: 14 },
  skeletonLines: { flex: 1, justifyContent: "center", gap: space[2] },
});
