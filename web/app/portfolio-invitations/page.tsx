"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  listMyPortfolioInvitations,
  respondToPortfolioInvitation,
  type PortfolioInvitation,
} from "@/lib/console";
import { useSession } from "@/lib/session";

function PortfolioInvitationContent() {
  const search = useSearchParams();
  const linkedId = search.get("invitation");
  const linkedToken = search.get("token");
  const { refresh } = useSession();
  const [rows, setRows] = useState<PortfolioInvitation[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try { setRows(await listMyPortfolioInvitations()); setError(""); }
    catch (cause) { setRows([]); setError(cause instanceof ApiFailure ? cause.error.message : "Could not load Portfolio invitations."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function respond(invitation: PortfolioInvitation, decision: "accept" | "decline") {
    const token = invitation.id === linkedId && linkedToken ? linkedToken : invitation.token;
    if (!token) { setError("Open the secure invitation link again and try once more."); return; }
    setBusy(`${invitation.id}:${decision}`);
    setError("");
    setNotice("");
    try {
      await respondToPortfolioInvitation(invitation.id, decision, token);
      if (decision === "accept") await refresh();
      setNotice(decision === "accept" ? `${invitation.portfolio.name} is now available in your Portfolio switcher.` : `Invitation to ${invitation.portfolio.name} declined.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not respond to this invitation.");
    } finally { setBusy(""); }
  }

  return (
    <div>
      <PageHeader title="Portfolio invitations" description="Review who invited you, the role they are offering, and which Properties will be in scope before any access becomes active." />
      {notice ? <Notice tone="success" title={notice} /> : null}
      {error ? <Notice tone="error" title={error} /> : null}
      {rows === null ? <LoadingRows rows={2} /> : null}
      {rows?.length === 0 ? <Notice tone="info" title="No Portfolio invitation is waiting" /> : null}
      <div style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-6)" }}>
        {rows?.map((invitation) => (
          <article key={invitation.id} style={CARD}>
            <div>
              <p className="type-label" style={{ margin: 0 }}>{invitation.portfolio.type === "individual_owner" ? "PERSONAL PORTFOLIO" : "PROPERTY BUSINESS"}</p>
              <h2 className="type-title-2" style={{ margin: "var(--space-1) 0 0" }}>{invitation.portfolio.name}</h2>
              <p className="type-body" style={{ margin: "var(--space-2) 0 0" }}>Role: {invitation.role.replaceAll("_", " ")}</p>
              <p className="type-caption">Invited by {invitation.invited_by_name} · expires {new Date(invitation.expires_at).toLocaleString()}</p>
              <p className="type-caption">
                {invitation.properties.length
                  ? `Assigned Properties: ${invitation.properties.map((row) => row.title).join(", ")}`
                  : ["owner", "admin"].includes(invitation.role)
                    ? "Effective access: all Portfolio Properties"
                    : "No Property is assigned yet"}
              </p>
            </div>
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <Button busy={busy === `${invitation.id}:accept`} busyLabel="Accepting…" onClick={() => void respond(invitation, "accept")}>Accept invitation</Button>
              <Button variant="secondary" busy={busy === `${invitation.id}:decline`} busyLabel="Declining…" onClick={() => void respond(invitation, "decline")}>Decline</Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function PortfolioInvitationsPage() {
  return <Suspense fallback={<LoadingRows rows={2} />}><PortfolioInvitationContent /></Suspense>;
}

const CARD: React.CSSProperties = { display: "grid", gap: "var(--space-4)", padding: "var(--space-5)", background: "var(--color-field-0)", border: "var(--border-hairline) solid var(--color-field-200)", borderRadius: "var(--radius-md)" };
