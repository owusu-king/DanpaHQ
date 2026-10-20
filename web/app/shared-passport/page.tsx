"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PassportDocument } from "@/components/passport/PassportDocument";
import { PreparedFor } from "@/components/passport/ShareFlow";
import { Icon, type IconName } from "@/components/portal/icons";
import { ApiFailure } from "@/lib/api";
import { dayMonthYear, openSharedPassport, type SharedPassport } from "@/lib/passport";

/**
 * A Housing Passport someone chose to share, as its recipient reads it.
 *
 * The token lives in the address's fragment (`/shared-passport#<token>`): a
 * fragment is never sent to a server, so it stays out of web-server logs and
 * Referer headers, and the API receives it only in a POST body. Nothing here
 * needs or reads a session — the link is the whole authority, and being signed
 * in as anyone changes nothing about what it shows.
 *
 * Its own chrome (AppShell's BARE list): this is a document handed to a
 * landlord, not a page of anybody's portal.
 */

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; passport: SharedPassport }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "revoked" }
  | { kind: "error"; message: string };

function tokenFromHash(): string {
  if (typeof window === "undefined") return "";
  return decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
}

export default function SharedPassportPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async (signal: { live: boolean }) => {
    const token = tokenFromHash();
    if (!token) { setPhase({ kind: "invalid" }); return; }
    setPhase((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    try {
      const passport = await openSharedPassport(token);
      if (signal.live) setPhase({ kind: "ready", passport });
    } catch (cause) {
      if (!signal.live) return;
      const code = cause instanceof ApiFailure ? cause.error.code : "";
      if (code === "passport_share_expired") setPhase({ kind: "expired" });
      else if (code === "passport_share_revoked") setPhase({ kind: "revoked" });
      else if (cause instanceof ApiFailure && (cause.status === 404 || cause.status === 422)) setPhase({ kind: "invalid" });
      else setPhase({ kind: "error", message: cause instanceof ApiFailure ? cause.error.message : "We couldn’t reach Danpa HQ." });
    }
  }, []);

  useEffect(() => {
    const signal = { live: true };
    void load(signal);
    const changed = () => void load(signal);
    window.addEventListener("hashchange", changed);
    return () => { signal.live = false; window.removeEventListener("hashchange", changed); };
  }, [load, attempt]);

  const passport = phase.kind === "ready" ? phase.passport : null;
  const first = passport?.holder.name.split(" ")[0] ?? "";
  const holderName = passport?.holder.name ?? "";

  useEffect(() => {
    document.title = holderName ? `${holderName} · Housing Passport · Danpa HQ` : "Housing Passport · Danpa HQ";
  }, [holderName]);

  return (
    <div className="shared-passport">
      {/* One reader, by link: never indexed, never referred onward. */}
      <meta name="robots" content="noindex, nofollow" />
      <meta name="referrer" content="no-referrer" />

      <header className="shared-passport-bar">
        <Link href="/" className="shared-passport-brand">Danpa HQ</Link>
        <span className="shared-passport-label"><Icon name="passport" />Housing Passport<em>Read-only</em></span>
      </header>

      <div className="shared-passport-main" aria-busy={phase.kind === "loading" || undefined}>
        {phase.kind === "loading" ? (
          <div className="passport-document" aria-label="Opening the passport">
            <div className="passport-cover is-loading" />
            <div className="shared-passport-skeleton"><span /><span /><span /></div>
          </div>
        ) : passport ? (
          <>
            <PassportDocument
              view={passport}
              audience="recipient"
              coverFooter={<PreparedFor label={passport.share.recipient_label} until={`until ${dayMonthYear(passport.share.expires_at)}`} />}
            />
            <footer className="shared-passport-foot">
              <p>
                Read from Danpa HQ’s records each time this page opens, and limited to what {first} chose to share.
                Contact details, documents and conversations are never included.
              </p>
              <Link href="/rentals">Find verified rentals on Danpa HQ</Link>
            </footer>
          </>
        ) : phase.kind === "expired" ? (
          <LinkState icon="clock" title="This link has expired" body="Housing Passport links stop working on the date they were set to. Ask the tenant to send you a new one." />
        ) : phase.kind === "revoked" ? (
          <LinkState icon="lock" title="This link was withdrawn" body="The tenant has stopped sharing their passport through this link. Nothing from it is available any more." />
        ) : phase.kind === "invalid" ? (
          <LinkState icon="link" crossed title="This link doesn’t open a passport" body="Check that the whole link was copied, or ask the tenant to send it again." />
        ) : phase.kind === "error" ? (
          <LinkState
            icon="warning"
            title="The passport didn’t open"
            body={`${phase.message} Check your connection and try again.`}
            action={<button type="button" className="ws-action is-primary" onClick={() => setAttempt((value) => value + 1)}>Try again</button>}
          />
        ) : null}
      </div>
    </div>
  );
}

function LinkState({
  icon,
  title,
  body,
  crossed = false,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  crossed?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <section className="shared-passport-state" role={icon === "warning" ? "alert" : undefined}>
      <span className={`shared-passport-state-mark${crossed ? " is-crossed" : ""}`} aria-hidden="true">
        <Icon name={icon} />
        {crossed ? (
          <svg viewBox="0 0 20 20" focusable="false"><path d="M3.5 3.5 16.5 16.5" /></svg>
        ) : null}
      </span>
      <h1>{title}</h1>
      <p>{body}</p>
      {action ?? <Link href="/" className="ws-action">Go to Danpa HQ</Link>}
    </section>
  );
}
