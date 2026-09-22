"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
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
 * The same record powers a focused in-context modal and a durable deep link.
 * The lifecycle can ask for several decisions, forms and pieces of released
 * context, so the body scrolls independently while its context and actions
 * remain anchored.
 *
 * The rule this holds: a control appears when it can be used and disappears
 * when it cannot. The check-in QR is not here the day before; the exact
 * directions are not here until the backend releases them; the follow-up is not
 * here once a follow-up has been chosen; cancel is not here once there is
 * nothing to cancel. `actions`, `check_in`, `attendance`, `post_viewing` and
 * `viewing_directions` are all computed per-reader on the server — this
 * re-derives none of it.
 */
type ViewingRecordProps = {
  viewing: MyViewing;
  onChanged: () => Promise<void>;
  modal?: boolean;
  titleId?: string;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  onBusyChange?: (busy: boolean) => void;
};

export function ViewingDetailModal({
  viewing,
  onChanged,
  onClose,
}: {
  viewing: MyViewing;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeTimer = useRef<number | null>(null);
  const closing = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => {
      if (!dialog) return;
      // Hold the opening proportions steady. Disclosures add scrollable body
      // content without resizing or re-centring the glass surface.
      dialog.style.setProperty("--viewing-modal-height", `${Math.ceil(dialog.offsetHeight)}px`);
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (dialog?.open) dialog.close();
      opener?.focus({ preventScroll: true });
    };
  }, []);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || closing.current || recordBusy) return;
    closing.current = true;
    setLeaving(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      return;
    }
    closeTimer.current = window.setTimeout(() => dialog.close(), 160);
  }, [recordBusy]);

  return (
    <dialog
      ref={dialogRef}
      className={`viewing-modal${leaving ? " is-leaving" : ""}`}
      aria-labelledby="viewing-modal-title"
      aria-busy={recordBusy}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
    >
      <div className="viewing-modal-surface">
        <button
          type="button"
          className="viewing-modal-close"
          aria-label="Close viewing details"
          disabled={recordBusy}
          onClick={requestClose}
        >
          <Icon name="close" />
        </button>
        <ViewingRecord
          viewing={viewing}
          onChanged={onChanged}
          modal
          titleId="viewing-modal-title"
          headingRef={headingRef}
          onBusyChange={setRecordBusy}
        />
      </div>
    </dialog>
  );
}

