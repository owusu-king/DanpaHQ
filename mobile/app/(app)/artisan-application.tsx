import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiFailure } from "@/api";
import {
  ARTISAN_STATUS_LOOK,
  canSendApplication,
  getMyArtisanApplication,
  type ArtisanApplication,
} from "@/artisan";
import { useAuth, type ArtisanStatus } from "@/auth";
import { ArtisanApplicationForm } from "@/components/artisan/ArtisanApplicationForm";
import { ArtisanFacts } from "@/components/artisan/ArtisanFacts";
import { PendingPulse, Rise, SuccessMark } from "@/components/auth/AuthMotion";
import { AuthAction } from "@/components/auth/AuthScene";
import { VerificationTrack, type TrackStop } from "@/components/auth/VerificationTrack";
import { ph } from "@/components/home/plinth";
import { Notice, Type, space } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";
import { chooseWorkspace } from "@/workspace";

/**
 * Becoming an artisan — the application, and where it stands. Mirrors web's
 * `/artisan`.
 *
 * Reached from Menu in whichever experience somebody is in, and it leaves them
 * there: nothing on this screen switches experience except the one button an
 * approved artisan presses themselves. Every state is read from the backend.
 *
 * The form asks for what a reviewer needs and nothing more: trades, area, a few
 * photographs of finished work and — only when Danpa HQ does not already hold
 * one — a government ID. Certificates are optional for every trade. Sending
 * again after a reviewer asked for more starts from what was sent last time,
 * so nobody uploads the same photograph twice.
 */

const AMBER = theme.color.harmattan["600"];
const KOLA = theme.color.kola["600"];
const LAGOON = theme.color.lagoon["600"];
const ALERT = theme.color.laterite["600"];
const GOLD = theme.color.gold["600"];
const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];

const PILL_TONE: Record<string, { ink: string; wash: string }> = {
  calm: { ink: LAGOON, wash: theme.color.lagoon["100"] },
  waiting: { ink: GOLD, wash: theme.color.gold["50"] },
  attention: { ink: ALERT, wash: theme.color.laterite["100"] },
  approved: { ink: theme.color.kola["800"], wash: theme.color.kola["50"] },
};


function stopsFor(status: ArtisanStatus): TrackStop[] {
  const sent = status !== "not_started";
  const refused = status === "needs_more_info" || status === "rejected" || status === "revoked";
  const open = status === "approved" || status === "suspended";
  return [
    {
      state: refused ? "attention" : sent ? "done" : "next",
      label: refused ? "Update your application" : "Apply",
      detail: refused ? "See the note above" : "Trades, area and photos of your work",
    },
    {
      state: open ? "done" : status === "pending" ? "waiting" : "later",
      label: status === "pending" ? "Under review" : "We review it",
      detail: status === "pending" ? "We will let you know the outcome" : "Your account carries on as it is meanwhile",
    },
    { state: open ? "done" : "later", label: "Artisan work opens", detail: "Quote requests, jobs and your profile" },
  ];
}

