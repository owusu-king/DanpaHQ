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

import { Button } from "@/components/Button";
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
}: {
  unitId: string;
  /** False while a reviewer holds it, or once it has been approved. */
  editable: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [slots, setSlots] = useState<EvidenceSlot[]>([]);
  const [photos, setPhotos] = useState<SpacePhoto[]>([]);
  const [busySlot, setBusySlot] = useState("");
  const [error, setError] = useState("");

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
    if (!file) return;
    setBusySlot(slotKey);
    setError("");
    try {
      const stored = await uploadFile(file, "property_photo");
      if (!stored.is_usable) {
        setError(stored.rejection_reason || "That photo could not be accepted.");
        return;
      }
      await attachUnitPhoto(unitId, { file_id: stored.id, slot_key: slotKey });
      await load();
      await onChanged?.();
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not add that photo.",
      );
    } finally {
      setBusySlot("");
    }
  }

  async function act(run: () => Promise<unknown>) {
    setError("");
    try {
      await run();
      await load();
      await onChanged?.();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
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
      {error ? <Notice tone="error" title={error} /> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        {rows.map(({ slot, photo }, index) => (
          <figure
            key={slot?.key ?? photo?.id ?? index}
            style={{
              margin: 0,
              display: "grid",
              gap: "var(--space-2)",
              padding: "var(--space-3)",
              background: "var(--color-field-0)",
              border: "var(--border-hairline) solid var(--color-field-200)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <div
              style={{
                position: "relative",
                aspectRatio: "4 / 3",
                background: "var(--color-field-100)",
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
                display: "grid",
                placeItems: "center",
              }}
            >
              {photo?.download_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.download_url}
                  alt={slot?.label ?? photo.caption ?? "Photo of this Unit"}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span className="type-caption" style={{ color: "var(--color-ink-500)" }}>
                  {photo ? "Photo added" : "No photo yet"}
                </span>
              )}
              {photo?.is_primary ? (
                <span
                  className="type-label"
                  style={{
                    position: "absolute",
                    top: "var(--space-2)",
                    left: "var(--space-2)",
                    padding: "2px var(--space-2)",
                    background: "var(--color-kola-600)",
                    color: "var(--color-field-0)",
                    borderRadius: "var(--radius-stamp)",
                    textTransform: "uppercase",
                  }}
                >
                  First image
                </span>
              ) : null}
            </div>

            <figcaption style={{ display: "grid", gap: "var(--space-1)" }}>
              <span className="type-body-strong">
                {slot?.label ?? photo?.caption ?? "Photo"}
                {slot && !slot.required ? " (optional)" : ""}
              </span>
              {slot ? (
                <span className="type-caption" style={{ color: "var(--color-ink-500)" }}>
                  {slot.why}
                </span>
              ) : null}
            </figcaption>

            {!editable ? null : photo ? (
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                {photo.is_primary ? null : (
                  <Button
                    variant="quiet"
                    onClick={() => act(() => setPrimaryUnitPhoto(unitId, photo.id))}
                  >
                    Make it first
                  </Button>
                )}
                <Button
                  variant="quiet"
                  onClick={() => act(() => removeUnitPhoto(unitId, photo.id))}
                  style={{ color: "var(--color-laterite-600)" }}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <label
                className="type-body-strong"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "var(--target-min)",
                  padding: "0 var(--space-4)",
                  border: "var(--border-hairline) solid var(--color-field-300)",
                  borderRadius: "var(--radius-md)",
                  cursor: busySlot ? "progress" : "pointer",
                }}
              >
                {busySlot === slot?.key ? "Adding…" : "Add photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={Boolean(busySlot)}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // Cleared so the same file can be chosen again after a
                    // failure; without it the change event never fires twice.
                    event.target.value = "";
                    void add(slot?.key ?? "", file);
                  }}
                  className="sr-only"
                />
              </label>
            )}
          </figure>
        ))}
      </div>

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
