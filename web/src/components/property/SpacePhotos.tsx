"use client";

/**
 * The space's photographs — which are also the evidence its check is decided on.
 *
 * One upload, two consequences. A provider photographs the room once; that
 * image is what a tenant sees and what a reviewer judges. Asking twice is how
 * the reviewed room and the advertised room become different rooms, and it is
 * also how a hostel with eight rooms turns into an afternoon of uploading.
 *
 * The main view and every selected amenity are required; two context views are
 * invited. The slots, labels and requirement state all come from the backend's
 * evidence policy, so adding Kitchen immediately produces a Kitchen photo slot
 * without either client keeping a second copy of that rule.
 */

import { useCallback, useEffect, useState } from "react";
import { WalkthroughUpload } from "./WalkthroughVideo";

import { EvidenceTile } from "./VerificationPanel";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
import {
  attachUnitPhoto,
  listUnitPhotos,
  removeUnitPhoto,
  setPrimaryUnitPhoto,
  uploadFile,
  type SpacePhoto,
} from "@/lib/console";
import { getVerification, type EvidenceSlot } from "@/lib/verification";

export function SpacePhotos({
  unitId,
  editable,
  onChanged,
  onMediaBusy,
}: {
  unitId: string;
  /** False while a reviewer holds it, or once it has been approved. */
  editable: boolean;
  onChanged?: () => void | Promise<void>;
  onMediaBusy?: (busy: boolean) => void;
}) {
  const [slots, setSlots] = useState<EvidenceSlot[]>([]);
  const [photos, setPhotos] = useState<SpacePhoto[]>([]);
  const [busySlot, setBusySlot] = useState("");
  const [videoBusy, setVideoBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const mediaBusy = videoBusy || updating || Boolean(busySlot);

  useEffect(() => { onMediaBusy?.(mediaBusy); }, [mediaBusy, onMediaBusy]);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState<{ slot: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [progress, stored] = await Promise.all([
        getVerification("unit", unitId),
        listUnitPhotos(unitId),
      ]);
      // An approved check returns no slots — there is nothing left to ask for —
      // so the photographs themselves become the list.
      setSlots(progress.slots);
      setPhotos(stored.photos);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load the photos.",
      );
    }
  }, [unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(slotKey: string, file: File | undefined) {
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
      await attachUnitPhoto(unitId, { file_id: stored.id, slot_key: slotKey });
      await load();
      await onChanged?.();
    } catch (cause) {
      setFileError({ slot: slotKey, message: cause instanceof Error ? cause.message : "Could not add that photo." });
    } finally {
      setBusySlot("");
    }
  }

  async function act(run: () => Promise<unknown>) {
    setUpdating(true);
    setError("");
    try {
      await run();
      await load();
      await onChanged?.();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setUpdating(false);
    }
  }

  const slottedRows = slots.map((slot) => ({
        slot,
        photo: photos.find((row) => row.slot_key === slot.key) ?? null,
      }));
  const knownKeys = new Set(slots.map((slot) => slot.key));
  const retainedRows = photos
    .filter((photo) => !knownKeys.has(photo.slot_key))
    .map((photo) => ({ slot: null, photo }));
  const rows = slots.length ? [...slottedRows, ...retainedRows] : retainedRows;

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <WalkthroughUpload subject="unit" id={unitId} editable={editable} onBusy={setVideoBusy} />
      {error ? <Notice tone="error" title={error} /> : null}
      {editable ? <p className="type-caption">The main view and each selected amenity need a photo. The two context views are optional.</p> : null}
      {editable && slots.length ? <p className="type-caption">Choose or drop a JPEG, PNG or WebP photo on its matching slot. Up to 25 MB per original.</p> : null}

      <ul className="evidence-slots">
        {rows.map(({ slot, photo }, index) => (
          <li className="evidence-slot" key={slot?.key ?? photo?.id ?? index}>
            <EvidenceTile
              slot={{ label: slot?.label || photo?.caption || `Photo ${index + 1}`, provided: Boolean(photo), preview_url: photo?.download_url ?? null }}
              locked={!editable || Boolean(photo)}
              busy={busySlot === slot?.key}
              disabled={mediaBusy}
              onChoose={(file) => void add(slot?.key ?? "", file)}
            />
            <div className="evidence-slot-what">
              <p className="type-body-strong" style={{ margin: 0 }}>
                {photo?.is_primary ? "First image · " : ""}{slot?.label || photo?.caption || `Photo ${index + 1}`}{slot && !slot.required ? " (optional)" : ""}
              </p>
              {slot ? <p className="type-caption" style={{ margin: 0 }}>{slot.why}</p> : null}
              {busySlot && busySlot === slot?.key ? <span className="type-caption" role="status">Uploading photo…</span> : null}
              {fileError && fileError.slot === slot?.key ? <span className="type-caption field-error" role="alert">{fileError.message}</span> : null}
              {!editable || !photo ? null : <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
                {!photo.is_primary ? <button type="button" className="type-caption evidence-slot-remove" disabled={mediaBusy} onClick={() => void act(() => setPrimaryUnitPhoto(unitId, photo.id))}>Make it first</button> : null}
                <button type="button" className="type-caption evidence-slot-remove" disabled={mediaBusy} onClick={() => void act(() => removeUnitPhoto(unitId, photo.id))}>Remove</button>
              </div>}
            </div>
          </li>
        ))}
      </ul>

      {!editable && photos.length === 0 ? (
        <p className="type-caption" style={{ margin: 0 }}>
          No photos on this Unit.
        </p>
      ) : null}
    </div>
  );
}

/** Whether every currently required Unit and amenity photograph is in place. */
export function hasRequiredPhoto(slots: EvidenceSlot[]): boolean {
  return slots.filter((slot) => slot.required).every((slot) => slot.provided);
}
