import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  applicationBucket,
  placeOf,
  shortfallNote,
  standing,
  timeline,
  type ApplicationBucket,
  type ApplicationStanding,
  type TimelineStep,
} from "@/applicationMeaning";
import { listMyApplications, type RentalApplication } from "@/applications";
import { IndexGround } from "@/components/account/IndexRows";
import { StandingLine } from "@/components/applications/StandingLine";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  GroupLabel,
  HARMATTAN,
  INK,
  KOLA,
  LATERITE,
  PRESSED,
  QuietAction,
  RULE,
  Thumb,
  rowStyles,
} from "@/components/portfolio/PortfolioList";
import { Act, Acts, Briefing, Calm, Empty, Fold } from "@/components/work/WorkParts";
import { Notice, Type, space } from "@/components/ui";
import { listMyLeases, type Lease } from "@/leases";
import { timeAgo } from "@/notifications";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

type Row = { application: RentalApplication; state: ApplicationStanding; bucket: ApplicationBucket };

/**
 * Places this person has applied for, read as where each stands (owner,
 * 2026-10-06).
 *
 * An agreement ready for them leads, with the way to review it on the row.
 * Then what is still being considered, each with how far its journey has come
 * and — while it still predicts something — how far the advance offered falls
 * short; then what was approved; and the past, folded. One sentence says how
 * many are moving. `standing()` and `timeline()` are shared with web; this
 * screen only arranges them. The Filter sheet is gone.
 */
export default function ApplicationsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const [items, setItems] = useState<RentalApplication[] | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [pastOpen, setPastOpen] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      // Acceptance is not the end of the story and the story lives in the
      // lease, so the agreements the tenant can already read are joined in.
      const [applications, myLeases] = await Promise.all([
        listMyApplications(),
        listMyLeases().catch(() => [] as Lease[]),
      ]);
      setItems(applications);
      setLeases(myLeases);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load your applications.");
      setItems([]);
    }
  }, []);

  // Withdrawing happens on the record screen, so the list has to be right when
  // it comes back into view.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const lanes = useMemo(() => {
    const rows: Row[] = (items ?? []).map((application) => ({
      application,
      state: standing(application, leases),
      bucket: applicationBucket(application, leases),
    }));
    const newest = (a: Row, b: Row) => b.application.created_at.localeCompare(a.application.created_at);
    const of = (bucket: ApplicationBucket) => rows.filter((row) => row.bucket === bucket).sort(newest);
    return { action: of("action"), open: of("open"), approved: of("approved"), past: of("past") };
  }, [items, leases]);

  const open = (application: RentalApplication) => router.push({ pathname: "/(app)/application/[id]", params: { id: application.id } });
  const review = (leaseId: string) => router.push({ pathname: "/(app)/agreement/[id]", params: { id: leaseId } });
  const moving = lanes.open.length + lanes.approved.length;
  const short = lanes.open.filter((row) => shortfallNote(row.application)).length;

  return (
    <IndexGround>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: space[5] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
      >
        {error ? <Notice tone="error" title={error} /> : null}

        {items === null ? (
          <ApplicationSkeleton />
        ) : items.length === 0 ? (
          error ? null : (
            <Empty
              icon="document-text-outline"
              title="No applications yet"
              hint="Apply for a place, and where it stands shows here."
              action={<QuietAction icon="compass-outline" label="Explore homes" onPress={() => router.push("/(app)/(tabs)/explore" as never)} />}
            />
          )
        ) : (
          <>
            <Briefing
              title={lanes.action.length
                ? `${lanes.action.length} ${lanes.action.length === 1 ? "agreement is" : "agreements are"} ready for you`
                : moving ? `${moving} ${moving === 1 ? "application" : "applications"} moving` : "Nothing in progress"}
              parts={[
                lanes.open.length ? { text: `${lanes.open.length} being considered`, tone: HARMATTAN } : null,
                lanes.approved.length ? { text: `${lanes.approved.length} approved`, tone: KOLA } : null,
                short ? { text: `${short} below the advance asked`, tone: LATERITE } : null,
              ].filter((part): part is NonNullable<typeof part> => part !== null)}
            />

            {lanes.action.length ? (
              <Section title="Ready for you" tone={LATERITE} rows={lanes.action} leases={leases} onOpen={open} onAgreement={review} />
            ) : moving ? <Calm text="Nothing needs you. When an agreement is ready, it shows here first." /> : null}
            {lanes.open.length ? <Section title="Being considered" rows={lanes.open} leases={leases} onOpen={open} onAgreement={review} /> : null}
            {lanes.approved.length ? <Section title="Approved" rows={lanes.approved} leases={leases} onOpen={open} onAgreement={review} /> : null}
            {lanes.past.length ? (
              <View>
                <Fold title="Past" summary="Not accepted, withdrawn or ended" count={lanes.past.length} open={pastOpen} onToggle={() => setPastOpen((current) => !current)} />
                {pastOpen ? (
                  <View style={styles.foldBody}>
                    <Panel>
                      {lanes.past.map((row, index) => (
                        <ApplicationRow key={row.application.id} row={row} steps={timeline(row.application, leases)} first={index === 0} onPress={() => open(row.application)} onAgreement={review} />
                      ))}
                    </Panel>
                  </View>
                ) : null}
              </View>
            ) : null}
            {!lanes.action.length && !moving ? (
              <View style={styles.explore}><QuietAction icon="compass-outline" label="Explore homes" onPress={() => router.push("/(app)/(tabs)/explore" as never)} /></View>
            ) : null}
          </>
        )}
      </ScrollView>
    </IndexGround>
  );
}

