import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { uploadImage } from "@/provider";
import { theme } from "@/theme";

type Verification = {
  id: string;
  kind: string;
  status: string;
  decision_note: string;
  state: "verified" | "pending" | "unverified" | "expired";
};

export default function IdentityVerificationScreen() {
  const { refreshMe } = useAuth();
  const [identity, setIdentity] = useState<Verification | null | undefined>();
  const [nationalId, setNationalId] = useState("");
  const [document, setDocument] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await apiFetch<{ verifications: Verification[] }>("/trust/verifications/");
      setIdentity(result.verifications.find((row) => row.kind === "identity") ?? null);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load identity verification.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    setBusy(true);
    setSent(false);
    setError("");
    try {
      const stored = document ? await uploadImage(document, "identity_document") : null;
      if (!stored?.is_usable) {
        throw new Error(stored?.status_message || "Choose a clear Ghana Card photo.");
      }
      const continuing = identity?.status === "needs_more_info" ? identity : null;
      const verificationId = continuing?.id ?? (await apiFetch<{ id: string }>(
        "/trust/verifications/",
        { method: "POST", body: { kind: "identity", method: "document_review" } },
      )).id;
      await apiFetch(`/trust/verifications/${verificationId}/evidence/`, {
        method: "POST",
        body: {
          evidence_type: "ghana_card_front",
          file_id: stored.id,
          national_id: nationalId,
        },
      });
      setDocument(null);
      setNationalId("");
      setSent(true);
      await Promise.all([load(), refreshMe()]);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : cause instanceof Error
            ? cause.message
            : "Could not submit identity verification.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[6] }}>
      <View style={{ gap: space[2] }}>
        <Type variant="label">IDENTITY</Type>
        <Type variant="display2" accessibilityRole="header">Identity verification</Type>
        <Type variant="body" style={{ color: theme.color.ink["500"] }}>
          Submit one clear document. This check carries across every Rooomly experience.
        </Type>
      </View>

      {identity === undefined && !error ? (
        <View style={{ paddingVertical: space[10], alignItems: "center" }}>
          <ActivityIndicator color={theme.color.kola["600"]} />
        </View>
      ) : null}
      {error ? <Notice tone="error" title={error} /> : null}
      {sent ? <Notice tone="success" title="Sent for review" body="We will notify you when the decision changes." /> : null}

      {identity?.state === "verified" ? (
        <Notice tone="success" title="Identity verified" body="Nothing further is needed." />
      ) : identity?.state === "pending" ? (
        <Notice tone="info" title="With our review team" body="There is nothing further to send unless we ask." />
      ) : identity !== undefined ? (
        <View style={{ gap: space[4] }}>
          {identity?.decision_note ? (
            <Notice tone="warning" title="From the reviewer" body={identity.decision_note} />
          ) : null}
          <Field
            label="Ghana Card number"
            value={nationalId}
            onChangeText={setNationalId}
            autoCapitalize="characters"
          />
          <Button
            label={document ? "Ghana Card photo selected" : "Choose Ghana Card photo"}
            variant="secondary"
            onPress={async () => {
              const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (!permission.granted) {
                setError("Allow photo access to choose your Ghana Card image.");
                return;
              }
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                quality: 0.9,
              });
              if (!result.canceled && result.assets[0]) setDocument(result.assets[0]);
            }}
          />
          <Button
            label="Submit for review"
            busy={busy}
            busyLabel="Sending…"
            disabled={!document || !nationalId.trim()}
            onPress={() => void submit()}
          />
          <Type variant="caption">
            Evidence is private, access is audited, and the card number is hashed rather than stored in plain text.
          </Type>
        </View>
      ) : null}
    </ScrollView>
  );
}
