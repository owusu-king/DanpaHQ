import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type ProviderReadiness, type ProviderVerificationStatus } from "@/auth";
import { Button, Notice, Surface, Type, space } from "@/components/ui";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { getProviderReadiness, uploadImage } from "@/provider";
import { theme } from "@/theme";

/**
 * Provider standing: may this person operate as a provider at all.
 *
 * Deliberately not the same screen as claiming a property. This answers a
 * question about the person and is decided once; whether they control a
 * particular address is a separate review against separate evidence, and now
 * happens inside property creation — the Documents step records the claim
 * against a property that already exists (ADR 0024).
 *
 * Every state below is read from the backend. A client deciding for itself
 * whether the workspace was open is the thing this architecture removed.
 */
type Standing = {
  exists: boolean;
  verification_status: ProviderVerificationStatus | null;
  onboarding_complete: boolean;
  workspace_access: boolean;
  can_create_property: boolean;
};

const DOCUMENT_TYPES = [
  ["ghana_card_front", "Ghana Card — front"],
  ["ghana_card_back", "Ghana Card — back"],
  ["passport", "Passport"],
  ["drivers_licence", "Driver's licence"],
] as const;

export default function ProviderStandingScreen() {
  // Android draws edge-to-edge: the last row would sit under the
  // navigation buttons, which then look as though the page showed through.
  const pageBottom = useSafeBottom(space[8]);
  const router = useRouter();
  const { refreshMe } = useAuth();

  const [standing, setStanding] = useState<Standing | null>(null);
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [documentType, setDocumentType] = useState<string>("ghana_card_front");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [next, ready] = await Promise.all([
        apiFetch<Standing>("/me/provider-verification/"),
        getProviderReadiness().catch(() => null),
      ]);
      setStanding(next);
      setReadiness(ready);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your status.");
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function chooseDocument() {
  setError("");

  try {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (picked.canceled || !picked.assets[0]) return;

    setSelectedAsset(picked.assets[0]);
  } catch (cause) {
    setError(
      cause instanceof ApiFailure
        ? cause.error.message
        : "Could not choose that document.",
    );
  }
}

async function submitDocument() {
  if (!selectedAsset) {
    setError("Choose a document first.");
    return;
  }

  setBusy(true);
  setError("");

  try {
    const stored = await uploadImage(selectedAsset, "identity_document");

    await apiFetch<Standing>("/me/provider-verification/", {
      method: "POST",
      body: {
        documents: [
          {
            file_id: stored.id,
            evidence_type: documentType,
          },
        ],
      },
    });

    setSelectedAsset(null);
    await load();
    await refreshMe();
  } catch (cause) {
    setError(
      cause instanceof ApiFailure
        ? cause.error.message
        : "Could not submit that document.",
    );
  } finally {
    setBusy(false);
  }
}

  const status = standing?.verification_status ?? "not_started";

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[5] }}>
      <View style={{ gap: space[2] }}>
        <Type variant="label">PROVIDER VERIFICATION</Type>
        <Type variant="display2">Approval to operate</Type>
        <Type variant="body" style={{ color: theme.color.ink["700"] }}>
          This is a check on you, not on any building. It is asked once and carries to every
          property you manage. Authority over a particular address is reviewed separately, each
          time you claim one.
        </Type>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}

      {status === "approved" ? (
        <>
          <Notice
            tone="success"
            title="Approved"
            body="You can operate as a provider. Each property you add still needs its own authority review before it can be advertised or collect rent."
          />
          <Button
            label="Go to your properties"
            onPress={() => router.replace("/(app)/(provider-tabs)/properties")}
          />
        </>
      ) : null}

      {status === "pending" ? (
        <>
          {/*
            Submitted is a finished step, not a holding pen. This reads as the
            success it is: everything asked of them is done, nothing is
            outstanding on their side, and there is somewhere to go meanwhile.
          */}
          <Notice
            tone="success"
            title="Documents submitted"
            body="Thank you — your provider verification is with our review team. There is nothing further to send. We will let you know the outcome, and you can check back here any time."
          />
          <Button
            label="Explore rentals"
            variant="secondary"
            icon={<Ionicons name="search-outline" size={20} color={theme.color.kola["600"]} />}
            onPress={() => router.replace("/(app)/(tabs)/explore" as never)}
          />
          <Button
            label="Back to home"
            variant="quiet"
            icon={<Ionicons name="home-outline" size={20} color={theme.color.kola["600"]} />}
            onPress={() => router.replace("/(app)/(tabs)" as never)}
          />
        </>
      ) : null}

      {status === "needs_more_info" ? (
        <Notice
          tone="warning"
          title="We need something else"
          body={readiness?.identity_decision_note || "Send another document so the review can continue."}
        />
      ) : null}

      {status === "rejected" || status === "revoked" ? (
        <Notice
          tone="error"
          title={status === "rejected" ? "Not approved" : "Approval withdrawn"}
          body={readiness?.identity_decision_note || "Read the note, put it right, and send it again."}
        />
      ) : null}

      {status === "not_started" ? (
        <Notice
          tone="info"
          title="Not started"
          body="Send one government-issued identity document. The same review confirms who you are and whether you may operate here, so this is the only document we need to start."
        />
      ) : null}

      {status !== "approved" && status !== "pending" ? (
        <Surface style={{ gap: space[3] }}>
          <Type variant="title2">Send a document</Type>

          {DOCUMENT_TYPES.map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setDocumentType(value)}
              accessibilityRole="radio"
              aria-selected={documentType === value}
              {...pressableFeedback(theme.color.kola["50"])}
            >
              <Type variant={documentType === value ? "bodyStrong" : "body"}>
                {documentType === value ? "✓ " : ""}{label}
              </Type>
            </Pressable>
          ))}

          <Button
              label={selectedAsset ? "Change document" : "Choose document"}
              onPress={chooseDocument}
              disabled={busy}
            />

            {selectedAsset ? (
              <Surface
                style={{
                  gap: space[1],
                  backgroundColor: theme.color.kola["50"],
                }}
              >
                <Type variant="bodyStrong">
                  Document selected
                </Type>

                <Type variant="caption">
                  {selectedAsset.fileName || "Selected image"}
                </Type>
              </Surface>
            ) : null}

            <Button
              label="Submit document"
              busyLabel="Submitting…"
              onPress={submitDocument}
              busy={busy}
              disabled={!selectedAsset}
            />

            <Pressable
              onPress={() => router.replace("/(app)/(tabs)" as never)}
              disabled={busy}
              {...pressableFeedback(theme.color.kola["50"])}
            >
              <Type
                variant="bodyStrong"
                style={{
                  color: theme.color.kola["600"],
                  textAlign: "center",
                }}
              >
                Submit later
              </Type>
            </Pressable>
                    </Surface>
                  ) : null}

      {/* {canSwitchToTenant ? (
        <Surface style={{ gap: space[2] }}>
          <Type variant="caption">
            You also rent as a tenant. Switching is only a change of view — it does not cancel this
            review, remove anything, or sign you out.
          </Type>
          <Button label="Switch to tenant experience" variant="secondary" onPress={switchToTenant} />
        </Surface>
      ) : null} */}
    </ScrollView>
  );
}
