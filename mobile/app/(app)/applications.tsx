import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  applicationBucket,
  applicationFilters,
  matchesApplicationFilter,
  placeOf,
  shortfallNote,
  standing,
  timeline,
  type ApplicationBucket,
  type ApplicationFilter,
  type ApplicationStanding,
  type TimelineStep,
} from "@/applicationMeaning";
import { listMyApplications, type RentalApplication } from "@/applications";
import { IndexGround } from "@/components/account/IndexRows";
import { StandingLine } from "@/components/applications/StandingLine";
import { Bone } from "@/components/billing/BillingParts";
import { Panel, ViewAll } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  ChoiceRow,
  EmptyState,
  FilterGroup,
  GroupLabel,
  HARMATTAN,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  ListHead,
  PRESSED,
  QuietAction,
  RULE,
  SheetFooter,
  Thumb,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, Type, space } from "@/components/ui";
import { listMyLeases, type Lease } from "@/leases";
import { timeAgo } from "@/notifications";
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

const FILTER_TITLE: Record<ApplicationFilter, string> = {
  all: "All applications",
  action: "Needs you",
  open: "In progress",
  approved: "Approved",
  past: "Past",
};
const FILTER_ICON: Record<ApplicationFilter, IconName> = {
  all: "documents-outline",
  action: "hand-right-outline",
  open: "hourglass-outline",
  approved: "checkmark-circle-outline",
  past: "time-outline",
};
const EMPTY: Record<ApplicationFilter, { title: string; hint: string }> = {
  all: { title: "No applications here", hint: "Your applications will appear here." },
  action: { title: "Nothing needs you", hint: "You are up to date on every application." },
  open: { title: "Nothing in progress", hint: "No application is waiting for a decision." },
  approved: { title: "No approvals yet", hint: "Approved applications stay easy to find here." },
  past: { title: "No past applications", hint: "Rejected and withdrawn applications appear here." },
};
/** How many past applications the whole list shows before the rest are one tap away. */
const PAST_SHOWN = 3;

/**
 * Places this person has applied for.
 *
 * Four questions in one glance: where did I apply, where does it stand, is
 * anything needed from me, and what happens next. The photograph answers the
 * first, and `standing()` collapses the other three into one line — so a row
 * never carries a status word *and* a sentence explaining that status word,
 * which is what the old cards did.
 *
 * What the tenant themselves wrote — the advance, the guarantor, the message —
 * is in the record behind the row. Nobody scanning five applications is
 * re-reading their own occupation.
 *
 * Refined on review (2026-09-15): glass groups instead of a tab strip, one green
 * Filter, a row that draws how far its journey has come, and the agreement one
 * tap away once it is ready. The past shows its latest few.
 */
