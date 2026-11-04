/**
 * The space's photographs — which are also the evidence its check is decided on.
 *
 * One upload, two consequences. On a phone this matters more than anywhere
 * else: the provider is standing in the room with the camera, and asking them
 * to photograph it once for a reviewer and again for a tenant is how a hostel
 * with eight rooms becomes an afternoon.
 *
 * The main view and every selected amenity are required; two context views are
 * invited. Which, and what they are called, comes from the backend's evidence
 * policy — a client deciding for itself would eventually drift from the API.
 */

import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";
import { WalkthroughUpload } from "./WalkthroughVideo";
import { View } from "react-native";

import { ApiFailure } from "@/api";
import { QuietAct } from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import {
  attachUnitPhoto,
  listUnitPhotos,
  removeUnitPhoto,
  setPrimaryUnitPhoto,
  uploadImage,
  type SpacePhoto,
} from "@/provider";
import { theme } from "@/theme";
import { EvidenceTile } from "./VerificationPanel";
import { getVerification, type EvidenceSlot } from "@/verification";

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
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    await Promise.all([
      getVerification("unit", unitId),
      listUnitPhotos(unitId),
    ]).then(([progress, stored]) => {
      if (signal?.aborted) return;
      // An approved check returns no slots — there is nothing left to ask for —
      // so the photographs themselves become the list.
      setSlots(progress.slots);
      setPhotos(stored.photos);
      setError("");
    }).catch((cause) => {
      if (signal?.aborted) return;
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load the photos.",
      );
    });
  }, [unitId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function add(slotKey: string) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to add a picture of this Unit.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (picked.canceled || !picked.assets[0]) return;

    setBusySlot(slotKey);
    setError("");
    try {
      const stored = await uploadImage(picked.assets[0], "property_photo");
      if (!stored.is_usable) {
        setError(stored.rejection_reason || stored.status_message || "That photo was refused.");
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
    .map((photo) => ({ slot: null as EvidenceSlot | null, photo }));
  const rows = slots.length ? [...slottedRows, ...retainedRows] : retainedRows;

  return (
    <View style={{ gap: space[3] }}>
      <WalkthroughUpload subject="unit" id={unitId} editable={editable} onBusy={onMediaBusy} />
      {error ? <Notice tone="error" title={error} /> : null}
      {editable ? <Type variant="caption">The main view and each selected amenity need a photo. The two context views are optional.</Type> : null}

      {rows.map(({ slot, photo }, index) => (
        <View key={slot?.key ?? photo?.id ?? index} style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3], paddingVertical: space[3], borderTopWidth: index === 0 ? 0 : 1, borderTopColor: theme.color.field["200"] }}>
          <EvidenceTile
            slot={{ label: slot?.label || photo?.caption || `Photo ${index + 1}`, provided: Boolean(photo), preview_url: photo?.download_url ?? null }}
            locked={!editable || Boolean(photo)}
            busy={busySlot === slot?.key}
            disabled={Boolean(busySlot)}
            onPress={() => void add(slot?.key ?? "")}
          />

          <View style={{ flex: 1, minWidth: 0, gap: space[2] }}>
            <View style={{ gap: space[1] }}>
              <Type variant="bodyStrong">
                {photo?.is_primary ? "First image · " : ""}
                {slot?.label || photo?.caption || `Photo ${index + 1}`}
                {slot && !slot.required ? " (optional)" : ""}
              </Type>
              {slot ? <Type variant="caption">{slot.why}</Type> : null}
            </View>

            {/* A slot's controls belong to the slot, so they are quiet words
                beside it — an action bar per photograph would be a page of
                things all asking to be pressed. The shared photo tile adds an image;
                the remaining actions stay beside its label. */}
            {!editable ? null : photo ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[4] }}>
                {photo.is_primary ? null : (
                  <QuietAct
                    label="Make it first"
                    icon="star-outline"
                    accessibilityLabel="Make it the first image"
                    onPress={() => void act(() => setPrimaryUnitPhoto(unitId, photo.id))}
                  />
                )}
                <QuietAct
                  label="Remove"
                  icon="trash-outline"
                  accessibilityLabel="Remove this photo"
                  onPress={() => void act(() => removeUnitPhoto(unitId, photo.id))}
                />
              </View>
            ) : null}
          </View>
        </View>
      ))}

      {!editable && photos.length === 0 ? (
        <Type variant="caption">No photos on this Unit.</Type>
      ) : null}
    </View>
  );
}