export function ViewingRecord({
  viewing,
  onChanged,
  modal = false,
  titleId,
  headingRef,
  onBusyChange,
}: ViewingRecordProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"none" | "reschedule" | "cancel" | "withdraw">("none");
  const [bodyScrolled, setBodyScrolled] = useState(false);

  useEffect(() => {
    setError("");
    setMode("none");
    setBodyScrolled(false);
  }, [viewing.id]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // A provider validates the tenant's temporary QR on another device. While the
  // check-in window is live, reread the server record so this surface moves from
  // "ready" to the authoritative `checked_in` state without a manual refresh.
  useEffect(() => {
    if (viewing.status !== "confirmed" || viewing.check_in.state !== "ready") return;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try { await onChanged(); } finally { refreshing = false; }
    };
    const interval = window.setInterval(() => { void refresh(); }, 3_000);
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onChanged, viewing.check_in.state, viewing.status]);

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
  const context = [viewing.unit_label, placeOf(viewing)].filter(Boolean).join(" · ");
  const statusTone = viewing.status === "checked_in" || viewing.status === "completed"
    ? "positive"
    : state.group === "action"
      ? "action"
      : state.group === "past"
        ? "past"
        : "upcoming";

  return (
    <article className={`viewing-detail${modal ? " is-modal" : ""}`} data-body-scrolled={bodyScrolled || undefined}>
      <header className="viewing-detail-head">
        <div className="viewing-detail-status">
          <span className={`viewing-detail-state is-${statusTone}`}>
            <i aria-hidden="true" />
            <span><small>Viewing status</small><strong>{state.line}</strong></span>
          </span>
          <span className="viewing-detail-time">
            <Icon name="clock" />
            <span><small>Appointment</small><strong>{when ?? "Time not set"}</strong></span>
          </span>
        </div>

        <div className="viewing-detail-property">
          <span className="viewing-detail-photo">
            {viewing.photo_url ? (
              /* Short-lived signed URLs from the files service. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={viewing.photo_url} alt="" />
            ) : (
              <span aria-hidden="true"><Icon name="properties" /></span>
            )}
          </span>
          <span className="viewing-detail-property-copy">
            <small>Property &amp; Unit</small>
            <h2 id={titleId} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
              {viewing.property_title || viewing.listing_headline}
            </h2>
            {context ? <p><Icon name="landmark" />{context}</p> : null}
          </span>
        </div>
      </header>

      <div
        className="viewing-detail-body"
        onScroll={(event) => setBodyScrolled(event.currentTarget.scrollTop > 2)}
      >
        {error ? <Notice tone="error" title={error} /> : null}


        {viewing.status === "checked_in" ? (
          <section className="viewing-live-state is-active" aria-live="polite">
            <span><Icon name="check" /></span>
            <div><small>Viewing opened</small><h3>You are checked in</h3><p>Your attendance was verified by the property representative.</p></div>
          </section>
        ) : viewing.status === "confirmed" && viewing.check_in.state === "upcoming" ? (
          <section className="viewing-live-state">
            <span><Icon name="clock" /></span>
            <div>
              <small>Check-in</small>
              <h3>Opens near your appointment</h3>
              <p>{viewing.check_in.opens_at ? `Available from ${formatViewingMoment(viewing.check_in.opens_at)}.` : "Your secure check-in will appear here when it is ready."}</p>
            </div>
          </section>
        ) : null}

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

        {viewing.viewing_directions || viewing.contact ? (
          <div className="viewing-arrival-grid">
            {viewing.viewing_directions ? <ViewingDirections directions={viewing.viewing_directions} /> : null}
            {viewing.contact ? (
              <section className="viewing-contact">
                <span className="viewing-contact-icon"><Icon name="info" /></span>
                <div>
                  <small>{viewing.contact.role}</small>
                  <h3>{viewing.contact.name}</h3>
                  <a href={`tel:${viewing.contact.phone}`}>{viewing.contact.phone}</a>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {note ? <blockquote className="viewing-note"><small>Appointment note</small><p>{note}</p></blockquote> : null}

        {viewing.appointments.length > 1 ? (
          <details className="viewing-history">
            <summary><span><Icon name="clock" />Appointment history ({viewing.appointments.length})</span><Icon name="chevron-down" /></summary>
            <ul>
              {viewing.appointments.map((appointment) => (
                <li key={appointment.id}>
                  <strong>{whenLabel(appointment.scheduled_at)}</strong>
                  <span>{appointmentOutcome(appointment)}</span>
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
          <section className="viewing-action is-destructive">
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
        ) : null}
      </div>

      <footer className="viewing-detail-foot">
        <Link href={`/listings/${viewing.listing_id}`} className="viewing-listing-action">
          <Icon name="explore" />View listing
        </Link>
        {mode === "none" && hasExits ? (
          <div className="viewing-context-actions">
            {viewing.actions.can_reschedule ? (
              <Button variant="secondary" disabled={busy} onClick={() => setMode("reschedule")}>Suggest another time</Button>
            ) : null}
            {viewing.actions.can_cancel ? (
              <Button variant="quiet" disabled={busy} onClick={() => setMode("cancel")}>Cancel viewing</Button>
            ) : null}
            {viewing.actions.can_withdraw ? (
              <Button variant="quiet" disabled={busy} onClick={() => setMode("withdraw")}>Withdraw</Button>
            ) : null}
          </div>
        ) : null}
      </footer>
    </article>
  );
}

function formatViewingMoment(iso: string): string {
  return new Date(iso).toLocaleString("en-GH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
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
