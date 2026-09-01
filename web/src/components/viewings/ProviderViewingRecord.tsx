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

import { useState } from "react";

import { Button } from "@/components/Button";
import { Radio } from "@/components/Check";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
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

  return (
    <div className="viewing-detail">
      <div className="viewing-detail-identity">
        <p className="type-body-strong">{viewing.listing_headline}</p>
        <p className="type-caption">{[viewing.locality_name, viewing.rent_formatted ? `${viewing.rent_formatted} per month` : null].filter(Boolean).join(" · ")}</p>
        <span className={`viewing-row-state is-${providerViewingSummary(viewing).tone}`}><i aria-hidden="true" />{providerViewingSummary(viewing).label}</span>
      </div>

      {viewing.message ? (
        <blockquote>“{viewing.message}”</blockquote>
      ) : null}

      {viewing.availability_note ? (
        <p className="type-caption">Tenant availability: {viewing.availability_note}</p>
      ) : null}

      {viewing.confirmed_starts_at ? (
        <div className="viewing-schedule"><span>Scheduled</span><strong>{formatViewingTime(viewing.confirmed_starts_at)}</strong></div>
      ) : null}

      {viewing.contact ? (
        <section className="viewing-detail-section"><h3>Contact</h3><p>{viewing.contact.name} · <a href={`tel:${viewing.contact.phone}`}>{viewing.contact.phone}</a></p></section>
      ) : null}

      {viewing.viewing_directions ? <ViewingDirections directions={viewing.viewing_directions} /> : null}
      <AppointmentHistory viewing={viewing} />

      {error ? <Notice tone="error" title={error} /> : null}

      {viewing.status === "offered" && viewing.actions.can_confirm_slot ? (
        <ConfirmOfferedSlot viewing={viewing} busy={busy} onConfirm={(slotId) => run(() => confirmMyViewingSlot(viewing.id, slotId))} />
      ) : null}

      <AttendanceResolutionPanel viewing={viewing} busy={busy} run={run} />

      {declining ? (
        <section className="viewing-inline-confirm">
          <Notice tone="warning" title="Decline this request?" body="The tenant will be told that this viewing will not go ahead." />
          <div className="viewing-actions"><Button variant="destructive" busy={busy} onClick={() => run(() => viewingAction(viewing.id, "decline", "Not available").then((result) => { setDeclining(false); return result; }))}>Decline request</Button><Button variant="quiet" disabled={busy} onClick={() => setDeclining(false)}>Keep request</Button></div>
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
          onCancel={() => setOffering(false)}
          onOffer={async (input) => {
            await run(() => rescheduling
              ? rescheduleViewing(viewing.id, input.slots)
              : offerSlots(viewing.id, input));
            setOffering(false);
            setRescheduling(false);
          }}
        />
      ) : (
        <div style={{ marginTop: "var(--space-4)", display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {viewing.actions.can_decline ? (
            <>
              <Button onClick={() => setOffering(true)}>
                {viewing.status === "offered" ? "Offer different times" : "Offer times"}
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
                <Notice
                  tone="info"
                  title={viewing.check_in.state === "upcoming" ? "Check-in opens near the viewing time" : "Waiting for verified check-in"}
                  body={viewing.check_in.opens_at && viewing.check_in.state === "upcoming" ? `Available after ${formatViewingTime(viewing.check_in.opens_at)}.` : "Ask the tenant to show their temporary QR or six-digit code when they arrive."}
                />
              )}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setRescheduling(true);
                  setOffering(true);
                }}
              >
                Offer different times
              </Button>
              {!cancelling ? <Button
                variant="quiet"
                busy={busy}
                onClick={() => setCancelling(true)}
              >
                Cancel appointment
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
              Cancel appointment
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
    <section style={{ marginTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
      <p className="type-body-strong" style={{ margin: 0 }}>Choose the replacement time</p>
      <p className="type-caption" style={{ margin: 0 }}>The other party suggested these times. Confirming one creates the next appointment in the history.</p>
      {available.map((slot) => (
        <Radio
          key={slot.id}
          name={`offered-slot-${viewing.id}`}
          label={formatViewingTime(slot.starts_at)}
          checked={selected === slot.id}
          onChange={() => setSelected(slot.id)}
        />
      ))}
      <div><Button busy={busy} disabled={!selected} onClick={() => onConfirm(selected)}>Confirm replacement time</Button></div>
    </section>
  );
}

function CancelAppointmentForm({ busy, onBack, onCancel }: { busy: boolean; onBack: () => void; onCancel: (input: { reason: ViewingCancellationReason; note?: string }) => Promise<void> }) {
  const [reason, setReason] = useState<ViewingCancellationReason>("schedule_conflict");
  const [note, setNote] = useState("");
  return (
    <section style={{ marginTop: "var(--space-4)", padding: "var(--space-4)", border: "var(--border-hairline) solid var(--color-field-300)", borderRadius: "var(--radius-sm)", display: "grid", gap: "var(--space-3)" }}>
      <Notice tone="info" title="Could a new time work?" body="Rescheduling keeps the appointment active. Cancel only when the viewing should not go ahead." />
      <label className="type-body-strong">Reason
        <select value={reason} onChange={(event) => setReason(event.target.value as ViewingCancellationReason)} style={{ display: "block", width: "100%", marginTop: "var(--space-1)", minHeight: 44 }}>
          <option value="schedule_conflict">Schedule conflict</option>
          <option value="emergency">Emergency</option>
          <option value="transportation_problem">Transportation problem</option>
          <option value="no_longer_interested">No longer interested</option>
          <option value="property_unavailable">Property or unit no longer available</option>
          <option value="other">Other</option>
        </select>
      </label>
      <Field label="Optional note" value={note} onChange={(event) => setNote(event.target.value)} />
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <Button variant="destructive" busy={busy} onClick={() => onCancel({ reason, note })}>Cancel appointment</Button>
        <Button variant="quiet" disabled={busy} onClick={onBack}>Keep appointment</Button>
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
      <section style={{ marginTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
        <Notice tone="info" title="Attendance report awaiting a response" body={`The other party reported the ${alleged} absent. This is an allegation, not a verified outcome.`} />
        {viewing.attendance.can_respond ? <>
          <Field label="Optional response note" value={note} onChange={(event) => setNote(event.target.value)} />
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <Button busy={busy} onClick={() => run(() => respondViewingAttendance(viewing.id, "confirm", note))}>Confirm I could not attend</Button>
            <Button variant="secondary" busy={busy} onClick={() => run(() => respondViewingAttendance(viewing.id, "dispute", note))}>Dispute report</Button>
          </div>
        </> : null}
      </section>
    );
  }
  if (!viewing.attendance.can_report) return null;
  return (
    <section style={{ marginTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
      <Notice tone="info" title="No verified check-in" body="A missing check-in does not prove who was absent. You may report that the other party did not attend; they will be asked to confirm or dispute it." />
      <Field label="Optional factual note" value={note} onChange={(event) => setNote(event.target.value)} />
      <div><Button variant="secondary" busy={busy} onClick={() => run(() => reportViewingNoShow(viewing.id, note))}>Report other party absent</Button></div>
    </section>
  );
}

function AppointmentHistory({ viewing }: { viewing: Viewing }) {
  if (viewing.appointments.length < 2 && !viewing.appointments.some((item) => item.status === "rescheduled")) return null;
  return (
    <details style={{ marginTop: "var(--space-3)" }}>
      <summary className="type-body-strong">Appointment history</summary>
      <ol className="type-caption" style={{ marginBottom: 0 }}>
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
    <section style={{ flexBasis: "100%", padding: "var(--space-4)", background: "var(--color-kola-50)", borderRadius: "var(--radius-sm)" }}>
      <h3 className="type-body-strong" style={{ margin: 0 }}>Ready for check-in</h3>
      <p className="type-caption" style={{ margin: "var(--space-1) 0 var(--space-3)" }}>Enter the temporary code shown on the tenant&apos;s screen.</p>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "end", flexWrap: "wrap" }}>
        <Field
          label="6-digit check-in code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        />
        <Button busy={busy} busyLabel="Checking…" disabled={code.length !== 6} onClick={submit}>Check in tenant</Button>
      </div>
      {error ? <Notice tone="error" title={error} /> : null}
    </section>
  );
}

function OfferTimes({
  onCancel,
  onOffer,
  purpose = "offer",
}: {
  onCancel: () => void;
  onOffer: (input: {
    slots: { starts_at: string }[];
  }) => Promise<void>;
  purpose?: "offer" | "reschedule";
}) {
  const [times, setTimes] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);

  const filled = times.filter((value) => value);

  return (
    <div style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <p className="type-caption" style={{ margin: 0, color: "var(--color-ink-700)" }}>
        {purpose === "reschedule"
          ? "Suggest up to five replacement times. The other party confirms one; the original appointment remains in the history."
          : "Offer up to five times. The tenant picks one, and only then do you exchange numbers."}
      </p>

      {times.map((value, index) => (
        <Field
          key={index}
          label={index === 0 ? "A time that works" : "Another time"}
          type="datetime-local"
          value={value}
          onChange={(event) => {
            const next = [...times];
            next[index] = event.target.value;
            setTimes(next);
          }}
        />
      ))}

      {times.length < 5 ? (
        <div>
          <Button variant="quiet" onClick={() => setTimes([...times, ""])}>
            Add another time
          </Button>
        </div>
      ) : null}

      <Notice tone="info" title="Rooomly viewings are free" body="Tenants should never be charged simply to attend a viewing." />

      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <Button
          busy={busy}
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
          {purpose === "reschedule" ? "Suggest" : "Offer"} {filled.length ? `${filled.length} time${filled.length === 1 ? "" : "s"}` : "times"}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
