import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { Select } from "@/components/form/Select";
import { ActionBar, LinkRow, Pill, RecordPanel } from "@/components/record/RecordSurfaces";
import { Field, Notice, space } from "@/components/ui";
import { recordPropertyClaim, uploadImage } from "@/provider";

/**
 * Claiming authority over a property that already exists.
 *
 * Mirrors the web component against the same endpoint. A property created
 * privately has no owner and no relationship — deliberately, because setting one
 * up is not proof of holding it — and only an approved authority application
 * writes that relationship. Without a route to it from the property, anything
 * created after onboarding stayed ownerless indefinitely.
 *
 * Deliberately distinct from the condition check beside it: photographs show
 * what a building looks like and say nothing about who may let it.
 */

const RELATIONSHIPS = [
  { value: "owner", label: "I own it" },
  { value: "agent", label: "Owner's agent" },
  { value: "manager", label: "I manage it" },
  { value: "company_representative", label: "For a company" },
] as const;

type Relationship = (typeof RELATIONSHIPS)[number]["value"];

const EVIDENCE_HINT: Record<Relationship, string> = {
  owner: "An indenture, title, or a land or assembly document naming you.",
  agent: "A letter from the owner naming you and this property.",
  manager: "The agreement appointing you to manage it.",
  company_representative: "The certificate showing the company is registered.",
};

export function AuthorityClaim({
  propertyId,
  onSubmitted,
  showSubmit = true,
  onReady,
  submitRef,
}: {
  propertyId: string;
  onSubmitted: () => Promise<void>;
  /** False when the property screen owns the one button for the whole thing. */
  showSubmit?: boolean;
  onReady?: (ready: boolean) => void;
  /** Filled with this form's submit, so the shared button can call it. */
  submitRef?: { current: (() => Promise<void>) | null };
}) {
  const [relationship, setRelationship] = useState<Relationship>("owner");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [document, setDocument] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  // Acting for somebody else means naming them: a reviewer has to be able to
  // check the claim with the person it is made about.
  const actingForAnother = relationship !== "owner";

  async function pickDocument() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to attach your document.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) setDocument(result.assets[0]);
  }

  async function submit() {
    if (!document) {
      setError("Add the document that supports your claim.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const stored = await uploadImage(document, "property_document");
      if (!stored.is_usable) {
        setError(stored.status_message || "That document could not be accepted.");
        return;
      }
      await recordPropertyClaim(propertyId, {
        relationship_type: relationship,
        owner_name: actingForAnother ? ownerName.trim() : undefined,
        owner_phone: actingForAnother ? ownerPhone.trim() : undefined,
        company_name:
          relationship === "company_representative" ? companyName.trim() : undefined,
        file_ids: [stored.id],
      });
      setSent(true);
      await onSubmitted();
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not save that document.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Handed up so the shared button knows whether this half is ready, and can
  // run it. Written in effects, never during render.
  useEffect(() => {
    if (submitRef) submitRef.current = submit;
  });

  useEffect(() => {
    onReady?.(Boolean(document));
  }, [document, onReady]);

  if (sent) {
    return (
      <Notice
        tone="info"
        title="Your claim is with our team"
        body="Once it is accepted this property is recorded as yours, and it can be advertised."
      />
    );
  }

  return (
    <View style={styles.claim}>
      <Select
        label="Your relationship to this property"
        placeholder="Choose one"
        value={relationship}
        options={RELATIONSHIPS.map((row) => ({ value: row.value, label: row.label }))}
        onChange={(value) => setRelationship(value as Relationship)}
      />

      {actingForAnother ? (
        <>
          <Field label="The owner's name" placeholder="Ama Mensah" value={ownerName} onChangeText={setOwnerName} />
          <Field
            label="The owner's phone number"
            placeholder="024 123 4567"
            value={ownerPhone}
            onChangeText={setOwnerPhone}
            keyboardType="phone-pad"
          />
        </>
      ) : null}

      {relationship === "company_representative" ? (
        <Field label="Company name" placeholder="Adenta Homes Ltd" value={companyName} onChangeText={setCompanyName} />
      ) : null}

      {/* The document is a thing you attach, so it reads as a row that holds
          one — with a tick once it does — rather than as a secondary button
          whose label had to say both what it does and what it has done. */}
      <RecordPanel>
        <LinkRow
          first
          icon={document ? "checkmark-circle" : "document-attach-outline"}
          tone={document ? "good" : "action"}
          label={document ? (document.fileName || "Document attached") : "Attach the document"}
          detail={document ? "Tap to choose a different one" : EVIDENCE_HINT[relationship]}
          onPress={pickDocument}
        />
      </RecordPanel>

      {error ? <Notice tone="error" title={error} /> : null}

      {showSubmit ? (
        <ActionBar>
          <Pill
            label="Save document"
            icon="shield-checkmark-outline"
            busy={busy}
            busyLabel="Saving"
            disabled={!document}
            grow
            onPress={submit}
          />
        </ActionBar>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  claim: {
    gap: space[3],
  },
});
