"use client";

import { useMemo, useState } from "react";

import { Check } from "@/components/Check";
import { Icon } from "@/components/portal/icons";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ModalViews, useModalViews } from "@/components/workspace/ModalViews";
import { PanelSkeleton, PanelState, SegmentedControl } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  createPassportShare,
  dayMonthYear,
  previewPassport,
  SHARE_LIFETIMES,
  shareUrl,
  tenancyPeriod,
  type PassportScope,
  type PassportShare,
  type PassportView,
  type ShareLifetime,
} from "@/lib/passport";

import { PassportDocument } from "./PassportDocument";
import { CopyLink } from "./SharedLinks";

type View = { kind: "preview" } | { kind: "ready"; share: PassportShare };

/**
 * Share Housing Passport: choose, see exactly what they will see, get a link.
 *
 * The preview is the backend's own answer for the chosen scope, rendered by the
 * same document the recipient gets — not a client-side guess at it. Once the
 * link exists there is no way back into the choices: changing what a live link
 * shows would mean a recipient's page changing under them, so a different
 * choice is a different link.
 */
export function ShareFlow({
  open,
  passport,
  onClose,
  onCreated,
}: {
  open: boolean;
  passport: PassportView;
  onClose: () => void;
  onCreated: (share: PassportShare) => void;
}) {
  const nav = useModalViews<View>(open, "share");
  const [label, setLabel] = useState("");
  const [identity, setIdentity] = useState(true);
  const [tenancyIds, setTenancyIds] = useState<string[]>([]);
  const [payments, setPayments] = useState(true);
  const [amounts, setAmounts] = useState(false);
  const [days, setDays] = useState<ShareLifetime>(7);
  const [preview, setPreview] = useState<PassportView | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Each opening starts from the sensible default: everything agreed, no
  // amounts. Adjusted during render on the opening itself, so a reload of the
  // passport behind an open sheet never wipes what was chosen.
  const [seenOpen, setSeenOpen] = useState(false);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) {
      setLabel("");
      setIdentity(true);
      setTenancyIds(passport.tenancies.filter((row) => row.status !== "pending_lease").map((row) => row.id));
      setPayments(true);
      setAmounts(false);
      setDays(7);
      setError("");
      setPreview(null);
    }
  }

  const scope: PassportScope = useMemo(() => ({
    include_identity: identity,
    tenancy_ids: tenancyIds,
    include_payments: payments && tenancyIds.length > 0,
    include_amounts: amounts && tenancyIds.length > 0,
  }), [amounts, identity, payments, tenancyIds]);
  const nothing = !identity && tenancyIds.length === 0;
  const top = nav.top;
  const ready = top?.kind === "ready" ? top.share : null;

  async function showPreview() {
    setPreview(null);
    setPreviewError("");
    nav.push({ kind: "preview" });
    try {
      setPreview(await previewPassport(scope));
    } catch (cause) {
      setPreviewError(cause instanceof ApiFailure ? cause.error.message : "The preview didn’t load.");
    }
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const share = await createPassportShare({ ...scope, recipient_label: label.trim(), expires_in_days: days });
      onCreated(share);
      nav.push({ kind: "ready", share });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "The link wasn’t created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function toggleTenancy(id: string, on: boolean) {
    setTenancyIds((current) => (on ? [...current, id] : current.filter((value) => value !== id)));
  }

  const title = ready ? "Link ready" : top?.kind === "preview" ? "What they’ll see" : "Share Housing Passport";
  const meta = ready
    ? `Works until ${dayMonthYear(ready.expires_at)}`
    : top?.kind === "preview"
      ? "Read from your records each time it is opened"
      : "Choose what to show. Nothing else is shared.";

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      icon="share"
      title={title}
      meta={meta}
      viewKey={top?.kind ?? "choose"}
      // The link is a short message; the sheet glides down to fit it.
      size={ready ? "sm" : "md"}
      className="passport-share-sheet"
      closeLabel="Close sharing"
      // From the link there is no going back to change what it shows.
      onBack={nav.depth && !ready ? nav.back : undefined}
      backLabel="Back to choices"
      footer={(close) => ready ? (
        <button type="button" className="ws-action is-primary" onClick={close}>Done</button>
      ) : top?.kind === "preview" ? (
        <>
          {error ? <span className="doc-modal-foot-note passport-foot-error" role="alert">{error}</span> : <span className="doc-modal-foot-note">Lasts {SHARE_LIFETIMES.find((row) => row.days === days)?.label}. You can withdraw it at any time.</span>}
          <button type="button" className="ws-action" onClick={nav.back}>Change</button>
          <button type="button" className="ws-action is-primary" disabled={busy || !preview} onClick={() => void create()}>
            <Icon name="link" />{busy ? "Creating…" : "Create link"}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="ws-action" onClick={close}>Cancel</button>
          <button type="button" className="ws-action is-primary" disabled={nothing} onClick={() => void showPreview()}>
            <Icon name="eye" />Preview
          </button>
        </>
      )}
    >
      <ModalViews depth={nav.depth} direction={nav.direction}>
        <div className="passport-choose">
          <label className="passport-field">
            <span>Who is it for? <em>Optional · they’ll see this</em></span>
            <input
              value={label}
              maxLength={80}
              placeholder="e.g. Landlord at East Legon"
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>

          <fieldset className="passport-choices">
            <legend>Include</legend>
            <div className="passport-choice">
              <Check
                checked={identity}
                onChange={setIdentity}
                label="Identity checks"
                note="Whether your Ghana Card, phone and email are verified — never the numbers"
              />
            </div>
            {passport.tenancies.length ? passport.tenancies.map((tenancy) => (
              <div className="passport-choice" key={tenancy.id}>
                <Check
                  checked={tenancyIds.includes(tenancy.id)}
                  onChange={(on) => toggleTenancy(tenancy.id, on)}
                  label={`${tenancy.place.title}${tenancy.place.space ? ` · ${tenancy.place.space}` : ""}`}
                  note={[tenancyPeriod(tenancy), tenancy.place.locality].filter(Boolean).join(" · ")}
                />
              </div>
            )) : (
              <p className="passport-choice-empty">No tenancies on Danpa HQ yet. You can still share your identity checks.</p>
            )}
          </fieldset>

          {passport.tenancies.length ? (
            <fieldset className="passport-choices" disabled={!tenancyIds.length}>
              <legend>For the chosen tenancies</legend>
              <div className="passport-choice">
                <Check
                  checked={payments && tenancyIds.length > 0}
                  disabled={!tenancyIds.length}
                  onChange={setPayments}
                  label="Rent payment record"
                  note="Confirmed, on-time, late and overdue counts"
                />
              </div>
              <div className="passport-choice">
                <Check
                  checked={amounts && tenancyIds.length > 0}
                  disabled={!tenancyIds.length}
                  onChange={setAmounts}
                  label="Show amounts"
                  note="Rent and total confirmed. Off by default"
                />
              </div>
            </fieldset>
          ) : null}

          <div className="passport-lifetime">
            <span id="passport-lifetime-label">Link lasts</span>
            <SegmentedControl
              inline
              label="Link lasts"
              value={String(days) as `${ShareLifetime}`}
              options={SHARE_LIFETIMES.map((row) => ({ key: String(row.days) as `${ShareLifetime}`, label: row.label }))}
              onChange={(value) => setDays(Number(value) as ShareLifetime)}
            />
          </div>

          {nothing ? <p className="passport-choice-warning" role="status">Choose at least one thing to share.</p> : null}
        </div>

        {nav.views.map((view, index) => view.kind === "preview" ? (
          <div className="passport-preview" key={`preview-${index}`}>
            {preview ? (
              <PassportDocument
                view={preview}
                audience="recipient"
                coverFooter={<PreparedFor label={label.trim()} until={`${SHARE_LIFETIMES.find((row) => row.days === days)?.label} from when you create it`} />}
              />
            ) : previewError ? (
              <PanelState tone="error" icon="warning" title="Preview didn’t load" body={previewError} action={<button type="button" className="ws-action" onClick={() => void showPreview()}>Try again</button>} />
            ) : (
              <PanelSkeleton rows={3} />
            )}
          </div>
        ) : (
          <LinkReady key={view.share.id} share={view.share} />
        ))}
      </ModalViews>
    </ModalSheet>
  );
}

export function PreparedFor({ label, until }: { label: string; until: string }) {
  return (
    <>
      <span>{label ? <>Prepared for <strong>{label}</strong></> : "Shared by link"}</span>
      <span>Valid {until}</span>
    </>
  );
}

function LinkReady({ share }: { share: PassportShare }) {
  const url = share.token ? shareUrl(share.token) : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="passport-ready">
      <span className="passport-ready-mark" aria-hidden="true"><Icon name="link" /></span>
      <p>Anyone with this link can read what you chose until {dayMonthYear(share.expires_at)}. Send it only to the person it’s for.</p>
      <CopyLink url={url} autoFocus />
      {canShare ? (
        <button
          type="button"
          className="ws-action"
          onClick={() => void navigator.share({ title: "My Danpa HQ Housing Passport", url }).catch(() => undefined)}
        >
          <Icon name="share" />Send with another app
        </button>
      ) : null}
      <p className="passport-fineprint">It stays in Shared links on your passport, where you can copy it again or withdraw it.</p>
    </div>
  );
}
