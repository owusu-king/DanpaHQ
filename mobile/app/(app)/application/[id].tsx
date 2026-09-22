import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Dimensions, Image, Pressable, StyleSheet, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { placeOf, standing, timeline } from "@/applicationMeaning";
import { getApplication, withdrawApplication, type RentalApplication } from "@/applications";
import { ApplicationTimeline } from "@/components/applications/ApplicationTimeline";
import { StandingLine } from "@/components/applications/StandingLine";
import { Bone } from "@/components/billing/BillingParts";
import {
  ActionBar,
  Fact,
  GroupLabel,
  KOLA_DEEP,
  LinkRow,
  MUTED,
  Pill,
  Quote,
  QuietAct,
  RecordPanel,
} from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import { listMyLeases, type Lease } from "@/leases";
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { theme } from "@/theme";

/**
 * One application, in full.
 *
 * The list answers where it stands. This answers what was actually sent, what
 * came back, and the one irreversible thing that can still be done about it.
 *
 * What the tenant wrote about themselves sits behind a disclosure: they know
 * what they said, and it is here to be checked rather than read. Withdrawing
 * asks first — it cannot be undone and it releases the Unit to somebody else.
 *
 * Refined on review (2026-09-21) onto the record surfaces. The photograph still
 * opens it, because recognising the place is the first thing anybody does; the
 * standing and the journey then sit on paper rather than between two hairlines,
 * and the two consequential acts keep the bar under the thumb.
 */
export default function ApplicationRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [application, setApplication] = useState<RentalApplication | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [told, setTold] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const width = useRef(Dimensions.get("window").width).current;
  // Without a bar the page itself must clear Android's navigation buttons.
  const openBottom = useSafeBottom(space[8]);

  useEffect(() => {
    void Promise.all([getApplication(id), listMyLeases().catch(() => [] as Lease[])])
      .then(([record, myLeases]) => {
        setApplication(record);
        setLeases(myLeases);
      })
      .catch((cause) =>
        setLoadError(
          cause instanceof ApiFailure ? cause.error.message : "We could not open that application.",
        ),
      );
  }, [id]);

  if (loadError) {
    return <View style={{ padding: space[5] }}><Notice tone="error" title={loadError} /></View>;
  }
  if (!application) return <RecordSkeleton />;

  const state = standing(application, leases);
  const open = ["submitted", "under_review"].includes(application.status);
  const asked = application.advance_months_asked;
  const offered = application.advance_months_offered;
  // Orientation, not exploration: enough photograph to recognize the place
  // without pushing the facts off the screen.
  const heroHeight = Math.min(Math.round(width * 0.42), 180);
  const barShown = state.stage === "action" || open;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: barShown ? space[6] : openBottom }]}>
        <View style={[styles.hero, { height: heroHeight }]}>
          {application.photo_url ? (
            <Image source={{ uri: application.photo_url }} accessible={false} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <Ionicons name="image-outline" size={28} color={theme.color.ink["300"]} />
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.identity}>
            <Type variant="title2" accessibilityRole="header" numberOfLines={2} style={styles.headline}>
              {application.listing_headline}
            </Type>
            <Type variant="caption" numberOfLines={2} style={styles.place}>{placeOf(application)}</Type>
          </View>

          <RecordPanel style={styles.standingPanel}>
            <StandingLine standing={state} />
            <Type variant="caption" style={styles.dates}>
              Applied {onDate(application.created_at)}
              {application.decided_at ? ` · answered ${onDate(application.decided_at)}` : ""}
            </Type>
          </RecordPanel>

          {/* Where it stands is one line above. This is how it got there and
              what is still to come — the difference between a status word and
              knowing where you are. */}
          <View style={styles.section}>
            <GroupLabel>Progress</GroupLabel>
            <RecordPanel style={styles.timelinePanel}>
              <ApplicationTimeline steps={timeline(application, leases)} />
            </RecordPanel>
          </View>

          {/* The landlord's own words, when there are any. */}
          {application.decision_note ? <Quote>{application.decision_note}</Quote> : null}

          <View style={styles.section}>
            <GroupLabel>What you offered</GroupLabel>
            <RecordPanel>
              <Fact
                first
                label="Advance offered"
                tone={offered < asked ? "waiting" : undefined}
                value={`${offered} month${offered === 1 ? "" : "s"}${offered === asked ? "" : ` of ${asked}`}`}
              />
              <Fact label="Rent" value={application.rent_formatted ?? "—"} />
              <Fact label="Move in from" value={application.move_in_from ? onDate(application.move_in_from) : "Not stated"} />
              <Fact label="Household" value={application.household_size ? `${application.household_size} people` : "Not stated"} />
            </RecordPanel>
          </View>

          <RecordPanel>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="What you told them"
              aria-expanded={told}
              onPress={() => setTold((value) => !value)}
              {...pressableFeedback(theme.color.field["100"])}
              style={({ pressed }) => [styles.disclosure, pressed && !isAndroid ? { backgroundColor: theme.color.field["100"] } : null]}
            >
              <Type variant="bodyStrong" style={styles.disclosureLabel}>What you told them</Type>
              <Ionicons name={told ? "chevron-up" : "chevron-down"} size={16} color={KOLA_DEEP} />
            </Pressable>
            {told ? (
              <>
                <Fact label="Occupation" value={application.occupation || "Not stated"} />
                <Fact label="Employer" value={application.employer || "Not stated"} />
                <Fact
                  label="Guarantor"
                  value={
                    application.guarantor_name
                      ? `${application.guarantor_name}${application.guarantor_relationship ? ` · ${application.guarantor_relationship}` : ""}`
                      : "None given"
                  }
                />
                {application.message ? <Fact wide label="What you wrote" value={application.message} /> : null}
              </>
            ) : null}
          </RecordPanel>

          <RecordPanel>
            <LinkRow
              first
              icon="home-outline"
              label="View the listing"
              onPress={() => router.push({ pathname: "/(app)/listing/[id]", params: { id: application.listing_id } })}
            />
          </RecordPanel>

          {actionError ? <Notice tone="error" title={actionError} /> : null}
        </View>
      </ScrollView>

      {/* One place for the consequential things, always reachable. */}
      {barShown ? (
        confirming ? (
          <ActionBar note="Withdrawing cannot be undone, and it releases the Unit to somebody else.">
            <Pill
              grow
              tone="danger"
              label="Yes, withdraw"
              busy={busy}
              busyLabel="Withdrawing…"
              onPress={async () => {
                setBusy(true);
                setActionError("");
                try {
                  await withdrawApplication(application.id, "No longer needed");
                  router.back();
                } catch (cause) {
                  setActionError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
                  setBusy(false);
                }
              }}
            />
            <QuietAct label="Keep it" disabled={busy} onPress={() => setConfirming(false)} />
          </ActionBar>
        ) : (
          <ActionBar>
            {/* The agreement this became, not the list of every agreement. The
                application already knows which one it is. */}
            {state.stage === "action" ? (
              <Pill
                grow
                icon="document-text-outline"
                label="Review agreement"
                onPress={() =>
                  state.leaseId
                    ? router.push({ pathname: "/(app)/agreement/[id]", params: { id: state.leaseId } })
                    : router.push("/(app)/leases" as never)
                }
              />
            ) : null}
            {open ? (
              <View style={state.stage === "action" ? null : styles.soleAct}>
                <QuietAct icon="close-outline" label="Withdraw" onPress={() => setConfirming(true)} />
              </View>
            ) : null}
          </ActionBar>
        )
      ) : null}
    </View>
  );
}

