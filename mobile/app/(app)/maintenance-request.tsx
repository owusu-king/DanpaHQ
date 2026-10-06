import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { ClipPlayer, STAGE, Tracker, dateLabel } from "@/components/maintenance/MaintenanceParts";
import { EntityHeader, LoadingRows, StatusLine, type StatusTone } from "@/components/property/WorkspacePatterns";
import { ActionBar, Fact, GroupLabel, Pill, QuietAct, Quote, RecordPanel } from "@/components/record/RecordSurfaces";
import { Field, Notice, Type, space } from "@/components/ui";
import {
  getMaintenanceRequest,
  maintenanceStatusLabel,
  maintenanceTone,
  moveMaintenanceRequest,
  type MaintenanceMove,
  type MaintenanceRequest,
  type MaintenanceTone,
} from "@/maintenance";
import { useSafeBottom } from "@/platform";
import { theme } from "@/theme";

type Side = "tenant" | "provider";

const STATUS_TONE: Record<MaintenanceTone, StatusTone> = {
  waiting: "waiting",
  working: "neutral",
  asking: "good",
  done: "good",
  reopened: "attention",
};

/**
 * One maintenance request, for whichever side opened it.
 *
 * Read top to bottom: where it stands and what that means for the reader; the
 * photograph and the clip; how far it has come; what the tenant said; what has
 * happened since, each note beside the move it explains. The bar at the foot
 * holds at most two acts, and only the ones the server says this reader may
 * make (`permissions`). Writing a note or a reason happens on the page, above
 * the bar — never in a dialog over it.
 */
export default function MaintenanceRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useAuth();
  const side: Side = state.status === "signed_in"
    && state.me.capabilities.active_workspace === "provider"
    && state.me.capabilities.provider.workspace_access ? "provider" : "tenant";
  const scroll = useRef<ScrollView>(null);
  const openBottom = useSafeBottom(space[10]);
  const [request, setRequest] = useState<MaintenanceRequest | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [done, setDone] = useState("");
  const [writing, setWriting] = useState<"fixed" | "reopen" | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRequest(await getMaintenanceRequest(id));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "This request did not open.");
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function move(kind: MaintenanceMove) {
    if (!request) return;
    setBusy(true);
    setActionError("");
    try {
      const body = kind === "reopen" ? { reason: words.trim() } : kind === "fixed" ? { note: words.trim() } : {};
      setRequest(await moveMaintenanceRequest(request.id, kind, body));
      setWriting(null);
      setWords("");
      setDone({
        start: "Work started. The tenant has been told.",
        fixed: "Sent to the tenant to confirm.",
        confirm: "Thank you — marked as fixed.",
        reopen: "Reopened. Your landlord has been told.",
      }[kind]);
      scroll.current?.scrollTo({ y: 0, animated: true });
    } catch (cause) {
      setActionError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!request) {
    return (
      <View style={styles.page}>
        {error ? <Notice tone="error" title={error} body="Return to Maintenance and try again." /> : <LoadingRows rows={5} />}
      </View>
    );
  }

  const tone = maintenanceTone(request.status);
  const stage = STAGE[tone];
  const can = request.permissions ?? { start: false, report_fixed: false, confirm: false, reopen: false };
  const barShown = Boolean(writing) || can.start || can.report_fixed || can.confirm || can.reopen;
  const place = [request.place.unit_label, request.place.bed_label, request.place.property_title].filter(Boolean).join(" · ");

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.page, { paddingBottom: barShown ? space[6] : openBottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <EntityHeader
          eyebrow="Maintenance"
          title={request.category_display}
          subtitle={side === "provider" ? `${request.tenant.name} · ${place}` : place}
          status={<StatusLine label={maintenanceStatusLabel(request.status, side)} tone={STATUS_TONE[tone]} />}
        />

        {done ? <Notice tone="success" title={done} /> : null}
        {actionError ? <Notice tone="error" title={actionError} /> : null}

        <View style={[styles.hero, { backgroundColor: stage.wash }]}>
          <View style={[styles.heroMark, { backgroundColor: stage.ink }]}>
            <Ionicons name={stage.icon} size={20} color="#fff" />
          </View>
          <Type variant="body" style={styles.heroText}>{heroLine(request, side)}</Type>
        </View>

        {request.photo ? (
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel={`Photo of the problem: ${request.category_display}. Open full size.`}
            onPress={() => void Linking.openURL(request.photo!.url)}
          >
            <Image source={{ uri: request.photo.url }} style={styles.photo} accessibilityIgnoresInvertColors />
          </Pressable>
        ) : null}
        {request.video ? (
          <ClipPlayer uri={request.video.url} startMs={request.video_clip_start_ms} endMs={request.video_clip_end_ms} />
        ) : null}

        <RecordPanel style={styles.trackPanel}>
          <Tracker request={request} />
        </RecordPanel>

        <View style={styles.section}>
          <GroupLabel>{side === "tenant" ? "What you reported" : `${request.tenant.name.split(" ")[0]} reported`}</GroupLabel>
          <Quote>{request.description}</Quote>
        </View>

        {request.events.length > 1 ? (
          <View style={styles.section}>
            <GroupLabel>History</GroupLabel>
            <RecordPanel>
              {[...request.events].reverse().map((event, index) => (
                <View key={event.id}>
                  <Fact
                    first={index === 0}
                    label={event.kind_display}
                    value={[event.actor_name, dateLabel(event.at)].filter(Boolean).join(" · ")}
                    tone={event.kind === "reopened" ? "alert" : event.kind === "confirmed" ? "good" : undefined}
                  />
                  {event.note ? <Fact wide label="Note" value={event.note} /> : null}
                </View>
              ))}
            </RecordPanel>
          </View>
        ) : null}

        {writing ? (
          <View style={[styles.writing, writing === "reopen" ? styles.writingAlert : null]}>
            <Field
              label={writing === "reopen" ? "What is still wrong?" : "What was done? (optional)"}
              value={words}
              onChangeText={setWords}
              multiline
              maxLength={500}
              autoFocus
              placeholder={writing === "reopen" ? "It still drips when the tap is closed." : "Replaced the washer and sealed the joint."}
              style={styles.writingField}
            />
          </View>
        ) : null}
      </ScrollView>

      {barShown ? (
        <ActionBar note={writing === "fixed" ? "The tenant is asked to confirm the fix." : undefined}>
          <Foot can={can} writing={writing} busy={busy} words={words} onWrite={(next) => { setWriting(next); setWords(""); setActionError(""); }} onMove={(kind) => void move(kind)} />
        </ActionBar>
      ) : null}
    </View>
  );
}

