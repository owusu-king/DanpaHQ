import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, Linking, StyleSheet, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import {
  ActionBar,
  EDGE,
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
  type RecordTone,
} from "@/components/record/RecordSurfaces";
import { TimeOffer } from "@/components/record/TimeOffer";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Choice, Field, Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
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

type Mode = "none" | "reschedule" | "cancel" | "withdraw";

/**
 * One viewing, and only what the lifecycle makes relevant right now.
 *
 * The rule this screen exists to hold: a control appears when it can be used
 * and disappears when it cannot. The check-in code is not here the day before;
 * the exact directions are not here until the backend releases them; the
 * follow-up actions are not here once a follow-up has been chosen.
 *
 * The backend decides all of that — `actions`, `check_in`, `attendance`,
 * `post_viewing` and `viewing_directions` are computed per-reader on the
 * server. This screen renders what it is handed and re-derives none of it.
 *
 * Refined on review (2026-09-21): the appointment leads as one card — the place
 * it is at, the time it is, and where it stands. What the lifecycle offers
 * follows as a single zone. The three ways out stopped being three quiet
 * buttons stacked under the page and became one "Change or cancel", because
 * rescheduling, cancelling and withdrawing are one question asked three ways.
 * Choosing one gives the page over to it, so a decision is made on its own.
 */
