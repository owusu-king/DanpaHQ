import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { ApiFailure } from "@/api";
import { Button, Notice, Surface, Type, space } from "@/components/ui";
import { theme } from "@/theme";
import {
  issueViewingCheckInCredential,
  listMyViewings,
  type Viewing,
  type ViewingCheckInCredential,
} from "@/viewings";

/** A short-lived attendance credential. Its opaque QR and fallback code rotate together. */
export default function ViewingCheckInScreen() {
  const { viewingId } = useLocalSearchParams<{ viewingId: string }>();
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [credential, setCredential] = useState<ViewingCheckInCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const item = (await listMyViewings()).find((candidate) => candidate.id === viewingId);
      if (!item) throw new Error("not_found");
      setViewing(item);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not open this check-in.");
    }
  }, [viewingId]);

  useEffect(() => { void load(); }, [load]);

  async function issue() {
    if (!viewingId) return;
    setBusy(true);
    setError("");
    try {
      setCredential(await issueViewingCheckInCredential(viewingId));
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not create a temporary check-in code.");
    } finally {
      setBusy(false);
    }
  }

  if (!viewing) {
    return <View style={{ padding: space[5] }}>{error ? <Notice tone="error" title={error} /> : <Type variant="caption">Loading…</Type>}</View>;
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="display2">Viewing check-in</Type>
        <Type variant="caption">{viewing.listing_headline}</Type>
      </View>

      {credential ? (
        <Surface style={{ alignItems: "center", gap: space[3] }}>
          <View style={{ padding: space[3], backgroundColor: "#FFFFFF", borderRadius: 8 }}>
            <QRCode value={credential.qr_payload} size={230} backgroundColor="#FFFFFF" color="#14201D" />
          </View>
          <Type variant="body" style={{ textAlign: "center" }}>Show this QR to the host when you arrive.</Type>
          <View style={{ alignItems: "center", gap: space[1], marginTop: space[2] }}>
            <Type variant="caption">Can&apos;t scan?</Type>
            <Type variant="bodyStrong">Check-in code</Type>
            <Type variant="display2" style={{ letterSpacing: 8 }}>
              {credential.code.slice(0, 3)} {credential.code.slice(3)}
            </Type>
            <Type variant="caption">
              Expires at {new Date(credential.expires_at).toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })}
            </Type>
          </View>
          <Button label="Refresh temporary code" variant="quiet" busy={busy} onPress={issue} />
        </Surface>
      ) : viewing.check_in.can_issue ? (
        <Surface style={{ gap: space[3] }}>
          <Type variant="body">Open a temporary QR and six-digit code when you arrive. Giving either one to the host verifies attendance.</Type>
          <Button label="Open check-in" busy={busy} busyLabel="Opening…" onPress={issue} />
        </Surface>
      ) : (
        <Notice
          tone="info"
          title="Check-in is not open yet"
          body={viewing.check_in.opens_at ? `It opens at ${new Date(viewing.check_in.opens_at).toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })}.` : "It becomes available near the confirmed viewing time."}
        />
      )}
      {error ? <Notice tone="error" title={error} /> : null}
      <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
        This credential is temporary, single-use, and only works for this viewing.
      </Type>
    </ScrollView>
  );
}
