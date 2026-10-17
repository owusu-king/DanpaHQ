"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  getPortfolioInvitation,
  listMyPortfolioInvitations,
  respondToPortfolioInvitation,
  type PortfolioInvitation,
  type PortfolioMember,
} from "@/lib/console";
import { chooseWorkspace, useSession } from "@/lib/session";

/**
 * The one screen an invited person actually arrives on.
 *
 * It answers four questions, and it used to answer one. *Is this for me* — the
 * link may be open on the wrong account. *Is it still good* — invitations
 * expire, are withdrawn, are declined, are already used, and a list of pending
 * ones can say none of that. *Is anything asked of me first* — an administrator
 * role waits for an identity check. And then, after accepting: *where did I
 * just go* — the Portfolio is selected, the provider workspace is opened, and
 * the join is confirmed with what the role reaches, rather than leaving somebody
 * to discover it by navigating.
 */
function PortfolioInvitationContent() {
  const search = useSearchParams();
  const router = useRouter();
  const linkedId = search.get("invitation");
  const linkedToken = search.get("token");
  const { refresh } = useSession();

  const [rows, setRows] = useState<PortfolioInvitation[] | null>(null);
  const [linked, setLinked] = useState<PortfolioInvitation | null>(null);
  const [joined, setJoined] = useState<PortfolioMember | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      // History included: "nothing is waiting" and "the one you were sent
      // expired on Tuesday" are different things to be told.
      const [history, followed] = await Promise.all([
        listMyPortfolioInvitations({ history: true }),
        linkedId && linkedToken
          ? getPortfolioInvitation(linkedId, linkedToken).catch(() => null)
          : Promise.resolve(null),
      ]);
      setRows(history);
      setLinked(followed);
      setError("");
    } catch (cause) {
      setRows([]);
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load Portfolio invitations.",
      );
    }
  }, [linkedId, linkedToken]);

  useEffect(() => { void load(); }, [load]);

  async function respond(invitation: PortfolioInvitation, decision: "accept" | "decline") {
    const token = invitation.id === linkedId && linkedToken ? linkedToken : invitation.token;
    if (!token) {
      setError("Open the secure invitation link again and try once more.");
      return;
    }
    setBusy(`${invitation.id}:${decision}`);
    setError("");
    try {
      const member = await respondToPortfolioInvitation(invitation.id, decision, token);
      if (decision === "accept") {
        // The three things that make the membership usable, in the order that
        // makes them stick: be in the provider experience, re-read the account
        // so the new Portfolio is a context at all, and select it. Selecting it
        // before the refresh silently did nothing — the id did not yet exist.
        await chooseWorkspace("provider");
        await refresh(member.context_id);
        setJoined(member);
      }
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not respond to this invitation.",
      );
    } finally {
      setBusy("");
    }
  }

  if (joined) {
    return (
      <div>
        <PageHeader
          title="You are in"
          description="Your Portfolio is now in the workspace switcher, and the role decides what it opens."
        />
        <JoinedPanel member={joined} onOpen={() => router.push("/home" as never)} />
      </div>
    );
  }

  // The followed link leads; the rest of the history sits behind it.
  const followed = linked ? [linked] : [];
  const others = (rows ?? []).filter((row) => row.id !== linked?.id);
  const pending = others.filter((row) => row.status === "pending");
  const answered = others.filter((row) => row.status !== "pending");
  const nothingWaiting = rows !== null && !linked && pending.length === 0;

  return (
    <div>
      <PageHeader
        title="Portfolio invitations"
        description="Review who invited you, the role they are offering, and which Properties are in scope. Nothing is granted until you accept."
      />
      {error ? <Notice tone="error" title={error} /> : null}
      {rows === null ? <LoadingRows rows={2} /> : null}
      {nothingWaiting ? (
        <Notice
          tone="info"
          title="No Portfolio invitation is waiting"
          body={
            answered.length
              ? "The ones below have already been answered or have run out."
              : "An owner or administrator invites you by your mobile number, and it appears here."
          }
        />
      ) : null}

      <div style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-6)" }}>
        {[...followed, ...pending, ...answered].map((invitation) => (
          <InvitationCard
            key={invitation.id}
            invitation={invitation}
            busy={busy}
            onRespond={respond}
          />
        ))}
      </div>
    </div>
  );
}

function InvitationCard({
  invitation,
  busy,
  onRespond,
}: {
  invitation: PortfolioInvitation;
  busy: string;
  onRespond: (invitation: PortfolioInvitation, decision: "accept" | "decline") => Promise<void>;
}) {
  const ending = invitation.status === "pending" ? null : ENDINGS[invitation.status](invitation);
  const requirement = invitation.requirements[0];
  const asked = requirement ? REQUIREMENTS[requirement] : null;

  return (
    <article style={CARD}>
      <div>
        <p className="type-label" style={{ margin: 0 }}>
          {invitation.portfolio.type === "individual_owner" ? "PERSONAL PORTFOLIO" : "PROPERTY BUSINESS"}
        </p>
        <h2 className="type-title-2" style={{ margin: "var(--space-1) 0 0" }}>{invitation.portfolio.name}</h2>
        <p className="type-body" style={{ margin: "var(--space-2) 0 0" }}>
          Invited as {roleWord(invitation.role)} by {invitation.invited_by_name}.
        </p>
        <p className="type-caption">
          {invitation.status === "pending"
            ? `Expires ${new Date(invitation.expires_at).toLocaleDateString("en-GH", { day: "numeric", month: "long" })}`
            : `Sent ${new Date(invitation.created_at).toLocaleDateString("en-GH", { day: "numeric", month: "long" })}`}
        </p>
        <p className="type-caption">
          {invitation.properties.length
            ? `Assigned Properties: ${invitation.properties.map((row) => row.title).join(", ")}`
            : invitation.role === "admin"
              ? "Every Property in this Portfolio"
              : "No Property is assigned yet"}
        </p>
      </div>

      {!invitation.addressed_to_you ? (
        <Notice
          tone="warning"
          title="This invitation is for another number"
          body={`It was sent to ${invitation.invitee_phone}. Sign in with that number to accept it — an invitation only ever belongs to the number it names.`}
        />
      ) : ending ? (
        <Notice tone={ending.tone} title={ending.title} body={ending.body} />
      ) : asked ? (
        <>
          <Notice tone="info" title={asked.title} body={asked.body} />
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <Link href={asked.href as never} className="button-link">
              {asked.action}
            </Link>
            <Button
              variant="secondary"
              busy={busy === `${invitation.id}:decline`}
              busyLabel="Declining…"
              onClick={() => void onRespond(invitation, "decline")}
            >Decline</Button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <Button
            busy={busy === `${invitation.id}:accept`}
            busyLabel="Accepting…"
            onClick={() => void onRespond(invitation, "accept")}
          >Accept invitation</Button>
          <Button
            variant="secondary"
            busy={busy === `${invitation.id}:decline`}
            busyLabel="Declining…"
            onClick={() => void onRespond(invitation, "decline")}
          >Decline</Button>
        </div>
      )}
    </article>
  );
}

