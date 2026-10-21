"use client";

/**
 * The artisan's own work: quote invitations (Requests) and assigned jobs (Jobs).
 *
 * One sheet serves both, because they are one record at two moments. Invited,
 * the sheet shows the problem, its photograph and the area — and the quote form.
 * Assigned, it also shows what the payer's approval unlocked: the address, the
 * contact on site, who approved, the price on record and the request's history,
 * with a way to ask for a revised price. Nothing here is fetched before the
 * backend decides it may be.
 */

import { MapPin, Phone, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { useToast } from "@/components/toast/Toaster";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { PanelSkeleton, PanelState } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  INVITATION_STATE_LABEL,
  declineInvitation,
  getMyInvitation,
  submitQuote,
  submitRevision,
  toMinor,
  withdrawQuote,
  type ArtisanInvitation,
  type Material,
} from "@/lib/artisan";
import { useDeepLinkedModal } from "@/lib/deepLinkedModal";
import { onDate } from "@/lib/time";

const STATE_TONE: Record<string, string> = {
  invited: "is-harmattan",
  quoted: "is-lagoon",
  assigned: "is-kola",
  declined: "is-muted",
  closed: "is-muted",
  suggested: "is-muted",
  cancelled: "is-muted",
};

/** A list of invitations or jobs, and the sheet that opens one. */
export function WorkList({
  rows,
  empty,
  onChanged,
}: {
  rows: ArtisanInvitation[] | null;
  empty: { icon: "receipt" | "wrench"; title: string; body: string };
  onChanged: () => void | Promise<void>;
}) {
  const [openId, setOpenId] = useDeepLinkedModal("invitation");

  return (
    <>
      <section className="ws-panel art-list" aria-busy={rows === null || undefined}>
        {rows === null ? (
          <PanelSkeleton rows={3} />
        ) : rows.length ? (
          <ul>
            {rows.map((row) => {
              const pending = row.quotes.find((quote) => quote.status === "submitted");
              const onRecord = row.job?.price_on_record;
              return (
                <li key={row.id}>
                  <button type="button" className="art-row" onClick={() => setOpenId(row.id)}>
                    <span className="art-row-thumb" aria-hidden="true">
                      {row.request.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.request.photo.url} alt="" />
                      ) : (
                        <Icon name="wrench" />
                      )}
                    </span>
                    <span className="art-row-body">
                      <strong>{row.request.title}</strong>
                      <span className="art-result-area">
                        <MapPin aria-hidden="true" />
                        {row.unlocked && row.job ? row.job.address.line : [row.request.area.locality, row.request.area.district].filter(Boolean).join(", ")}
                      </span>
                      <small>{row.request.description}</small>
                    </span>
                    <span className="art-row-side">
                      <span className={`art-state ${STATE_TONE[row.state] ?? ""}`}>{INVITATION_STATE_LABEL[row.state]}</span>
                      {onRecord ? <strong>{onRecord.price_display}</strong> : pending ? <strong>{pending.price_display}</strong> : null}
                      <small>{onDate(row.invited_at ?? row.request.reported_at)}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <PanelState icon={empty.icon} title={empty.title} body={empty.body} />
        )}
      </section>
      <InvitationSheet
        id={openId}
        onClose={() => setOpenId("")}
        onChanged={onChanged}
      />
    </>
  );
}

function InvitationSheet({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [row, setRow] = useState<ArtisanInvitation | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let live = true;
    getMyInvitation(id)
      .then((next) => { if (live) { setRow(next); setError(""); } })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "This did not open."); });
    return () => { live = false; };
  }, [id]);

  const shown = row && row.id === id ? row : null;
  const update = useCallback(async (next: ArtisanInvitation) => {
    setRow(next);
    await onChanged();
  }, [onChanged]);

  return (
    <ModalSheet
      open={Boolean(id)}
      onClose={onClose}
      icon={shown?.unlocked ? "wrench" : "receipt"}
      title={shown ? shown.request.title : "Request"}
      meta={shown ? INVITATION_STATE_LABEL[shown.state] : error ? undefined : "Opening…"}
      className="art-job-sheet"
      bodyBusy={!shown && !error}
    >
      {error ? (
        <div className="doc-modal-state" role="alert"><strong>This did not open</strong><span>{error}</span></div>
      ) : shown ? (
        <Invitation row={shown} onChanged={update} />
      ) : (
        <PanelSkeleton rows={4} />
      )}
    </ModalSheet>
  );
}

