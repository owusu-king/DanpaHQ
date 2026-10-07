import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import {
  ENDING_DAYS,
  SIGNING_STEPS,
  agreementWork,
  daysUntilEnd,
  nextAct,
  signingLine,
  stepsDone,
  termProgress,
  type AgreementWork,
} from "@/agreementWork";
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
  QuietAction,
  RULE,
  RowLine,
  SearchField,
  rowStyles,
} from "@/components/portfolio/PortfolioList";
import { Act, Acts, Bar, Briefing, BriefingButton, Calm, Empty, Face, Fold, MoreRow, Segments } from "@/components/work/WorkParts";
import { Notice, Type, space } from "@/components/ui";
import { listGrantedLeases, type Lease } from "@/leases";
import { formatMinor } from "@/listings";
import { pressableFeedback, useSafeBottom } from "@/platform";
import {
  formatLeaseDate,
  leaseSearchText,
  providerLeasePeriod,
  providerLeasePlace,
  providerLeaseRent,
  providerLeaseTenant,
} from "@/providerLeaseMeaning";
import { theme } from "@/theme";

type Section = "yours" | "signing" | "ending" | "running";
type Entry =
  | { kind: "label"; key: string; title: string; count: number; tone?: string; first: boolean }
  | { kind: "row"; key: string; lease: Lease; section: Section | "closed"; first: boolean; last: boolean }
  | { kind: "more"; key: string; section: Section; hidden: number }
  | { kind: "fold"; key: string; count: number; ended: number; open: boolean }
  | { kind: "calm"; key: string };

/** Each lane in the colour of who holds it: the provider in laterite, the tenant in lagoon,
 *  a term running out in harmattan, a running tenancy in kola. */
const LANE = {
  yours: { title: "Your move", ink: LATERITE, wash: theme.color.laterite["100"] },
  signing: { title: "Being signed", ink: LAGOON, wash: theme.color.lagoon["100"] },
  ending: { title: "Ending soon", ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  running: { title: "Running", ink: KOLA, wash: theme.color.kola["50"] },
} as const;
const CLOSED = { ink: theme.color.ink["700"], wash: theme.color.field["100"] };
/** How many of a lane show before the rest are one tap away. Running grows with the Portfolio. */
const SHOWN: Record<Section, number> = { yours: 8, signing: 6, ending: 6, running: 5 };
const SEARCH_FROM = 9;

/**
 * The agreements a Portfolio granted, read as work (owner, 2026-10-06).
 *
 * The figure that matters leads: what the running agreements bring in each
 * month. Then what waits on the provider — drafts to send, tenants who accepted
 * and wait to be confirmed — with the step on the row; the agreements being
 * signed, each with its four steps drawn; the tenancies whose term is running
 * out, so a renewal is a plan and not a surprise; and everything running, each
 * with how far through its term it is. What closed folds into one line.
 *
 * Gone: the summary panel of counts, the Filter sheet and the standing search.
 */
export function ProviderAgreementsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const list = useRef<FlatList<Entry>>(null);
  // An agreement belongs to the Portfolio whose Property granted it.
  const { activeContext } = useAuth();
  const preferred = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";
  const [items, setItems] = useState<Lease[] | null>(null);
  const [expanded, setExpanded] = useState<Record<Section | "closed", boolean>>({ yours: false, signing: false, ending: false, running: false, closed: false });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    try { setItems(await listGrantedLeases(preferred ? { organization: preferred } : undefined)); setError(""); }
    catch (cause) { setItems([]); setError(cause instanceof ApiFailure ? cause.error.message : "We could not load these agreements."); }
  }, [preferred]);
  // Sending and confirming happen on the agreement, so the page is right when it comes back.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const all = useMemo(() => items ?? [], [items]);
  const work = useMemo(() => agreementWork(all), [all]);
  const needle = query.trim().toLocaleLowerCase("en-GH");
  const entries = useMemo(() => entriesFor(work, all, expanded, needle), [work, all, expanded, needle]);
  const open = (lease: Lease) => router.push({ pathname: "/(app)/provider-lease", params: { leaseId: lease.id } } as never);

  const loading = items === null;
  const nothingAtAll = !loading && !error && all.length === 0;
  const running = work.ending.length + work.running.length;
  const parts = [
    work.yours.length ? { text: `${work.yours.length} ${work.yours.length === 1 ? "needs" : "need"} you`, tone: LATERITE, strong: true } : null,
    work.signing.length ? { text: `${work.signing.length} being signed`, tone: LAGOON } : null,
    work.ending.length ? { text: `${work.ending.length} ending within ${ENDING_DAYS} days`, tone: HARMATTAN } : null,
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
            <Briefing
              figure={work.rentRoll ? formatMinor(work.rentRoll.minor, work.rentRoll.currency).replace(/\.00$/, "") : undefined}
              title={work.rentRoll
                ? `a month from ${running} running ${running === 1 ? "agreement" : "agreements"}`
                : work.yours.length ? `${work.yours.length} ${work.yours.length === 1 ? "agreement needs" : "agreements need"} you` : "No tenancy is running yet"}
              parts={parts}
              trailing={all.length >= SEARCH_FROM
                ? <BriefingButton icon={searching ? "close" : "search"} label={searching ? "Close search" : "Search agreements"} onPress={() => { setSearching((current) => !current); setQuery(""); }} />
                : undefined}
            />
            {searching ? <SearchField label="Search agreements" placeholder="Tenant, Property or Unit" value={query} onChangeText={setQuery} /> : null}
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
                <MoreRow label={`Show ${entry.hidden} more`} onPress={() => setExpanded((current) => ({ ...current, [entry.section]: true }))} />
              </ListRow>
            );
          }
          if (entry.kind === "fold") {
            return (
              <View style={styles.labelGap}>
                <Fold
                  title="Closed"
                  summary={`${entry.ended} ended · ${entry.count - entry.ended} declined or withdrawn`}
                  count={entry.count}
                  open={entry.open}
                  onToggle={() => setExpanded((current) => ({ ...current, closed: !current.closed }))}
                />
              </View>
            );
          }
          if (entry.kind === "calm") return <Calm text="Nothing to send or confirm. Drafts and accepted agreements will wait here for you." />;
          return (
            <ListRow first={entry.first} last={entry.last}>
              {entry.first ? null : <View style={styles.rule} />}
              <AgreementRow lease={entry.lease} section={entry.section} onOpen={() => open(entry.lease)} />
            </ListRow>
          );
        }}
        ListEmptyComponent={loading ? <AgreementsSkeleton /> : nothingAtAll ? (
          <Empty
            icon="document-text-outline"
            title="No agreements yet"
            hint="Prepare one from an accepted tenancy request. It waits here until you send it."
            action={<QuietAction icon="mail-open-outline" label="Open tenancy requests" onPress={() => router.push("/(app)/provider-applications" as never)} />}
          />
        ) : needle ? (
          <Empty icon="search-outline" title="No matching agreements" hint="Try a different tenant, Property or Unit." />
        ) : null}
      />
    </IndexGround>
  );
}

