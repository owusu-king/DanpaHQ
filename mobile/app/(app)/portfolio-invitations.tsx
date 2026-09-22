import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Notice, Surface, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import {
  listMyPortfolioInvitations,
  respondToPortfolioInvitation,
  type PortfolioInvitation,
  type PortfolioMember,
} from "@/organizations";
import { chooseWorkspace } from "@/workspace";

/**
 * The screen an invited person actually arrives on.
 *
 * It answers what the previous one could not. *Is this for me* — the invitation
 * belongs to one number, and this account may not be it. *Is it still good* —
 * invitations expire, are withdrawn, are declined, are already used. *Is
 * anything asked of me first* — an administrator role waits for an identity
 * check. And after accepting: *where did I just go* — the Portfolio is
 * selected, the provider workspace opened, and the join confirmed with what the
 * role reaches, instead of leaving somebody on a list that has gone empty.
 */
export default function PortfolioInvitationsScreen() {
  // Android draws edge-to-edge: the last row would sit under the
  // navigation buttons, which then look as though the page showed through.
  const pageBottom = useSafeBottom(space[8]);
  const router = useRouter();
  const { refreshMe } = useAuth();
  const [rows, setRows] = useState<PortfolioInvitation[] | null>(null);
  const [joined, setJoined] = useState<PortfolioMember | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      // History included: "nothing is waiting" and "the one you were sent
      // expired last week" are different things to be told.
      setRows(await listMyPortfolioInvitations({ history: true }));
      setError("");
    } catch (cause) {
      setRows([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load Portfolio invitations.");
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function respond(invitation: PortfolioInvitation, decision: "accept" | "decline") {
    if (!invitation.token) {
      setError("Open the invitation again and try once more.");
      return;
    }
    setBusy(`${invitation.id}:${decision}`);
    setError("");
    try {
      const member = await respondToPortfolioInvitation(invitation.id, decision, invitation.token);
      if (decision === "accept") {
        // The three things that make the membership usable, in the order that
        // makes them stick: be in the provider experience, re-read the account
        // so the Portfolio is a context at all, then select it.
        await chooseWorkspace("provider");
        await refreshMe(member.context_id);
        setJoined(member);
      }
      await load();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not respond to that invitation.");
    } finally {
      setBusy("");
    }
  }

  if (joined) {
    return (
      <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[4] }}>
        <View style={{ gap: space[2] }}>
          <Type variant="label">JOINED</Type>
          <Type variant="display2" accessibilityRole="header">You joined {joined.portfolio.name}</Type>
          <Type variant="body">You are {roleWord(joined.role)} here. {scopeSentence(joined)}</Type>
        </View>
        {joined.access.requirements.length ? (
          <Notice
            tone="info"
            title="Some actions need a check first"
            body={joined.access.requirements.map((key) => WAITING[key] ?? key).join(" ")}
          />
        ) : null}
        <Button
          label={`Open ${joined.portfolio.name}`}
          onPress={() => router.replace("/(app)/(provider-tabs)" as never)}
        />
        <Button label="See your role and access" variant="secondary" onPress={() => router.replace("/(app)/team" as never)} />
      </ScrollView>
    );
  }

  const pending = (rows ?? []).filter((row) => row.status === "pending");
  const answered = (rows ?? []).filter((row) => row.status !== "pending");

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4] }}>
      <View style={{ gap: space[2] }}>
        <Type variant="label">YOUR ACCESS</Type>
        <Type variant="display2" accessibilityRole="header">Portfolio invitations</Type>
        <Type variant="body">
          Review the Portfolio, the role and the Properties in scope. Nothing is granted until you
          accept.
        </Type>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}
      {rows === null ? <Type variant="caption">Loading…</Type> : null}
      {rows !== null && pending.length === 0 ? (
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

      {[...pending, ...answered].map((invitation) => (
        <InvitationCard
          key={invitation.id}
          invitation={invitation}
          busy={busy}
          onRespond={respond}
          onVerifyIdentity={() => router.push("/(app)/identity-verification" as never)}
        />
      ))}
    </ScrollView>
  );
}

