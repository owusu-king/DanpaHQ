"use client";

/**
 * The artisan part of a maintenance request: who was asked, what they quoted,
 * who is doing the work, and the price on record.
 *
 * The request stays the record — this section reads `request.artisans` and
 * never keeps a status of its own. What it offers comes from the backend's
 * `permissions`: anybody who runs the property may invite up to three
 * artisans; only the payer may approve a price; the tenant may suggest an
 * artisan and sees who is doing the work, never what it costs.
 *
 * Approving commits the owner's money, so it asks once more before it goes.
 */

import { Hammer } from "lucide-react";
import { useEffect, useState } from "react";

import { openArtisans } from "@/components/artisan/ArtisansSheet";
import { Notice } from "@/components/Notice";
import { useToast } from "@/components/toast/Toaster";
import { ApiFailure } from "@/lib/api";
import {
  ARTISAN_WORK_CHANGED,
  INVITATION_STATE_LABEL,
  PAYMENT_TIP,
  TRADE_FOR_CATEGORY,
  approveQuote,
  declineQuote,
  type ArtisanBrief,
  type QuoteView,
} from "@/lib/artisan";
import { getMaintenanceRequest, type MaintenanceRequest } from "@/lib/maintenance";
import { formatMoney } from "@/lib/money";
import { onDate } from "@/lib/time";

type Side = "tenant" | "provider";