export default function ViewingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [exits, setExits] = useState(false);
  const [mode, setMode] = useState<Mode>("none");
  // With a bar under it the page ends above the bar, and the bar keeps the
  // clearance. Without one the page itself must not run under the navigation.
  const openBottom = useSafeBottom(space[8]);

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

  /** A sheet row must put the sheet away before it takes the page. */
  function choose(next: Mode) {
    setExits(false);
    setMode(next);
  }

  if (missing) {
    return (
      <View style={{ padding: space[5] }}>
        <Notice tone="error" title={loadError || "We could not find that viewing."} />
      </View>
    );
  }
  if (!viewing) return <ViewingSkeleton />;

  const state = standing(viewing);
  const when = whenLabel(viewing.confirmed_starts_at);
  const tone: RecordTone = state.group === "action" ? "action" : state.group === "upcoming" ? "good" : "quiet";
  const note = viewing.response_note || viewing.cancellation_note || viewing.outcome_note;
  const directions = viewing.viewing_directions;
  const hasExits =
    viewing.actions.can_reschedule || viewing.actions.can_cancel || viewing.actions.can_withdraw;
  const focused = mode !== "none";
  const barShown = !focused && (viewing.check_in.can_issue || hasExits);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: barShown ? space[6] : openBottom }]}>
        <RecordPanel>
          <View style={styles.identity}>
            <Shot uri={viewing.photo_url} />
            <View style={styles.identityBody}>
              <Type variant="bodyStrong" numberOfLines={2} style={styles.headline}>{viewing.listing_headline}</Type>
              <Type variant="caption" numberOfLines={1} style={styles.place}>{placeOf(viewing) || "Ghana"}</Type>
            </View>
          </View>
          <View style={styles.rule} />
          <Lead
            label={state.group === "past" ? "This viewing" : "Your viewing"}
            value={when ?? "No time set yet"}
            note={state.line}
            tone={tone}
          />
        </RecordPanel>

        {actionError ? <Notice tone="error" title={actionError} /> : null}

        {focused ? (
          mode === "reschedule" ? (
            <TimeOffer
              title="Suggest another time"
              verb="Suggest"
              replacing={viewing.slots.map((slot) => slot.starts_at)}
              busy={busy}
              backLabel="Keep the current time"
              onBack={() => setMode("none")}
              onSubmit={(slots) => void run(() => rescheduleViewing(viewing.id, slots))}
            />
          ) : mode === "cancel" ? (
            <CancelAppointment viewing={viewing} busy={busy} onBack={() => setMode("none")} run={run} />
          ) : mode === "withdraw" ? (
            <Withdraw viewing={viewing} busy={busy} onBack={() => setMode("none")} run={run} />
          ) : null
        ) : (
          <>
            {/* Exactly one of these is on screen, whichever the lifecycle points at. */}
            {viewing.status === "offered" && viewing.actions.can_confirm_slot ? (
              <ChooseTime viewing={viewing} busy={busy} run={run} />
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

            {/* Released only during a valid confirmed appointment, and only by
                the server — never inferred from the status here. */}
            {directions ? (
              <View style={styles.section}>
                <GroupLabel>How to find it</GroupLabel>
                <RecordPanel>
                  {[directions.house_number, directions.street].filter(Boolean).length ? (
                    <Fact first label="Address" value={[directions.house_number, directions.street].filter(Boolean).join(" ")} />
                  ) : null}
                  {directions.digital_address ? (
                    <Fact label="GhanaPost GPS" value={directions.digital_address} />
                  ) : null}
                  {directions.wing ? <Fact label="Block or wing" value={directions.wing} /> : null}
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
            ) : null}

            {/* Released only once a time is confirmed. */}
            {viewing.contact ? (
              <View style={styles.section}>
                <GroupLabel>{viewing.contact.role}</GroupLabel>
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

            {note ? <Quote>{note}</Quote> : null}

            {viewing.appointments.length > 1 ? (
              <View style={styles.section}>
                <GroupLabel>Appointment history</GroupLabel>
                <RecordPanel>
                  {viewing.appointments.map((appointment, index) => (
                    <Fact
                      key={appointment.id}
                      first={index === 0}
                      label={whenLabel(appointment.scheduled_at) ?? "Not scheduled"}
                      value={appointmentOutcome(appointment)}
                    />
                  ))}
                </RecordPanel>
              </View>
            ) : null}

            <RecordPanel>
              <LinkRow
                first
                icon="home-outline"
                label="See the listing again"
                onPress={() => router.push({ pathname: "/(app)/listing/[id]", params: { id: viewing.listing_id } })}
              />
            </RecordPanel>
          </>
        )}
      </ScrollView>

      {barShown ? (
        <ActionBar>
          {viewing.check_in.can_issue ? (
            <Pill
              grow
              icon="qr-code-outline"
              label="Open check-in"
              onPress={() => router.push({ pathname: "/(app)/viewing-check-in", params: { viewingId: viewing.id } })}
            />
          ) : null}
          {hasExits ? (
            <View style={viewing.check_in.can_issue ? null : styles.soleAct}>
              <QuietAct icon="swap-horizontal-outline" label="Change or cancel" onPress={() => setExits(true)} />
            </View>
          ) : null}
        </ActionBar>
      ) : null}

      <BottomSheet
        visible={exits}
        onClose={() => setExits(false)}
        title="Change or cancel"
        closeLabel="Close options"
      >
        <View style={styles.sheetBody}>
          <RecordPanel>
            {viewing.actions.can_reschedule ? (
              <LinkRow
                first
                icon="time-outline"
                label="Suggest another time"
                detail="The current appointment stays until the landlord confirms."
                onPress={() => choose("reschedule")}
              />
            ) : null}
            {viewing.actions.can_cancel ? (
              <LinkRow
                first={!viewing.actions.can_reschedule}
                icon="close-circle-outline"
                tone="alert"
                label="Cancel this viewing"
                detail="Ends the appointment. Suggesting a time keeps it alive."
                onPress={() => choose("cancel")}
              />
            ) : null}
            {viewing.actions.can_withdraw ? (
              <LinkRow
                first={!viewing.actions.can_reschedule && !viewing.actions.can_cancel}
                icon="return-down-back-outline"
                tone="alert"
                label="Withdraw the request"
                detail="Tells the landlord you no longer want to arrange this."
                onPress={() => choose("withdraw")}
              />
            ) : null}
          </RecordPanel>
        </View>
      </BottomSheet>
    </View>
  );
}

/** The times the landlord offered, each one a tap away from being the appointment. */
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
    <View style={styles.section}>
      <GroupLabel>Pick a time</GroupLabel>
      <RecordPanel>
        {open.map((slot, index) => (
          <LinkRow
            key={slot.id}
            first={index === 0}
            icon="calendar-outline"
            tone="action"
            label={whenLabel(slot.starts_at) ?? "A time"}
            detail={slot.note || undefined}
            onPress={() => { if (!busy) void run(() => confirmSlot(viewing.id, slot.id)); }}
          />
        ))}
      </RecordPanel>
      <Footnote>The landlord&apos;s number is released once a time is set.</Footnote>
    </View>
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
    <View style={styles.section}>
      <GroupLabel>Did this viewing happen?</GroupLabel>
      <RecordPanel style={styles.formPanel}>
        <Type variant="caption" style={styles.formNote}>
          Nobody checked in. Saying the landlord did not come is a report they can answer, not a
          verdict.
        </Type>
        <Field label="What happened (optional)" value={note} onChangeText={setNote} multiline maxLength={300} />
        <Pill
          grow
          label="The landlord did not come"
          busy={busy}
          busyLabel="Reporting…"
          onPress={() => run(() => reportViewingNoShow(viewing.id, note.trim()))}
        />
      </RecordPanel>
    </View>
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
    <View style={styles.section}>
      <GroupLabel>Someone reported you did not attend</GroupLabel>
      <RecordPanel style={styles.formPanel}>
        <Type variant="caption" style={styles.formNote}>
          {viewing.attendance.report_note || "No details were given."} This is a report, not a
          verdict — your answer is recorded either way.
        </Type>
        <Field label="Your answer (optional)" value={note} onChangeText={setNote} multiline maxLength={300} />
        {/* Two answers to a question of fact, drawn with equal weight. A page
            that makes one of them the filled button is nudging somebody towards
            an account of what happened, which is not this screen's business. */}
        <View style={styles.formActions}>
          <Pill
            grow
            tone="quiet"
            label="No, I was there"
            busy={busy}
            busyLabel="Sending…"
            onPress={() => run(() => respondViewingAttendance(viewing.id, "dispute", note.trim()))}
          />
          <Pill
            grow
            tone="quiet"
            label="Yes, I could not"
            busy={busy}
            busyLabel="Sending…"
            onPress={() => run(() => respondViewingAttendance(viewing.id, "confirm", note.trim()))}
          />
        </View>
      </RecordPanel>
    </View>
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
      <View style={styles.section}>
        <GroupLabel>What went wrong?</GroupLabel>
        <RecordPanel style={styles.formPanel}>
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
          <Pill grow label="Send report" busy={busy} busyLabel="Sending…" onPress={() => choose("report")} />
          <QuietAct label="Go back" disabled={busy} onPress={() => setReporting(false)} />
        </RecordPanel>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <GroupLabel>How was it?</GroupLabel>
      <RecordPanel style={styles.formPanel}>
        {viewing.post_viewing.can_request_home ? (
          <Pill grow icon="key-outline" label="Apply to rent it" busy={busy} busyLabel="Opening…" onPress={() => choose("request_home")} />
        ) : null}
        <View style={styles.quietRow}>
          <QuietAct icon="bookmark-outline" label="Save for later" disabled={busy} onPress={() => choose("save")} />
          <QuietAct icon="close-outline" label="Not for me" disabled={busy} onPress={() => choose("not_interested")} />
        </View>
        <QuietAct icon="flag-outline" label="Report a problem" disabled={busy} onPress={() => setReporting(true)} />
      </RecordPanel>
    </View>
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
    <View style={styles.section}>
      <GroupLabel>Cancel this viewing</GroupLabel>
      <RecordPanel style={styles.formPanel}>
        <Type variant="caption" style={styles.formNote}>
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
        <Pill
          grow
          tone="danger"
          label="Yes, cancel it"
          busy={busy}
          busyLabel="Cancelling…"
          onPress={() => run(() => cancelViewing(viewing.id, { reason, note: note.trim() }))}
        />
        <QuietAct label="Keep it" disabled={busy} onPress={onBack} />
      </RecordPanel>
    </View>
  );
}

