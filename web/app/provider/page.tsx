"use client";
import Link from "next/link";
import { CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { openEnquiries } from "@/components/enquiries/EnquiriesInbox";
import { PhoneVerificationSection } from "@/components/account/IdentitySecurity";
import { Notice } from "@/components/Notice";
import { ProviderTermsConsent, type AcceptedProviderTerms } from "@/components/auth/ProviderTermsConsent";
import { authedFetch } from "@/lib/auth";
import { ApiFailure } from "@/lib/api";
import { getProviderStanding, type ProviderStanding } from "@/lib/console";
import { chooseWorkspace, useSession } from "@/lib/session";

export default function ProviderStandingPage() {
  const router = useRouter();
  const { state, refresh } = useSession();
  const [standing, setStanding] = useState<ProviderStanding | null>(null);
  const [terms, setTerms] = useState<AcceptedProviderTerms | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readingAgreement, setReadingAgreement] = useState(false);
  const load = useCallback(async () => {
    try { setStanding(await getProviderStanding()); setError(""); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your approval status."); }
  }, []);
  // While a review is simply with the team there is nothing to do here, and the
  // provider's Home is where they wait for it (owner, 2026-10-25). Only from the
  // provider side, where Home shows the review; anyone in the tenant side keeps
  // this page, and every state with something to do stays here too.
  const me = state.status === "signed_in" ? state.me : null;
  const waitsOnHome = Boolean(
    me
    && me.capabilities.active_workspace === "provider"
    && !me.capabilities.provider.workspace_access
    && me.capabilities.provider.verification_status === "pending"
    && me.is_phone_verified,
  );
  useEffect(() => { if (waitsOnHome) router.replace("/home"); }, [router, waitsOnHome]);
  useEffect(() => { if (waitsOnHome) return; void load(); const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer); }, [load, waitsOnHome]);
  async function submit() {
    if (!terms || busy) return;
    setBusy(true); setError("");
    try {
      setStanding(await authedFetch<ProviderStanding>("/me/provider-verification/", { method: "POST", body: JSON.stringify({ terms_accepted: true, accepted_terms_version: terms.version, accepted_terms_digest: terms.digest }) }));
      await refresh();
    } catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not request approval."); }
    finally { setBusy(false); }
  }
  const status = standing?.verification_status ?? "not_started";
  const approved = Boolean(standing?.workspace_access);
  const needsPhone = !approved && state.status === "signed_in" && !state.me.is_phone_verified;
  const pending = status === "pending" && !needsPhone;
  const title = needsPhone ? "Complete your provider application" : approved ? "Provider access approved" : pending ? "Pending Approval" : status === "rejected" ? "Provider application rejected" : status === "needs_more_info" ? "Management needs more information" : status === "revoked" ? "Approval withdrawn" : "Request provider approval";
  const canSubmit = standing && !approved && !needsPhone && !["pending", "needs_more_info"].includes(status);
  const showingAgreement = Boolean(canSubmit && readingAgreement);
  if (waitsOnHome) return null;
  return <div className={`provider-application${showingAgreement ? " is-reading" : ""}`}>
    <article className="provider-application-panel" aria-labelledby={showingAgreement ? "provider-agreement-title" : "provider-application-title"}>
      <header className="provider-application-header">
        <span className={`provider-application-mark${pending ? " is-pending" : ""}`} aria-hidden="true">{approved ? <CheckCircle2 /> : pending ? <Clock3 /> : <ShieldCheck />}</span>
        <p className="provider-application-eyebrow">Danpa HQ / Provider account</p>
        <h1 id="provider-application-title">{standing ? title : "Provider approval"}</h1>
        <p>{needsPhone ? "Verify your phone by OTP before submitting for review." : pending ? "Your application is with Management. Your provider tools will open once it is approved." : approved ? "Your provider workspace is ready. Each property is verified separately." : status === "needs_more_info" ? "Review Management’s note and update your profile." : "Review the provider agreement, then submit your application."}</p>
      </header>
      {error ? <><Notice tone="error" title={error} /><Button variant="quiet" onClick={() => void load()}>Try again</Button></> : null}
      {standing?.decision_note ? <Notice tone="info" title="From Management" body={standing.decision_note} /> : null}
      {needsPhone ? <section className="provider-application-form" aria-label="Verify phone"><PhoneVerificationSection /></section> : pending ? <ol className="provider-application-progress" aria-label="Application progress"><li><CheckCircle2 /><span>Profile complete</span></li><li><CheckCircle2 /><span>Phone verified</span></li><li className="is-current"><Clock3 /><span>In review</span></li></ol> : null}
      {canSubmit ? <section className="provider-application-form" aria-label="Provider agreement"><ProviderTermsConsent value={terms} onChange={setTerms} presentation="page" reading={readingAgreement} onReadingChange={setReadingAgreement} />{!showingAgreement ? <Button disabled={!terms} busy={busy} onClick={() => void submit()}>Request approval</Button> : null}</section> : null}
      {approved ? <Button onClick={async () => { await chooseWorkspace("provider"); await refresh(); router.replace("/home"); }}>Open provider workspace</Button> : pending ? <p className="provider-application-note">Each property is verified separately.</p> : null}
      <footer className="provider-application-footer"><Link href="/settings">Your Profile</Link><button type="button" onClick={() => openEnquiries({ view: "support" })}>Support Tickets</button></footer>
    </article>
    {state.status === "signed_in" && state.me.capabilities.available_workspaces.includes("tenant") ? <Button variant="quiet" onClick={async () => { await chooseWorkspace("tenant"); await refresh(); router.replace("/rentals"); }}>Switch to tenant experience</Button> : null}
  </div>;
}
