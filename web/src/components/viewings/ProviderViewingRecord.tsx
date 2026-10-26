"use client";

/**
 * One viewing, and everything a host can do about it.
 *
 * This was the right-hand pane of a split view, with the first row of the list
 * always opened into it. That put a whole workflow — offering times, confirming
 * a slot, checking somebody in, resolving attendance, cancelling — somewhere
 * that could not be linked to, sent to a colleague, or returned to. It also
 * meant arriving at Viewings always showed *somebody's* appointment, chosen by
 * sort order rather than by anyone asking for it.
 *
 * Nothing about permission moved. Every action goes to the endpoint it did
 * before, and what is drawn is still read from `actions`, `check_in`,
 * `attendance` and `post_viewing` — all computed per-reader on the server.
 */

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Radio } from "@/components/Check";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { ViewingDirections } from "@/components/viewings/ViewingDirections";
import { ApiFailure } from "@/lib/api";
import {
  cancelViewingAppointment,
  offerSlots,
  recordViewingOutcome,
  reportViewingNoShow,
  rescheduleViewing,
  respondViewingAttendance,
  validateViewingCheckIn,
  viewingAction,
  type Viewing,
  type ViewingCancellationReason,
} from "@/lib/console";
import { formatViewingTime, providerViewingSummary } from "@/lib/providerViewings";
// The host confirms a slot through the same endpoint the tenant does; it is one
// appointment and one confirmation, whichever side presses it.
import { confirmMyViewingSlot } from "@/lib/tenant";

