import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Choice, Field, Notice, Surface, Type, space } from "@/components/ui";
import { Disclosure, EntityHeader, LoadingRows, StatusLine, type StatusTone } from "@/components/property/WorkspacePatterns";
import { destructiveConfirmStyle, pressableFeedback } from "@/platform";
import { theme } from "@/theme";
import {
  cancelViewing,
  confirmSlot,
  formatSlot,
  getViewing,
  offerViewingSlots,
  recordProviderViewingOutcome,
  reportViewingNoShow,
  rescheduleViewing,
  respondToViewing,
  respondViewingAttendance,
  type Viewing,
  type ViewingCancellationReason,
} from "@/viewings";

export default function ProviderViewingScreen() {
  const { viewingId } = useLocalSearchParams<{ viewingId: string }>();
  const router = useRouter();
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!viewingId) return;
    try {
      setViewing(await getViewing(viewingId));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this Viewing.");
    }
  }, [viewingId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!viewing) {
    return <View style={{ padding: space[5] }}>{error ? <Notice tone="error" title={error} body="Return to Viewings and try again." /> : <LoadingRows rows={5} />}</View>;
  }
  const summary = viewingSummary(viewing);

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[5] }} keyboardShouldPersistTaps="handled">
      <EntityHeader
        eyebrow="Viewing"
        title={viewing.tenant_name}
        subtitle={viewing.listing_headline}
        status={<StatusLine label={summary.label} tone={summary.tone} />}
      />
      {error ? <Notice tone="error" title={error} body="Some information may be out of date. Try again." /> : null}
      <ViewingActions viewing={viewing} onChanged={load} onCheckIn={() => router.push({ pathname: "/(app)/provider-viewing-check-in", params: { viewingId: viewing.id } })} />

      {viewing.confirmed_starts_at ? (
        <View style={{ gap: space[1], padding: space[4], backgroundColor: theme.color.kola["50"], borderRadius: 8 }}>
          <Type variant="caption">Scheduled</Type>
          <Type variant="bodyStrong">{formatSlot(viewing.confirmed_starts_at)}</Type>
        </View>
      ) : null}

      {viewing.message ? (
        <View style={{ padding: space[4], backgroundColor: theme.color.field["100"], borderLeftWidth: 3, borderLeftColor: theme.color.field["300"] }}>
          <Type variant="body">“{viewing.message}”</Type>
        </View>
      ) : null}
      {viewing.availability_note ? <Fact label="Tenant availability" value={viewing.availability_note} /> : null}

      {viewing.contact ? (
        <View style={{ gap: space[2] }}>
          <Type variant="title2" accessibilityRole="header">Contact</Type>
          <Type variant="bodyStrong">{viewing.contact.name}</Type>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`tel:${viewing.contact?.phone}`)} {...pressableFeedback(theme.color.field["200"])} style={{ minHeight: 48, justifyContent: "center" }}>
            <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>{viewing.contact.phone} · Call</Type>
          </Pressable>
        </View>
      ) : null}

      {viewing.viewing_directions ? <Directions viewing={viewing} /> : null}

      <View>
        <Type variant="title2" accessibilityRole="header" style={{ marginBottom: space[3] }}>Viewing details</Type>
        <Disclosure title="Request and Property" initiallyOpen>
          <Fact label="Property" value={viewing.listing_headline} />
          <Fact label="Location" value={[viewing.locality_name, viewing.landmark].filter(Boolean).join(" · ") || "Not recorded"} />
          {viewing.rent_formatted ? <Fact label="Rent" value={`${viewing.rent_formatted} per month`} /> : null}
          <Fact label="Requested" value={formatSlot(viewing.created_at)} />
        </Disclosure>
        {viewing.response_note || viewing.cancellation_reason_display || viewing.outcome_note ? (
          <Disclosure title="Outcome details">
            {viewing.response_note ? <Fact label="Response" value={viewing.response_note} /> : null}
            {viewing.cancellation_reason_display ? <Fact label="Cancellation" value={viewing.cancellation_reason_display} /> : null}
            {viewing.cancellation_note ? <Fact label="Note" value={viewing.cancellation_note} /> : null}
            {viewing.outcome_note ? <Fact label="Outcome" value={viewing.outcome_note} /> : null}
          </Disclosure>
        ) : null}
        <AppointmentHistory viewing={viewing} />
      </View>
    </ScrollView>
  );
}