/**
 * The confirmation, which is also the handover.
 *
 * It states what was joined, what the role reaches, and what any capability is
 * still waiting on — then opens the workspace. A member who is told none of
 * that reads a limited role as a broken one.
 */
function JoinedPanel({ member, onOpen }: { member: PortfolioMember; onOpen: () => void }) {
  return (
    <article style={CARD}>
      <div>
        <p className="type-label" style={{ margin: 0 }}>JOINED</p>
        <h2 className="type-title-2" style={{ margin: "var(--space-1) 0 0" }}>
          You joined {member.portfolio.name}
        </h2>
        <p className="type-body" style={{ margin: "var(--space-2) 0 0" }}>
          You are {roleWord(member.role)} here. {scopeSentence(member)}
        </p>
      </div>
      {member.access.requirements.length ? (
        <Notice
          tone="info"
          title="Some actions need a check first"
          body={member.access.requirements.map((key) => WAITING[key] ?? key).join(" ")}
        />
      ) : null}
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Button onClick={onOpen}>Open {member.portfolio.name}</Button>
        <Link href={"/settings/team" as never} className="type-body-strong" style={{ alignSelf: "center" }}>
          See your role and access →
        </Link>
      </div>
    </article>
  );
}

const ROLE_WORDS: Record<string, string> = {
  owner: "the owner",
  admin: "an administrator",
  property_manager: "a property manager",
  accountant: "an accountant",
  staff: "staff",
};

function roleWord(role: string): string {
  return ROLE_WORDS[role] ?? role.replaceAll("_", " ");
}

/** What the role actually reaches, said in Properties rather than in role names. */
function scopeSentence(member: PortfolioMember): string {
  if (member.access.scope === "portfolio_wide") {
    return "Every Property in this Portfolio is yours to operate.";
  }
  const count = member.assigned_properties.length;
  if (!count) {
    return "No Property is assigned to you yet — an owner or administrator decides which ones you operate.";
  }
  const what = count === 1 ? "Property is" : "Properties are";
  return member.access.scope === "assigned_financial"
    ? `${count} assigned ${what} open to you for rent and payment records.`
    : `${count} assigned ${what} yours to operate.`;
}

/** Each ending, said as the thing that happened rather than as a status. */
const ENDINGS: Record<
  Exclude<PortfolioInvitation["status"], "pending">,
  (invitation: PortfolioInvitation) => { tone: "info" | "warning" | "success"; title: string; body: string }
> = {
  accepted: (invitation) => ({
    tone: "success",
    title: `You are already in ${invitation.portfolio.name}`,
    body: "This invitation has been used. The Portfolio is in your workspace switcher.",
  }),
  declined: (invitation) => ({
    tone: "info",
    title: "You declined this invitation",
    body: `Ask ${invitation.invited_by_name} to send a new one if you meant to join.`,
  }),
  revoked: (invitation) => ({
    tone: "warning",
    title: "This invitation was withdrawn",
    body: `${invitation.invited_by_name} cancelled it before it was accepted. Nothing was granted.`,
  }),
  expired: () => ({
    tone: "warning",
    title: "This invitation expired",
    body: "Invitations last seven days. Ask whoever sent it for a new one.",
  }),
};

/** What must happen before this invitation can be accepted at all. */
const REQUIREMENTS: Record<string, { title: string; body: string; href: string; action: string }> = {
  identity: {
    title: "Verify your identity to accept administrator access",
    body: "An administrator decides who may operate the business and what it owes, so Danpa HQ confirms who you are before the role becomes yours. Your invitation stays open while you do it.",
    href: "/settings/verification/identity",
    action: "Verify identity",
  },
};

/** What a capability is waiting on, once somebody is already in. */
const WAITING: Record<string, string> = {
  identity: "Verify your identity to place tenants, prepare agreements or publish a listing — Property details and Units are open to you now.",
  portfolio_standing: "This Portfolio's own provider verification is not current, so tenant-facing actions are paused for everyone in it until its owner renews it.",
};

export default function PortfolioInvitationsPage() {
  return (
    <Suspense fallback={<LoadingRows rows={2} />}>
      <PortfolioInvitationContent />
    </Suspense>
  );
}

const CARD: React.CSSProperties = {
  display: "grid",
  gap: "var(--space-4)",
  padding: "var(--space-5)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-200)",
  borderRadius: "var(--radius-md)",
};
