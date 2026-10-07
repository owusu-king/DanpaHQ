import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { type RentalApplication, listReceivedApplications } from "@/applications";
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
  KOLA_DEEP,
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
import { Notice, Type, space } from "@/components/ui";
import { type Lease, listGrantedLeases } from "@/leases";
import { getPortfolioSummary, listOrganizations, type PortfolioSummary } from "@/organizations";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { useBlankOnPortfolioSwitch } from "@/portfolioScope";
import {
  JOURNEY,
  STALLED_DAYS,
  createdAt,
  daysSince,
  evidenceFor,
  isNew,
  isYourMove,
  movedIn,
  nextStep,
  phaseOf,
  placeOf,
  queue,
  readyToDecide,
  searchText,
  shortAge,
  standingLine,
  viewingFor,
  waitingSince,
  whoOf,
  type Evidence,
  type Phase,
  type RequestItem,
} from "@/requestQueue";
import { secure } from "@/secure";
import { Act, Acts, Age, Briefing as BriefingLine, BriefingButton, Calm, Empty, Face, Fold, MoreRow } from "@/components/work/WorkParts";
import { theme } from "@/theme";
import { listReceivedViewings, type Viewing } from "@/viewings";

type Live = Exclude<Phase, "settled">;
type Entry =
  | { kind: "label"; key: string; title: string; count: number; tone?: string; first: boolean }
  | { kind: "row"; key: string; item: RequestItem; first: boolean; last: boolean }
  | { kind: "more"; key: string; section: "yours" | "theirs"; hidden: number }
  | { kind: "settled"; key: string; count: number; movedIn: number; open: boolean }
  | { kind: "calm"; key: string };

/** Each step of the journey in the colour of who holds it: you in laterite and
 *  harmattan, the tenant in lagoon, the last stretch in kola. */