function ViewingActions({ viewing, onChanged, onCheckIn }: { viewing: Viewing; onChanged: () => Promise<void>; onCheckIn: () => void }) {
  const [mode, setMode] = useState<"idle" | "offer" | "reschedule" | "cancel">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      setMode("idle");
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That action did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "offer" || mode === "reschedule") {
    return (
      <Surface style={{ gap: space[3] }}>
        <Type variant="title2">{mode === "reschedule" ? "Offer a different time" : "Offer a viewing time"}</Type>
        <OfferForm busy={busy} onCancel={() => setMode("idle")} onSubmit={(input) => run(() => mode === "reschedule" ? rescheduleViewing(viewing.id, input.slots) : offerViewingSlots(viewing.id, input))} />
      </Surface>
    );
  }

  if (mode === "cancel") {
    return <CancelAppointmentForm busy={busy} onBack={() => setMode("idle")} onSubmit={(input) => run(() => cancelViewing(viewing.id, input))} />;
  }

  if (viewing.status === "offered" && viewing.actions.can_confirm_slot) {
    const available = viewing.slots.filter((slot) => !slot.is_past);
    return (
      <Surface style={{ gap: space[3] }}>
        <Type variant="title2">Choose the replacement time</Type>
        <Type variant="caption">The tenant suggested these times. Confirming one creates the next appointment.</Type>
        {available.map((slot) => <Button key={slot.id} label={formatSlot(slot.starts_at)} variant="secondary" busy={busy} onPress={() => void run(() => confirmSlot(viewing.id, slot.id))} />)}
        {!available.length ? <Notice tone="info" title="Those times have passed" body="Offer another time to keep the Viewing moving." /> : null}
      </Surface>
    );
  }

  return (
    <View style={{ gap: space[3] }}>
      {error ? <Notice tone="error" title={error} /> : null}
      <AttendanceResolutionPanel viewing={viewing} busy={busy} run={run} />
      {viewing.actions.can_decline ? (
        <>
          <Button label={viewing.status === "offered" ? "Offer different times" : "Offer a time"} busy={busy} onPress={() => setMode("offer")} />
          <Button label="Decline request" variant="destructive" disabled={busy} onPress={() => Alert.alert("Decline this request?", "The tenant will be told that this Viewing will not go ahead.", [{ text: "Keep request", style: "cancel" }, { text: "Decline", style: destructiveConfirmStyle, onPress: () => void run(() => respondToViewing(viewing.id, "decline", "Not available")) }])} />
        </>
      ) : null}
      {viewing.status === "confirmed" ? (
        <>
          {viewing.check_in.can_validate ? <Button label="Scan QR or enter code" busy={busy} onPress={onCheckIn} /> : <Notice tone="info" title="Check-in is not open yet" body={viewing.check_in.opens_at ? `Available after ${formatSlot(viewing.check_in.opens_at)}.` : "Ask the tenant to show their temporary QR or six-digit code when they arrive."} />}
          <Button label="Offer different times" variant="secondary" disabled={busy} onPress={() => setMode("reschedule")} />
          <Button label="Cancel appointment" variant="quiet" disabled={busy} onPress={() => setMode("cancel")} />
        </>
      ) : null}
      {viewing.status === "checked_in" ? <Button label="Mark Viewing completed" busy={busy} onPress={() => void run(() => recordProviderViewingOutcome(viewing.id, "completed"))} /> : null}
      {viewing.actions.can_cancel && viewing.status !== "confirmed" ? <Button label="Cancel appointment" variant="quiet" disabled={busy} onPress={() => setMode("cancel")} /> : null}
    </View>
  );
}

function CancelAppointmentForm({ busy, onBack, onSubmit }: { busy: boolean; onBack: () => void; onSubmit: (input: { reason: ViewingCancellationReason; note?: string }) => Promise<void> }) {
  const [reason, setReason] = useState<ViewingCancellationReason>("schedule_conflict");
  const [note, setNote] = useState("");
  return (
    <Surface style={{ gap: space[3] }}>
      <Type variant="title2">Cancel this appointment</Type>
      <Notice tone="info" title="Could a different time work?" body="Rescheduling keeps the Viewing active. Cancel only when it should not go ahead." />
      <Choice label="Reason" value={reason} onChange={(value) => setReason(value as ViewingCancellationReason)} options={[
        { value: "schedule_conflict", label: "Schedule conflict" },
        { value: "emergency", label: "Emergency" },
        { value: "transportation_problem", label: "Transportation problem" },
        { value: "no_longer_interested", label: "No longer interested" },
        { value: "property_unavailable", label: "Property or Unit unavailable" },
        { value: "other", label: "Other" },
      ]} />
      <Field label="Optional note" value={note} onChangeText={setNote} multiline />
      <Button label="Cancel appointment" variant="destructive" busy={busy} onPress={() => void onSubmit({ reason, note })} />
      <Button label="Keep appointment" variant="quiet" disabled={busy} onPress={onBack} />
    </Surface>
  );
}

