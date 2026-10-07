import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { agreedTerms, homeOf, money, months, per, standing, type AgreementStanding } from "@/agreementMeaning";
import { ApiFailure } from "@/api";
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
  LAGOON,
  LATERITE,
  MUTED,
  PRESSED,
  QuietAction,
  RULE,
  rowStyles,
} from "@/components/portfolio/PortfolioList";
import { Act, Acts, Bar, Calm, Empty, Fold, Segments } from "@/components/work/WorkParts";
import { Notice, Type, space } from "@/components/ui";
import { listMyLeases, type Lease } from "@/leases";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { TENANT_STEPS, laneOf, stepsDone, termOf, type TenantLane } from "@/tenantAgreementWork";
import { theme } from "@/theme";

type Row = { lease: Lease; state: AgreementStanding };

/** Deciding in laterite, finalising in lagoon, the home in kola, the past quiet. */
const LOOK: Record<TenantLane, { icon: keyof typeof Ionicons.glyphMap; ink: string; wash: string }> = {
  decide: { icon: "create-outline", ink: LATERITE, wash: theme.color.laterite["100"] },
  finalising: { icon: "hourglass-outline", ink: LAGOON, wash: theme.color.lagoon["100"] },
  home: { icon: "home-outline", ink: KOLA_DEEP, wash: theme.color.kola["50"] },
  past: { icon: "time-outline", ink: theme.color.ink["700"], wash: theme.color.field["100"] },
};

/**
 * The agreements this tenant holds, read as their home (owner, 2026-10-06).
 *
 * An agreement waiting for their decision leads, with what moving in costs and
 * the way to the review — accepting happens there, after the terms, never from
 * the list. Then the home in place, with how far through its term it is and
 * when it ends; any agreement between "accepted" and "in place", with the
 * steps it still has to walk; and the past, folded. The Filter sheet is gone.
 */
