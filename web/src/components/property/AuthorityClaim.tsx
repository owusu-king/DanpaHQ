"use client";

/**
 * Recording who says a property is theirs, and what they show for it.
 *
 * **This saves; it does not send.** The document sits on the property as a draft
 * claim, exactly the way the photographs sit on the condition review, until the
 * provider submits the whole property for verification — one act, both halves,
 * made from the property once it is finished.
 *
 * It used to file the claim for review the moment the document was chosen, so
 * the Documents step of the creation wizard read "Send this claim for review"
 * and did. By the last step there was nothing left of the claim to send, and the
 * button that should have finished creating a property said "Send the
 * photographs" instead.
 *
 * The gap this fills: a property created privately has no owner and no
 * relationship — deliberately, because the creator is a claimant and setting a
 * property up is not proof of holding it. Authority is established by a
 * reviewed application, and that review is the *only* thing that writes a
 * `PropertyRelationship`.
 *
 * But there was no way to reach it from a property. The provider journey
 * submits the claim for the first property during onboarding; anything created
 * afterwards had nowhere to go, so it stayed ownerless indefinitely and the
 * operations list showed a blank owner column for it forever.
 *
 * Deliberately distinct from the condition check next to it. Photographs show
 * what a building looks like; they say nothing about who may let it. Two
 * reviews, two questions, and conflating them would mean a flattering photo
 * establishing ownership.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { ApiFailure } from "@/lib/api";
import { recordPropertyClaim, uploadFile } from "@/lib/console";

const RELATIONSHIPS = [
  ["owner", "I own it"],
  ["agent", "I am the owner's agent"],
  ["manager", "I manage it for the owner"],
  ["company_representative", "I act for a company that holds it"],
] as const;

/** What each relationship has to produce. Read from the same policy the backend
 *  enforces would be better; this is the label only, and the server still
 *  decides whether what arrives is enough. */
const EVIDENCE_HINT: Record<string, string> = {
  owner: "Title, indenture or land document naming you.",
  agent: "The owner's letter naming you.",
  manager: "The agreement appointing you.",
  company_representative: "The company's registration certificate.",
};

/** A property for sale is sold on its title, so the review reads the title too.
 *  Unregistered land has an indenture instead of a certificate. */
const TITLE_TYPES = [
  ["land_title_certificate", "Land Title Certificate"],
  ["indenture", "Indenture (land not yet registered)"],
] as const;

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
  /** False when the setup flow's review step owns the one button that sends
   *  the whole property — the document and the photographs together. */
  showSubmit?: boolean;
  onReady?: (ready: boolean) => void;
  /** Filled with this form's submit, so the shared button can call it. */
  submitRef?: { current: (() => Promise<void>) | null };
}) {
  const [relationship, setRelationship] =
    useState<(typeof RELATIONSHIPS)[number][0]>("owner");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [titleType, setTitleType] = useState<string>(TITLE_TYPES[0][0]);
  const [titleFile, setTitleFile] = useState<File | null>(null);
  const [sitePlan, setSitePlan] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  // Acting for somebody else means naming them: a reviewer has to be able to
  // check the claim with the person it is made about.
  const actingForAnother = relationship !== "owner";
  const selling = saleKind !== null;
  const land = saleKind === "land";
  const ready = Boolean(file) && (!selling || Boolean(titleFile)) && (!land || Boolean(sitePlan));

  async function submit() {
    if (!file) {
      setError("Add the document that supports your claim.");
      return;
    }
    if (selling && !titleFile) {
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
      // The relationship document carries no declared type; the backend files
      // it as the one the relationship asks for. The title and the site plan say
      // which they are, so the reviewer finds each where it belongs.
      const uploads: { file: File; type: string | null }[] = [
        { file, type: null },
        ...(selling && titleFile ? [{ file: titleFile, type: titleType }] : []),
        ...(land && sitePlan ? [{ file: sitePlan, type: "site_plan" }] : []),
      ];
      const fileIds: string[] = [];
      const evidenceTypes: Record<string, string> = {};
      for (const upload of uploads) {
        const stored = await uploadFile(upload.file, "property_document");
        if (!stored.is_usable) {
          setError(
            stored.rejection_reason || `${upload.file.name} could not be accepted.`,
          );
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
  // run it. A ref rather than a callback prop because the button is a sibling,
  // not a parent of these fields. Written in an effect, never during render.
  useEffect(() => {
    if (submitRef) submitRef.current = submit;
  });

  useEffect(() => {
    onReady?.(ready);
  }, [ready, onReady]);

  if (sent) {
    return (
      <Notice
        tone="success"
        title="Document saved with this property"
        body="It goes to our team when you send the property for checking."
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <Select
        label="What is your relationship to this property?"
        value={relationship}
        onChange={(value) => setRelationship(value as typeof relationship)}
        options={RELATIONSHIPS}
      />

      {actingForAnother ? (
        <>
          <Field
            label="The owner's name"
            value={ownerName}
            onChange={(event) => setOwnerName(event.target.value)}
          />
          <Field
            label="The owner's phone number"
            value={ownerPhone}
            onChange={(event) => setOwnerPhone(event.target.value)}
            inputMode="tel"
          />
        </>
      ) : null}

      {relationship === "company_representative" ? (
        <Field
          label="Company name"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
        />
      ) : null}

      <FilePick
        hint={EVIDENCE_HINT[relationship]!}
        file={file}
        onChange={setFile}
        empty="Choose the document"
      />

      {selling ? (
        <>
          <Select
            label="The property's title"
            hint="Needed for a sale."
            value={titleType}
            onChange={setTitleType}
            options={TITLE_TYPES}
          />
          <FilePick
            hint={
              titleType === "indenture"
                ? "Every page, plus stamp duty receipt."
                : "From the Lands Commission."
            }
            file={titleFile}
            onChange={setTitleFile}
            empty="Choose the title document"
          />
        </>
      ) : null}

      {land ? (
        <FilePick
          hint="Signed by a licensed surveyor."
          file={sitePlan}
          onChange={setSitePlan}
          empty="Choose the site plan"
        />
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      {showSubmit ? (
        <div>
          <Button onClick={submit} busy={busy} busyLabel="Saving…" disabled={!ready}>
            {selling ? "Save documents" : "Save document"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** One document to choose, with what it should be said above it. */
function FilePick({
  hint,
  file,
  onChange,
  empty,
}: {
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
  empty: string;
}) {
  return (
    <div>
      <p className="type-caption" style={{ margin: "0 0 var(--space-2)" }}>
        {hint}
      </p>
      <label
        className="type-caption"
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 48,
          padding: "0 var(--space-4)",
          border: "var(--border-hairline) solid var(--color-field-300)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        {file ? file.name : empty}
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
          className="sr-only"
        />
      </label>
    </div>
  );
}