function AttendanceResolutionPanel({ viewing, busy, run }: { viewing: Viewing; busy: boolean; run: (work: () => Promise<unknown>) => Promise<void> }) {
  const [note, setNote] = useState("");
  if (viewing.attendance.state === "disputed") return <Notice tone="info" title="Attendance is disputed" body="No party is treated as a verified no-show. The evidence remains available for support review." />;
  if (viewing.attendance.state === "pending") {
    return (
      <Surface style={{ gap: space[3] }}>
        <Notice tone="info" title="Attendance report awaiting response" body="This is not a verified no-show until the reported party responds." />
        {viewing.attendance.can_respond ? <><Field label="Optional response note" value={note} onChangeText={setNote} multiline /><Button label="Confirm I could not attend" busy={busy} onPress={() => void run(() => respondViewingAttendance(viewing.id, "confirm", note))} /><Button label="Dispute report" variant="secondary" busy={busy} onPress={() => void run(() => respondViewingAttendance(viewing.id, "dispute", note))} /></> : null}
      </Surface>
    );
  }
  if (!viewing.attendance.can_report) return null;
  return (
    <Surface style={{ gap: space[3] }}>
      <Notice tone="info" title="No verified check-in" body="A missing check-in does not prove who was absent. The tenant can confirm or dispute your report." />
      <Field label="Optional factual note" value={note} onChangeText={setNote} multiline />
      <Button label="Report tenant absent" variant="secondary" busy={busy} onPress={() => void run(() => reportViewingNoShow(viewing.id, note))} />
    </Surface>
  );
}

function OfferForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (input: { slots: { starts_at: string; duration_minutes: number }[] }) => Promise<void> }) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [day, setDay] = useState(tomorrow);
  const [time, setTime] = useState("10:00");
  const [error, setError] = useState("");
  function submit() {
    const startsAt = new Date(`${day}T${time}:00`);
    if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) { setError("Choose a valid future date and time."); return; }
    setError("");
    void onSubmit({ slots: [{ starts_at: startsAt.toISOString(), duration_minutes: 30 }] });
  }
  return (
    <View style={{ gap: space[3] }}>
      <Field label="Viewing date" hint="YYYY-MM-DD" value={day} onChangeText={setDay} />
      <Field label="Time" hint="24-hour time, for example 14:30" value={time} onChangeText={setTime} />
      <Type variant="caption">Rooomly Viewings are free. A tenant is never charged to attend.</Type>
      {error ? <Notice tone="error" title={error} /> : null}
      <Button label="Offer this time" busy={busy} onPress={submit} />
      <Button label="Not now" variant="quiet" disabled={busy} onPress={onCancel} />
    </View>
  );
}

function Directions({ viewing }: { viewing: Viewing }) {
  const directions = viewing.viewing_directions!;
  const address = [directions.house_number, directions.street].filter(Boolean).join(" ");
  return (
    <View style={{ gap: space[2] }}>
      <Type variant="title2" accessibilityRole="header">Directions</Type>
      {address ? <Type variant="body">{address}</Type> : null}
      {directions.digital_address ? <Type variant="mono">{directions.digital_address}</Type> : null}
      {directions.entrance_note ? <Type variant="caption">{directions.entrance_note}</Type> : null}
      {directions.latitude && directions.longitude ? <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${directions.latitude},${directions.longitude}`)}`)} {...pressableFeedback(theme.color.field["200"])} style={{ minHeight: 48, justifyContent: "center" }}><Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>Open map directions →</Type></Pressable> : null}
    </View>
  );
}

function AppointmentHistory({ viewing }: { viewing: Viewing }) {
  if (!viewing.appointments.length) return null;
  return (
    <Disclosure title={`Appointment history (${viewing.appointments.length})`}>
      {viewing.appointments.map((appointment) => <Fact key={appointment.id} label={`Appointment ${appointment.sequence}`} value={`${formatSlot(appointment.scheduled_at)} · ${appointment.status.replaceAll("_", " ")}`} />)}
    </Disclosure>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={{ minHeight: 40, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[4] }}><Type variant="caption">{label}</Type><Type variant="bodyStrong" style={{ flex: 1, textAlign: "right" }}>{value}</Type></View>;
}

function viewingSummary(viewing: Viewing): { label: string; tone: StatusTone } {
  if (viewing.status === "requested") return { label: "Needs a reply", tone: "attention" };
  if (viewing.status === "offered") return { label: "Waiting for tenant", tone: "waiting" };
  if (viewing.status === "confirmed" && viewing.check_in.can_validate) return { label: "Ready for check-in", tone: "attention" };
  if (viewing.status === "confirmed") return { label: "Confirmed", tone: "good" };
  if (viewing.status === "checked_in") return { label: "Checked in", tone: "attention" };
  if (viewing.status === "attendance_pending" && viewing.attendance.can_respond) return { label: "Response needed", tone: "attention" };
  if (viewing.status === "attendance_pending") return { label: "Attendance pending", tone: "waiting" };
  if (viewing.status === "completed") return { label: "Completed", tone: "good" };
  return { label: viewing.status_display, tone: "neutral" };
}
