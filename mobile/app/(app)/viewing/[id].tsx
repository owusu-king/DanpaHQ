import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, Linking, Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Choice, Field, Notice, Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";
import { placeOf, standing, whenLabel } from "@/viewingMeaning";
import {
  cancelViewing,
  confirmSlot,
  listMyViewings,
  recordPostViewingAction,
  reportViewingNoShow,
  rescheduleViewing,
  respondToViewing,
  respondViewingAttendance,
  type Viewing,
  type ViewingCancellationReason,
} from "@/viewings";

/**
 * One viewing, and only what the lifecycle makes relevant right now.
 *
 * The rule this screen exists to hold: a control appears when it can be used
 * and disappears when it cannot. The check-in code is not here the day before;
 * the exact directions are not here until the backend releases them; the
 * follow-up actions are not here once a follow-up has been chosen; the cancel
 * button is not here once there is nothing to cancel.
 *
 * The backend decides all of that — `actions`, `check_in`, `attendance`,
 * `post_viewing` and `viewing_directions` are computed per-reader on the
 * server. This screen renders what it is handed and re-derives none of it.
 */
export default function ViewingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [mode, setMode] = useState<"none" | "reschedule" | "cancel" | "withdraw">("none");

  const load = useCallback(async () => {
    try {
      const mine = await listMyViewings();
      const found = mine.find((row) => row.id === id) ?? null;
      setViewing(found);
      setMissing(found === null);
    } catch (cause) {
      setMissing(true);
      setLoadError(
        cause instanceof ApiFailure ? cause.error.message : "We could not open that viewing.",
      );
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setActionError("");
    try {
      await work();
      setMode("none");
      await load();
    } catch (cause) {
      setActionError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <View style={{ padding: space[5] }}>
        <Notice tone="error" title={loadError || "We could not find that viewing."} />
      </View>
    );
  }
  if (!viewing) {
    return <View style={{ padding: space[5] }}><Type variant="caption">Loading…</Type></View>;
  }

  const state = standing(viewing);
  const when = whenLabel(viewing.confirmed_starts_at);
  const note = viewing.response_note || viewing.cancellation_note || viewing.outcome_note;
  const directions = viewing.viewing_directions;
  const hasExits =
    viewing.actions.can_reschedule || viewing.actions.can_cancel || viewing.actions.can_withdraw;

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], gap: space[5], paddingBottom: space[10] }}>
      <View style={{ flexDirection: "row", gap: space[4] }}>
        <View
          style={{
            width: 104,
            height: 78,
            borderRadius: 8,
            backgroundColor: theme.color.field["100"],
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {viewing.photo_url ? (
            <Image
              source={{ uri: viewing.photo_url }}
              accessible={false}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          ) : (
            <Ionicons name="image-outline" size={22} color={theme.color.ink["300"]} />
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Type variant="title1" accessibilityRole="header">{viewing.listing_headline}</Type>
          <Type variant="caption">{placeOf(viewing) || "Ghana"}</Type>
        </View>
      </View>

      {when ? <Type variant="display2">{when}</Type> : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor:
              state.group === "action"
                ? theme.color.kola["600"]
                : state.group === "upcoming"
                  ? theme.color.kola["300"]
                  : theme.color.ink["300"],
          }}
        />
        <Type
          variant="caption"
          style={state.group === "action" ? { color: theme.color.kola["600"], fontWeight: "600" } : undefined}
        >
          {state.line}
        </Type>
      </View>

      {actionError ? <Notice tone="error" title={actionError} /> : null}

      {/* Exactly one of these is on screen, whichever the lifecycle points at. */}
      {viewing.status === "offered" && viewing.actions.can_confirm_slot ? (
        <ChooseTime viewing={viewing} busy={busy} run={run} />
      ) : null}

      {viewing.check_in.can_issue ? (
        <Block title="Check in">
          <Type variant="caption">Open your code when you arrive. It expires shortly after.</Type>
          <Button
            label="Open check-in"
            onPress={() =>
              router.push({ pathname: "/(app)/viewing-check-in", params: { viewingId: viewing.id } })
            }
          />
        </Block>
      ) : null}

      {viewing.attendance.can_report ? (
        <ReportAttendance viewing={viewing} busy={busy} run={run} />
      ) : null}

      {viewing.attendance.can_respond ? (
        <RespondToAttendance viewing={viewing} busy={busy} run={run} />
      ) : null}

      {viewing.attendance.state === "disputed" ? (
        <Notice
          tone="info"
          title="Attendance is disputed"
          body="Neither of you is recorded as a verified no-show. The history stays available if support needs it."
        />
      ) : null}

      {viewing.post_viewing.available ? (
        <FollowUp viewing={viewing} busy={busy} run={run} />
      ) : null}

      {/* Released only during a valid confirmed appointment. */}
      {directions ? (
        <Block title="How to find it" tone="kola">
          {[directions.house_number, directions.street].filter(Boolean).length ? (
            <Type variant="title2">
              {[directions.house_number, directions.street].filter(Boolean).join(" ")}
            </Type>
          ) : null}
          {directions.digital_address ? (
            <Type variant="caption">GhanaPost GPS: {directions.digital_address}</Type>
          ) : null}
          {[directions.building, directions.wing].filter(Boolean).length ? (
            <Type variant="caption">
              {[directions.building, directions.wing].filter(Boolean).join(" · ")}
            </Type>
          ) : null}
          {directions.entrance_note ? (
            <Type variant="caption">{directions.entrance_note}</Type>
          ) : null}
          {directions.latitude && directions.longitude ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open map directions"
              onPress={() =>
                Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${directions.latitude},${directions.longitude}`)}`,
                )
              }
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
                Open map directions →
              </Type>
            </Pressable>
          ) : null}
        </Block>
      ) : null}

      {/* Released only once a time is confirmed. */}
      {viewing.contact ? (
        <Block title={viewing.contact.role}>
          <Type variant="bodyStrong">{viewing.contact.name}</Type>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${viewing.contact.name}`}
            onPress={() => Linking.openURL(`tel:${viewing.contact?.phone}`)}
            {...pressableFeedback(theme.color.field["200"])}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
              {viewing.contact.phone} · Tap to call
            </Type>
          </Pressable>
        </Block>
      ) : null}

      {note ? (
        <View style={{ paddingLeft: space[4], borderLeftWidth: 3, borderLeftColor: theme.color.field["300"] }}>
          <Type variant="body">{note}</Type>
        </View>
      ) : null}

      {viewing.appointments.length > 1 ? (
        <Block title="Appointment history">
          {viewing.appointments.map((appointment) => (
            <Type key={appointment.id} variant="caption">
              {whenLabel(appointment.scheduled_at)} · {appointmentOutcome(appointment)}
            </Type>
          ))}
        </Block>
      ) : null}

      {mode === "reschedule" ? (
        <SuggestTime viewing={viewing} busy={busy} onBack={() => setMode("none")} run={run} />
      ) : mode === "cancel" ? (
        <CancelAppointment viewing={viewing} busy={busy} onBack={() => setMode("none")} run={run} />
      ) : mode === "withdraw" ? (
        <Block title="Withdraw this request?">
          <Type variant="caption">The landlord will be told you no longer want to arrange this viewing.</Type>
          <Button
            label="Yes, withdraw it"
            variant="destructive"
            busy={busy}
            onPress={() => run(() => respondToViewing(viewing.id, "withdraw", "No longer interested"))}
          />
          <Button label="Keep the request" variant="quiet" disabled={busy} onPress={() => setMode("none")} />
        </Block>
      ) : hasExits ? (
        <View style={{ gap: space[2] }}>
          {viewing.actions.can_reschedule ? (
            <Button label="Suggest another time" variant="quiet" disabled={busy} onPress={() => setMode("reschedule")} />
          ) : null}
          {viewing.actions.can_cancel ? (
            <Button label="Cancel this viewing" variant="quiet" disabled={busy} onPress={() => setMode("cancel")} />
          ) : null}
          {viewing.actions.can_withdraw ? (
            <Button
              label="Withdraw the request"
              variant="quiet"
              disabled={busy}
              onPress={() => setMode("withdraw")}
            />
          ) : null}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="link"
        onPress={() =>
          router.push({ pathname: "/(app)/listing/[id]", params: { id: viewing.listing_id } })
        }
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
          See the listing again →
        </Type>
      </Pressable>
    </ScrollView>
  );
}

function ChooseTime({
  viewing,
  busy,
  run,
}: {
  viewing: Viewing;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const open = viewing.slots.filter((slot) => !slot.is_past);
  if (!open.length) {
    return (
      <Notice
        tone="warning"
        title="Those times have passed"
        body="Ask the landlord for new ones, or suggest a time yourself."
      />
    );
  }
  return (
    <Block title="Pick a time" tone="kola">
      {open.map((slot) => (
        <Pressable
          key={slot.id}
          accessibilityRole="button"
          accessibilityLabel={`Confirm ${whenLabel(slot.starts_at)}`}
          disabled={busy}
          onPress={() => run(() => confirmSlot(viewing.id, slot.id))}
          {...pressableFeedback(theme.color.kola["50"])}
          style={{
            minHeight: 52,
            justifyContent: "center",
            paddingHorizontal: space[4],
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.color.kola["600"],
            backgroundColor: theme.color.field["0"],
            opacity: busy ? 0.5 : 1,
          }}
        >
          <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
            {whenLabel(slot.starts_at)}
          </Type>
          {slot.note ? <Type variant="caption">{slot.note}</Type> : null}
        </Pressable>
      ))}
      <Type variant="caption">The landlord&apos;s number is released once a time is set.</Type>
    </Block>
  );
}

function ReportAttendance({
  viewing,
  busy,
  run,
}: {
  viewing: Viewing;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <Block title="Did this viewing happen?">
      <Type variant="caption">
        Nobody checked in. Saying the landlord did not come is a report they can answer, not a
        verdict.
      </Type>
      <Field label="What happened (optional)" value={note} onChangeText={setNote} multiline maxLength={300} />
      <Button
        label="The landlord did not come"
        busy={busy}
        onPress={() => run(() => reportViewingNoShow(viewing.id, note.trim()))}
      />
    </Block>
  );
}

function RespondToAttendance({
  viewing,
  busy,
  run,
}: {
  viewing: Viewing;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <Block title="Someone reported you did not attend" tone="kola">
      <Type variant="caption">
        {viewing.attendance.report_note || "No details were given."} This is a report, not a
        verdict — your answer is recorded either way.
      </Type>
      <Field label="Your answer (optional)" value={note} onChangeText={setNote} multiline maxLength={300} />
      <Button
        label="Yes, I could not attend"
        busy={busy}
        onPress={() => run(() => respondViewingAttendance(viewing.id, "confirm", note.trim()))}
      />
      <Button
        label="No, I was there"
        variant="secondary"
        busy={busy}
        onPress={() => run(() => respondViewingAttendance(viewing.id, "dispute", note.trim()))}
      />
    </Block>
  );
}

/** After the visit — and only until a choice has been made. */
function FollowUp({
  viewing,
  busy,
  run,
}: {
  viewing: Viewing;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [reporting, setReporting] = useState(false);
  const [category, setCategory] = useState("misleading_listing");
  const [details, setDetails] = useState("");

  const choose = (action: "request_home" | "save" | "report" | "not_interested") =>
    run(() =>
      recordPostViewingAction(viewing.id, {
        action,
        ...(action === "report" ? { report_category: category, details } : {}),
      }),
    );

  if (reporting) {
    return (
      <Block title="What went wrong?">
        <Choice
          label="What happened"
          value={category}
          onChange={setCategory}
          options={[
            { value: "misleading_listing", label: "The listing was misleading" },
            { value: "wrong_unit_or_property", label: "It was a different place" },
            { value: "host_no_show", label: "Nobody came" },
            { value: "inappropriate_conduct", label: "Inappropriate conduct" },
            { value: "other", label: "Something else" },
          ]}
        />
        <Field label="Tell us what happened" value={details} onChangeText={setDetails} multiline />
        <Button label="Send report" busy={busy} onPress={() => choose("report")} />
        <Button label="Go back" variant="quiet" disabled={busy} onPress={() => setReporting(false)} />
      </Block>
    );
  }

  return (
    <Block title="How was it?" tone="kola">
      {viewing.post_viewing.can_request_home ? (
        <Button label="Apply to rent it" busy={busy} onPress={() => choose("request_home")} />
      ) : null}
      <Button label="Save for later" variant="secondary" busy={busy} onPress={() => choose("save")} />
      <Button label="Not for me" variant="quiet" busy={busy} onPress={() => choose("not_interested")} />
      <Button label="Report a problem" variant="quiet" disabled={busy} onPress={() => setReporting(true)} />
    </Block>
  );
}

function SuggestTime({
  viewing,
  busy,
  onBack,
  run,
}: {
  viewing: Viewing;
  busy: boolean;
  onBack: () => void;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  // Read once, on mount: the clock is not pure during render.
  const [day, setDay] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [time, setTime] = useState("10:00");
  return (
    <Block title="Suggest another time">
      <Type variant="caption">
        The landlord has to confirm it. The current appointment stays until they do.
      </Type>
      <Field label="Day" hint="YYYY-MM-DD" value={day} onChangeText={setDay} />
      <Field label="Time" hint="24-hour" value={time} onChangeText={setTime} />
      <Button
        label="Suggest it"
        busy={busy}
        onPress={() => {
          const startsAt = new Date(`${day}T${time}:00`);
          if (Number.isNaN(startsAt.getTime())) return;
          void run(() =>
            rescheduleViewing(viewing.id, [
              { starts_at: startsAt.toISOString(), duration_minutes: 30 },
            ]),
          );
        }}
      />
      <Button label="Keep the current time" variant="quiet" disabled={busy} onPress={onBack} />
    </Block>
  );
}

function CancelAppointment({
  viewing,
  busy,
  onBack,
  run,
}: {
  viewing: Viewing;
  busy: boolean;
  onBack: () => void;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [reason, setReason] = useState<ViewingCancellationReason>("schedule_conflict");
  const [note, setNote] = useState("");
  return (
    <Block title="Cancel this viewing">
      <Type variant="caption">
        If another time would work, suggest one instead — that keeps the appointment alive.
      </Type>
      <Choice
        label="Why"
        value={reason}
        onChange={(value) => setReason(value as ViewingCancellationReason)}
        options={[
          { value: "schedule_conflict", label: "Something else came up" },
          { value: "emergency", label: "An emergency" },
          { value: "transportation_problem", label: "I cannot get there" },
          { value: "no_longer_interested", label: "No longer interested" },
          { value: "other", label: "Another reason" },
        ]}
      />
      <Field label="Anything to add (optional)" value={note} onChangeText={setNote} multiline maxLength={300} />
      <Button
        label="Yes, cancel it"
        variant="destructive"
        busy={busy}
        onPress={() => run(() => cancelViewing(viewing.id, { reason, note: note.trim() }))}
      />
      <Button label="Keep it" variant="quiet" disabled={busy} onPress={onBack} />
    </Block>
  );
}

function Block({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "kola";
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        gap: space[2],
        padding: space[4],
        backgroundColor: tone === "kola" ? theme.color.kola["50"] : theme.color.field["50"],
        borderWidth: 1,
        borderColor: tone === "kola" ? theme.color.kola["50"] : theme.color.field["200"],
        borderRadius: 12,
      }}
    >
      <Type variant="label" accessibilityRole="header">{title.toUpperCase()}</Type>
      {children}
    </View>
  );
}

/** What became of one appointment, in the tenant's terms. */
function appointmentOutcome(appointment: Viewing["appointments"][number]): string {
  return (
    {
      confirmed: "Confirmed",
      rescheduled: "Moved",
      cancelled: appointment.cancellation_reason_display || "Cancelled",
      checked_in: "You checked in",
      attendance_pending: "Attendance queried",
      completed: "Happened",
      tenant_no_show: "Recorded as not attended",
      host_no_show: "The landlord did not come",
      disputed: "Disputed",
    }[appointment.status] ?? appointment.status
  );
}
