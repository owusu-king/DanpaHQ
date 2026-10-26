import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  FAINT,
  GroupLabel,
  HARMATTAN,
  KOLA,
  KOLA_DEEP,
  LAGOON,
  ListRow,
  MUTED,
  PRESSED,
  RULE,
  RowLine,
  rowStyles,
} from "@/components/portfolio/PortfolioList";
import { ActionBar, Pill } from "@/components/record/RecordSurfaces";
import { Act, Acts, Briefing, Calm, Empty, Fold, Segments } from "@/components/work/WorkParts";
import { Notice, Type, space } from "@/components/ui";
import { categoryIcon, listMyMaintenance, type MaintenanceRequest } from "@/maintenance";
import { daysSince, stopsDone, tenantLaneOf, tenantLineOf, tenantRepairs, type TenantLane, type TenantRepairs } from "@/maintenanceWork";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { shortAge } from "@/requestQueue";
import { listMyTenancies, type Tenancy } from "@/tenancy";
import { theme } from "@/theme";

type Entry =
  | { kind: "label"; key: string; lane: TenantLane; count: number; first: boolean }
  | { kind: "row"; key: string; request: MaintenanceRequest; first: boolean; last: boolean }
  | { kind: "fold"; key: string; count: number; open: boolean }
  | { kind: "calm"; key: string };