const PHASE_TONE: Record<Live, { ink: string; wash: string }> = {
  decide: { ink: LATERITE, wash: theme.color.laterite["100"] },
  agreement: { ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  tenant: { ink: LAGOON, wash: theme.color.lagoon["100"] },
  moving: { ink: KOLA, wash: theme.color.kola["50"] },
};
const SETTLED_TONE = { ink: theme.color.ink["700"], wash: theme.color.field["100"] };
const EVIDENCE_INK: Record<Evidence["tone"], string> = {
  good: KOLA_DEEP,
  caution: HARMATTAN,
  info: LAGOON,
  quiet: FAINT,
};

/** How many of a section show before the rest are one tap away, so 500 requests read like 5. */
const SHOWN = { yours: 8, theirs: 4, settled: 6 } as const;
/** Search earns its place only once there is more than a glance can take in. */
const SEARCH_FROM = 9;

/**
 * Tenancy requests, as the work they are rather than the records they are
 * (owner, 2026-10-06).
 *
 * A property manager opens this to answer one question: what needs me? So the
 * page is a briefing, not an index. One sentence says how much waits on them and
 * for how long; the leasing journey shows where everything else has got to, and
 * is the only filter; then **Your move** — the oldest wait first, each row
 * carrying the facts the decision turns on and the step itself — and **Waiting
 * on others**, so nothing in flight is out of sight. What is settled folds into
 * one line.
 *
 * Gone: the summary panel of counts, the Filter sheet (stage × source), the
 * standing search box and the status-word rows. Where a request came from is
 * evidence on the row, not a way to slice the pile.
 */
export default function ProviderApplicationsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const list = useRef<FlatList<Entry>>(null);
  const { activeContext } = useAuth();
  const [summaries, setSummaries] = useState<PortfolioSummary[] | null>(null);
  const [applications, setApplications] = useState<RentalApplication[] | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [focus, setFocus] = useState<Live | null>(null);
  const [expanded, setExpanded] = useState<{ yours: boolean; theirs: boolean; settled: boolean }>({ yours: false, theirs: false, settled: false });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [seenBefore, setSeenBefore] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // The private tenancy requests come from the Portfolio summary, so they too
  // go when the Portfolio does — a request answered on this screen decides
  // somebody's tenancy, and it must be one this Portfolio actually received.
  useBlankOnPortfolioSwitch(activeContext, () => {
    setSummaries(null);
    setApplications(null);
    setLeases([]);
  });

  const load = useCallback(async () => {
    // One Portfolio: the one being operated.
    setApplications(null);
    try {
      const organizations = await listOrganizations();
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const organization = organizations.find((row) => row.id === preferred) ?? organizations[0];
      if (!organization) {
        setSummaries([]); setApplications([]); setLeases([]); setViewings([]); setError("");
        return;
      }
      const scope = { organization: organization.id };
      const [summary, nextApplications, nextLeases, nextViewings] = await Promise.all([
        getPortfolioSummary(organization.id),
        listReceivedApplications(false, scope),
        listGrantedLeases(scope),
        // Evidence, not the point: a failure here leaves the decisions intact.
        listReceivedViewings(false, scope).catch(() => [] as Viewing[]),
      ]);
      setSummaries([summary]); setApplications(nextApplications); setLeases(nextLeases); setViewings(nextViewings); setError("");
    } catch (cause) {
      setApplications([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load tenancy requests.");
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // "New since your last visit": read when the page opens, written when it is
  // left, so what arrived while it was open is not new next time either.
  const seenKey = `requests.seen.${(activeContext ?? "portfolio").replace(/[^A-Za-z0-9._-]/g, "_")}`;
  useFocusEffect(useCallback(() => {
    let live = true;
    void secure.get(seenKey).then((value) => { if (live) setSeenBefore(value); }).catch(() => undefined);
    return () => {
      live = false;
      void secure.set(seenKey, new Date().toISOString()).catch(() => undefined);
    };
  }, [seenKey]));

  const items = useMemo<RequestItem[]>(() => {
    const leaseByApplication = new Map(leases.filter((lease) => lease.application).map((lease) => [lease.application!, lease]));
    return [
      ...(applications ?? []).map((application) => ({
        key: `application:${application.id}`,
        kind: "application" as const,
        application,
        lease: leaseByApplication.get(application.id) ?? null,
        viewing: viewingFor(application, viewings),
      })),
      ...(summaries ?? []).flatMap((summary) => summary.tenancy_requests.map((request) => ({ key: `private:${request.id}`, kind: "private" as const, request, organizationId: summary.organization.id }))),
    ];
  }, [applications, leases, summaries, viewings]);

  const work = useMemo(() => queue(items), [items]);
  const needle = query.trim().toLocaleLowerCase("en-GH");
  const entries = useMemo(
    () => entriesFor(work, { focus, expanded, needle, items }),
    [work, focus, expanded, needle, items],
  );

  const openRecord = (item: RequestItem, decide?: "accept" | "decline") =>
    router.push({
      pathname: "/(app)/provider-application",
      params: {
        kind: item.kind,
        id: item.kind === "application" ? item.application.id : item.request.id,
        organizationId: item.kind === "private" ? item.organizationId : "",
        ...(decide ? { decide } : {}),
      },
    } as never);
  const openLease = (leaseId: string) => router.push({ pathname: "/(app)/provider-lease", params: { leaseId } } as never);
  const toggleFocus = (phase: Live) => {
    setFocus((current) => (current === phase ? null : phase));
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const loading = applications === null;
  const nothingAtAll = !loading && !error && items.length === 0;

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
              yours={work.yours}
              moving={work.theirs.length}
              seenBefore={seenBefore}
              canSearch={items.length >= SEARCH_FROM}
              searching={searching}
              onSearch={() => { setSearching((current) => !current); setQuery(""); }}
            />
            {searching ? (
              <SearchField label="Search requests" placeholder="Person, Property or Unit" value={query} onChangeText={setQuery} />
            ) : (
              <Journey counts={work.counts} focus={focus} onFocus={toggleFocus} />
            )}
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
                <MoreRow
                  label={`Show ${entry.hidden} more`}
                  onPress={() => setExpanded((current) => ({ ...current, [entry.section]: true }))}
                />
              </ListRow>
            );
          }
          if (entry.kind === "settled") {
            return (
              <View style={styles.labelGap}>
                <SettledFold
                  count={entry.count}
                  movedIn={entry.movedIn}
                  open={entry.open}
                  onToggle={() => setExpanded((current) => ({ ...current, settled: !current.settled }))}
                />
              </View>
            );
          }
          if (entry.kind === "calm") return <CaughtUp />;
          return (
            <ListRow first={entry.first} last={entry.last}>
              {entry.first ? null : <View style={styles.rule} />}
              <RequestRow
                item={entry.item}
                seenBefore={seenBefore}
                onOpen={() => {
                  const step = nextStep(entry.item);
                  // Past the decision, the agreement is the record that moves.
                  const leaseId = entry.item.kind === "application" ? entry.item.lease?.id : entry.item.request.lease_id;
                  if (!isYourMove(entry.item) && leaseId && phaseOf(entry.item) !== "settled") openLease(leaseId);
                  else if (step?.kind === "lease") openLease(step.leaseId);
                  else openRecord(entry.item);
                }}
                onDecide={(decide) => openRecord(entry.item, decide)}
                onStep={() => {
                  const step = nextStep(entry.item);
                  if (step?.kind === "lease") openLease(step.leaseId);
                  else openRecord(entry.item);
                }}
              />
            </ListRow>
          );
        }}
        ListEmptyComponent={loading ? <QueueSkeleton /> : nothingAtAll ? (
          <Empty
            icon="document-text-outline"
            title="No tenancy requests yet"
            hint="People who apply to a listing, or ask with a Unit's access code, appear here."
            action={<QuietAction icon="people-outline" label="Tenants" onPress={() => router.push("/(app)/(provider-tabs)/tenants" as never)} />}
          />
        ) : needle ? (
          <Empty icon="search-outline" title="No matching requests" hint="Try a different person, Property or Unit." />
        ) : null}
      />
    </IndexGround>
  );
}

/** The page as rows the list can virtualise: sections, their rows, their "more", and the settled fold. */
function entriesFor(
  work: ReturnType<typeof queue>,
  { focus, expanded, needle, items }: {
    focus: Live | null;
    expanded: { yours: boolean; theirs: boolean; settled: boolean };
    needle: string;
    items: RequestItem[];
  },
): Entry[] {
  const out: Entry[] = [];
  const section = (key: "yours" | "theirs", title: string, rows: RequestItem[], tone?: string) => {
    if (!rows.length) return;
    out.push({ kind: "label", key: `label:${key}`, title, count: rows.length, tone, first: out.length === 0 });
    const cut = !expanded[key] && rows.length > SHOWN[key] + 1;
    const shown = cut ? rows.slice(0, SHOWN[key]) : rows;
    shown.forEach((item, index) => out.push({ kind: "row", key: item.key, item, first: index === 0, last: !cut && index === shown.length - 1 }));
    if (cut) out.push({ kind: "more", key: `more:${key}`, section: key, hidden: rows.length - shown.length });
  };

  // Searching reads every request, settled included, newest first.
  if (needle) {
    const found = items
      .filter((item) => searchText(item).toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => createdAt(b).localeCompare(createdAt(a)));
    found.forEach((item, index) => out.push({ kind: "row", key: item.key, item, first: index === 0, last: index === found.length - 1 }));
    return out;
  }

  const inFocus = (item: RequestItem) => !focus || phaseOf(item) === focus;
  const yours = work.yours.filter(inFocus);
  const theirs = work.theirs.filter(inFocus);
  section("yours", "Your move", yours, LATERITE);
  section("theirs", "Waiting on others", theirs);
  if (!focus && !yours.length) out.unshift({ kind: "calm", key: "calm" });

  if (!focus && work.settled.length) {
    const moved = work.settled.filter(movedIn).length;
    out.push({ kind: "settled", key: "settled", count: work.settled.length, movedIn: moved, open: expanded.settled });
    if (expanded.settled) {
      const shown = work.settled.slice(0, SHOWN.settled * 4);
      shown.forEach((item, index) => out.push({ kind: "row", key: item.key, item, first: index === 0, last: index === shown.length - 1 }));
    }
  }
  return out;
}

/**
 * One sentence about the provider's own work: how much waits on them, how long
 * the oldest has waited, and what is new since they last looked.
 */
function Briefing({ yours, moving, seenBefore, canSearch, searching, onSearch }: {
  yours: RequestItem[];
  moving: number;
  seenBefore: string | null;
  canSearch: boolean;
  searching: boolean;
  onSearch: () => void;
}) {
  const oldest = yours[0] ? daysSince(waitingSince(yours[0])) : 0;
  const fresh = yours.filter((item) => isNew(item, seenBefore)).length;
  const title = yours.length
    ? `${yours.length} ${yours.length === 1 ? "request waits" : "requests wait"} on you`
    : "You're all caught up";
  const parts: { text: string; tone: string }[] = [];
  if (yours.length) {
    parts.push(oldest >= 1
      ? { text: `Oldest ${oldest} ${oldest === 1 ? "day" : "days"}`, tone: oldest >= STALLED_DAYS ? LATERITE : MUTED }
      : { text: "All arrived today", tone: MUTED });
    if (fresh) parts.push({ text: `${fresh} new since your last visit`, tone: KOLA_DEEP });
  } else if (moving) {
    parts.push({ text: `${moving} moving along without you`, tone: MUTED });
  }

  return (
    <BriefingLine
      title={title}
      parts={parts.map((part, index) => ({ ...part, strong: index === 0 && part.tone === LATERITE }))}
      trailing={canSearch ? <BriefingButton icon={searching ? "close" : "search"} label={searching ? "Close search" : "Search requests"} onPress={onSearch} /> : undefined}
    />
  );
}

/**
 * The leasing journey, four steps, each with how many requests stand on it.
 * The steps that wait on the provider are drawn in their colour; the steps that
 * wait on the tenant in theirs. Tapping a step shows only it; tapping it again
 * shows everything. It is the page's only filter.
 */
function Journey({ counts, focus, onFocus }: { counts: Record<Live, number>; focus: Live | null; onFocus: (phase: Live) => void }) {
  // On the narrowest phones the steps drop their arrows and take their short names.
  const narrow = useHomeDensity().veryCompact;
  return (
    <View style={[styles.journey, narrow ? styles.journeyNarrow : null]} accessibilityRole="tablist">
      {JOURNEY.map((step, index) => {
        const tone = PHASE_TONE[step.phase];
        const count = counts[step.phase];
        const selected = focus === step.phase;
        const dimmed = focus !== null && !selected;
        return (
          <Pressable
            key={step.phase}
            accessibilityRole="tab"
            aria-selected={selected}
            accessibilityLabel={`${step.label}: ${count}. ${step.owner === "you" ? "Waits on you" : "Waits on the tenant"}.${selected ? " Showing only these." : ""}`}
            onPress={() => onFocus(step.phase)}
            {...pressableFeedback(PRESSED)}
            style={({ pressed }) => [
              styles.step,
              narrow ? styles.stepNarrow : null,
              selected ? { backgroundColor: tone.wash, borderColor: tone.ink } : null,
              pressed && !selected ? { backgroundColor: PRESSED } : null,
              dimmed ? styles.dimmed : null,
            ]}
          >
            <View style={styles.stepTop}>
              <Type variant="title2" style={[styles.stepCount, { color: count ? tone.ink : FAINT }]}>{count}</Type>
              {index < JOURNEY.length - 1 && !narrow ? <Ionicons name="chevron-forward" size={12} color={RULE_STRONG} style={styles.stepArrow} /> : null}
            </View>
            <Type variant="caption" numberOfLines={1} style={[styles.stepLabel, narrow ? styles.stepLabelNarrow : null]}>{narrow ? step.short : step.label}</Type>
            <View style={[styles.stepBar, { backgroundColor: count ? tone.ink : RULE }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One request: who, and how long it has waited; the exact place; what the
 * decision turns on; and the next step itself — so a decision the evidence
 * already makes takes one tap to begin, and anything else opens the record.
 * Accept and Decline appear only where the evidence is in (`readyToDecide`):
 * five identical pairs down a list would be furniture, not guidance.
 */
function RequestRow({ item, seenBefore, onOpen, onDecide, onStep }: {
  item: RequestItem;
  seenBefore: string | null;
  onOpen: () => void;
  onDecide: (decide: "accept" | "decline") => void;
  onStep: () => void;
}) {
  const who = whoOf(item);
  const phase = phaseOf(item);
  const tone = phase === "settled" ? SETTLED_TONE : PHASE_TONE[phase];
  const yours = isYourMove(item);
  const days = daysSince(waitingSince(item));
  const stalled = yours && days >= STALLED_DAYS;
  const fresh = isNew(item, seenBefore);
  const evidence = evidenceFor(item, shortWhen);
  const step = nextStep(item);
  const standing = standingLine(item);
  const source = item.kind === "application" ? "Public listing" : "Direct request";

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${who}, ${placeOf(item)}. ${standing}. ${evidence.map((row) => row.text).join(", ")}${evidence.length ? ". " : ""}${source}, ${phase === "settled" ? `received ${shortWhen(createdAt(item))}` : `waiting ${days} ${days === 1 ? "day" : "days"}`}.`}
      onPress={onOpen}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, styles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Face name={who} ink={tone.ink} wash={tone.wash} fresh={fresh} />
      <View style={[rowStyles.rowBody, styles.body]}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{who}</Type>}
          end={phase === "settled"
            ? <Type variant="caption" style={rowStyles.rowMeta}>{shortWhen(createdAt(item))}</Type>
            : <Age text={shortAge(days)} late={stalled} />}
        />
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{placeOf(item)}</Type>

        {evidence.length ? (
          <View style={styles.evidence}>
            {evidence.map((row) => (
              <View key={row.text} style={styles.fact}>
                <Ionicons name={row.icon} size={12} color={EVIDENCE_INK[row.tone]} />
                <Type variant="caption" numberOfLines={1} style={[styles.factText, { color: EVIDENCE_INK[row.tone] }]}>{row.text}</Type>
              </View>
            ))}
          </View>
        ) : (
          <Type variant="caption" numberOfLines={1} style={[styles.standing, { color: phase === "settled" ? MUTED : tone.ink }]}>{standing}</Type>
        )}

        {step?.kind === "decide" ? (readyToDecide(item) ? (
          <Acts>
            <Act label="Accept" icon="checkmark" primary onPress={() => onDecide("accept")} />
            <Act label="Decline" onPress={() => onDecide("decline")} />
          </Acts>
        ) : null) : step ? (
          <Acts>
            <Act label={step.label} icon={step.label === "Send agreement" ? "send-outline" : step.label === "Confirm move-in" ? "checkmark-done-outline" : "document-text-outline"} primary onPress={onStep} />
          </Acts>
        ) : yours && phase === "decide" ? (
          <Type variant="caption" style={styles.standing}>{standing}</Type>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Nothing waits on the provider: say so plainly, and let the rest follow. */
function CaughtUp() {
  return <Calm text="No decisions or agreements wait on you. New applications will appear here first." />;
}

/** Settled requests, in one line until they are wanted. */
function SettledFold({ count, movedIn: moved, open, onToggle }: { count: number; movedIn: number; open: boolean; onToggle: () => void }) {
  return <Fold title="Settled" summary={`${moved} moved in · ${count - moved} closed`} count={count} open={open} onToggle={onToggle} />;
}

/** Shaped like the briefing, the journey and the first rows, so nothing jumps when they arrive. */
function QueueSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading tenancy requests" style={styles.skeleton}>
      <Bone width="62%" height={22} />
      <Bone width="40%" height={12} />
      <View style={styles.skeletonJourney}>
        {[0, 1, 2, 3].map((key) => <Bone key={key} width="23%" height={58} round={14} />)}
      </View>
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={36} height={36} round={18} />
            <View style={styles.skeletonLines}>
              <Bone width="44%" height={14} />
              <Bone width="72%" />
              <Bone width="58%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

/** "Fri 10 Oct" this year, "10 Oct 2025" otherwise; a time where the record has one ahead. */
function shortWhen(iso: string) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = date.toLocaleDateString("en-GH", sameYear ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  if (date.getTime() > Date.now() && iso.length > 10) {
    return `${day}, ${date.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })}`;
  }
  return day;
}

const RULE_STRONG = theme.color.field["300"];

const styles = StyleSheet.create({
  header: {
    gap: space[4],
    marginBottom: space[5],
  },
  journey: {
    flexDirection: "row",
    gap: 6,
  },
  step: {
    flex: 1,
    minWidth: 0,
    paddingTop: space[2],
    paddingBottom: space[2],
    paddingHorizontal: 10,
    borderRadius: 14,
    gap: 2,
    backgroundColor: theme.color.field["0"],
    borderWidth: 1,
    borderColor: "transparent",
  },
  journeyNarrow: {
    gap: 4,
  },
  stepNarrow: {
    paddingHorizontal: 6,
  },
  stepLabelNarrow: {
    fontSize: 10.5,
    letterSpacing: -0.1,
  },
  dimmed: {
    opacity: 0.55,
  },
  stepTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepCount: {
    fontSize: 20,
    lineHeight: 25,
    fontVariant: ["tabular-nums"],
  },
  stepArrow: {
    marginRight: -4,
  },
  stepLabel: {
    fontSize: 11.5,
    lineHeight: 15,
    color: MUTED,
  },
  stepBar: {
    height: 3,
    borderRadius: 2,
    marginTop: 6,
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
  row: {
    paddingVertical: 14,
  },
  body: {
    gap: 3,
  },
  evidence: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: space[3],
    rowGap: 2,
    marginTop: 2,
  },
  fact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
  },
  factText: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "500",
  },
  standing: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "500",
    color: MUTED,
    marginTop: 2,
  },
  skeleton: {
    gap: space[3],
  },
  skeletonJourney: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: space[3],
  },
  skeletonRow: {
    flexDirection: "row",
    gap: space[3],
    padding: 14,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  skeletonLines: {
    flex: 1,
    justifyContent: "center",
    gap: space[2],
  },
});