function Invitation({ row, onChanged }: { row: ArtisanInvitation; onChanged: (next: ArtisanInvitation) => Promise<void> }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = row.quotes.find((quote) => quote.status === "submitted");
  const job = row.unlocked ? row.job : undefined;

  async function act(run: () => Promise<ArtisanInvitation>, done: string) {
    setBusy(true);
    setError("");
    try {
      await onChanged(await run());
      toast({ tone: "success", title: done });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="art-job">
      {job ? (
        <section className="art-job-unlocked" aria-label="The job">
          <div className="art-job-line">
            <MapPin aria-hidden="true" />
            <span>
              <strong>{job.address.line}</strong>
              <small>
                {[job.place?.unit_label, job.address.digital_address, job.address.landmark].filter(Boolean).join(" · ")}
              </small>
            </span>
          </div>
          <div className="art-job-line">
            <Phone aria-hidden="true" />
            <span>
              <strong>{job.contact.name}</strong>
              <small>{job.contact.role}</small>
            </span>
            {job.contact.phone ? <a className="ws-action" href={`tel:${job.contact.phone.replace(/\s/g, "")}`}>{job.contact.phone}</a> : null}
          </div>
          <p className="art-job-approved">
            Approved by {job.approved_by}{job.approved_at ? ` on ${onDate(job.approved_at)}` : ""}
            {job.price_on_record ? <> · price on record <strong>{job.price_on_record.price_display}</strong></> : null}
          </p>
        </section>
      ) : (
        <p className="art-job-private">
          <Icon name="lock" />
          The address and a contact open here if your quote is approved.
        </p>
      )}

      {row.request.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="art-job-photo" src={row.request.photo.url} alt={`Photo: ${row.request.title}`} />
      ) : null}
      <blockquote className="rq-message">
        <small>
          {row.request.area.locality}{row.request.area.district ? `, ${row.request.area.district}` : ""} · {row.request.kind === "direct_job" ? `${row.request.category_display}, posted` : "reported"} {onDate(row.request.reported_at)}
        </small>
        {row.request.description}
      </blockquote>

      {error ? <Notice tone="error" title={error} /> : null}

      {row.quotes.length ? (
        <section className="art-job-quotes" aria-label="Your quotes">
          {row.quotes.map((quote) => (
            <div key={quote.id} className="mt-quote">
              <strong className="mt-quote-price">
                {quote.revises ? "Revised: " : ""}{quote.price_display} · {quote.status_display}
              </strong>
              {quote.reason ? <p className="mt-quote-reason">{quote.reason}</p> : null}
              <p className="mt-quote-scope">{quote.scope}</p>
              {quote.decision_note ? <p className="mt-quote-reason">{quote.decision_note}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {row.state === "invited" ? (
        <QuoteForm
          title="Send your quote"
          busy={busy}
          onSubmit={(input) => act(() => submitQuote(row.id, input), "Quote sent")}
          secondary={{ label: "Decline", onClick: () => void act(() => declineInvitation(row.id), "Invitation declined") }}
        />
      ) : pending && !pending.revises ? (
        <div className="mt-quote-actions">
          <button type="button" className="ws-action" disabled={busy} onClick={() => void act(() => withdrawQuote(pending.id), "Quote withdrawn")}>
            Withdraw quote
          </button>
        </div>
      ) : null}

      {row.state === "assigned" && !pending ? (
        <details className="art-revise">
          <summary>Found more work? Ask for a revised price</summary>
          <QuoteForm
            title="Revised quote"
            withReason
            busy={busy}
            onSubmit={(input) => act(() => submitRevision(row.request.kind, row.request.id, input), "Revised price sent")}
          />
        </details>
      ) : null}

      {job?.history.length ? (
        <section className="mt-history" aria-label="History">
          <header><strong>History</strong></header>
          <ol>
            {[...job.history].reverse().map((event, index) => (
              <li key={`${event.kind}-${index}`}>
                <span className="mt-history-dot" aria-hidden="true" />
                <span className="mt-history-copy">
                  <strong>{event.kind_display}</strong>
                  {event.note ? <span>{event.note}</span> : null}
                  <small>{onDate(event.at)}</small>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function QuoteForm({
  title,
  busy,
  withReason = false,
  onSubmit,
  secondary,
}: {
  title: string;
  busy: boolean;
  withReason?: boolean;
  onSubmit: (input: { price_minor: number; scope: string; materials: Material[]; reason: string }) => Promise<void>;
  secondary?: { label: string; onClick: () => void };
}) {
  const [price, setPrice] = useState("");
  const [scope, setScope] = useState("");
  const [reason, setReason] = useState("");
  const [materials, setMaterials] = useState<{ item: string; quantity: string; cost: string }[]>([]);
  const [attempted, setAttempted] = useState(false);
  const priceMinor = toMinor(price);
  const ready = priceMinor !== null && scope.trim().length >= 10 && (!withReason || reason.trim().length >= 10);

  return (
    <form
      className="art-quote-form"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!ready || priceMinor === null) return;
        void onSubmit({
          price_minor: priceMinor,
          scope: scope.trim(),
          reason: reason.trim(),
          materials: materials
            .filter((row) => row.item.trim())
            .map((row) => ({ item: row.item.trim(), quantity: row.quantity.trim(), cost_minor: toMinor(row.cost) })),
        });
      }}
    >
      <h3>{title}</h3>
      {withReason ? (
        <div className="mt-field">
          <label htmlFor="art-reason">What did you find?</label>
          <textarea id="art-reason" className="lw-textarea" rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="The tap body is cracked, so a washer will not hold." />
        </div>
      ) : null}
      <Field
        label="Price (GH₵)"
        inputMode="decimal"
        value={price}
        placeholder="450.00"
        error={attempted && priceMinor === null ? "Enter the price." : undefined}
        onChange={(event) => setPrice(event.target.value)}
      />
      <div className="mt-field">
        <label htmlFor="art-scope">What the price covers</label>
        <textarea id="art-scope" className="lw-textarea" rows={3} maxLength={1000} value={scope} onChange={(event) => setScope(event.target.value)} placeholder="Replace the tap washer and reseal the sink trap." />
        {attempted && scope.trim().length < 10 ? <span className="art-missing">Say in a sentence what it covers.</span> : null}
      </div>
      <div className="art-materials">
        <span className="type-caption field-label">Materials <span className="art-optional">optional</span></span>
        {materials.map((row, index) => (
          <div key={index} className="art-material">
            <input className="field-input type-body" aria-label="Item" placeholder="Item" value={row.item} onChange={(event) => setMaterials((current) => current.map((item, at) => (at === index ? { ...item, item: event.target.value } : item)))} />
            <input className="field-input type-body" aria-label="Quantity" placeholder="Qty" value={row.quantity} onChange={(event) => setMaterials((current) => current.map((item, at) => (at === index ? { ...item, quantity: event.target.value } : item)))} />
            <input className="field-input type-body" aria-label="Cost in cedis" placeholder="GH₵" inputMode="decimal" value={row.cost} onChange={(event) => setMaterials((current) => current.map((item, at) => (at === index ? { ...item, cost: event.target.value } : item)))} />
            <button type="button" className="art-certificate-remove" aria-label={`Remove material ${index + 1}`} onClick={() => setMaterials((current) => current.filter((_, at) => at !== index))}><X /></button>
          </div>
        ))}
        {materials.length < 20 ? (
          <button type="button" className="art-add-certificate" onClick={() => setMaterials((current) => [...current, { item: "", quantity: "", cost: "" }])}>
            <Plus aria-hidden="true" /> Add a material
          </button>
        ) : null}
      </div>
      <div className="mt-quote-actions">
        <button type="submit" className="ws-action is-primary" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
        {secondary ? <button type="button" className="ws-action" disabled={busy} onClick={secondary.onClick}>{secondary.label}</button> : null}
      </div>
    </form>
  );
}
