"use client";

import Link from "next/link";
import { useState } from "react";
import QRCode from "react-qr-code";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { ViewingDirections } from "@/components/viewings/ViewingDirections";
import { ApiFailure } from "@/lib/api";
import {
  cancelMyViewing,
  confirmMyViewingSlot,
  issueViewingCheckInCredential,
  recordPostViewingAction,
  reportMyViewingNoShow,
  rescheduleMyViewing,
  respondMyViewingAttendance,
  withdrawMyViewing,
  type MyViewing,
  type ViewingCheckInCredential,
} from "@/lib/tenant";
import { placeOf, standing, whenLabel } from "@/lib/viewingMeaning";

/**
 * One viewing, and only what the lifecycle makes relevant right now.
 *
 * A full workspace record beside the schedule on wide screens and one pane on
 * narrow screens. This is not a modal: the lifecycle can ask for several
 * decisions, forms and pieces of released context, which makes it resumable
 * work rather than a quick interruption.
 *
 * The rule this holds: a control appears when it can be used and disappears
 * when it cannot. The check-in QR is not here the day before; the exact
 * directions are not here until the backend releases them; the follow-up is not
 * here once a follow-up has been chosen; cancel is not here once there is
 * nothing to cancel. `actions`, `check_in`, `attendance`, `post_viewing` and
 * `viewing_directions` are all computed per-reader on the server — this
 * re-derives none of it.
 */