function Section({ title, tone, rows, leases, onOpen, onAgreement }: {
  title: string;
  tone?: string;
  rows: Row[];
  leases: Lease[];
  onOpen: (application: RentalApplication) => void;
  onAgreement: (leaseId: string) => void;
}) {
  return (
    <View style={styles.section}>
      <GroupLabel count={rows.length} tone={tone}>{title}</GroupLabel>
      <Panel>
        {rows.map((row, index) => (
          <ApplicationRow key={row.application.id} row={row} steps={timeline(row.application, leases)} first={index === 0} onPress={() => onOpen(row.application)} onAgreement={onAgreement} />
        ))}
      </Panel>
    </View>
  );
}

/**
 * Which place, where it is and what it costs, how far the application has come,
 * and where it stands. Once an agreement is waiting, the way to it is the row's
 * step; the row itself still opens the application.
 */
function ApplicationRow({ row, steps, first, onPress, onAgreement }: {
  row: Row;
  steps: TimelineStep[];
  first: boolean;
  onPress: () => void;
  onAgreement: (leaseId: string) => void;
}) {
  const { application, state } = row;
  const short = shortfallNote(application);
  const agreement = state.stage === "action" ? state.leaseId : null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${application.listing_headline}. ${placeOf(application)}. ${state.line}. Applied ${timeAgo(application.created_at)}.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, first ? null : styles.ruled, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Thumb uri={application.photo_url} size={64} />
      <View style={rowStyles.rowBody}>
        <Type variant="bodyStrong" numberOfLines={2} style={rowStyles.rowTitle}>{application.listing_headline}</Type>
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{placeOf(application)}</Type>
        {application.rent_formatted ? (
          <Type variant="caption" numberOfLines={1} style={rowStyles.rowMeta}>
            <Type variant="bodyStrong" style={rowStyles.rowAmount}>{application.rent_formatted}</Type>
            {" / month"}
          </Type>
        ) : null}
        <Journey steps={steps} stage={state.stage} />
        <StandingLine standing={state} trailing={timeAgo(application.created_at)} />
        {short ? <Type variant="caption" style={styles.short}>{short}</Type> : null}
        {agreement ? (
          <Acts>
            <Act label="Review the agreement" icon="document-text-outline" primary onPress={() => onAgreement(agreement)} />
          </Acts>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The journey as a row can hold it: one short segment per step of `timeline()`,
 * filled as far as it has come, in the standing dot's colour while it moves and
 * laterite where it stopped. The standing line under it says the same in words,
 * so the bar is hidden from a screen reader rather than said twice.
 */
function Journey({ steps, stage }: { steps: TimelineStep[]; stage: ApplicationStanding["stage"] }) {
  const tone: Record<TimelineStep["state"], string> = {
    done: KOLA,
    current: stage === "action" ? KOLA : HARMATTAN,
    waiting: alpha(INK, 0.1),
    stopped: LATERITE,
  };
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.journey}>
      {steps.map((step) => (
        <View key={step.id} style={[styles.segment, { backgroundColor: tone[step.state] }]} />
      ))}
    </View>
  );
}

/** The shape of the briefing and an application row, before the applications arrive. */
function ApplicationSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading your applications" style={styles.skeleton}>
      <Bone width="64%" height={22} />
      <Bone width="40%" height={12} />
      <Panel>
        {[0, 1].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={64} height={64} round={12} />
            <View style={styles.skeletonLines}>
              <Bone width="72%" height={14} />
              <Bone width="48%" />
              <Bone height={4} round={2} />
              <Bone width="56%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  foldBody: { marginTop: space[3] },
  explore: { alignItems: "flex-start" },
  journey: { flexDirection: "row", gap: 3, marginTop: space[2], marginBottom: space[1] },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  short: { marginTop: 2, fontSize: 12.5, lineHeight: 17, color: theme.color.harmattan["600"] },
  skeleton: { gap: space[3] },
  skeletonRow: { flexDirection: "row", gap: space[3], padding: 14 },
  skeletonLines: { flex: 1, justifyContent: "center", gap: space[2] },
});

