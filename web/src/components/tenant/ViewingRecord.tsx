"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";

import { Button } from "@/components/Button";
import { Radio } from "@/components/Check";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { useToast } from "@/components/toast/Toaster";
import { Countdown, countsDown, useNow } from "@/components/viewings/Countdown";
import { ViewingDirections } from "@/components/viewings/ViewingDirections";
import { ModalSheet } from "@/components/workspace/ModalSheet";
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
 * The same record powers the sheet the schedule opens and the viewing's own
 * address, drawn in the provider's record vocabulary (`vr-*`,
 * viewings-workspace.css) so both sides of one appointment look like one
 * appointment: the date as the hero's face, a countdown once it is close, the
 * place, then whatever step the lifecycle is on, with the exits pinned to the
 * sheet's foot.
 *
 * The rule this holds: a control appears when it can be used and disappears
 * when it cannot. The check-in QR is not here the day before; the exact
 * directions are not here until the backend releases them; the follow-up is not
 * here once a follow-up has been chosen; cancel is not here once there is
 * nothing to cancel. `actions`, `check_in`, `attendance`, `post_viewing` and
 * `viewing_directions` are all computed per-reader on the server — this
 * re-derives none of it.
 */

/** How a viewing is coloured for its tenant: presentation over `standing()`. */
export type TenantViewingTone = "good" | "waiting" | "attention" | "neutral";

export function tenantViewingTone(viewing: MyViewing): TenantViewingTone {
  const state = standing(viewing);
  if (state.group === "action") return "attention";
  if (viewing.status === "confirmed" || viewing.status === "checked_in" || viewing.status === "completed") return "good";
  if (state.group === "upcoming") return "waiting";
  return "neutral";
}

/**
 * The record over the schedule. A plain click on a card opens it, held in the
 * page's state rather than the address. The last viewing shown is held so the
 * sheet can play its exit after the page has let it go.
 */