export function ViewingRecord({
  viewing,
  onChanged,
}: {
  viewing: MyViewing;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"none" | "reschedule" | "cancel" | "withdraw">("none");

  // A pane had to reset itself when a different viewing arrived in it. A page
  // is mounted fresh for the one it is about.

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      setMode("none");
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const state = standing(viewing);
  const when = whenLabel(viewing.confirmed_starts_at ?? null);
  const note = viewing.response_note || viewing.cancellation_note || viewing.outcome_note;
  const hasExits = Boolean(
    viewing.actions.can_reschedule || viewing.actions.can_cancel || viewing.actions.can_withdraw,
  );

  return (
    <div className="viewing-record">
          <header className="viewing-record-head">
            <span className="viewing-record-photo">
              {viewing.photo_url ? (
                /* Short-lived signed URLs from the files service. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={viewing.photo_url} alt="" />
              ) : null}
            </span>
            <div>
              <h2>{viewing.listing_headline}</h2>
              <p className="type-caption">{placeOf(viewing) || "Ghana"}</p>
              {when ? <p className="viewing-when-big">{when}</p> : null}
              <p className={`viewing-standing is-${state.group}`}>
                <i aria-hidden="true" />{state.line}
              </p>
            </div>
          </header>

          <div className="viewing-record-body">
            {error ? <Notice tone="error" title={error} /> : null}

            {/* Exactly one of these, whichever the lifecycle points at. */}
            {viewing.status === "offered" && viewing.actions.can_confirm_slot ? (
              <ChooseTime viewing={viewing} busy={busy} run={run} />
            ) : null}

            {viewing.check_in.can_issue ? <CheckIn viewing={viewing} /> : null}

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

            {viewing.viewing_directions ? (
              <ViewingDirections directions={viewing.viewing_directions} />
            ) : null}

            {viewing.contact ? (
              <section className="viewing-contact">
                <h3>{viewing.contact.role}</h3>
                <p>
                  {viewing.contact.name} ·{" "}
                  <a href={`tel:${viewing.contact.phone}`}>{viewing.contact.phone}</a>
                </p>
              </section>
            ) : null}

            {note ? <p className="viewing-note">{note}</p> : null}

            {viewing.appointments.length > 1 ? (
              <details className="viewing-history">
                <summary>Appointment history ({viewing.appointments.length})</summary>
                <ul>
                  {viewing.appointments.map((appointment) => (
                    <li key={appointment.id}>
                      <strong>{whenLabel(appointment.scheduled_at)}</strong>
                      <span> · {appointmentOutcome(appointment)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {mode === "reschedule" ? (
              <SuggestTime viewing={viewing} busy={busy} onBack={() => setMode("none")} run={run} />
            ) : mode === "cancel" ? (
              <CancelAppointment viewing={viewing} busy={busy} onBack={() => setMode("none")} run={run} />
            ) : mode === "withdraw" ? (
              <section className="viewing-action">
                <h3>Withdraw this request?</h3>
                <p className="type-caption">The landlord will be told you no longer want to arrange this viewing.</p>
                <div className="viewing-exits">
                  <Button
                    variant="destructive"
                    busy={busy}
                    onClick={() => void run(() => withdrawMyViewing(viewing.id, "No longer interested"))}
                  >Yes, withdraw it</Button>
                  <Button variant="quiet" disabled={busy} onClick={() => setMode("none")}>Keep the request</Button>
                </div>
              </section>
            ) : hasExits ? (
              <div className="viewing-exits">
                {viewing.actions.can_reschedule ? (
                  <Button variant="quiet" disabled={busy} onClick={() => setMode("reschedule")}>
                    Suggest another time
                  </Button>
                ) : null}
                {viewing.actions.can_cancel ? (
                  <Button variant="quiet" disabled={busy} onClick={() => setMode("cancel")}>
                    Cancel this viewing
                  </Button>
                ) : null}
                {viewing.actions.can_withdraw ? (
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => setMode("withdraw")}
                  >
                    Withdraw the request
                  </Button>
                ) : null}
              </div>
            ) : null}

            <p className="viewing-listing-link">
              <Link href={`/listings/${viewing.listing_id}`}>See the listing again →</Link>
            </p>
          </div>
    </div>
  );
}

function ChooseTime({
  viewing,
  busy,
  run,
}: {
  viewing: MyViewing;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
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
    <section className="viewing-action is-primary">
      <h3>Pick a time</h3>
      <div className="viewing-slots">
        {open.map((slot) => (
          <label key={slot.id} className={selected === slot.id ? "is-selected" : undefined}>
            <input
              type="radio"
              name="viewing-slot"
              value={slot.id}
              checked={selected === slot.id}
              onChange={() => setSelected(slot.id)}
              className="control-input"
            />
            <span aria-hidden className="control-box control-box-radio" />
            <span>
              <strong>{whenLabel(slot.starts_at)}</strong>
              {slot.note ? <em>{slot.note}</em> : null}
            </span>
          </label>
        ))}
      </div>
      <Button
        busy={busy}
        busyLabel="Confirming…"
        disabled={!selected}
        onClick={() => void run(() => confirmMyViewingSlot(viewing.id, selected))}
      >Confirm this time</Button>
      <p className="type-caption">The landlord&apos;s number is released once a time is set.</p>
    </section>
  );
}

/**
 * The QR and the fallback code.
 *
 * Rendered only while `check_in.can_issue` — a window the server opens shortly
 * before the appointment and closes after it. Not something to carry around.
 */
function CheckIn({ viewing }: { viewing: MyViewing }) {
  const [credential, setCredential] = useState<ViewingCheckInCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function issue() {
    setBusy(true);
    setError("");
    try {
      setCredential(await issueViewingCheckInCredential(viewing.id));
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not open check-in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="viewing-checkin">
      <h3>Check in</h3>
      {credential ? (
        <>
          <div className="viewing-qr">
            <QRCode value={credential.qr_payload} size={188} aria-label="Viewing check-in QR code" />
          </div>
          <p className="type-caption">Show this to the landlord when you arrive.</p>
          <p className="viewing-code">
            {credential.code.slice(0, 3)} {credential.code.slice(3)}
          </p>
          <p className="type-caption">
            Or read the code out. It expires at{" "}
            {new Date(credential.expires_at).toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })}.
          </p>
          <Button variant="quiet" busy={busy} onClick={issue}>New code</Button>
        </>
      ) : (
        <Button busy={busy} busyLabel="Opening…" onClick={issue}>Open check-in</Button>
      )}
      {error ? <Notice tone="error" title={error} /> : null}
    </section>
  );
}

function ReportAttendance({
  viewing,
  busy,
  run,
}: {
  viewing: MyViewing;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <section className="viewing-action is-primary">
      <h3>Did this viewing happen?</h3>
      <p className="type-caption">
        Nobody checked in. Saying the landlord did not come is a report they can answer, not a
        verdict.
      </p>
      <Field label="What happened (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      <div className="viewing-exits">
        <Button
          busy={busy}
          onClick={() => void run(() => reportMyViewingNoShow(viewing.id, note.trim()))}
        >The landlord did not come</Button>
      </div>
    </section>
  );
}

function RespondToAttendance({
  viewing,
  busy,
  run,
}: {
  viewing: MyViewing;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <section className="viewing-action is-primary">
      <h3>Someone reported you did not attend</h3>
      <p className="type-caption">
        {viewing.attendance.report_note || "No details were given."} This is a report, not a
        verdict — your answer is recorded either way.
      </p>
      <Field label="Your answer (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      <div className="viewing-exits">
        <Button
          busy={busy}
          onClick={() => void run(() => respondMyViewingAttendance(viewing.id, "confirm", note.trim()))}
        >Yes, I could not attend</Button>
        <Button
          variant="secondary"
          busy={busy}
          onClick={() => void run(() => respondMyViewingAttendance(viewing.id, "dispute", note.trim()))}
        >No, I was there</Button>
      </div>
    </section>
  );
}

/** After the visit — and only until a choice has been made. */
function FollowUp({
  viewing,
  busy,
  run,
}: {
  viewing: MyViewing;
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
      <section className="viewing-action is-primary">
        <h3>What went wrong?</h3>
        <label className="viewing-select">
          <span className="type-caption">What happened</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="misleading_listing">The listing was misleading</option>
            <option value="wrong_unit_or_property">It was a different place</option>
            <option value="host_no_show">Nobody came</option>
            <option value="inappropriate_conduct">Inappropriate conduct</option>
            <option value="other">Something else</option>
          </select>
        </label>
        <Field label="Tell us what happened" value={details} onChange={(event) => setDetails(event.target.value)} />
        <div className="viewing-exits">
          <Button busy={busy} onClick={() => void choose("report")}>Send report</Button>
          <Button variant="quiet" disabled={busy} onClick={() => setReporting(false)}>Go back</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="viewing-action is-primary">
      <h3>How was it?</h3>
      <div className="viewing-exits">
        {viewing.post_viewing.can_request_home ? (
          <Button busy={busy} onClick={() => void choose("request_home")}>Apply to rent it</Button>
        ) : null}
        <Button variant="secondary" busy={busy} onClick={() => void choose("save")}>Save for later</Button>
        <Button variant="quiet" busy={busy} onClick={() => void choose("not_interested")}>Not for me</Button>
        <Button variant="quiet" disabled={busy} onClick={() => setReporting(true)}>Report a problem</Button>
      </div>
    </section>
  );
}

function SuggestTime({
  viewing,
  busy,
  onBack,
  run,
}: {
  viewing: MyViewing;
  busy: boolean;
  onBack: () => void;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  // Read once, on mount: the clock is not pure during render.
  const [day, setDay] = useState(() =>
    new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  );
  const [time, setTime] = useState("10:00");

  return (
    <section className="viewing-action">
      <h3>Suggest another time</h3>
      <p className="type-caption">
        The landlord has to confirm it. The current appointment stays until they do.
      </p>
      <div className="viewing-when-fields">
        <label><span className="type-caption">Day</span>
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        <label><span className="type-caption">Time</span>
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
      </div>
      <div className="viewing-exits">
        <Button
          busy={busy}
          onClick={() => {
            const startsAt = new Date(`${day}T${time}:00`);
            if (Number.isNaN(startsAt.getTime())) return;
            void run(() =>
              rescheduleMyViewing(viewing.id, [
                { starts_at: startsAt.toISOString(), duration_minutes: 30 },
              ]),
            );
          }}
        >Suggest it</Button>
        <Button variant="quiet" disabled={busy} onClick={onBack}>Keep the current time</Button>
      </div>
    </section>
  );
}

function CancelAppointment({
  viewing,
  busy,
  onBack,
  run,
}: {
  viewing: MyViewing;
  busy: boolean;
  onBack: () => void;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [reason, setReason] = useState("schedule_conflict");
  const [note, setNote] = useState("");

  return (
    <section className="viewing-action">
      <h3>Cancel this viewing</h3>
      <p className="type-caption">
        If another time would work, suggest one instead — that keeps the appointment alive.
      </p>
      <label className="viewing-select">
        <span className="type-caption">Why</span>
        <select value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="schedule_conflict">Something else came up</option>
          <option value="emergency">An emergency</option>
          <option value="transportation_problem">I cannot get there</option>
          <option value="no_longer_interested">No longer interested</option>
          <option value="other">Another reason</option>
        </select>
      </label>
      <Field label="Anything to add (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      <div className="viewing-exits">
        <Button
          variant="destructive"
          busy={busy}
          onClick={() =>
            void run(() =>
              cancelMyViewing(viewing.id, {
                reason: reason as Parameters<typeof cancelMyViewing>[1]["reason"],
                note: note.trim(),
              }),
            )
          }
        >Yes, cancel it</Button>
        <Button variant="quiet" disabled={busy} onClick={onBack}>Keep it</Button>
      </div>
    </section>
  );
}

/** What became of one appointment, in the tenant's terms. */
function appointmentOutcome(appointment: MyViewing["appointments"][number]): string {
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
