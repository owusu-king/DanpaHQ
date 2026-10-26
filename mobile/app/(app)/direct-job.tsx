import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { cancelDirectJob, getDirectJob, type DirectJob } from "@/artisan";
import { shortDate } from "@/components/artisan/ArtisanChips";
import { WorkArtisans } from "@/components/artisan/MaintenanceArtisans";
import { GroupLabel, Pill, Quote, RecordPanel } from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * One posted job, as the person who posted it — and pays for it — reads it.
 * Pushed from Find Artisans' Requests or Records, or from a notification.
 *
 * Asking an artisan goes to Find Artisans with this job named, and each
 * profile there offers to ask them; quotes come back here, decided with the
 * same card a repair uses — it asks once more and shows how to pay safely.
 * Coming back to this page reads the job again.
 */

const AMBER = theme.color.harmattan["600"];
const AMBER_WASH = theme.color.harmattan["100"];
const KOLA = theme.color.kola["800"];
const KOLA_WASH = theme.color.kola["50"];
const LAGOON = theme.color.lagoon["600"];
const LAGOON_WASH = theme.color.lagoon["100"];
const DEEP = theme.color.kola["900"];
const MUTED = theme.color.ink["500"];

const STATUS_LOOK: Record<DirectJob["job"]["status"], { ink: string; wash: string }> = {
  open: { ink: AMBER, wash: AMBER_WASH },
  assigned: { ink: KOLA, wash: KOLA_WASH },
  done_reported: { ink: LAGOON, wash: LAGOON_WASH },
  completed: { ink: KOLA, wash: KOLA_WASH },
  cancelled: { ink: MUTED, wash: theme.color.field["100"] },
};

export default function DirectJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const pageBottom = useSafeBottom(space[10]);
  const [job, setJob] = useState<DirectJob | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    try {
      setJob(await getDirectJob(id));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not open this job.");
    }
  }, [id]);

  // Back from asking an artisan lands here: read the job again.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useLayoutEffect(() => {
    navigation.setOptions({ title: job ? job.job.title : "Your job" });
  }, [navigation, job]);

  async function cancel() {
    setBusy(true);
    try {
      setJob(await cancelDirectJob(id));
      setConfirming(false);
      setDone("Job cancelled. Anybody asked has been told.");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not cancel the job.");
    } finally {
      setBusy(false);
    }
  }

  if (!job) {
    return (
      <View style={styles.center}>
        {error ? <Notice tone="error" title={error} /> : <ActivityIndicator color={AMBER} />}
      </View>
    );
  }

  const { job: about } = job;
  const look = STATUS_LOOK[about.status];

  function find() {
    router.push({
      pathname: "/(app)/artisans",
      params: { request: about.id, kind: "direct_job", mode: "invite", label: about.title, trade: about.trade },
    } as never);
  }

  return (
    <ScrollView style={styles.ground} contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]} showsVerticalScrollIndicator={false}>
      <View style={styles.column}>
        {done ? <Notice tone="success" title={done} /> : null}
        {error ? <Notice tone="error" title={error} /> : null}

        <RecordPanel style={styles.head}>
          <View style={[styles.status, { backgroundColor: look.wash }]}>
            <Type variant="captionStrong" style={{ color: look.ink, fontSize: 12 }}>{about.status_display}</Type>
          </View>
          <Type variant="title2" accessibilityRole="header">{about.title}</Type>
          <View style={styles.area}>
            <Ionicons name="location-outline" size={14} color={MUTED} />
            <Type variant="caption" style={{ color: theme.color.ink["700"], flexShrink: 1 }}>
              {about.trade_display} · {about.area.locality}, {about.area.district}
            </Type>
          </View>
          <Type variant="caption" style={{ color: MUTED }}>Posted {shortDate(about.created_at)}</Type>
        </RecordPanel>

        {about.photo?.url ? <Image source={{ uri: about.photo.url }} style={styles.photo} accessibilityLabel="The job" /> : null}
        <Quote>{about.description}</Quote>

        {about.address.line || about.address.landmark ? (
          <View style={styles.private}>
            <Ionicons name="lock-closed-outline" size={15} color={LAGOON} />
            <View style={{ flex: 1, gap: 2 }}>
              <Type variant="captionStrong">{[about.address.line, about.address.landmark].filter(Boolean).join(" · ")}</Type>
              <Type variant="caption" style={{ color: MUTED }}>Shown only to the artisan you approve.</Type>
            </View>
          </View>
        ) : null}

        <WorkArtisans work={job} side="provider" onChanged={load} onFind={find} directJobId={about.id} />
        {!job.assigned && !job.invitations.length && about.status === "open" ? (
          <Type variant="caption" style={{ color: MUTED }}>
            Ask up to {job.max_open_invitations} artisans to quote. They see the job and the area.
          </Type>
        ) : null}

        {job.permissions.cancel ? (
          <View style={{ gap: space[2] }}>
            <GroupLabel>Cancel</GroupLabel>
            {confirming ? (
              <RecordPanel style={styles.cancel}>
                <Type variant="caption" style={{ color: theme.color.ink["700"] }}>Cancel this job? Anybody asked is told.</Type>
                <View style={styles.acts}>
                  <Pill tone="danger" label="Cancel the job" busy={busy} busyLabel="Cancelling…" onPress={() => void cancel()} />
                  <Pill tone="quiet" label="Keep it" onPress={() => setConfirming(false)} />
                </View>
              </RecordPanel>
            ) : (
              <Pill tone="quiet" icon="close-circle-outline" label="Cancel this job" onPress={() => setConfirming(true)} />
            )}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: theme.color.field["50"] },
  page: { paddingTop: space[4], paddingHorizontal: space[4] },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", gap: space[4] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space[6], backgroundColor: theme.color.field["50"] },
  head: { gap: space[2], padding: space[4] },
  status: { alignSelf: "flex-start", paddingVertical: 2, paddingHorizontal: space[2], borderRadius: 999 },
  area: { flexDirection: "row", alignItems: "center", gap: 4 },
  photo: { width: "100%", height: 200, borderRadius: 16, backgroundColor: theme.color.field["100"] },
  private: { flexDirection: "row", alignItems: "flex-start", gap: space[2], padding: space[3], borderRadius: 14, backgroundColor: LAGOON_WASH },
  cancel: { gap: space[3], padding: space[4], borderColor: alpha(DEEP, 0.08) },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