function Withdraw({
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
  return (
    <View style={styles.section}>
      <GroupLabel>Withdraw this request?</GroupLabel>
      <RecordPanel style={styles.formPanel}>
        <Type variant="caption" style={styles.formNote}>
          The landlord will be told you no longer want to arrange this viewing.
        </Type>
        <Pill
          grow
          tone="danger"
          label="Yes, withdraw it"
          busy={busy}
          busyLabel="Withdrawing…"
          onPress={() => run(() => respondToViewing(viewing.id, "withdraw", "No longer interested"))}
        />
        <QuietAct label="Keep the request" disabled={busy} onPress={onBack} />
      </RecordPanel>
    </View>
  );
}

/** The place, at the size a thumb recognizes rather than explores. */
function Shot({ uri }: { uri: string | null }) {
  return (
    <View style={styles.shot}>
      {uri ? (
        <Image source={{ uri }} accessible={false} resizeMode="cover" style={styles.shotImage} />
      ) : (
        <Ionicons name="image-outline" size={20} color={theme.color.ink["300"]} />
      )}
    </View>
  );
}

/** Shaped like the card it becomes, so nothing jumps when the viewing arrives. */
function ViewingSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading this viewing" style={styles.page}>
      <RecordPanel style={styles.skeletonPanel}>
        <View style={styles.identity}>
          <Bone width={64} height={64} round={12} />
          <View style={styles.skeletonLines}>
            <Bone width="78%" height={15} />
            <Bone width="46%" />
          </View>
        </View>
        <Bone width="54%" height={28} />
        <Bone width="66%" />
      </RecordPanel>
      <RecordPanel style={styles.skeletonPanel}>
        <Bone width="40%" height={12} />
        <Bone height={44} round={12} />
      </RecordPanel>
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  page: {
    padding: space[4],
    paddingBottom: space[10],
    gap: space[4],
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[4],
  },
  identityBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headline: {
    fontSize: 15,
    lineHeight: 20,
  },
  place: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: space[4],
    backgroundColor: EDGE,
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
  quietRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[4],
  },
  soleAct: {
    flex: 1,
    alignItems: "center",
  },
  sheetBody: {
    gap: space[3],
  },
  shot: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["100"],
  },
  shotImage: {
    width: "100%",
    height: "100%",
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
  skeletonLines: {
    flex: 1,
    gap: space[2],
  },
});
