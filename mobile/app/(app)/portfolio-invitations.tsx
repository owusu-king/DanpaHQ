import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Notice, Surface, Type, space } from "@/components/ui";
import { listMyPortfolioInvitations, respondToPortfolioInvitation, type PortfolioInvitation } from "@/organizations";

export default function PortfolioInvitationsScreen() {
  const { refreshMe } = useAuth();
  const [rows, setRows] = useState<PortfolioInvitation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try { setRows(await listMyPortfolioInvitations()); setError(""); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not load Portfolio invitations."); }
    finally { setLoaded(true); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function respond(invitation: PortfolioInvitation, decision: "accept" | "decline") {
    if (!invitation.token) return;
    setBusy(`${invitation.id}:${decision}`); setError(""); setNotice("");
    try {
      await respondToPortfolioInvitation(invitation.id, decision, invitation.token);
      if (decision === "accept") await refreshMe(`organization:${invitation.portfolio.id}`);
      setNotice(decision === "accept" ? `${invitation.portfolio.name} is now in your Portfolio switcher.` : "Invitation declined.");
      await load();
    } catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not respond to that invitation."); }
    finally { setBusy(""); }
  }

  return <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4] }}>
    <View style={{ gap: space[2] }}><Type variant="label">YOUR ACCESS</Type><Type variant="display2">Portfolio invitations</Type><Type variant="body">Review the Portfolio, role and assigned Properties before access becomes active.</Type></View>
    {notice ? <Notice tone="success" title={notice} /> : null}
    {error ? <Notice tone="error" title={error} /> : null}
    {!loaded ? <Type variant="caption">Loading…</Type> : null}
    {loaded && rows.length === 0 ? <Notice tone="info" title="No Portfolio invitation is waiting" /> : null}
    {rows.map((invitation) => <Surface key={invitation.id} style={{ gap: space[3] }}>
      <Type variant="label">{invitation.portfolio.type === "individual_owner" ? "PERSONAL PORTFOLIO" : "PROPERTY BUSINESS"}</Type>
      <Type variant="title2">{invitation.portfolio.name}</Type>
      <Type variant="body">Role: {invitation.role.replaceAll("_", " ")}</Type>
      <Type variant="caption">Invited by {invitation.invited_by_name} · expires {new Date(invitation.expires_at).toLocaleString()}</Type>
      <Type variant="caption">{invitation.properties.length ? `Assigned: ${invitation.properties.map((row) => row.title).join(", ")}` : "No individual Property assignment"}</Type>
      <Button label="Accept invitation" busy={busy === `${invitation.id}:accept`} onPress={() => void respond(invitation, "accept")} />
      <Button label="Decline" variant="secondary" busy={busy === `${invitation.id}:decline`} onPress={() => void respond(invitation, "decline")} />
    </Surface>)}
  </ScrollView>;
}
