"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/portal/icons";
import { useToast } from "@/components/toast/Toaster";
import { ApiFailure } from "@/lib/api";
import {
  dayMonthYear,
  revokePassportShare,
  scopeLine,
  shareLifeLine,
  shareUrl,
  viewsLine,
  type PassportShare,
} from "@/lib/passport";
import { timeAgo } from "@/lib/time";

/**
 * Who can read the passport right now, and the way to stop them.
 *
 * Live links first, each with its copy and its withdraw; links that have
 * stopped working stay listed for a month, quieter, so the tenant can see
 * what they shared and when it ended.
 */
export function SharedLinks({
  shares,
  error,
  onShare,
  onChanged,
}: {
  shares: PassportShare[] | null;
  error: string;
  onShare: () => void;
  onChanged: (share: PassportShare) => void;
}) {
  const live = (shares ?? []).filter((share) => share.state === "active");
  const ended = (shares ?? []).filter((share) => share.state !== "active");
  const [showEnded, setShowEnded] = useState(false);

  return (
    <section className="passport-section passport-links" aria-labelledby="passport-links" aria-busy={shares === null || undefined}>
      <header className="passport-section-head">
        <h3 id="passport-links">Shared links</h3>
        {live.length ? <span className="passport-section-count">{live.length} live</span> : null}
      </header>

      {shares === null ? (
        <div className="passport-links-skeleton" aria-label="Loading"><span /><span /></div>
      ) : error && !shares.length ? (
        <p className="passport-links-error" role="alert"><Icon name="warning" />{error}</p>
      ) : !live.length ? (
        <div className="passport-links-empty">
          <span className="passport-links-empty-mark" aria-hidden="true"><Icon name="link" /></span>
          <p><strong>Not shared with anyone</strong><span>Make a read-only link for a landlord you’re applying to.</span></p>
          <button type="button" className="ws-action is-primary" onClick={onShare}><Icon name="share" />Share</button>
        </div>
      ) : (
        <ul className="passport-link-list">
          {live.map((share) => <LinkRow key={share.id} share={share} onChanged={onChanged} />)}
        </ul>
      )}

      {ended.length ? (
        <div className="passport-links-ended">
          <button type="button" className="passport-disclosure" aria-expanded={showEnded} onClick={() => setShowEnded((value) => !value)}>
            {ended.length} ended link{ended.length === 1 ? "" : "s"}
            <Icon name="chevron-down" />
          </button>
          {showEnded ? (
            <ul className="passport-link-list is-ended">
              {ended.map((share) => <LinkRow key={share.id} share={share} onChanged={onChanged} />)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LinkRow({ share, onChanged }: { share: PassportShare; onChanged: (share: PassportShare) => void }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = share.state === "active";

  async function revoke() {
    setBusy(true);
    try {
      const next = await revokePassportShare(share.id);
      onChanged(next);
      toast({ tone: "success", title: "Link withdrawn", description: "It stopped working straight away." });
    } catch (cause) {
      toast({ tone: "error", title: "The link is still live", description: cause instanceof ApiFailure ? cause.error.message : "Try again." });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className={`passport-link is-${share.state}`}>
      <div className="passport-link-text">
        <strong>{share.recipient_label || "Shared by link"}</strong>
        <span>{scopeLine(share.scope)}</span>
        <small>
          <span className={`passport-link-life is-${share.state}`}>{shareLifeLine(share)}</span>
          <span>
            {live ? viewsLine(share) : `Made ${dayMonthYear(share.created_at)}`}
            {live && share.last_viewed_at ? `, last ${timeAgo(share.last_viewed_at)}` : ""}
          </span>
        </small>
      </div>
      {live && share.token ? (
        confirming ? (
          <div className="passport-link-confirm" role="group" aria-label="Withdraw this link?">
            <span>Withdraw? It stops working at once.</span>
            <button type="button" className="ws-action" disabled={busy} onClick={() => setConfirming(false)}>Keep</button>
            <button type="button" className="ws-action is-danger" disabled={busy} onClick={() => void revoke()}>{busy ? "Withdrawing…" : "Withdraw"}</button>
          </div>
        ) : (
          <div className="passport-link-actions">
            <CopyLink url={shareUrl(share.token)} compact />
            <button type="button" className="ws-action is-quiet-danger" onClick={() => setConfirming(true)}>Withdraw</button>
          </div>
        )
      ) : null}
    </li>
  );
}

/** The link, readable and copyable, with a confirmation that it was copied. */
export function CopyLink({ url, compact = false, autoFocus = false }: { url: string; compact?: boolean; autoFocus?: boolean }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) button.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard permission: select it so a long-press or Ctrl+C still works.
      field.current?.select();
    }
  }

  if (compact) {
    return (
      <button type="button" className={`ws-action passport-copy${copied ? " is-copied" : ""}`} onClick={() => void copy()} aria-live="polite">
        <Icon name={copied ? "check" : "copy"} />{copied ? "Copied" : "Copy link"}
      </button>
    );
  }
  return (
    <div className={`passport-copy-field${copied ? " is-copied" : ""}`}>
      <input ref={field} readOnly value={url} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} />
      <button ref={button} type="button" onClick={() => void copy()} aria-live="polite">
        <Icon name={copied ? "check" : "copy"} />{copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