/** At most two acts: the move, and — while writing — the way back. */
function Foot({
  can,
  writing,
  busy,
  words,
  onWrite,
  onMove,
}: {
  can: NonNullable<MaintenanceRequest["permissions"]>;
  writing: "fixed" | "reopen" | null;
  busy: boolean;
  words: string;
  onWrite: (next: "fixed" | "reopen" | null) => void;
  onMove: (kind: MaintenanceMove) => void;
}) {
  if (writing) {
    return (
      <>
        <Pill
          grow
          icon={writing === "reopen" ? "refresh-outline" : "checkmark-circle-outline"}
          tone={writing === "reopen" ? "danger" : "primary"}
          label={writing === "reopen" ? "Reopen request" : "Send to tenant"}
          busy={busy}
          busyLabel="Sending…"
          disabled={writing === "reopen" && !words.trim()}
          onPress={() => onMove(writing)}
        />
        <QuietAct label="Back" onPress={() => onWrite(null)} disabled={busy} />
      </>
    );
  }
  if (can.start) return <Pill grow icon="construct-outline" label="Start work" busy={busy} busyLabel="Starting…" onPress={() => onMove("start")} />;
  if (can.report_fixed) return <Pill grow icon="checkmark-circle-outline" label="Mark as fixed" onPress={() => onWrite("fixed")} />;
  return (
    <>
      {can.confirm ? <Pill grow icon="checkmark-circle-outline" label="Yes, it’s fixed" busy={busy} busyLabel="Confirming…" onPress={() => onMove("confirm")} /> : null}
      {can.reopen ? <QuietAct label="Not fixed" onPress={() => onWrite("reopen")} disabled={busy} /> : null}
    </>
  );
}

function heroLine(request: MaintenanceRequest, side: Side) {
  switch (request.status) {
    case "submitted":
      return side === "tenant" ? `Sent ${dateLabel(request.created_at)}. Waiting for your landlord to start.` : `Reported ${dateLabel(request.created_at)}. Start the work when someone is on it.`;
    case "reopened":
      return side === "tenant" ? "You said it is not fixed. Your landlord has been told." : "The tenant says it is not fixed. Start the work again.";
    case "in_progress":
      return side === "tenant" ? "Your landlord is working on it." : "Mark it fixed when the work is done; the tenant confirms.";
    case "awaiting_tenant_confirmation":
      return side === "tenant" ? "Your landlord says it is fixed. Is it?" : "Waiting for the tenant to confirm the fix.";
    default:
      return request.completed_at ? `Confirmed fixed ${dateLabel(request.completed_at)}.` : "Confirmed fixed.";
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { padding: space[4], paddingBottom: space[10], gap: space[4] },
  section: { gap: space[2] },
  hero: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: 16 },
  heroMark: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  heroText: { flex: 1, color: theme.color.ink["900"] },
  photo: { width: "100%", height: 220, borderRadius: 16, backgroundColor: theme.color.field["100"] },
  trackPanel: { padding: space[4] },
  writing: { padding: space[3], borderRadius: 16, backgroundColor: theme.color.kola["50"] },
  writingAlert: { backgroundColor: theme.color.laterite["100"] },
  writingField: { minHeight: 88, textAlignVertical: "top" },
});
