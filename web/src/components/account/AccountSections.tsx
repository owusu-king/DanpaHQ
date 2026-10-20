"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Avatar } from "@/components/portal/icons";
import { Select } from "@/components/Select";
import {
  attachVerificationEvidence,
  changePassword,
  listMyVerifications,
  startVerification,
  setProfileBio,
  setProfilePhoto,
  updateProfile,
  uploadFile,
} from "@/lib/console";
import { fieldErrorsFrom, summaryErrorFrom, type FieldErrors } from "@/lib/formErrors";
import { ARTISAN_STATUS_LOOK } from "@/lib/artisan";
import type { Capabilities } from "@/lib/session";

const MIN_PASSWORD_LENGTH = 8;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `1994-03-02` as "2 March 1994". */
function longDate(value: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return "Not given";
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

/**
 * Content only.
 *
 * These render inside a Settings panel that already carries the heading, the
 * explanation and the frame. When they carried their own as well, `/settings`
 * read "Photo" then "Your photo", and each one drew a bordered card inside the
 * panel that was already holding it.
 */
const sectionStyle: React.CSSProperties = {
  display: "grid",
  gap: "var(--space-4)",
};

/**
 * What the platform believes about this account, in plain words.
 *
 * Read straight from `capabilities`, never derived. The point of the section is
 * that someone can tell, without guessing, which experience they are in, what
 * has been decided about them, and what is still outstanding.
 */
export function AccountStanding({
  capabilities,
  phoneDisplay,
}: {
  capabilities: Capabilities;
  phoneDisplay: string;
}) {
  const provider = capabilities.provider;

  const providerLine = !provider.exists
    ? "Not a provider account."
    : provider.verification_status === "approved"
      ? "Approved — you can create properties."
      : provider.onboarding_complete
        ? "Documents submitted. Your review is with our team, and your provider workspace opens once it is approved."
        : "Not started. Send an identity document to begin.";

  return (
    <section style={sectionStyle}>

      <Row label="Mobile number" value={phoneDisplay} mono />
      <Row
        label="Account type"
        value={capabilities.account_type === "provider" ? "Property provider" : "Tenant"}
      />
      <Row
        label="Current experience"
        value={
          {
            discovery: "Browsing",
            tenant: "Tenant",
            provider: "Provider",
            artisan: "Artisan",
          }[capabilities.active_workspace]
        }
      />
      <Row label="Provider verification" value={providerLine} />
      {capabilities.artisan.status !== "not_started" ? (
        <Row label="Artisan application" value={ARTISAN_STATUS_LOOK[capabilities.artisan.status].pill} />
      ) : null}

      {provider.exists && !provider.can_create_property ? (
        <Notice
          tone="info"
          title="Provider verification is not finished"
          body="Your account is set up and works normally. Creating properties becomes available once your provider verification is approved."
        />
      ) : null}
    </section>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", justifyContent: "space-between" }}>
      <span className="type-caption" style={{ color: "var(--color-ink-500)" }}>{label}</span>
      <span
        className="type-body-strong"
        style={mono ? { fontFamily: "var(--font-mono)" } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The profile photo. Optional, and it stays optional.
 *
 * Initials are shown when there is none, never a silhouette of a stranger, so
 * the account has a recognisable mark before anyone uploads anything. That is
 * also why nothing here nags: a photo raises profile completeness and is
 * otherwise nobody's business.
 *
 * The upload reuses `uploadFile`, which reserves, sends the bytes straight to
 * storage, and waits for the virus scan. A photo is not a special case worth a
 * second code path.
 */
export function PhotoSection({
  name,
  photoUrl,
  onSaved,
}: {
  name: string;
  photoUrl: string | null;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clearing the input is what lets someone pick the same file again after a
    // failure; without it the change event never fires a second time.
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setError("");
    try {
      const stored = await uploadFile(file, "avatar");
      if (!stored.is_usable) {
        setError(
          stored.rejection_reason ||
            "That photo could not be accepted. Try a different one.",
        );
        return;
      }
      await setProfilePhoto(stored.id);
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not set that photo.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await setProfilePhoto(null);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={sectionStyle}>
      {error ? <Notice tone="warning" title="That did not work" body={error} /> : null}

      <div className="settings-photo">
        <span className="settings-photo-frame">
          <Avatar name={name} size={72} photoUrl={photoUrl} />
        </span>
        <div className="settings-photo-copy">
          <strong>{photoUrl ? "Current photo" : "No photo yet"}</strong>
          <small>JPEG, PNG or WebP. Large photos are optimized on your device for the 3.5 MB pilot limit.</small>
          <div className="settings-photo-actions">
            <label className={`settings-upload${busy ? " is-busy" : ""}`}>
              {busy ? "Working…" : photoUrl ? "Change photo" : "Upload a photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={choose}
                disabled={busy}
                className="sr-only"
              />
            </label>
            {photoUrl ? (
              <Button variant="quiet" size="sm" type="button" onClick={remove} disabled={busy}>
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ProfileSection({
  initial,
  onSaved,
}: {
  initial: {
    first_name: string;
    last_name: string;
    preferred_name: string;
    date_of_birth: string | null;
    bio: string;
  };
  onSaved: () => Promise<void>;
}) {
  const [firstName, setFirstName] = useState(initial.first_name);
  const [lastName, setLastName] = useState(initial.last_name);
  const [preferredName, setPreferredName] = useState(initial.preferred_name);
  const [bio, setBio] = useState(initial.bio);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setSummary("");
    setSaved(false);
    try {
      // The email is not here: an address joins the account only through its
      // code, in the Email panel. The bio is part of the profile, not the account.
      await Promise.all([
        updateProfile({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          preferred_name: preferredName.trim(),
        }),
        bio !== initial.bio ? setProfileBio(bio.trim()) : Promise.resolve(null),
      ]);
      await onSaved();
      setSaved(true);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setErrors(fields);
      setSummary(summaryErrorFrom(cause, fields));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={sectionStyle}>
      <Field
        label="What should we call you?"
        hint="The name landlords and agents will see."
        value={preferredName}
        onChange={(event) => setPreferredName(event.target.value)}
        error={errors.preferred_name}
        autoComplete="nickname"
      />
      <div className="settings-fields-2">
        <Field
          label="First name"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          error={errors.first_name}
          autoComplete="given-name"
        />
        <Field
          label="Surname"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          error={errors.last_name}
          autoComplete="family-name"
        />
      </div>
      <div className="profile-readonly">
        <span className="type-caption">Date of birth</span>
        <strong>{longDate(initial.date_of_birth)}</strong>
        <small>Set when you joined. Contact support if it is wrong.</small>
      </div>
      <label className="field">
        <span className="type-caption field-label">About you (optional)</span>
        <textarea
          className="profile-textarea"
          rows={3}
          maxLength={600}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          placeholder="A line or two for providers you apply to"
        />
      </label>
      {summary ? <Notice tone="error" title={summary} /> : null}
      {saved ? <Notice tone="success" title="Saved" /> : null}
      <Button type="submit" busy={busy}>Save changes</Button>
    </form>
  );
}

/** Change a known password. The current one is required even inside a session. */
export function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) {
      setErrors({ new_password: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    setBusy(true);
    setErrors({});
    setSummary("");
    setDone(false);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setDone(true);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setErrors(fields);
      setSummary(summaryErrorFrom(cause, fields));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={sectionStyle}>
      <div className="settings-fields-2">
        <Field
          label="Current password"
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          error={errors.current_password}
          autoComplete="current-password"
        />
        <Field
          label="New password"
          type="password"
          value={next}
          onChange={(event) => {
            setNext(event.target.value);
            if (errors.new_password) setErrors({});
          }}
          error={errors.new_password}
          autoComplete="new-password"
        />
      </div>
      {summary ? <Notice tone="error" title={summary} /> : null}
      {done ? (
        <Notice
          tone="success"
          title="Password changed"
          body="Your other devices have been signed out."
        />
      ) : null}
      <Button type="submit" busy={busy}>Change password</Button>
    </form>
  );
}

const ID_DOCUMENTS = [
  ["ghana_card_front", "Ghana Card — front"],
  ["ghana_card_back", "Ghana Card — back"],
  ["passport", "Passport"],
  ["drivers_licence", "Driver's licence"],
] as const;

/**
 * Submitting an identity check.
 *
 * This is the step the provider screen sends people here for, and until now the
 * web had nowhere to do it — the account page could show that identity was
 * unverified but offered no way to change that.
 *
 * A check that came back `needs_more_info` is continued by adding evidence to
 * the row that already exists, so the reviewer sees one case with everything
 * attached rather than two half-cases.
 */
export function IdentitySection({
  state,
  onSubmitted,
}: {
  state: "verified" | "pending" | "unverified" | "expired";
  onSubmitted: () => Promise<void>;
}) {
  // The reviewer's note lives on the verification, not in the trust summary —
  // and deliberately so: that summary also feeds the public view of someone's
  // stamps, where a note about them has no business appearing. So this section
  // reads its own row.
  const [decisionNote, setDecisionNote] = useState("");
  const [documentType, setDocumentType] = useState<string>("ghana_card_front");
  const [nationalId, setNationalId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const loadNote = useCallback(async () => {
    try {
      const { verifications } = await listMyVerifications();
      const identity = verifications.find((row) => row.kind === "identity");
      setDecisionNote(
        identity && ["rejected", "needs_more_info"].includes(identity.status)
          ? identity.decision_note
          : "",
      );
    } catch {
      // A missing note is not worth an error next to a form that still works.
      setDecisionNote("");
    }
  }, []);

  useEffect(() => {
    void loadNote();
  }, [loadNote]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a clear photo or scan of the document.");
      return;
    }
    setBusy(true);
    setError("");
    setSent(false);
    try {
      const stored = await uploadFile(file, "identity_document");
      const { verifications } = await listMyVerifications();
      const continuing = verifications.find(
        (row) => row.kind === "identity" && row.status === "needs_more_info",
      );
      const verificationId =
        continuing?.id ?? (await startVerification("identity")).id;

      await attachVerificationEvidence(verificationId, {
        evidence_type: documentType,
        file_id: stored.id,
        national_id: nationalId.trim() || undefined,
      });
      setFile(null);
      setSent(true);
      await loadNote();
      await onSubmitted();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not submit that document.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (state === "verified") {
    return (
      <section style={sectionStyle}>
        <Notice
          tone="success"
          title="Identity verified"
          body="Nothing further is needed. This check carries to every property you manage."
        />
      </section>
    );
  }

  if (state === "pending") {
    return (
      <section style={sectionStyle}>
        <Notice
          tone="info"
          title="With our review team"
          body="You will be told the outcome. There is nothing further to send unless we ask."
        />
      </section>
    );
  }

  return (
    <form onSubmit={submit} style={sectionStyle}>
      <p className="type-caption" style={{ margin: 0, maxWidth: "60ch" }}>
        A government-issued document, checked once and carried to everything you do
        here. It is the first thing a provider verification rests on.
      </p>

      {decisionNote ? <Notice tone="warning" title="From the reviewer" body={decisionNote} /> : null}

      <Select
        label="Document type"
        value={documentType}
        onChange={setDocumentType}
        options={ID_DOCUMENTS}
      />
      <Field
        label="Document number (optional)"
        value={nationalId}
        onChange={(event) => setNationalId(event.target.value)}
        hint="Helps the reviewer match the document to the register."
      />
      <label className="type-caption" style={{ display: "grid", gap: "var(--space-2)" }}>
        <span style={{ color: "var(--color-ink-700)" }}>Photo or scan</span>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <p className="type-caption" style={{ margin: 0 }}>
        Large photos are optimized on your device when possible; PDFs must be under 3.5 MB. Cloudmersive scans the file in North America before review.
      </p>

      {error ? <Notice tone="error" title={error} /> : null}
      {sent ? <Notice tone="success" title="Sent for review" /> : null}
      <Button type="submit" busy={busy}>Submit for review</Button>
    </form>
  );
}