export function ProviderViewingRecord({ viewing, onChanged }: { viewing: Viewing; onChanged: () => Promise<void> }) {
  const [offering, setOffering] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [declining, setDeclining] = useState(false);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const summary = providerViewingSummary(viewing);
  const when = viewing.confirmed_starts_at ? new Date(viewing.confirmed_starts_at) : null;
  const place = [viewing.property_title, viewing.unit_label].filter(Boolean).join(" · ");

  return (
    <div className="vr">
      {/* When it is, where it stands and where it is: one card, read at a glance. */}
      <section className="vr-hero" data-tone={summary.tone} aria-label="Viewing">
      <div className="vr-when">
        <span className="vr-date" aria-hidden="true">
          {when ? (
            <>
              <strong>{when.toLocaleDateString("en-GH", { day: "numeric" })}</strong>
              <small>{when.toLocaleDateString("en-GH", { month: "short" })}</small>
            </>
          ) : <Icon name="viewings" />}
        </span>
        <span className="vr-when-copy">
          <strong>
            {when
              ? `${when.toLocaleDateString("en-GH", { weekday: "long" })} · ${when.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })}`
              : viewing.status === "offered" ? "Tenant is picking a time" : "No time yet"}
          </strong>
          <span className={`viewing-row-state is-${summary.tone}`}><i aria-hidden="true" />{summary.label}</span>
        </span>
      </div>

      <div className="vr-place">
        <span className="vr-photo" aria-hidden="true">
          {viewing.photo_url ? (
            /* Short-lived signed URLs from the files service. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={viewing.photo_url} alt="" />
          ) : <Icon name="properties" />}
        </span>
        <span className="vr-place-copy">
          <strong>{viewing.listing_headline}</strong>
          <small>{[place || null, viewing.locality_name, viewing.rent_formatted ? `${viewing.rent_formatted}/mo` : null].filter(Boolean).join(" · ")}</small>
        </span>
      </div>
      </section>

      {viewing.message || viewing.availability_note ? (
        <section className="vr-note" aria-label={`From ${viewing.tenant_name}`}>
          <span className="vr-avatar" aria-hidden="true">{initialsOf(viewing.tenant_name)}</span>
          <div>
            <p className="vr-note-who">{viewing.tenant_name}</p>
            {viewing.message ? <blockquote>“{viewing.message}”</blockquote> : null}
            {viewing.availability_note ? <p className="vr-note-small"><Icon name="clock" />{viewing.availability_note}</p> : null}
          </div>
        </section>
      ) : null}

      {viewing.contact ? (
        <section className="vr-contact" aria-label="Contact">
          <span className="vr-avatar is-contact" aria-hidden="true">{initialsOf(viewing.contact.name)}</span>
          <span className="vr-contact-copy">
            <strong>{viewing.contact.name}</strong>
            <small>{viewing.contact.phone}</small>
          </span>
          <a className="vr-icon-button" href={`tel:${viewing.contact.phone}`} aria-label={`Call ${viewing.contact.name}`} title="Call">
            <Icon name="handset" />
          </a>
        </section>
      ) : null}

      {viewing.viewing_directions ? <ViewingDirections directions={viewing.viewing_directions} /> : null}
      <AppointmentHistory viewing={viewing} />

      {error ? <Notice tone="error" title={error} /> : null}

      {viewing.status === "offered" && viewing.actions.can_confirm_slot ? (
        <ConfirmOfferedSlot viewing={viewing} busy={busy} onConfirm={(slotId) => run(() => confirmMyViewingSlot(viewing.id, slotId))} />
      ) : null}

      <AttendanceResolutionPanel viewing={viewing} busy={busy} run={run} />

      {declining ? (
        <section className="viewing-inline-confirm vr-confirm is-danger">
          <p className="vr-panel-title">Decline this request?</p>
          <p className="vr-panel-body">The tenant will be told.</p>
          <div className="vr-row"><Button variant="destructive" busy={busy} onClick={() => run(() => viewingAction(viewing.id, "decline", "Not available").then((result) => { setDeclining(false); return result; }))}>Decline</Button><Button variant="quiet" disabled={busy} onClick={() => setDeclining(false)}>Keep</Button></div>
        </section>
      ) : null}

      {cancelling ? (
        <CancelAppointmentForm
          busy={busy}
          onBack={() => setCancelling(false)}
          onCancel={(input) => run(() => cancelViewingAppointment(viewing.id, input).then((result) => {
            setCancelling(false);
            return result;
          }))}
        />
      ) : null}

      {offering ? (
        <OfferTimes
          purpose={rescheduling ? "reschedule" : "offer"}
          busy={busy}
          onCancel={() => { setOffering(false); setRescheduling(false); }}
          onOffer={async (input) => {
            await run(() => rescheduling
              ? rescheduleViewing(viewing.id, input.slots)
              : offerSlots(viewing.id, input));
            setOffering(false);
            setRescheduling(false);
          }}
        />
      ) : (
        <div className="vr-actions">
          {viewing.actions.can_decline ? (
            <>
              <Button onClick={() => setOffering(true)}>
                <Icon name="clock" />{viewing.status === "offered" ? "New times" : "Offer times"}
              </Button>
              {viewing.actions.can_decline ? <Button
                variant="destructive"
                busy={busy}
                onClick={() => setDeclining(true)}
              >
                Decline
              </Button> : null}
            </>
          ) : null}

          {viewing.status === "confirmed" ? (
            <>
              {viewing.check_in.can_validate ? (
                <ProviderManualCheckIn viewing={viewing} onChanged={onChanged} />
              ) : (
                <p className="vr-hint">
                  <Icon name="clock" />
                  {viewing.check_in.opens_at && viewing.check_in.state === "upcoming"
                    ? `Check-in opens ${formatViewingTime(viewing.check_in.opens_at)}`
                    : "Ask for the tenant’s check-in code on arrival"}
                </p>
              )}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setRescheduling(true);
                  setOffering(true);
                }}
              >
                Reschedule
              </Button>
              {!cancelling ? <Button
                variant="quiet"
                busy={busy}
                onClick={() => setCancelling(true)}
              >
                Cancel viewing
              </Button> : null}
            </>
          ) : null}

          {viewing.status === "checked_in" ? (
            <Button
              busy={busy}
              busyLabel="Completing…"
              onClick={() => run(() => recordViewingOutcome(viewing.id, "completed"))}
            >
              Mark viewing completed
            </Button>
          ) : null}
          {viewing.actions.can_cancel && viewing.status !== "confirmed" && !cancelling ? (
            <Button variant="quiet" disabled={busy} onClick={() => setCancelling(true)}>
              Cancel viewing
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ConfirmOfferedSlot({ viewing, busy, onConfirm }: { viewing: Viewing; busy: boolean; onConfirm: (slotId: string) => Promise<void> }) {
  const [selected, setSelected] = useState("");
  const available = viewing.slots.filter((slot) => !slot.is_past);
  return (
    <section className="vr-panel">
      <p className="vr-panel-title">Pick the new time</p>
      {available.map((slot) => (
        <Radio
          key={slot.id}
          name={`offered-slot-${viewing.id}`}
          label={formatViewingTime(slot.starts_at)}
          checked={selected === slot.id}
          onChange={() => setSelected(slot.id)}
        />
      ))}
      <div><Button busy={busy} disabled={!selected} onClick={() => onConfirm(selected)}>Confirm time</Button></div>
    </section>
  );
}

function CancelAppointmentForm({ busy, onBack, onCancel }: { busy: boolean; onBack: () => void; onCancel: (input: { reason: ViewingCancellationReason; note?: string }) => Promise<void> }) {
  const [reason, setReason] = useState<ViewingCancellationReason>("schedule_conflict");
  const [note, setNote] = useState("");
  return (
    <section className="vr-panel is-danger">
      <Notice tone="info" title="Could a new time work?" body="Rescheduling keeps it active." />
      <label className="vr-select">Reason
        <select value={reason} onChange={(event) => setReason(event.target.value as ViewingCancellationReason)}>
          <option value="schedule_conflict">Schedule conflict</option>
          <option value="emergency">Emergency</option>
          <option value="transportation_problem">Transportation problem</option>
          <option value="no_longer_interested">No longer interested</option>
          <option value="property_unavailable">Property or unit no longer available</option>
          <option value="other">Other</option>
        </select>
      </label>
      <Field label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
      <div className="vr-row">
        <Button variant="destructive" busy={busy} onClick={() => onCancel({ reason, note })}>Cancel viewing</Button>
        <Button variant="quiet" disabled={busy} onClick={onBack}>Keep</Button>
      </div>
    </section>
  );
}

function AttendanceResolutionPanel({ viewing, busy, run }: { viewing: Viewing; busy: boolean; run: (work: () => Promise<unknown>) => Promise<void> }) {
  const [note, setNote] = useState("");
  if (viewing.attendance.state === "disputed") {
    return <Notice tone="info" title="Attendance is disputed" body="The accounts differ. No party is treated as a verified no-show; the history remains available for support review." />;
  }
  if (viewing.attendance.state === "pending") {
    const alleged = viewing.attendance.alleged_absent_party === "tenant" ? "tenant" : "host";
    return (
      <section className="vr-panel">
        <Notice tone="info" title="Attendance report awaiting a response" body={`The other party reported the ${alleged} absent. This is an allegation, not a verified outcome.`} />
        {viewing.attendance.can_respond ? <>
          <Field label="Optional response note" value={note} onChange={(event) => setNote(event.target.value)} />
          <div className="vr-row">
            <Button busy={busy} onClick={() => run(() => respondViewingAttendance(viewing.id, "confirm", note))}>Confirm I could not attend</Button>
            <Button variant="secondary" busy={busy} onClick={() => run(() => respondViewingAttendance(viewing.id, "dispute", note))}>Dispute report</Button>
          </div>
        </> : null}
      </section>
    );
  }
  if (!viewing.attendance.can_report) return null;
  return (
    <section className="vr-panel">
      <Notice tone="info" title="No verified check-in" body="A missing check-in does not prove who was absent. You may report that the other party did not attend; they will be asked to confirm or dispute it." />
      <Field label="Optional factual note" value={note} onChange={(event) => setNote(event.target.value)} />
      <div><Button variant="secondary" busy={busy} onClick={() => run(() => reportViewingNoShow(viewing.id, note))}>Report other party absent</Button></div>
    </section>
  );
}

function AppointmentHistory({ viewing }: { viewing: Viewing }) {
  if (viewing.appointments.length < 2 && !viewing.appointments.some((item) => item.status === "rescheduled")) return null;
  return (
    <details className="vr-history">
      <summary>Appointment history</summary>
      <ol>
        {viewing.appointments.map((appointment) => (
          <li key={appointment.id}>{formatViewingTime(appointment.scheduled_at)} — {appointment.status.replaceAll("_", " ")}{appointment.rescheduled_by ? ` by ${appointment.rescheduled_by}` : ""}</li>
        ))}
      </ol>
    </details>
  );
}

function ProviderManualCheckIn({ viewing, onChanged }: { viewing: Viewing; onChanged: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await validateViewingCheckIn(viewing.id, { code });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That code could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="vr-checkin">
      <span className="vr-checkin-mark" aria-hidden="true"><Icon name="check" /></span>
      <div>
        <h3>Check in</h3>
        <p>Enter the code on the tenant&apos;s screen.</p>
      </div>
      <div className="vr-checkin-form">
        <Field
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        />
        <Button busy={busy} busyLabel="Checking…" disabled={code.length !== 6} onClick={submit}>Check in</Button>
      </div>
      {error ? <Notice tone="error" title={error} /> : null}
    </section>
  );
}

function OfferTimes({
  onCancel,
  onOffer,
  purpose = "offer",
  busy: parentBusy = false,
}: {
  onCancel: () => void;
  onOffer: (input: {
    slots: { starts_at: string }[];
  }) => Promise<void>;
  purpose?: "offer" | "reschedule";
  busy?: boolean;
}) {
  const [times, setTimes] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLElement>(null);

  const filled = times.filter((value) => value);

  // Opened from the action bar at the foot, so bring the new panel into view —
  // once a sheet around it has finished growing, or the scroll would be
  // measured against a height that is still changing.
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    node.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    let live = true;
    const sheet = node.closest("dialog");
    const growing = sheet ? sheet.getAnimations().filter((animation) => animation.playState === "running") : [];
    void Promise.allSettled(growing.map((animation) => animation.finished)).then(() => {
      if (live) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => { live = false; };
  }, []);

  return (
    <>
      <section ref={panel} className="vr-offer" aria-label={purpose === "reschedule" ? "New times" : "Offer times"}>
        <header className="vr-offer-head">
          <strong>{purpose === "reschedule" ? "New times" : "Offer times"}</strong>
          <span className="vr-offer-count" aria-label={`${filled.length} of 5 times`}>{filled.length}/5</span>
        </header>

        <ol className="vr-slots">
          {times.map((value, index) => (
            <li key={index} className="vr-slot" data-filled={value ? "" : undefined}>
              <span className="vr-slot-mark" aria-hidden="true">{index + 1}</span>
              <input
                className="vr-slot-input"
                type="datetime-local"
                aria-label={`Time ${index + 1}`}
                value={value}
                onChange={(event) => {
                  const next = [...times];
                  next[index] = event.target.value;
                  setTimes(next);
                }}
              />
              {times.length > 1 ? (
                <button
                  type="button"
                  className="vr-slot-remove"
                  aria-label={`Remove time ${index + 1}`}
                  onClick={() => setTimes(times.filter((_, at) => at !== index))}
                >
                  <Icon name="close" />
                </button>
              ) : null}
            </li>
          ))}
        </ol>

        {times.length < 5 ? (
          <button type="button" className="vr-slot-add" onClick={() => setTimes([...times, ""])}>
            <Icon name="plus" />Add time
          </button>
        ) : null}

        <p className="vr-hint is-quiet"><Icon name="shield" />Viewings are always free for tenants</p>
      </section>

      <div className="vr-actions is-offer">
        <Button
          busy={busy || parentBusy}
          busyLabel="Sending…"
          disabled={filled.length === 0}
          onClick={async () => {
            setBusy(true);
            try {
              await onOffer({
                slots: filled.map((value) => ({
                  starts_at: new Date(value).toISOString(),
                })),
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          Send {filled.length ? `${filled.length} time${filled.length === 1 ? "" : "s"}` : "times"}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