export function MaintenanceArtisans({
  request,
  side,
  onChanged,
}: {
  request: MaintenanceRequest;
  side: Side;
  onChanged: (next: MaintenanceRequest) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const work = request.artisans;

  // An invitation or suggestion made in the Artisans sheet lands here at once.
  useEffect(() => {
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ requestId: string }>).detail?.requestId !== request.id) return;
      void getMaintenanceRequest(request.id).then(onChanged).catch(() => undefined);
    };
    window.addEventListener(ARTISAN_WORK_CHANGED, onChange);
    return () => window.removeEventListener(ARTISAN_WORK_CHANGED, onChange);
  }, [request.id, onChanged]);

  if (!work) return null;
  const nothing = !work.assigned && !work.invitations.length && !work.permissions.invite && !work.permissions.suggest;
  if (nothing) return null;

  async function decide(quote: QuoteView, approve: boolean) {
    setBusy(quote.id);
    setError("");
    try {
      if (approve) await approveQuote(quote.id);
      else await declineQuote(quote.id);
      setConfirming(null);
      await onChanged(await getMaintenanceRequest(request.id));
      toast({
        tone: "success",
        title: approve
          ? quote.revises ? "Revised price approved" : "Artisan assigned"
          : quote.revises ? "Revised price declined" : "Quote declined",
      });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const pendingRevision = work.invitations
    .flatMap((row) => row.quotes)
    .find((quote) => quote.revises && quote.status === "submitted");
  const waitingRows = work.invitations.filter((row) => row.state !== "assigned");

  function find(mode: "invite" | "suggest") {
    openArtisans({
      tab: "find",
      trade: TRADE_FOR_CATEGORY[request.category],
      forRequest: { id: request.id, mode, label: request.category_display },
    });
  }

  return (
    <section className="mt-artisans" aria-labelledby={`mt-artisans-${request.id}`}>
      <header className="mt-artisans-head">
        <strong id={`mt-artisans-${request.id}`}>Artisan</strong>
        {work.permissions.invite ? (
          <button type="button" className="ws-action" onClick={() => find("invite")}>
            {work.invitations.some((row) => row.state !== "suggested") ? "Invite another" : "Find an artisan"}
          </button>
        ) : work.permissions.suggest ? (
          <button type="button" className="ws-action" onClick={() => find("suggest")}>Suggest an artisan</button>
        ) : null}
      </header>

      {error ? <Notice tone="error" title={error} /> : null}

      {work.assigned ? (
        <div className="mt-artisan is-assigned">
          <Brief artisan={work.assigned.artisan} />
          <div className="mt-artisan-facts">
            <span className="mt-artisan-chip is-kola">Doing the work</span>
            {work.assigned.assigned_at ? <small>Since {onDate(work.assigned.assigned_at)}</small> : null}
            {work.assigned.price_on_record ? (
              <small>
                Price on record <strong>{work.assigned.price_on_record.price_display}</strong>
              </small>
            ) : null}
          </div>
          {pendingRevision && side === "provider" ? (
            <QuoteCard
              quote={pendingRevision}
              title={`Revised price: ${pendingRevision.price_display}`}
              canDecide={work.permissions.approve}
              confirming={confirming === pendingRevision.id}
              busy={busy === pendingRevision.id}
              onAsk={() => setConfirming(pendingRevision.id)}
              onCancel={() => setConfirming(null)}
              onDecide={(approve) => void decide(pendingRevision, approve)}
            />
          ) : null}
        </div>
      ) : null}

      {waitingRows.length ? (
        <ul className="mt-artisan-list">
          {waitingRows.map((row) => {
            const waiting = row.quotes.find((quote) => quote.status === "submitted" && !quote.revises);
            const latest = waiting ?? row.quotes[row.quotes.length - 1];
            return (
              <li key={row.id} className="mt-artisan">
                <Brief artisan={row.artisan} />
                <div className="mt-artisan-facts">
                  <span className={`mt-artisan-chip is-${row.state}`}>{INVITATION_STATE_LABEL[row.state]}</span>
                  {row.suggested_by_tenant && row.state !== "suggested" ? <small>Suggested by the tenant</small> : null}
                </div>
                {latest && side === "provider" ? (
                  <QuoteCard
                    quote={latest}
                    title={`${latest.price_display}${latest.status === "submitted" ? "" : ` · ${latest.status_display}`}`}
                    canDecide={work.permissions.approve && latest.status === "submitted" && !work.assigned}
                    confirming={confirming === latest.id}
                    busy={busy === latest.id}
                    onAsk={() => setConfirming(latest.id)}
                    onCancel={() => setConfirming(null)}
                    onDecide={(approve) => void decide(latest, approve)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {side === "provider" && !work.permissions.approve && work.invitations.some((row) => row.quotes.some((q) => q.status === "submitted")) ? (
        <p className="mt-artisan-note">
          Only the owner, a Portfolio owner or administrator, or the Property Manager assigned to this property can approve a price.
        </p>
      ) : null}
    </section>
  );
}

export function Brief({ artisan }: { artisan: ArtisanBrief }) {
  return (
    <span className="mt-artisan-who">
      <span className="mt-artisan-face" aria-hidden="true">
        {artisan.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artisan.cover_url} alt="" />
        ) : (
          <Hammer />
        )}
      </span>
      <span>
        <strong>{artisan.name}</strong>
        <small>{artisan.trades.map((trade) => trade.label).join(" · ")}</small>
      </span>
    </span>
  );
}

export function QuoteCard({
  quote,
  title,
  canDecide,
  confirming,
  busy,
  onAsk,
  onCancel,
  onDecide,
}: {
  quote: QuoteView;
  title: string;
  canDecide: boolean;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onDecide: (approve: boolean) => void;
}) {
  return (
    <div className="mt-quote">
      <strong className="mt-quote-price">{title}</strong>
      {quote.reason ? <p className="mt-quote-reason">{quote.reason}</p> : null}
      <p className="mt-quote-scope">{quote.scope}</p>
      {quote.materials.length ? (
        <ul className="mt-quote-materials" aria-label="Materials">
          {quote.materials.map((row, index) => (
            <li key={`${row.item}-${index}`}>
              <span>{row.item}{row.quantity ? ` × ${row.quantity}` : ""}</span>
              {row.cost_minor != null ? <span>{formatMoney({ minor: row.cost_minor, currency: "GHS" })}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {quote.decision_note ? <p className="mt-quote-reason">{quote.decision_note}</p> : null}
      {canDecide ? (
        <>
          <p className="mt-quote-tip">{PAYMENT_TIP}</p>
          {confirming ? (
            <div className="mt-quote-actions">
              <button type="button" className="ws-action is-primary" disabled={busy} onClick={() => onDecide(true)}>
                {busy ? "Approving…" : `Approve ${quote.price_display}`}
              </button>
              <button type="button" className="ws-action" disabled={busy} onClick={onCancel}>Not yet</button>
            </div>
          ) : (
            <div className="mt-quote-actions">
              <button type="button" className="ws-action is-primary" disabled={busy} onClick={onAsk}>Approve</button>
              <button type="button" className="ws-action" disabled={busy} onClick={() => onDecide(false)}>
                {busy ? "Declining…" : "Decline"}
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