export function ViewingSheet({
  viewing,
  onClose,
  onChanged,
}: {
  viewing: MyViewing | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [shown, setShown] = useState<MyViewing | null>(viewing);
  if (viewing && viewing !== shown) setShown(viewing);
  const current = viewing ?? shown;
  if (!current) return null;

  return (
    <ModalSheet
      open={Boolean(viewing)}
      onClose={onClose}
      icon="viewings"
      title="Your viewing"
      meta={current.property_title || current.listing_headline}
      className="host-viewing-sheet tenant-viewing-sheet"
      size="sm"
      closeLabel="Close viewing"
    >
      <ViewingRecord key={current.id} viewing={current} onChanged={onChanged} />
    </ModalSheet>
  );
}

export function ViewingRecord({ viewing, onChanged }: { viewing: MyViewing; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"none" | "reschedule" | "cancel" | "withdraw">("none");
  const panelRef = useRef<HTMLElement>(null);
  const now = useNow(viewing.confirmed_starts_at);

  // A step is asked where it is answered, not off the bottom of the sheet.
  useEffect(() => {
    if (mode !== "none") panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [mode]);

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

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      setMode("none");
      await onChanged();
      if (done) toast({ tone: "success", title: done });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const state = standing(viewing);
  const tone = tenantViewingTone(viewing);
  const at = viewing.confirmed_starts_at ? new Date(viewing.confirmed_starts_at) : null;
  const note = viewing.response_note || viewing.cancellation_note || viewing.outcome_note;
  const hasExits = Boolean(
    viewing.actions.can_reschedule || viewing.actions.can_cancel || viewing.actions.can_withdraw,
  );
  const property = viewing.property_title || viewing.listing_headline;
  const context = [viewing.unit_label, placeOf(viewing), viewing.rent_formatted ? `${viewing.rent_formatted}/mo` : null].filter(Boolean).join(" · ");
  const counting = viewing.status === "confirmed" && countsDown(viewing.confirmed_starts_at, now);

  return (
    <div className="vr viewing-detail tenant-vr">
      {/* When, where it stands and where it is: one card, read at a glance. */}
      <section className="vr-hero" data-tone={tone} aria-label="Viewing">
        <div className="vr-when">
          <span className="vr-date" aria-hidden="true">
            {at ? (
              <>
                <strong>{at.toLocaleDateString("en-GH", { day: "numeric" })}</strong>
                <small>{at.toLocaleDateString("en-GH", { month: "short" })}</small>
              </>
            ) : <Icon name="viewings" />}
          </span>
          <span className="vr-when-copy">
            <strong>
              {at
                ? `${at.toLocaleDateString("en-GH", { weekday: "long" })} · ${at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })}`
                : viewing.status === "offered" ? "Pick one of the times offered" : "Time to be arranged"}
            </strong>
            <span className={`viewing-row-state is-${tone}`}><i aria-hidden="true" />{state.line}</span>
          </span>
        </div>
        {counting && viewing.confirmed_starts_at ? (
          <div className="tenant-vr-countdown">
            <small>Starts in</small>
            <Countdown target={viewing.confirmed_starts_at} />
          </div>
        ) : null}
        <div className="vr-place">
          <span className="vr-photo" aria-hidden="true">
            {viewing.photo_url ? (
              /* Short-lived signed URLs from the files service. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={viewing.photo_url} alt="" />
            ) : <Icon name="properties" />}
          </span>
          <span className="vr-place-copy">
            <strong>{property}</strong>
            {context ? <small>{context}</small> : null}
          </span>
          <Link className="rq-place-link" href={`/listings/${viewing.listing_id}`} aria-label="View listing" title="View listing">
            <Icon name="share" />
          </Link>
        </div>
      </section>

      {error ? <Notice tone="error" title={error} /> : null}

      {viewing.status === "checked_in" ? (
        <section className="vr-checkin is-live" aria-live="polite">
          <span className="vr-checkin-mark" aria-hidden="true"><Icon name="check" /></span>
          <div><h3>You are checked in</h3><p>The property representative verified your attendance.</p></div>
        </section>
      ) : viewing.status === "confirmed" && viewing.check_in.state === "upcoming" ? (
        <p className="vr-hint">
          <Icon name="clock" />
          {viewing.check_in.opens_at ? `Check-in opens ${formatViewingMoment(viewing.check_in.opens_at)}` : "Your secure check-in appears here when it is ready"}
        </p>
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

      {viewing.contact ? (
        <section className="vr-contact" aria-label="Contact">
          <span className="vr-avatar is-contact" aria-hidden="true">{initialsOf(viewing.contact.name)}</span>
          <span className="vr-contact-copy">
            <strong>{viewing.contact.name}</strong>
            <small>{viewing.contact.role} · {viewing.contact.phone}</small>
          </span>
          <a className="vr-icon-button" href={`tel:${viewing.contact.phone}`} aria-label={`Call ${viewing.contact.name}`} title="Call">
            <Icon name="handset" />
          </a>
        </section>
      ) : null}

      {viewing.viewing_directions ? <ViewingDirections directions={viewing.viewing_directions} /> : null}

      {note ? (
        <p className="rq-decision-note"><Icon name="chat" /><span><small>Appointment note</small>{note}</span></p>
      ) : null}

      {viewing.appointments.length > 1 ? (
        <details className="vr-history">
          <summary>Appointment history ({viewing.appointments.length})</summary>
          <ol>
            {viewing.appointments.map((appointment) => (
              <li key={appointment.id}>
                <strong>{whenLabel(appointment.scheduled_at)}</strong> — {appointmentOutcome(appointment)}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {mode === "reschedule" ? (
        <SuggestTime viewing={viewing} busy={busy} onBack={() => setMode("none")} run={run} panelRef={panelRef} />
      ) : mode === "cancel" ? (
        <CancelAppointment viewing={viewing} busy={busy} onBack={() => setMode("none")} run={run} panelRef={panelRef} />
      ) : mode === "withdraw" ? (
        <section ref={panelRef} className="vr-confirm is-danger">
          <p className="vr-panel-title">Withdraw this request?</p>
          <p className="vr-panel-body">The landlord will be told you no longer want to arrange this viewing.</p>
          <div className="vr-row">
            <Button
              variant="destructive"
              busy={busy}
              onClick={() => void run(() => withdrawMyViewing(viewing.id, "No longer interested"), "Viewing request withdrawn")}
            >Yes, withdraw it</Button>
            <Button variant="quiet" disabled={busy} onClick={() => setMode("none")}>Keep the request</Button>
          </div>
        </section>
      ) : null}

      {mode === "none" && hasExits ? (
        <div className="vr-actions">
          {viewing.actions.can_reschedule ? (
            <Button variant="secondary" disabled={busy} onClick={() => setMode("reschedule")}><Icon name="clock" />Suggest another time</Button>
          ) : null}
          <span className="vr-actions-spacer" />
          {viewing.actions.can_cancel ? (
            <Button variant="quiet" className="tenant-vr-exit" disabled={busy} onClick={() => setMode("cancel")}>Cancel viewing</Button>
          ) : null}
          {viewing.actions.can_withdraw ? (
            <Button variant="quiet" className="tenant-vr-exit" disabled={busy} onClick={() => setMode("withdraw")}>Withdraw</Button>
          ) : null}
        </div>
      ) : null}
    </div>
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

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

type Run = (work: () => Promise<unknown>, done?: string) => Promise<void>;

function ChooseTime({ viewing, busy, run }: { viewing: MyViewing; busy: boolean; run: Run }) {
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
    <section className="vr-panel tenant-vr-pick">
      <p className="vr-panel-title">Pick a time</p>
      <div className="tenant-vr-slots">
        {open.map((slot) => (
          <Radio
            key={slot.id}
            name={`viewing-slot-${viewing.id}`}
            label={whenLabel(slot.starts_at) ?? slot.starts_at}
            note={slot.note || undefined}
            checked={selected === slot.id}
            onChange={() => setSelected(slot.id)}
          />
        ))}
      </div>
      <div className="vr-row">
        <Button
          busy={busy}
          busyLabel="Confirming…"
          disabled={!selected}
          onClick={() => void run(() => confirmMyViewingSlot(viewing.id, selected), "Viewing confirmed")}
        ><Icon name="check" />Confirm this time</Button>
      </div>
      <p className="vr-panel-body">The landlord&apos;s number is released once a time is set.</p>
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
    <section className="vr-checkin tenant-vr-checkin">
      <span className="vr-checkin-mark" aria-hidden="true"><Icon name="verification" /></span>
      <div>
        <h3>Check in</h3>
        <p>{credential ? "Show this to the landlord when you arrive." : "Open your code when you reach the door."}</p>
      </div>
      {credential ? (
        <div className="tenant-vr-qr">
          <div className="viewing-qr">
            <QRCode value={credential.qr_payload} size={176} aria-label="Viewing check-in QR code" />
          </div>
          <p className="viewing-code">
            {credential.code.slice(0, 3)} {credential.code.slice(3)}
          </p>
          <p className="vr-panel-body">
            Or read the code out. It expires at{" "}
            {new Date(credential.expires_at).toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })}.
          </p>
          <Button variant="quiet" busy={busy} onClick={issue}>New code</Button>
        </div>
      ) : (
        <div className="vr-checkin-form">
          <Button busy={busy} busyLabel="Opening…" onClick={issue}><Icon name="verification" />Open check-in</Button>
        </div>
      )}
      {error ? <Notice tone="error" title={error} /> : null}
    </section>
  );
}

function ReportAttendance({ viewing, busy, run }: { viewing: MyViewing; busy: boolean; run: Run }) {
  const [note, setNote] = useState("");
  return (
    <section className="vr-panel">
      <p className="vr-panel-title">Did this viewing happen?</p>
      <p className="vr-panel-body">
        Nobody checked in. Saying the landlord did not come is a report they can answer, not a
        verdict.
      </p>
      <Field label="What happened (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      <div className="vr-row">
        <Button
          busy={busy}
          onClick={() => void run(() => reportMyViewingNoShow(viewing.id, note.trim()), "Report sent")}
        >The landlord did not come</Button>
      </div>
    </section>
  );
}

function RespondToAttendance({ viewing, busy, run }: { viewing: MyViewing; busy: boolean; run: Run }) {
  const [note, setNote] = useState("");
  return (
    <section className="vr-panel is-danger">
      <p className="vr-panel-title">Someone reported you did not attend</p>
      <p className="vr-panel-body">
        {viewing.attendance.report_note || "No details were given."} This is a report, not a
        verdict — your answer is recorded either way.
      </p>
      <Field label="Your answer (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      <div className="vr-row">
        <Button
          busy={busy}
          onClick={() => void run(() => respondMyViewingAttendance(viewing.id, "confirm", note.trim()), "Answer recorded")}
        >Yes, I could not attend</Button>
        <Button
          variant="secondary"
          busy={busy}
          onClick={() => void run(() => respondMyViewingAttendance(viewing.id, "dispute", note.trim()), "Answer recorded")}
        >No, I was there</Button>
      </div>
    </section>
  );
}

/** After the visit — and only until a choice has been made. */
function FollowUp({ viewing, busy, run }: { viewing: MyViewing; busy: boolean; run: Run }) {
  const [reporting, setReporting] = useState(false);
  const [category, setCategory] = useState("misleading_listing");
  const [details, setDetails] = useState("");

  const choose = (action: "request_home" | "save" | "report" | "not_interested") =>
    run(
      () => recordPostViewingAction(viewing.id, {
        action,
        ...(action === "report" ? { report_category: category, details } : {}),
      }),
      action === "report" ? "Report sent" : action === "save" ? "Saved for later" : action === "request_home" ? "Application started" : "Noted",
    );

  if (reporting) {
    return (
      <section className="vr-panel is-danger">
        <p className="vr-panel-title">What went wrong?</p>
        <label className="vr-select">What happened
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="misleading_listing">The listing was misleading</option>
            <option value="wrong_unit_or_property">It was a different place</option>
            <option value="host_no_show">Nobody came</option>
            <option value="inappropriate_conduct">Inappropriate conduct</option>
            <option value="other">Something else</option>
          </select>
        </label>
        <Field label="Tell us what happened" value={details} onChange={(event) => setDetails(event.target.value)} />
        <div className="vr-row">
          <Button busy={busy} onClick={() => void choose("report")}>Send report</Button>
          <Button variant="quiet" disabled={busy} onClick={() => setReporting(false)}>Go back</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="vr-panel tenant-vr-followup">
      <p className="vr-panel-title">How was it?</p>
      <p className="vr-panel-body">Tell us what you want to do next with this place.</p>
      <div className="vr-row">
        {viewing.post_viewing.can_request_home ? (
          <Button busy={busy} onClick={() => void choose("request_home")}><Icon name="applications" />Apply to rent it</Button>
        ) : null}
        <Button variant="secondary" busy={busy} onClick={() => void choose("save")}><Icon name="heart" />Save for later</Button>
        <Button variant="quiet" busy={busy} onClick={() => void choose("not_interested")}>Not for me</Button>
        <Button variant="quiet" disabled={busy} onClick={() => setReporting(true)}>Report a problem</Button>
      </div>
    </section>
  );
}

function SuggestTime({ viewing, busy, onBack, run, panelRef }: { viewing: MyViewing; busy: boolean; onBack: () => void; run: Run; panelRef: React.RefObject<HTMLElement | null> }) {
  // Read once, on mount: the clock is not pure during render.
  const [day, setDay] = useState(() =>
    new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  );
  const [time, setTime] = useState("10:00");

  return (
    <section ref={panelRef} className="vr-panel">
      <p className="vr-panel-title">Suggest another time</p>
      <p className="vr-panel-body">
        The landlord has to confirm it. The current appointment stays until they do.
      </p>
      <ol className="vr-slots">
        <li className="vr-slot" data-filled="">
          <span className="vr-slot-mark" aria-hidden="true"><Icon name="clock" /></span>
          <input className="vr-slot-input" type="date" aria-label="Day" value={day} onChange={(event) => setDay(event.target.value)} />
          <input className="vr-slot-input" type="time" aria-label="Time" value={time} onChange={(event) => setTime(event.target.value)} />
        </li>
      </ol>
      <div className="vr-row">
        <Button
          busy={busy}
          onClick={() => {
            const startsAt = new Date(`${day}T${time}:00`);
            if (Number.isNaN(startsAt.getTime())) return;
            void run(() =>
              rescheduleMyViewing(viewing.id, [
                { starts_at: startsAt.toISOString(), duration_minutes: 30 },
              ]),
              "New time suggested",
            );
          }}
        >Suggest it</Button>
        <Button variant="quiet" disabled={busy} onClick={onBack}>Keep the current time</Button>
      </div>
    </section>
  );
}

function CancelAppointment({ viewing, busy, onBack, run, panelRef }: { viewing: MyViewing; busy: boolean; onBack: () => void; run: Run; panelRef: React.RefObject<HTMLElement | null> }) {
  const [reason, setReason] = useState("schedule_conflict");
  const [note, setNote] = useState("");

  return (
    <section ref={panelRef} className="vr-panel is-danger">
      <p className="vr-panel-title">Cancel this viewing</p>
      <p className="vr-panel-body">
        If another time would work, suggest one instead — that keeps the appointment alive.
      </p>
      <label className="vr-select">Why
        <select value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="schedule_conflict">Something else came up</option>
          <option value="emergency">An emergency</option>
          <option value="transportation_problem">I cannot get there</option>
          <option value="no_longer_interested">No longer interested</option>
          <option value="other">Another reason</option>
        </select>
      </label>
      <Field label="Anything to add (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      <div className="vr-row">
        <Button
          variant="destructive"
          busy={busy}
          onClick={() =>
            void run(() =>
              cancelMyViewing(viewing.id, {
                reason: reason as Parameters<typeof cancelMyViewing>[1]["reason"],
                note: note.trim(),
              }),
              "Viewing cancelled",
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