export default function ApplicationsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const scroll = useRef<ScrollView>(null);
  const [items, setItems] = useState<RentalApplication[] | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ApplicationFilter>("all");
  const [filtering, setFiltering] = useState(false);

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
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not load your applications.",
      );
      setItems([]);
    }
  }, []);

  // Withdrawing happens on the record screen, so the list has to be right when
  // it comes back into view.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const rows = (items ?? []).map((application) => ({
    application,
    state: standing(application, leases),
    bucket: applicationBucket(application, leases),
  }));
  const sections: readonly {
    id: ApplicationBucket;
    label: string;
    rows: typeof rows;
  }[] = [
    { id: "action", label: FILTER_TITLE.action, rows: rows.filter((row) => row.bucket === "action") },
    { id: "open", label: FILTER_TITLE.open, rows: rows.filter((row) => row.bucket === "open") },
    { id: "approved", label: FILTER_TITLE.approved, rows: rows.filter((row) => row.bucket === "approved") },
    { id: "past", label: FILTER_TITLE.past, rows: rows.filter((row) => row.bucket === "past") },
  ];
  const visibleSections = sections
    .filter((section) => matchesApplicationFilter(section.id, filter))
    .filter((section) => section.rows.length > 0);
  const counts: Record<ApplicationFilter, number> = {
    all: rows.length,
    action: rows.filter((row) => row.bucket === "action").length,
    open: rows.filter((row) => row.bucket === "open").length,
    approved: rows.filter((row) => row.bucket === "approved").length,
    past: rows.filter((row) => row.bucket === "past").length,
  };

  const open = (application: RentalApplication) =>
    router.push({ pathname: "/(app)/application/[id]", params: { id: application.id } });
  const review = (leaseId: string) =>
    router.push({ pathname: "/(app)/agreement/[id]", params: { id: leaseId } });
  // A new filter starts at the top of what it shows.
  const choose = (next: ApplicationFilter) => {
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

        {items === null ? (
          <ApplicationSkeleton />
        ) : items.length === 0 ? (
          error ? null : (
            <EmptyState
              icon="document-text-outline"
              hero
              title="No applications yet"
              hint="Apply for a place, and where it stands shows here."
              action={<View style={styles.emptyAction}><QuietAction icon="compass-outline" label="Explore homes" onPress={() => router.push("/(app)/(tabs)/explore" as never)} /></View>}
            />
          )
        ) : (
          <>
            <ListHead title={FILTER_TITLE[filter]} count={counts[filter]} filters={filter === "all" ? 0 : 1} filterTone="kola" onFilter={() => setFiltering(true)} />

            {visibleSections.length ? (
              visibleSections.map((section) => {
                const cut = section.id === "past" && filter === "all" && section.rows.length > PAST_SHOWN;
                const shown = cut ? section.rows.slice(0, PAST_SHOWN) : section.rows;
                return (
                  <View key={section.id} style={styles.section}>
                    {filter === "all" ? (
                      <GroupLabel count={section.rows.length} tone={section.id === "action" ? KOLA_DEEP : undefined}>{section.label}</GroupLabel>
                    ) : null}
                    <Panel>
                      {shown.map((row, index) => (
                        <Row
                          key={row.application.id}
                          application={row.application}
                          state={row.state}
                          steps={timeline(row.application, leases)}
                          first={index === 0}
                          onPress={() => open(row.application)}
                          onAgreement={review}
                        />
                      ))}
                      {cut ? <ViewAll count={section.rows.length} noun="past applications" onPress={() => choose("past")} /> : null}
                    </Panel>
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
          {applicationFilters.map((option, index) => (
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
 * The shape of an application row, before the applications arrive.
 *
 * A caption reading "Loading…" told somebody something was happening and then
 * moved the page under them when it finished. This holds the space the list will
 * take: its heading, then rows of a photograph, lines, the journey and the
 * standing.
 */
function ApplicationSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading your applications" style={styles.skeleton}>
      <Bone width="42%" height={20} />
      <Panel>
        {[0, 1].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={64} height={64} round={12} />
            <View style={styles.skeletonLines}>
              <Bone width="72%" height={14} />
              <Bone width="48%" />
              <Bone width="30%" />
              <Bone height={4} round={2} />
              <Bone width="56%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

/**
 * Which place, where it is and what it costs, how far the application has come,
 * and where it stands. Once an agreement is waiting, the way to it sits under
 * the row as its own button, so the row still opens the application.
 */
function Row({
  application,
  state,
  steps,
  first,
  onPress,
  onAgreement,
}: {
  application: RentalApplication;
  state: ApplicationStanding;
  steps: TimelineStep[];
  first: boolean;
  onPress: () => void;
  onAgreement: (leaseId: string) => void;
}) {
  const short = shortfallNote(application);
  const agreement = state.stage === "action" ? state.leaseId : null;
  return (
    <View style={first ? null : styles.ruled}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${application.listing_headline}. ${placeOf(application)}. ${state.line}. Applied ${timeAgo(application.created_at)}.`}
        onPress={onPress}
        {...pressableFeedback(PRESSED)}
        style={({ pressed }) => [rowStyles.row, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
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
        </View>
      </Pressable>
      {agreement ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Review the agreement for ${application.listing_headline}`}
          onPress={() => onAgreement(agreement)}
          {...pressableFeedback(alpha(KOLA, 0.14))}
          style={({ pressed }) => [styles.agreement, pressed && !isAndroid ? { opacity: 0.85 } : null]}
        >
          <Ionicons name="document-text-outline" size={16} color={KOLA_DEEP} />
          <Type variant="captionStrong" style={styles.agreementText}>Review the agreement</Type>
          <Ionicons name="arrow-forward" size={15} color={KOLA_DEEP} />
        </Pressable>
      ) : null}
    </View>
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

const styles = StyleSheet.create({
  section: {
    gap: space[2],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  journey: {
    flexDirection: "row",
    gap: 3,
    marginTop: space[2],
    marginBottom: space[1],
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  short: {
    marginTop: 2,
    fontSize: 12.5,
    lineHeight: 17,
    color: theme.color.harmattan["600"],
  },
  agreement: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
    backgroundColor: theme.color.kola["50"],
  },
  agreementText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: KOLA_DEEP,
  },
  emptyAction: {
    marginTop: space[2],
  },
  skeleton: {
    gap: space[4],
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