export default function ArtisanApplicationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pageBottom = useSafeBottom(space[10]);
  const { state, refreshMe } = useAuth();
  const scroll = useRef<ScrollView>(null);

  const [application, setApplication] = useState<ArtisanApplication | null>(null);
  const [error, setError] = useState("");
  const [justSent, setJustSent] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try {
      setApplication(await getMyArtisanApplication());
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your application.");
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function enter() {
    setSwitching(true);
    try {
      const next = await chooseWorkspace("artisan");
      await refreshMe();
      router.replace(resolveEntryRoute(next) as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not open artisan work.");
      setSwitching(false);
    }
  }

  const status: ArtisanStatus = application?.status ?? "not_started";
  const look = ARTISAN_STATUS_LOOK[status];
  const pill = PILL_TONE[look.tone]!;
  const open = status === "approved" || status === "suspended";
  // Already inside, the way in would lead back to where they stand.
  const inside = state.status === "signed_in" && state.me.capabilities.active_workspace === "artisan";

  return (
    <View style={styles.ground}>
      <ScrollView ref={scroll} contentContainerStyle={{ flexGrow: 1, paddingBottom: pageBottom }} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { paddingTop: insets.top + space[3] }]}>
          <Ionicons name="hammer" size={180} color={alpha(WHITE, 0.09)} style={styles.heroMark} />
          <View style={styles.inner}>
            <View style={styles.crown}>
              <Pressable
                onPress={() => {
                  if (router.canGoBack()) router.back();
                  else if (state.status === "signed_in") router.replace(resolveEntryRoute(state.me) as never);
                }}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                hitSlop={10}
                {...pressableFeedback(alpha(WHITE, 0.2))}
                style={styles.back}
              >
                <Ionicons name="arrow-back" size={20} color={WHITE} />
              </Pressable>
              {application ? (
                <View style={[styles.pill, { backgroundColor: pill.wash }]}>
                  {look.icon ? <Ionicons name={look.icon} size={14} color={pill.ink} /> : <PendingPulse color={GOLD} />}
                  <Type variant="captionStrong" style={{ color: pill.ink }}>{look.pill}</Type>
                </View>
              ) : null}
            </View>
            <View style={{ gap: space[2] }}>
              <Type variant="display3" accessibilityRole="header" style={{ color: WHITE }}>
                {application ? look.title : "Work as an artisan"}
              </Type>
              <Type variant="caption" style={styles.heroLine}>
                {application ? look.line : "Checking where your application stands…"}
              </Type>
            </View>
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.column}>
            {error ? <Notice tone="error" title={error} /> : null}
            {!application && !error ? (
              <View style={{ paddingVertical: space[10], alignItems: "center" }}>
                <ActivityIndicator color={AMBER} />
              </View>
            ) : null}

            {application ? (
              <>
                <Rise>
                  <View style={styles.card}>
                    {justSent && status === "pending" ? (
                      <View style={styles.sent}>
                        <SuccessMark tone={KOLA} />
                        <Type variant="title2" style={{ textAlign: "center" }}>Application sent</Type>
                        <Type variant="caption" style={styles.centerMuted}>
                          It is with our team. Your account carries on exactly as it was meanwhile.
                        </Type>
                      </View>
                    ) : null}
                    {application.decision_note ? (
                      <Notice tone={status === "needs_more_info" ? "warning" : "error"} title="From the review" body={application.decision_note} />
                    ) : null}
                    {status === "suspended" && application.suspended_reason ? (
                      <Notice tone="warning" title="Why your account is suspended" body={application.suspended_reason} />
                    ) : null}
                    <VerificationTrack stops={stopsFor(status)} />
                    {open && !inside ? (
                      <AuthAction label="Switch to artisan work" busyLabel="Opening…" busy={switching} onPress={() => void enter()} />
                    ) : null}
                  </View>
                </Rise>

                {canSendApplication(status) ? (
                  <ArtisanApplicationForm
                    application={application}
                    onSent={(next) => {
                      setApplication(next);
                      setJustSent(true);
                      void refreshMe();
                      scroll.current?.scrollTo({ y: 0, animated: true });
                    }}
                  />
                ) : application.profile ? (
                  <Rise index={1}>
                    <View style={styles.card}>
                      <Type variant="title2">What you sent</Type>
                      <ArtisanFacts profile={application.profile} />
                    </View>
                  </Rise>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const RISE = 28;

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: ph.ground },
  hero: { paddingHorizontal: space[5], paddingBottom: RISE + space[6], backgroundColor: AMBER, overflow: "hidden" },
  heroMark: { position: "absolute", right: -30, bottom: -20, transform: [{ rotate: "-18deg" }] },
  inner: { width: "100%", maxWidth: 520, alignSelf: "center", gap: space[5] },
  crown: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: alpha(WHITE, 0.16), overflow: "hidden" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: space[3], borderRadius: 999 },
  heroLine: { color: alpha(WHITE, 0.86), fontSize: 15, lineHeight: 21, maxWidth: 380 },
  panel: {
    flexGrow: 1,
    marginTop: -RISE,
    paddingTop: space[6],
    paddingHorizontal: space[5],
    borderTopLeftRadius: RISE,
    borderTopRightRadius: RISE,
    backgroundColor: ph.ground,
  },
  column: { width: "100%", maxWidth: 520, alignSelf: "center", gap: space[5] },
  card: { gap: space[4], padding: space[4], borderRadius: 20, borderWidth: 1, borderColor: alpha(DEEP, 0.08), backgroundColor: WHITE },
  sent: { alignItems: "center", gap: space[1], paddingBottom: space[2] },
  centerMuted: { textAlign: "center", color: theme.color.ink["500"] },
});
