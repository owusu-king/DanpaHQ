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
import { Image, View } from "react-native";

import { ApiFailure } from "@/api";
import { Pill, QuietAct } from "@/components/record/RecordSurfaces";
import { Notice, Surface, Type, space } from "@/components/ui";
import {
  attachUnitPhoto,
  listUnitPhotos,
  removeUnitPhoto,
  setPrimaryUnitPhoto,
  uploadImage,
  type SpacePhoto,
} from "@/provider";
import { theme } from "@/theme";
import { getVerification, type EvidenceSlot } from "@/verification";

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
      {error ? <Notice tone="error" title={error} /> : null}

      {rows.map(({ slot, photo }, index) => (
        <Surface key={slot?.key ?? photo?.id ?? index} style={{ gap: space[3] }}>
          <View
            style={{
              height: 180,
              borderRadius: 8,
              overflow: "hidden",
              backgroundColor: theme.color.field["100"],
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {photo?.download_url ? (
              <Image
                source={{ uri: photo.download_url }}
                accessibilityLabel={slot?.label ?? photo.caption ?? "Photo of this Unit"}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
              />
            ) : (
              <Type variant="caption">{photo ? "Photo added" : "No photo yet"}</Type>
            )}
          </View>

          <View style={{ gap: space[1] }}>
            <Type variant="bodyStrong">
              {photo?.is_primary ? "First image · " : ""}
              {slot?.label ?? photo?.caption ?? "Photo"}
              {slot && !slot.required ? " (optional)" : ""}
            </Type>
            {slot ? <Type variant="caption">{slot.why}</Type> : null}
          </View>

          {/* A slot's controls belong to the slot, so they are quiet words
              beside it — an action bar per photograph would be a page of
              things all asking to be pressed. Adding is the one act, so it
              keeps a pill; the rest are words. */}
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
          ) : (
            <View style={{ flexDirection: "row" }}>
              <Pill
                label="Add photo"
                icon="camera-outline"
                tone="quiet"
                busy={busySlot === slot?.key}
                busyLabel="Adding"
                disabled={Boolean(busySlot)}
                onPress={() => void add(slot?.key ?? "")}
              />
            </View>
          )}
        </Surface>
      ))}

      {!editable && photos.length === 0 ? (
        <Type variant="caption">No photos on this Unit.</Type>
      ) : null}
    </View>
  );
}