/**
 * The shape of the record, before it arrives.
 *
 * A caption reading "Loading…" on an otherwise blank screen, then the whole
 * page appearing at once. This holds the hero, the heading and the first rows.
 */
function RecordSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading this application" style={styles.screen}>
      <View style={[styles.hero, { height: 170 }]} />
      <View style={[styles.body, styles.skeletonBody]}>
        <Bone width="76%" height={20} />
        <Bone width="52%" />
        <RecordPanel style={styles.standingPanel}>
          <Bone width="58%" height={14} />
          <Bone width="40%" />
        </RecordPanel>
        <RecordPanel style={styles.timelinePanel}>
          {[0, 1, 2].map((key) => (
            <View key={key} style={styles.skeletonStep}>
              <Bone width={18} height={18} round={9} />
              <Bone width="62%" />
            </View>
          ))}
        </RecordPanel>
      </View>
    </View>
  );
}

function onDate(value: string): string {
  const iso = value.length === 10 ? `${value}T12:00:00` : value;
  return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  page: {
    paddingBottom: space[8],
  },
  hero: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: theme.color.field["100"],
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  body: {
    padding: space[4],
    gap: space[4],
  },
  skeletonBody: {
    gap: space[3],
  },
  identity: {
    gap: 2,
    paddingHorizontal: 2,
  },
  headline: {
    fontSize: 19,
    lineHeight: 25,
  },
  place: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  standingPanel: {
    gap: space[2],
    padding: space[4],
  },
  dates: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  section: {
    gap: space[2],
  },
  timelinePanel: {
    padding: space[4],
  },
  disclosure: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: 14,
  },
  disclosureLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: KOLA_DEEP,
  },
  soleAct: {
    flex: 1,
    alignItems: "center",
  },
  skeletonStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[2],
  },
});
