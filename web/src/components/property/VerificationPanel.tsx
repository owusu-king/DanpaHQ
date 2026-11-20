"use client";

/**
 * The checklist for getting a property or a space checked.
 *
 * Deliberately a checklist rather than a form. The photos arrive over several
 * minutes and often several sittings — someone walks round the building taking
 * them — so the screen has to survive being left and come back saying exactly
 * what is still outstanding. Each row is one named thing to photograph, with the
 * reason it is asked for, because a provider who understands why sends a better
 * version of it.
 *
 * Nothing here decides completeness. The server does, and `can_submit` comes
 * back from it — a client that computed its own answer would eventually offer a
 * submit button the backend refuses.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { ApiFailure } from "@/lib/api";
import { uploadFile } from "@/lib/console";
import { WalkthroughUpload } from "./WalkthroughVideo";
import {
  attachEvidence,
  getVerification,
  removeEvidence,
  submitForReview,
  type EvidenceSlot,
  type Subject,
  type VerificationProgress,
} from "@/lib/verification";

export function VerificationPanel({
  subject,
  id,
  title,
  showSubmit = true,
  onState,
  onChanged,
  submitRef,
  onMediaBusy,
}: {
  subject: Subject;
  id: string;
  title: string;
  /** False when something above owns the submit button — see the setup flow's
   *  review step, where the photos and the ownership document go together. */
  showSubmit?: boolean;
  onMediaBusy?: (busy: boolean) => void;
  onState?: (state: VerificationProgress | null) => void;
  onChanged?: () => void;
  /** Filled with this panel's submit, so a shared button can call it. */
  submitRef?: { current: (() => Promise<void>) | null };
}) {
  const [state, setState] = useState<VerificationProgress | null>(null);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState<{ slot: string; message: string } | null>(null);
  const [busySlot, setBusySlot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const mediaBusy = videoBusy || Boolean(busySlot);

  useEffect(() => { onMediaBusy?.(mediaBusy); }, [mediaBusy, onMediaBusy]);

  // Held in a ref rather than depended on: a caller passing an inline arrow
  // would otherwise change `load` on every render, and the effect below would
  // refetch forever. Written in an effect — a ref must not be touched during
  // render, or React cannot guarantee the component updates as expected.
  const report = useRef(onState);
  useEffect(() => {
    report.current = onState;
  });

  const load = useCallback(async () => {
    try {
      const next = await getVerification(subject, id);
      setState(next);
      report.current?.(next);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load this check.",
      );
    }
  }, [subject, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function choose(slotKey: string, file: File | undefined) {
    if (!file || mediaBusy) return;
    setBusySlot(slotKey);
    setError("");
    setFileError(null);
    try {
      const stored = await uploadFile(file, "property_photo");
      if (!stored.is_usable) {
        setFileError({ slot: slotKey, message: stored.rejection_reason || stored.status_message || "That photo could not be accepted." });
        return;
      }
      const next = await attachEvidence(subject, id, {
        slot_key: slotKey,
        file_id: stored.id,
      });
      setState(next);
      report.current?.(next);
      onChanged?.();
    } catch (cause) {
      setFileError({ slot: slotKey, message: cause instanceof Error ? cause.message : "Could not add that photo." });
    } finally {
      setBusySlot("");
    }
  }

  async function remove(slotKey: string) {
    setBusySlot(slotKey);
    setError("");
    try {
      const next = await removeEvidence(subject, id, slotKey);
      setState(next);
      report.current?.(next);
      onChanged?.();
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not remove that photo.",
      );
    } finally {
      setBusySlot("");
    }
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const next = await submitForReview(subject, id);
      setState(next);
      report.current?.(next);
      onChanged?.();
    } catch (cause) {
      // The refusal names the outstanding slots, so it is worth showing as-is.
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not submit this yet.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Written in an effect, never during render: the ref has to hold the closure
  // from the most recent render, and React reserves render for pure work.
  useEffect(() => {
    if (submitRef) submitRef.current = submit;
  });

  if (!state) {
    return (
      <p className="type-caption" style={{ margin: 0 }}>
        {error || "Loading what this needs…"}
      </p>
    );
  }

  if (state.status === "approved") {
    return <Notice tone="success" title={`${title} has been checked`} />;
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)", minWidth: 0 }}>
      {subject === "property" ? <WalkthroughUpload subject="property" id={id} editable={Boolean(state.editable)} onBusy={setVideoBusy} /> : null}
      {state.submitted ? (
        <Notice
          tone="info"
          title="With our team"
        />
      ) : (
        <p className="type-caption" style={{ margin: 0 }}>
          {state.required_outstanding === 0
            ? showSubmit
              ? "All set. Send it for review."
              : "All set."
            : `${state.required_outstanding} of ${state.required_total} still needed.`}
        </p>
      )}

      {state.decision_note ? (
        <Notice tone="warning" title="We asked for more" body={state.decision_note} />
      ) : null}
      {error ? <Notice tone="error" title={error} /> : null}

      {!state.submitted && state.slots.length ? <p className="type-caption">Choose or drop a JPEG, PNG or WebP photo on its matching slot. Up to 25 MB per original.</p> : null}
      <ul className="evidence-slots">
        {state.slots.map((slot) => (
          <li key={slot.key} className="evidence-slot">
            <EvidenceTile
              slot={slot}
              locked={state.submitted}
              busy={busySlot === slot.key}
              disabled={mediaBusy}
              onChoose={(file) => void choose(slot.key, file)}
            />
            <div className="evidence-slot-what">
              <p className="type-body-strong" style={{ margin: 0 }}>
                {slot.label}
                {slot.required ? "" : " (optional)"}
              </p>
              <p className="type-caption" style={{ margin: 0 }}>
                {slot.why}
              </p>
              {busySlot === slot.key ? <span className="type-caption" role="status">Updating photo…</span> : null}
              {fileError?.slot === slot.key ? <span className="type-caption field-error" role="alert">{fileError.message}</span> : null}
              {slot.provided && state.submitted ? (
                <span className="type-caption evidence-slot-sent">Sent</span>
              ) : slot.provided ? (
                <button
                  type="button"
                  onClick={() => void remove(slot.key)}
                  disabled={mediaBusy}
                  className="type-caption evidence-slot-remove"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {state.submitted || !showSubmit ? null : (
        <div>
          <Button onClick={submit} busy={submitting} disabled={mediaBusy || !state.can_submit}>
            Send for review
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One slot's photograph, and the way to put one there.
 *
 * The slot used to render the word "Added" and nothing else, so a provider who
 * photographed the wrong side of a building was stuck with it. The fix added a
 * preview and two bordered buttons beside it — and that block, at a fixed
 * ~200px against `white-space: nowrap`, took every pixel the column lost. In a
 * 420px step the reason beside it wrapped to three lines; on the phone the same
 * slot was a card holding a 140px-tall image, so six of them ran past 1,700px.
 *
 * So the photograph is the control. Tapping it replaces what is there, which is
 * how changing a picture works everywhere else, and an empty slot is the same
 * square waiting — one 64px anchor per row, in a column you can glance down to
 * see what is still missing. Remove stays a separate, quiet thing: it is the
 * only action here that destroys something.
 *
 * Both disappear once a reviewer holds the submission, because what they were
 * sent must not change under them — the API refuses either way.
 */
export function EvidenceTile({
  slot,
  locked,
  busy,
  disabled,
  onChoose,
}: {
  slot: Pick<EvidenceSlot, "label" | "provided" | "preview_url">;
  locked: boolean;
  busy: boolean;
  disabled: boolean;
  onChoose: (file: File | undefined) => void;
}) {
  const [broken, setBroken] = useState(false);

  // A preview URL is short-lived and the object behind it can be gone — still
  // scanning, or cleaned up. A silent gap where a photograph should be reads as
  // a bug in the upload the provider has just made.
  const photo =
    slot.provided && slot.preview_url && !broken ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={slot.preview_url}
        alt=""
        onError={() => setBroken(true)}
        className="evidence-tile-photo"
      />
    ) : (
      <span className="evidence-tile-mark" aria-hidden="true">
        <Icon name={slot.provided ? "check" : "upload"} />
      </span>
    );

  if (locked) {
    return <span className="evidence-tile">{photo}</span>;
  }

  return (
    <label
      className={slot.provided ? "evidence-tile" : "evidence-tile evidence-tile-empty"}
      style={{ cursor: disabled ? "progress" : "pointer" }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        if (!disabled) onChoose(event.dataTransfer.files[0]);
      }}
    >
      {busy ? (
        <span className="evidence-tile-mark" aria-hidden="true">
          …
        </span>
      ) : (
        photo
      )}
      {/* Named for anybody not looking at it: a square with a plus in it says
          nothing to a screen reader, and "Replace" is the whole affordance for
          a slot that already has a photograph. */}
      <span className="sr-only">
        {slot.provided ? `Replace the photo of ${slot.label}` : `Add a photo of ${slot.label}`}
      </span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so the same file can be picked again after a failure;
          // without it the change event never fires twice.
          event.target.value = "";
          onChoose(file);
        }}
        className="sr-only"
      />
    </label>
  );
}