function InvitationCard({
  invitation,
  busy,
  onRespond,
  onVerifyIdentity,
}: {
  invitation: PortfolioInvitation;
  busy: string;
  onRespond: (invitation: PortfolioInvitation, decision: "accept" | "decline") => Promise<void>;
  onVerifyIdentity: () => void;
}) {
  const ending = invitation.status === "pending" ? null : ending_(invitation);
  const requirement = invitation.requirements[0];
  const asked = requirement ? REQUIREMENTS[requirement] : null;

  return (
    <Surface style={{ gap: space[3] }}>
      <Type variant="label">
        {invitation.portfolio.type === "individual_owner" ? "PERSONAL PORTFOLIO" : "PROPERTY BUSINESS"}
      </Type>
      <Type variant="title2" accessibilityRole="header">{invitation.portfolio.name}</Type>
      <Type variant="body">Invited as {roleWord(invitation.role)} by {invitation.invited_by_name}.</Type>
      <Type variant="caption">
        {invitation.status === "pending"
          ? `Expires ${new Date(invitation.expires_at).toLocaleDateString("en-GH", { day: "numeric", month: "long" })}`
          : `Sent ${new Date(invitation.created_at).toLocaleDateString("en-GH", { day: "numeric", month: "long" })}`}
      </Type>
      <Type variant="caption">
        {invitation.properties.length
          ? `Assigned: ${invitation.properties.map((row) => row.title).join(", ")}`
          : invitation.role === "admin"
            ? "Every Property in this Portfolio"
            : "No Property is assigned yet"}
      </Type>

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
          <Button label={asked.action} onPress={onVerifyIdentity} />
          <Button
            label="Decline"
            variant="secondary"
            busy={busy === `${invitation.id}:decline`}
            onPress={() => void onRespond(invitation, "decline")}
          />
        </>
      ) : (
        <>
          <Button
            label="Accept invitation"
            busy={busy === `${invitation.id}:accept`}
            onPress={() => void onRespond(invitation, "accept")}
          />
          <Button
            label="Decline"
            variant="secondary"
            busy={busy === `${invitation.id}:decline`}
            onPress={() => void onRespond(invitation, "decline")}
          />
        </>
      )}
    </Surface>
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
function ending_(invitation: PortfolioInvitation): { tone: "info" | "warning" | "success"; title: string; body: string } {
  switch (invitation.status) {
    case "accepted":
      return {
        tone: "success",
        title: `You are already in ${invitation.portfolio.name}`,
        body: "This invitation has been used. The Portfolio is in your workspace switcher.",
      };
    case "declined":
      return {
        tone: "info",
        title: "You declined this invitation",
        body: `Ask ${invitation.invited_by_name} to send a new one if you meant to join.`,
      };
    case "revoked":
      return {
        tone: "warning",
        title: "This invitation was withdrawn",
        body: `${invitation.invited_by_name} cancelled it before it was accepted. Nothing was granted.`,
      };
    default:
      return {
        tone: "warning",
        title: "This invitation expired",
        body: "Invitations last seven days. Ask whoever sent it for a new one.",
      };
  }
}

/** What must happen before an invitation can be accepted at all. */
const REQUIREMENTS: Record<string, { title: string; body: string; action: string }> = {
  identity: {
    title: "Verify your identity to accept administrator access",
    body: "An administrator decides who may operate the business and what it owes, so Rooomly confirms who you are before the role becomes yours. Your invitation stays open while you do it.",
    action: "Verify identity",
  },
};

/** What a capability is waiting on, once somebody is already in. */
const WAITING: Record<string, string> = {
  identity: "Verify your identity to place tenants, prepare agreements or publish a listing — Property details and Units are open to you now.",
  portfolio_standing: "This Portfolio's own provider verification is not current, so tenant-facing actions are paused for everyone in it until its owner renews it.",
};
