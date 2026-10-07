import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, StyleSheet, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { EntityHeader, LoadingRows, StatusLine, type StatusTone } from "@/components/property/WorkspacePatterns";
import {
  ActionBar,
  Fact,
  Footnote,
  GroupLabel,
  Lead,
  LinkRow,
  MUTED,
  Pill,
  Quote,
  QuietAct,
  RecordPanel,
} from "@/components/record/RecordSurfaces";
import { TimeOffer } from "@/components/record/TimeOffer";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Choice, Field, Notice, Type, space } from "@/components/ui";
import { destructiveConfirmStyle, useSafeBottom } from "@/platform";
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

type Mode = "idle" | "offer" | "reschedule" | "cancel";

/**
 * One viewing, from the side that has to answer it.
 *
 * The tenant's record asks "what do I do now"; this one asks "what does this
 * person need from me". So the one act the lifecycle is waiting on sits in the
 * bar under the thumb, and everything that merely *could* be done — offering
 * another time, cancelling, declining — waits inside one "Change or cancel".
 *
 * Refined on review (2026-09-21) onto the record surfaces: paper panels on the
 * warm ground the pushed screens keep, replacing seven stacked buttons and a
 * column of bare label/value rows.
 */
export default function ProviderViewingScreen() {
  const { viewingId } = useLocalSearchParams<{ viewingId: string }>();
  const router = useRouter();
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exits, setExits] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  // Without a bar the page itself must clear Android's navigation buttons.
  const openBottom = useSafeBottom(space[8]);

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

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setActionError("");
    try {
      await work();
      setMode("idle");
      await load();
    } catch (cause) {
      setActionError(cause instanceof ApiFailure ? cause.error.message : "That action did not work.");
    } finally {
      setBusy(false);
    }
  }

  /** A sheet row puts the sheet away before it takes the page. */
  function choose(next: Mode) {
    setExits(false);
    setMode(next);
  }

  if (!viewing) {
    return (
      <View style={{ padding: space[5] }}>
        {error ? <Notice tone="error" title={error} body="Return to Viewings and try again." /> : <LoadingRows rows={5} />}
      </View>
    );
  }

  const summary = viewingSummary(viewing);
  const focused = mode !== "idle";
  // Every change is the backend's to allow. A confirmed Viewing used to offer
  // "Offer different times" and "Cancel appointment" whatever the server said —
  // after it had passed, say — and both were refused only once pressed
  // (owner, 2026-10-06).
  const canOffer = Boolean(viewing.actions.can_decline);
  const canReschedule = viewing.status === "confirmed" && Boolean(viewing.actions.can_reschedule);
  const canCancel = Boolean(viewing.actions.can_cancel);
  const hasExits = canOffer || canReschedule || canCancel;
  const primary = primaryAct(viewing);
  const barShown = !focused && (Boolean(primary) || hasExits);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.page, { paddingBottom: barShown ? space[6] : openBottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <EntityHeader
          eyebrow="Viewing with"
          title={viewing.tenant_name}
          subtitle={viewing.listing_headline}
          status={<StatusLine label={summary.label} tone={summary.tone} />}
        />

        {error ? <Notice tone="error" title={error} body="Some information may be out of date. Try again." /> : null}
        {actionError ? <Notice tone="error" title={actionError} /> : null}

        {focused ? (
          mode === "cancel" ? (
            <CancelAppointmentForm busy={busy} onBack={() => setMode("idle")} onSubmit={(input) => run(() => cancelViewing(viewing.id, input))} />
          ) : (
            <TimeOffer
              title={mode === "reschedule" ? "Offer a different time" : "Offer a viewing time"}
              verb="Offer"
              replacing={viewing.slots.map((slot) => slot.starts_at)}
              busy={busy}
              backLabel="Not now"
              onBack={() => setMode("idle")}
              onSubmit={(slots) =>
                void run(() => mode === "reschedule" ? rescheduleViewing(viewing.id, slots) : offerViewingSlots(viewing.id, { slots }))
              }
            />
          )
        ) : (
          <>
            {viewing.confirmed_starts_at ? (
              <RecordPanel>
                {/* What the time is to the Viewing now: ahead, happened, or did not. */}
                <Lead label={timeLabel(viewing)} value={formatSlot(viewing.confirmed_starts_at)} />
              </RecordPanel>
            ) : null}

            {/* The tenant suggested times: confirming one becomes the appointment. */}
            {viewing.status === "offered" && viewing.actions.can_confirm_slot ? (
              <ReplacementTimes viewing={viewing} busy={busy} run={run} />
            ) : null}

            {/* The times *this* provider put forward. Without them the record
                showed only "offer a time", so the landlord could not see what
                was already on the table — or what re-offering would replace. */}
            {viewing.status === "offered" && !viewing.actions.can_confirm_slot && viewing.slots.length ? (
              <View style={styles.section}>
                <GroupLabel>Times you offered</GroupLabel>
                <RecordPanel>
                  {viewing.slots.map((slot, index) => (
                    <Fact
                      key={slot.id}
                      first={index === 0}
                      label={formatSlot(slot.starts_at)}
                      value={slot.is_past ? "Passed" : "Waiting"}
                      tone={slot.is_past ? "quiet" : "waiting"}
                    />
                  ))}
                </RecordPanel>
                <Footnote>
                  {`${viewing.tenant_name.split(" ")[0]} picks one of these and it becomes the appointment. Offering again replaces them.`}
                </Footnote>
              </View>
            ) : null}

            <Attendance viewing={viewing} busy={busy} run={run} />

            {viewing.status === "confirmed" && !viewing.check_in.can_validate ? (
              <Footnote>
                {viewing.check_in.opens_at
                  ? `Check-in opens ${formatSlot(viewing.check_in.opens_at)}. Ask the tenant to show their code when they arrive.`
                  : "Ask the tenant to show their temporary QR or six-digit code when they arrive."}
              </Footnote>
            ) : null}

            {viewing.message ? <Quote>{viewing.message}</Quote> : null}

            {viewing.contact ? (
              <View style={styles.section}>
                <GroupLabel>Contact</GroupLabel>
                <RecordPanel>
                  <LinkRow
                    first
                    icon="call-outline"
                    tone="action"
                    label={viewing.contact.name}
                    detail={`${viewing.contact.phone} · tap to call`}
                    onPress={() => Linking.openURL(`tel:${viewing.contact?.phone}`)}
                  />
                </RecordPanel>
              </View>
            ) : null}

            <View style={styles.section}>
              <GroupLabel>The request</GroupLabel>
              <RecordPanel>
                <Fact first label="Property" value={viewing.listing_headline} />
                <Fact label="Location" value={[viewing.locality_name, viewing.landmark].filter(Boolean).join(" · ") || "Not recorded"} />
                {viewing.rent_formatted ? <Fact label="Rent" value={`${viewing.rent_formatted} per month`} /> : null}
                <Fact label="Requested" value={formatSlot(viewing.created_at)} />
                {viewing.availability_note ? <Fact wide label="Tenant availability" value={viewing.availability_note} /> : null}
              </RecordPanel>
              {!viewing.confirmed_starts_at && viewing.actions.can_decline ? (
                <Footnote>
                  Offer a time and {viewing.tenant_name.split(" ")[0]} confirms one — that becomes the appointment.
                  Rooomly Viewings are free, and a tenant is never charged to attend.
                </Footnote>
              ) : null}
            </View>

            {viewing.viewing_directions ? <Directions viewing={viewing} /> : null}

            {viewing.response_note || viewing.cancellation_reason_display || viewing.outcome_note ? (
              <View style={styles.section}>
                <GroupLabel>Outcome</GroupLabel>
                <RecordPanel>
                  {viewing.response_note ? <Fact first label="Response" value={viewing.response_note} /> : null}
                  {viewing.cancellation_reason_display ? (
                    <Fact first={!viewing.response_note} label="Cancellation" value={viewing.cancellation_reason_display} />
                  ) : null}
                  {viewing.cancellation_note ? <Fact label="Note" value={viewing.cancellation_note} /> : null}
                  {viewing.outcome_note ? <Fact label="Outcome" value={viewing.outcome_note} /> : null}
                </RecordPanel>
              </View>
            ) : null}

            {viewing.appointments.length ? (
              <View style={styles.section}>
                <GroupLabel>Appointment history</GroupLabel>
                <RecordPanel>
                  {viewing.appointments.map((appointment, index) => (
                    <Fact
                      key={appointment.id}
                      first={index === 0}
                      label={formatSlot(appointment.scheduled_at)}
                      value={appointment.status.replaceAll("_", " ")}
                    />
                  ))}
                </RecordPanel>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {barShown ? (
        <ActionBar>
          {primary ? (
            <Pill
              grow
              icon={primary.icon}
              label={primary.label}
              busy={busy}
              busyLabel="Working…"
              onPress={() => {
                if (primary.kind === "check-in") {
                  router.push({ pathname: "/(app)/provider-viewing-check-in", params: { viewingId: viewing.id } });
                } else if (primary.kind === "complete") {
                  void run(() => recordProviderViewingOutcome(viewing.id, "completed"));
                } else {
                  setMode("offer");
                }
              }}
            />
          ) : null}
          {hasExits ? (
            <View style={primary ? null : styles.soleAct}>
              <QuietAct icon="swap-horizontal-outline" label="Change or cancel" onPress={() => setExits(true)} />
            </View>
          ) : null}
        </ActionBar>
      ) : null}

      <BottomSheet visible={exits} onClose={() => setExits(false)} title="Change or cancel" closeLabel="Close options">
        <View style={styles.sheetBody}>
          <RecordPanel>
            {canReschedule || canOffer ? (
              <LinkRow
                first
                icon="time-outline"
                label="Offer different times"
                detail="The tenant confirms one, and that becomes the appointment."
                onPress={() => choose(canReschedule ? "reschedule" : "offer")}
              />
            ) : null}
            {canCancel ? (
              <LinkRow
                first={!(canReschedule || canOffer)}
                icon="close-circle-outline"
                tone="alert"
                label="Cancel appointment"
                detail="Rescheduling keeps the Viewing alive. Cancel only when it should not go ahead."
                onPress={() => choose("cancel")}
              />
            ) : null}
            {canOffer ? (
              <LinkRow
                icon="ban-outline"
                tone="alert"
                label="Decline request"
                detail="Tells the tenant this Viewing will not go ahead."
                onPress={() => {
                  setExits(false);
                  Alert.alert(
                    "Decline this request?",
                    "The tenant will be told that this Viewing will not go ahead.",
                    [
                      { text: "Keep request", style: "cancel" },
                      {
                        text: "Decline",
                        style: destructiveConfirmStyle,
                        onPress: () => void run(() => respondToViewing(viewing.id, "decline", "Not available")),
                      },
                    ],
                  );
                }}
              />
            ) : null}
          </RecordPanel>
        </View>
      </BottomSheet>
    </View>
  );
}

/**
 * What the appointment's time is to it now. A completed Viewing used to read
 * "Scheduled" for a date that had passed (owner, 2026-10-06).
 */
function timeLabel(viewing: Viewing): string {
  if (viewing.status === "completed" || viewing.status === "checked_in") return "Took place";
  if (viewing.status === "cancelled") return "Was booked for";
  if (["tenant_no_show", "host_no_show", "attendance_pending", "disputed"].includes(viewing.status)) return "Was booked for";
  return "Scheduled";
}

/** The one act the lifecycle is waiting on, if there is one. */
function primaryAct(viewing: Viewing): { kind: "offer" | "check-in" | "complete"; label: string; icon: "time-outline" | "qr-code-outline" | "checkmark-done-outline" } | null {
  if (viewing.status === "checked_in" && viewing.actions.can_complete !== false) {
    return { kind: "complete", label: "Mark Viewing completed", icon: "checkmark-done-outline" };
  }
  if (viewing.status === "confirmed" && viewing.check_in.can_validate) {
    return { kind: "check-in", label: "Scan QR or enter code", icon: "qr-code-outline" };
  }
  if (viewing.actions.can_decline) {
    return { kind: "offer", label: viewing.status === "offered" ? "Offer different times" : "Offer a time", icon: "time-outline" };
  }
  return null;
}

/** Times the tenant put forward, each a tap from becoming the appointment. */
function ReplacementTimes({
  viewing,
  busy,
  run,
}: {
  viewing: Viewing;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const available = viewing.slots.filter((slot) => !slot.is_past);
  return (
    <View style={styles.section}>
      <GroupLabel>Times the tenant suggested</GroupLabel>
      {available.length ? (
        <RecordPanel>
          {available.map((slot, index) => (
            <LinkRow
              key={slot.id}
              first={index === 0}
              icon="calendar-outline"
              tone="action"
              label={formatSlot(slot.starts_at)}
              detail={slot.note || undefined}
              onPress={() => { if (!busy) void run(() => confirmSlot(viewing.id, slot.id)); }}
            />
          ))}
        </RecordPanel>
      ) : (
        <Notice tone="info" title="Those times have passed" body="Offer another time to keep the Viewing moving." />
      )}
    </View>
  );
}

/**
 * Attendance, which is a report until the other side answers it.
 *
 * A missing check-in does not prove who was absent, so nothing here is phrased
 * as a verdict and the reported party always gets an answer.
 */
function Attendance({
  viewing,
  busy,
  run,
}: {
  viewing: Viewing;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [note, setNote] = useState("");

  if (viewing.attendance.state === "disputed") {
    return (
      <Notice
        tone="info"
        title="Attendance is disputed"
        body="No party is treated as a verified no-show. The evidence remains available for support review."
      />
    );
  }

  if (viewing.attendance.state === "pending") {
    if (!viewing.attendance.can_respond) {
      return (
        <Notice
          tone="info"
          title="Attendance report awaiting response"
          body="This is not a verified no-show until the reported party responds."
        />
      );
    }
    return (
      <View style={styles.section}>
        <GroupLabel>A report is waiting on you</GroupLabel>
        <RecordPanel style={styles.formPanel}>
          <Type variant="caption" style={styles.formNote}>
            {viewing.attendance.report_note || "No details were given."} Your answer is recorded either way.
          </Type>
          <Field label="Optional response note" value={note} onChangeText={setNote} multiline />
          <View style={styles.formActions}>
            <Pill
              grow
              tone="quiet"
              label="Dispute report"
              busy={busy}
              busyLabel="Sending…"
              onPress={() => run(() => respondViewingAttendance(viewing.id, "dispute", note))}
            />
            <Pill
              grow
              tone="quiet"
              label="I could not attend"
              busy={busy}
              busyLabel="Sending…"
              onPress={() => run(() => respondViewingAttendance(viewing.id, "confirm", note))}
            />
          </View>
        </RecordPanel>
      </View>
    );
  }

  if (!viewing.attendance.can_report) return null;

  return (
    <View style={styles.section}>
      <GroupLabel>Nobody checked in</GroupLabel>
      <RecordPanel style={styles.formPanel}>
        <Type variant="caption" style={styles.formNote}>
          A missing check-in does not prove who was absent. The tenant can confirm or dispute your report.
        </Type>
        <Field label="Optional factual note" value={note} onChangeText={setNote} multiline />
        <Pill
          grow
          tone="quiet"
          label="Report tenant absent"
          busy={busy}
          busyLabel="Reporting…"
          onPress={() => run(() => reportViewingNoShow(viewing.id, note))}
        />
      </RecordPanel>
    </View>
  );
}

function CancelAppointmentForm({
  busy,
  onBack,
  onSubmit,
}: {
  busy: boolean;
  onBack: () => void;
  onSubmit: (input: { reason: ViewingCancellationReason; note?: string }) => Promise<void>;
}) {
  const [reason, setReason] = useState<ViewingCancellationReason>("schedule_conflict");
  const [note, setNote] = useState("");
  return (
    <View style={styles.section}>
      <GroupLabel>Cancel appointment</GroupLabel>
      <RecordPanel style={styles.formPanel}>
        <Type variant="caption" style={styles.formNote}>
          Could a different time work? Rescheduling keeps the Viewing alive.
        </Type>
        <Choice
          label="Reason"
          value={reason}
          onChange={(value) => setReason(value as ViewingCancellationReason)}
          options={[
            { value: "schedule_conflict", label: "Schedule conflict" },
            { value: "emergency", label: "Emergency" },
            { value: "transportation_problem", label: "Transportation problem" },
            { value: "no_longer_interested", label: "No longer interested" },
            { value: "property_unavailable", label: "Property or Unit unavailable" },
            { value: "other", label: "Other" },
          ]}
        />
        <Field label="Optional note" value={note} onChangeText={setNote} multiline />
        <Pill grow tone="danger" label="Cancel appointment" busy={busy} busyLabel="Cancelling…" onPress={() => void onSubmit({ reason, note })} />
        <QuietAct label="Keep appointment" disabled={busy} onPress={onBack} />
      </RecordPanel>
    </View>
  );
}

function Directions({ viewing }: { viewing: Viewing }) {
  const directions = viewing.viewing_directions!;
  const address = [directions.house_number, directions.street].filter(Boolean).join(" ");
  return (
    <View style={styles.section}>
      <GroupLabel>Directions</GroupLabel>
      <RecordPanel>
        {address ? <Fact first label="Address" value={address} /> : null}
        {directions.digital_address ? <Fact first={!address} label="GhanaPost GPS" value={directions.digital_address} /> : null}
        {directions.entrance_note ? <Fact wide label="Entrance" value={directions.entrance_note} /> : null}
        {directions.latitude && directions.longitude ? (
          <LinkRow
            icon="navigate-outline"
            tone="action"
            label="Open map directions"
            onPress={() =>
              Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${directions.latitude},${directions.longitude}`)}`,
              )
            }
          />
        ) : null}
      </RecordPanel>
    </View>
  );
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  page: {
    padding: space[4],
    paddingBottom: space[10],
    gap: space[4],
  },
  section: {
    gap: space[2],
  },
  formPanel: {
    gap: space[3],
    padding: space[4],
  },
  formNote: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  formActions: {
    flexDirection: "row",
    gap: space[2],
  },
  soleAct: {
    flex: 1,
    alignItems: "center",
  },
  sheetBody: {
    gap: space[3],
  },
});