function entriesFor(work: AgreementWork, all: Lease[], expanded: Record<Section | "closed", boolean>, needle: string): Entry[] {
  const out: Entry[] = [];
  if (needle) {
    const found = all
      .filter((lease) => leaseSearchText(lease).toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    found.forEach((lease, index) => out.push({ kind: "row", key: lease.id, lease, section: sectionOf(work, lease), first: index === 0, last: index === found.length - 1 }));
    return out;
  }
  for (const section of ["yours", "signing", "ending", "running"] as const) {
    const rows = work[section];
    if (!rows.length) continue;
    out.push({ kind: "label", key: `label:${section}`, title: LANE[section].title, count: rows.length, tone: section === "yours" ? LATERITE : undefined, first: out.length === 0 });
    const cut = !expanded[section] && rows.length > SHOWN[section] + 1;
    const shown = cut ? rows.slice(0, SHOWN[section]) : rows;
    shown.forEach((lease, index) => out.push({ kind: "row", key: lease.id, lease, section, first: index === 0, last: !cut && index === shown.length - 1 }));
    if (cut) out.push({ kind: "more", key: `more:${section}`, section, hidden: rows.length - shown.length });
  }
  if (!work.yours.length && out.length) out.unshift({ kind: "calm", key: "calm" });
  if (work.closed.length) {
    out.push({ kind: "fold", key: "fold", count: work.closed.length, ended: work.closed.filter((lease) => lease.status === "ended").length, open: expanded.closed });
    if (expanded.closed) {
      const shown = work.closed.slice(0, 24);
      shown.forEach((lease, index) => out.push({ kind: "row", key: lease.id, lease, section: "closed", first: index === 0, last: index === shown.length - 1 }));
    }
  }
  return out;
}

function sectionOf(work: AgreementWork, lease: Lease): Section | "closed" {
  for (const section of ["yours", "signing", "ending", "running"] as const) {
    if (work[section].includes(lease)) return section;
  }
  return "closed";
}

/**
 * One agreement: who and for how much; the exact space; then the one thing its
 * lane is about — the steps of signing, or how far through its term it is — and,
 * where the next step is the provider's, the step itself.
 */
function AgreementRow({ lease, section, onOpen }: { lease: Lease; section: Section | "closed"; onOpen: () => void }) {
  const tenant = providerLeaseTenant(lease);
  const rent = providerLeaseRent(lease);
  const period = providerLeasePeriod(lease);
  const look = section === "closed" ? CLOSED : LANE[section];
  const act = nextAct(lease);
  const progress = termProgress(lease);
  const left = daysUntilEnd(lease);
  const line = section === "ending"
    ? `Ends ${formatLeaseDate(lease.agreement?.terms.term.ends_on ?? lease.ends_on)} · ${left !== null && left <= 1 ? "tomorrow" : `in ${left} days`}`
    : section === "running"
      ? progress ? `Month ${progress.month} of ${progress.months} · ends ${formatLeaseDate(lease.agreement?.terms.term.ends_on ?? lease.ends_on)}` : "Running · no end date"
      : signingLine(lease);
  const starts = lease.agreement?.terms.term.starts_on ?? lease.starts_on;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${tenant}. ${providerLeasePlace(lease).join(", ")}. ${rent ? `${rent} per ${period}` : "Rent not recorded"}. ${line}. Open agreement.`}
      onPress={onOpen}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, styles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Face name={tenant} ink={look.ink} wash={look.wash} />
      <View style={[rowStyles.rowBody, styles.body]}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={2} style={rowStyles.rowTitle}>{tenant}</Type>}
          end={rent ? <Type variant="bodyStrong" numberOfLines={1} style={styles.rent}>{rent}<Type variant="caption" style={styles.per}>{` /${period === "year" ? "yr" : "mo"}`}</Type></Type> : undefined}
        />
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{providerLeasePlace(lease).join(" · ")}</Type>

        {section === "yours" || section === "signing" ? (
          <View style={styles.progress}>
            <Segments total={SIGNING_STEPS.length} done={stepsDone(lease)} tone={look.ink} />
            <View style={styles.progressLine}>
              <Type variant="caption" numberOfLines={2} style={[styles.line, { color: look.ink }]}>{line}</Type>
              {starts && section === "signing" ? <Type variant="caption" style={styles.meta}>{`Tenancy starts ${shortDate(starts)}`}</Type> : null}
            </View>
          </View>
        ) : section === "ending" || section === "running" ? (
          <View style={styles.progress}>
            <Bar value={progress?.share ?? 1} tone={look.ink} />
            <Type variant="caption" numberOfLines={1} style={[styles.line, { color: section === "ending" ? HARMATTAN : MUTED }]}>{line}</Type>
          </View>
        ) : (
          <Type variant="caption" numberOfLines={1} style={[styles.line, { color: MUTED }]}>{line}</Type>
        )}

        {act ? (
          <Acts>
            <Act label={act.label} icon={act.icon} primary onPress={onOpen} />
          </Acts>
        ) : null}
      </View>
    </Pressable>
  );
}

/** "9 Oct": the year only when it is not this one. */
function shortDate(value: string) {
  const at = new Date(`${value.slice(0, 10)}T12:00:00`);
  return at.toLocaleDateString("en-GH", at.getFullYear() === new Date().getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

function AgreementsSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading agreements" style={styles.skeleton}>
      <Bone width="48%" height={34} />
      <Bone width="62%" height={14} />
      <Bone width="40%" height={12} />
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={38} height={38} round={19} />
            <View style={styles.skeletonLines}>
              <Bone width="50%" height={14} />
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
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 64,
    backgroundColor: RULE,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  row: {
    paddingVertical: 14,
  },
  body: {
    gap: 3,
  },
  rent: {
    fontSize: 14.5,
    lineHeight: 20,
    color: theme.color.ink["900"],
    fontVariant: ["tabular-nums"],
  },
  per: {
    fontSize: 12,
    color: FAINT,
  },
  progress: {
    gap: 6,
    marginTop: 6,
  },
  progressLine: {
    gap: 1,
  },
  line: {
    flexShrink: 1,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "500",
  },
  meta: {
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
  },
  skeleton: {
    gap: space[3],
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

