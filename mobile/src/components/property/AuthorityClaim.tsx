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

/** A property for sale is sold on its title, so the review reads the title too.
 *  Unregistered land has an indenture instead of a certificate. */
const TITLE_TYPES = [
  { value: "land_title_certificate", label: "Land Title Certificate" },
  { value: "indenture", label: "Indenture (not yet registered)" },
] as const;

type Asset = ImagePicker.ImagePickerAsset;

export function AuthorityClaim({
  propertyId,
  onSubmitted,
  showSubmit = true,
  onReady,
  submitRef,
  saleKind = null,
}: {
  propertyId: string;
  /** Set for a property for sale: its title is asked for beside the
   *  relationship document, and land adds its surveyed site plan. */
  saleKind?: "residential" | "commercial" | "land" | null;
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
  const [document, setDocument] = useState<Asset | null>(null);
  const [titleType, setTitleType] = useState<string>(TITLE_TYPES[0].value);
  const [title, setTitle] = useState<Asset | null>(null);
  const [sitePlan, setSitePlan] = useState<Asset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  // Acting for somebody else means naming them: a reviewer has to be able to
  // check the claim with the person it is made about.
  const actingForAnother = relationship !== "owner";
  const selling = saleKind !== null;
  const land = saleKind === "land";
  const ready = Boolean(document) && (!selling || Boolean(title)) && (!land || Boolean(sitePlan));

  async function pick(set: (asset: Asset) => void) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to attach your document.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) set(result.assets[0]);
  }

  async function submit() {
    if (!document) {
      setError("Add the document that supports your claim.");
      return;
    }
    if (selling && !title) {
      setError("Add the property's title — its Land Title Certificate or indenture.");
      return;
    }
    if (land && !sitePlan) {
      setError("Add the surveyed site plan of the plot.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // The relationship document carries no declared type; the title and the
      // site plan say which they are, so the reviewer finds each where it belongs.
      const uploads: { asset: Asset; type: string | null }[] = [
        { asset: document, type: null },
        ...(selling && title ? [{ asset: title, type: titleType }] : []),
        ...(land && sitePlan ? [{ asset: sitePlan, type: "site_plan" }] : []),
      ];
      const fileIds: string[] = [];
      const evidenceTypes: Record<string, string> = {};
      for (const upload of uploads) {
        const stored = await uploadImage(upload.asset, "property_document");
        if (!stored.is_usable) {
          setError(stored.status_message || "That document could not be accepted.");
          return;
        }
        fileIds.push(stored.id);
        if (upload.type) evidenceTypes[stored.id] = upload.type;
      }
      await recordPropertyClaim(propertyId, {
        relationship_type: relationship,
        owner_name: actingForAnother ? ownerName.trim() : undefined,
        owner_phone: actingForAnother ? ownerPhone.trim() : undefined,
        company_name:
          relationship === "company_representative" ? companyName.trim() : undefined,
        file_ids: fileIds,
        ...(selling ? { evidence_types: evidenceTypes } : {}),
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
    onReady?.(ready);
  }, [ready, onReady]);

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
          onPress={() => void pick(setDocument)}
        />
      </RecordPanel>

      {selling ? (
        <>
          <Select
            label="The property's title"
            value={titleType}
            options={TITLE_TYPES.map((row) => ({ value: row.value, label: row.label }))}
            onChange={setTitleType}
          />
          <RecordPanel>
            <LinkRow
              first
              icon={title ? "checkmark-circle" : "document-text-outline"}
              tone={title ? "good" : "action"}
              label={title ? (title.fileName || "Title attached") : "Attach the title"}
              detail={title
                ? "Tap to choose a different one"
                : titleType === "indenture"
                  ? "Every page, and the stamp duty receipt if you have it."
                  : "The certificate from the Lands Commission."}
              onPress={() => void pick(setTitle)}
            />
            {land ? (
              <LinkRow
                icon={sitePlan ? "checkmark-circle" : "map-outline"}
                tone={sitePlan ? "good" : "action"}
                label={sitePlan ? (sitePlan.fileName || "Site plan attached") : "Attach the site plan"}
                detail={sitePlan ? "Tap to choose a different one" : "Signed by a licensed surveyor."}
                onPress={() => void pick(setSitePlan)}
              />
            ) : null}
          </RecordPanel>
        </>
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      {showSubmit ? (
        <ActionBar>
          <Pill
            label={selling ? "Save documents" : "Save document"}
            icon="shield-checkmark-outline"
            busy={busy}
            busyLabel="Saving"
            disabled={!ready}
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