/** Each lane in the colour of who holds it: the tenant in kola, the landlord in harmattan and lagoon. */
const LANE: Record<TenantLane, { title: string; ink: string; wash: string }> = {
  confirm: { title: "Confirm the fix", ink: KOLA_DEEP, wash: theme.color.kola["50"] },
  sent: { title: "Waiting for your landlord", ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  fixing: { title: "Being fixed", ink: LAGOON, wash: theme.color.lagoon["100"] },
  done: { title: "Fixed", ink: theme.color.ink["700"], wash: theme.color.field["100"] },
};

/**
 * A tenant's repairs, read as where each one has got to (owner, 2026-10-06).
 *
 * It was the provider's list said from the other side: a summary panel of
 * counts, a Filter sheet, and rows with a status chip. Now one line says what
 * is the tenant's to do — a fix to confirm — or that nothing is; then the lanes
 * in the order that matters to them: confirm the fix, waiting for the landlord,
 * being fixed. Each repair shows its photo, where, their own words, the four
 * stops it walks and how long it has waited. Fixed repairs fold into one line.
 * Reporting a new problem stays in the bar under the thumb.
 */
export function TenantMaintenanceScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const params = useLocalSearchParams<{ report?: string }>();
  const [requests, setRequests] = useState<MaintenanceRequest[] | null>(null);
  const [homes, setHomes] = useState<Tenancy[]>([]);
  const [foldOpen, setFoldOpen] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const canReport = homes.length > 0;
  const pageBottom = useSafeBottom(canReport ? space[6] : space[12]);

  const load = useCallback(async () => {
    try {
      const [rows, tenancies] = await Promise.all([listMyMaintenance(), listMyTenancies()]);
      setRequests(rows);
      setHomes(tenancies.filter((row) => row.status === "active"));
      setError("");
    } catch (cause) {
      setRequests((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load maintenance requests.");
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const all = useMemo(() => requests ?? [], [requests]);
  const work = useMemo(() => tenantRepairs(all), [all]);
  const entries = useMemo(() => entriesFor(work, foldOpen), [work, foldOpen]);
  const open = (request: MaintenanceRequest) => router.push({ pathname: "/(app)/maintenance-request", params: { id: request.id } } as never);
  const report = () =>
    router.push({ pathname: "/(app)/maintenance-report", params: params.report ? { tenancy: params.report } : {} } as never);

  const loading = requests === null;
  const nothingAtAll = !loading && !error && all.length === 0;
  const open_ = work.sent.length + work.fixing.length;
  const parts = [
    work.sent.length ? { text: `${work.sent.length} not started yet`, tone: HARMATTAN } : null,
    work.fixing.length ? { text: `${work.fixing.length} being fixed`, tone: LAGOON } : null,
    work.done.length ? { text: `${work.done.length} fixed`, tone: MUTED } : null,
  ].filter((part): part is NonNullable<typeof part> => part !== null);

  return (
    <IndexGround>
      <FlatList
        data={loading || nothingAtAll ? [] : entries}
        keyExtractor={(entry) => entry.key}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={loading || nothingAtAll ? (error ? <Notice tone="error" title={error} /> : null) : (
          <View style={styles.header}>
            {error ? <Notice tone="error" title={error} /> : null}
            <Briefing
              title={work.confirm.length
                ? `${work.confirm.length} ${work.confirm.length === 1 ? "fix waits" : "fixes wait"} for you to confirm`
                : open_ ? `${open_} ${open_ === 1 ? "repair is" : "repairs are"} with your landlord` : "Nothing needs fixing"}
              parts={parts}
            />
          </View>
        )}
        renderItem={({ item: entry }) => {
          if (entry.kind === "label") {
            return (
              <View style={[styles.label, entry.first ? null : styles.labelGap]}>
                <GroupLabel count={entry.count} tone={entry.lane === "confirm" ? KOLA_DEEP : undefined}>{LANE[entry.lane].title}</GroupLabel>
              </View>
            );
          }
          if (entry.kind === "fold") {
            return (
              <View style={styles.labelGap}>
                <Fold
                  title="Fixed"
                  icon="checkmark-done-outline"
                  summary="Repairs you confirmed"
                  count={entry.count}
                  open={entry.open}
                  onToggle={() => setFoldOpen((current) => !current)}
                />
              </View>
            );
          }
          if (entry.kind === "calm") return <Calm text="Nothing is waiting on your landlord. If something breaks, report it below with a photo." />;
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
            title="Nothing reported"
            hint={canReport
              ? "A leak, a fault, a broken lock — report it with a photo and your landlord is told at once."
              : "Once your tenancy is active you can report problems here."}
          />
        ) : null}
      />

      {canReport ? (
        <ActionBar>
          <Pill grow icon="add-circle-outline" label="Report a problem" onPress={report} />
        </ActionBar>
      ) : null}
    </IndexGround>
  );
}

function entriesFor(work: TenantRepairs, foldOpen: boolean): Entry[] {
  const out: Entry[] = [];
  const rows = (list: MaintenanceRequest[]) => list.forEach((request, index) => {
    out.push({ kind: "row", key: request.id, request, first: index === 0, last: index === list.length - 1 });
  });
  for (const lane of ["confirm", "sent", "fixing"] as const) {
    if (!work[lane].length) continue;
    out.push({ kind: "label", key: `label:${lane}`, lane, count: work[lane].length, first: out.length === 0 });
    rows(work[lane]);
  }
  if (!out.length && work.done.length) out.push({ kind: "calm", key: "calm" });
  if (work.done.length) {
    out.push({ kind: "fold", key: "fold", count: work.done.length, open: foldOpen });
    if (foldOpen) rows(work.done.slice(0, 24));
  }
  return out;
}

/**
 * One repair: its photo (or the problem's glyph), the problem and how long it
 * has waited, where, the tenant's own words, the four stops, and — when the
 * fix is theirs to confirm — the act that opens the record to confirm it.
 */
function RepairRow({ request, onOpen }: { request: MaintenanceRequest; onOpen: () => void }) {
  const lane = tenantLaneOf(request);
  const look = LANE[lane];
  const days = daysSince(request.status_changed_at);
  const where = [request.place.property_title, request.place.unit_label, request.place.bed_label].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${request.category_display}. ${where}. ${tenantLineOf(request)}. Open request.`}
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
          end={lane === "done" ? undefined : <Type variant="caption" style={styles.age}>{shortAge(days)}</Type>}
        />
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{where}</Type>
        {request.description ? <Type variant="caption" numberOfLines={2} style={styles.quote}>{`“${request.description}”`}</Type> : null}
        <View style={styles.progress}>
          <Segments total={4} done={stopsDone(request)} tone={look.ink} current={lane !== "done"} />
          <Type variant="caption" numberOfLines={2} style={[styles.line, { color: lane === "done" ? MUTED : look.ink }]}>{tenantLineOf(request)}</Type>
        </View>
        {lane === "confirm" && request.permissions?.confirm !== false ? (
          <Acts>
            <Act label="Check and confirm" icon="checkmark-circle-outline" primary onPress={onOpen} />
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
  age: { fontSize: 12, lineHeight: 16, color: MUTED },
  quote: { fontSize: 12.5, lineHeight: 17, color: FAINT, fontStyle: "italic" },
  progress: { gap: 6, marginTop: 6 },
  line: { fontSize: 12.5, lineHeight: 17, fontWeight: "500" },
  skeleton: { gap: space[3] },
  skeletonRow: { flexDirection: "row", gap: space[3], padding: 14 },
  skeletonLines: { flex: 1, justifyContent: "center", gap: space[2] },
});