export function TenantAgreementsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const [items, setItems] = useState<Lease[] | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listMyLeases());
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load your agreements.");
      setItems([]);
    }
  }, []);

  // Deciding happens on the review screen, so the list has to be right when it
  // comes back into view.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const lanes = useMemo(() => {
    const rows: Row[] = (items ?? []).map((lease) => ({ lease, state: standing(lease) }));
    const of = (lane: TenantLane) => rows.filter((row) => laneOf(row.lease) === lane);
    return { decide: of("decide"), finalising: of("finalising"), home: of("home"), past: of("past") };
  }, [items]);
  const open = (lease: Lease) => router.push({ pathname: "/(app)/agreement/[id]", params: { id: lease.id } });

  return (
    <IndexGround>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: space[5] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
      >
        {error ? <Notice tone="error" title={error} /> : null}
        {items === null ? <AgreementsSkeleton /> : items.length === 0 ? (error ? null : (
          <Empty
            icon="document-text-outline"
            title="No agreements yet"
            hint="When a landlord sends one, it waits here for you. Nothing binds you until you accept."
            action={<QuietAction icon="compass-outline" label="Explore homes" onPress={() => router.push("/(app)/(tabs)/explore" as never)} />}
          />
        )) : (
          <>
            {lanes.decide.length ? (
              <Section title="Needs your decision" tone={LATERITE} rows={lanes.decide} lane="decide" onOpen={open} />
            ) : lanes.home.length || lanes.finalising.length ? (
              <Calm text="Nothing to decide. A new agreement from a landlord shows here first." />
            ) : null}
            {lanes.home.length ? <Section title={lanes.home.length === 1 ? "Your home" : "Your homes"} rows={lanes.home} lane="home" onOpen={open} /> : null}
            {lanes.finalising.length ? <Section title="Being finalised" rows={lanes.finalising} lane="finalising" onOpen={open} /> : null}
            {lanes.past.length ? (
              <View>
                <Fold title="Past" summary="Declined, withdrawn and ended" count={lanes.past.length} open={pastOpen} onToggle={() => setPastOpen((current) => !current)} />
                {pastOpen ? <View style={styles.foldBody}><Rows rows={lanes.past} lane="past" onOpen={open} /></View> : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </IndexGround>
  );
}

function Section({ title, tone, rows, lane, onOpen }: { title: string; tone?: string; rows: Row[]; lane: TenantLane; onOpen: (lease: Lease) => void }) {
  return (
    <View style={styles.section}>
      <GroupLabel count={rows.length} tone={tone}>{title}</GroupLabel>
      <Rows rows={rows} lane={lane} onOpen={onOpen} />
    </View>
  );
}

function Rows({ rows, lane, onOpen }: { rows: Row[]; lane: TenantLane; onOpen: (lease: Lease) => void }) {
  return (
    <Panel>
      {rows.map((row, index) => <AgreementRow key={row.lease.id} row={row} lane={lane} first={index === 0} onOpen={() => onOpen(row.lease)} />)}
    </Panel>
  );
}

/**
 * One agreement: which home and with whom, the rent and the term, then the one
 * thing its lane is about — what moving in costs and the way to the review; how
 * far through its term it is; or the steps it still has to walk.
 */
function AgreementRow({ row, lane, first, onOpen }: { row: Row; lane: TenantLane; first: boolean; onOpen: () => void }) {
  const terms = agreedTerms(row.lease);
  const look = LOOK[lane];
  const term = lane === "home" ? termOf(terms) : null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${homeOf(terms)}. With ${terms.landlordName}. ${money(terms.rentMinor, terms.rentCurrency)} per ${per(terms.rentPeriod)}. ${row.state.line}.`}
      onPress={onOpen}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, styles.row, first ? null : styles.ruled, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.well, { backgroundColor: look.wash }]}>
        <Ionicons name={look.icon} size={18} color={look.ink} />
      </View>
      <View style={[rowStyles.rowBody, styles.body]}>
        <Type variant="bodyStrong" numberOfLines={2} style={rowStyles.rowTitle}>{homeOf(terms)}</Type>
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>With {terms.landlordName}{row.lease.locality_name ? ` · ${row.lease.locality_name}` : ""}</Type>
        <Type variant="caption" numberOfLines={1} style={styles.money}>
          <Type variant="bodyStrong" style={rowStyles.rowAmount}>{money(terms.rentMinor, terms.rentCurrency)}</Type>
          {` / ${per(terms.rentPeriod)} · ${months(terms.termMonths)}`}
        </Type>

        {lane === "decide" ? (
          <>
            <Type variant="caption" style={styles.meta}>
              {`${money(terms.moveInTotalMinor, terms.rentCurrency)} to move in${terms.startsOn ? ` · starts ${shortDate(terms.startsOn)}` : ""}`}
            </Type>
            <Acts>
              <Act label="Review agreement" icon="document-text-outline" primary onPress={onOpen} />
            </Acts>
          </>
        ) : lane === "home" ? (
          <View style={styles.progress}>
            {term ? <Bar value={term.share} tone={term.daysLeft <= 60 ? HARMATTAN : KOLA} /> : null}
            <Type variant="captionStrong" style={[styles.line, { color: term && term.daysLeft <= 60 ? HARMATTAN : KOLA_DEEP }]}>
              {term
                ? `Month ${term.month} of ${term.months} · ends ${shortDate(terms.endsOn as string)}${term.daysLeft <= 60 ? ` · in ${term.daysLeft} days` : ""}`
                : row.state.line}
            </Type>
          </View>
        ) : lane === "finalising" ? (
          <View style={styles.progress}>
            <Segments total={TENANT_STEPS.length} done={stepsDone(row.lease)} tone={LAGOON} />
            <Type variant="captionStrong" style={[styles.line, { color: LAGOON }]}>{row.state.line}</Type>
          </View>
        ) : (
          <Type variant="captionStrong" style={[styles.line, { color: MUTED }]}>{row.state.line}</Type>
        )}
      </View>
    </Pressable>
  );
}

function AgreementsSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your agreements" style={styles.skeleton}>
      <Bone width="38%" height={11} />
      <Panel>
        {[0, 1].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={40} height={40} round={12} />
            <View style={styles.skeletonLines}>
              <Bone width="70%" height={14} />
              <Bone width="44%" />
              <Bone height={4} />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

function shortDate(value: string) {
  const at = new Date(`${value.slice(0, 10)}T12:00:00`);
  return at.toLocaleDateString("en-GH", { day: "numeric", month: "short", ...(at.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  foldBody: { marginTop: space[3] },
  row: { paddingVertical: 14 },
  body: { gap: 3 },
  well: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  money: { marginTop: 2, lineHeight: 22, color: FAINT },
  meta: { fontSize: 12.5, lineHeight: 17, color: INK },
  progress: { gap: 6, marginTop: 6 },
  line: { fontSize: 12.5, lineHeight: 17 },
  skeleton: { gap: space[3] },
  skeletonRow: { flexDirection: "row", gap: space[3], padding: 14 },
  skeletonLines: { flex: 1, justifyContent: "center", gap: space[2] },
});
