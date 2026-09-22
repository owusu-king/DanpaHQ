import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, View } from "react-native";

import { ApiFailure } from "@/api";
import { ActionBar, Pill } from "@/components/record/RecordSurfaces";
import { Notice, Type, radius, space } from "@/components/ui";
import { uploadImage } from "@/provider";
import { theme } from "@/theme";
import {
  attachEvidence,
  removeEvidence,
  getVerification,
  submitForReview,
  type Subject,
  type VerificationProgress,
} from "@/verification";

/**
 * The checklist for getting a property or a space checked.
 *
 * Deliberately a checklist rather than a form, and doubly so on a phone: this is
 * the device somebody actually has in their hand while walking round a building,
 * so it has to survive being closed between photographs and come back saying
 * exactly what is still outstanding.
 *
 * Completeness is never worked out here. `can_submit` comes back from the
 * server, so the button cannot offer a submission the backend would refuse.
 */
export function VerificationPanel({
  subject,
  id,
  title,
  showSubmit = true,
  onState,
  submitRef,
}: {
  subject: Subject;
  id: string;
  title: string;
  /** False when something above owns the submit button — see the property
   *  screen, where the photographs and the ownership document go together. */
  showSubmit?: boolean;
  onState?: (state: VerificationProgress | null) => void;
  /** Filled with this panel's submit, so a shared button can call it. */
  submitRef?: { current: (() => Promise<void>) | null };
}) {
  const [state, setState] = useState<VerificationProgress | null>(null);
  const [error, setError] = useState("");
  const [busySlot, setBusySlot] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Held in a ref rather than depended on: a caller passing an inline arrow
  // would otherwise change `load` every render and the effect would refetch
  // forever. Written in an effect, never during render.
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

  async function removePhoto(slotKey: string) {
    setBusySlot(slotKey);
    setError("");
    try {
      const next = await removeEvidence(subject, id, slotKey);
      setState(next);
      report.current?.(next);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not remove that photo.",
      );
    } finally {
      setBusySlot("");
    }
  }

  async function addPhoto(slotKey: string) {
    // Asked at the moment of use, and a refusal is a sentence about what to do
    // next rather than an error state.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to add photographs.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;

    setBusySlot(slotKey);
    setError("");
    try {
      const stored = await uploadImage(result.assets[0], "property_photo");
      if (!stored.is_usable) {
        setError(stored.status_message || "That photo could not be accepted.");
        return;
      }
      const next = await attachEvidence(subject, id, {
        slot_key: slotKey,
        file_id: stored.id,
      });
      setState(next);
      report.current?.(next);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not add that photo.",
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
    } catch (cause) {
      // The refusal names the outstanding slots, so it is shown as it arrives.
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not submit this yet.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (submitRef) submitRef.current = submit;
  });

  if (!state) {
    return <Type variant="caption">{error || "Loading what this needs…"}</Type>;
  }

  if (state.status === "approved") {
    return <Notice tone="success" title={`${title} has been checked`} />;
  }

  return (
    <View style={{ gap: space[3] }}>
      {state.submitted ? (
        <Notice
          tone="info"
          title="With our team"
          body="We will let you know the outcome. There is nothing more to do here."
        />
      ) : (
        <Type variant="caption">
          {state.required_outstanding === 0
            ? showSubmit
              ? "Everything needed is here. Send it for review."
              : "Everything needed is here."
            : `${state.required_outstanding} of ${state.required_total} still needed.`}
        </Type>
      )}

      {state.decision_note ? (
        <Notice tone="warning" title="We asked for more" body={state.decision_note} />
      ) : null}
      {error ? <Notice tone="error" title={error} /> : null}

      <View style={{ marginTop: space[1] }}>
        {state.slots.map((slot, index) => (
          <View
            key={slot.key}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: space[3],
              paddingVertical: space[3],
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: theme.color.field["200"],
            }}
          >
            <EvidenceTile
              slot={slot}
              locked={state.submitted}
              busy={busySlot === slot.key}
              disabled={Boolean(busySlot)}
              onPress={() => addPhoto(slot.key)}
            />
            <View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
              <Type variant="bodyStrong">
                {slot.label}
                {slot.required ? "" : " (optional)"}
              </Type>
              <Type variant="caption">{slot.why}</Type>
              {slot.provided && state.submitted ? (
                <Type variant="caption" style={{ color: theme.color.kola["600"] }}>
                  Sent
                </Type>
              ) : slot.provided ? (
                /* Quiet and on its own line: the only control here that
                   destroys something should not sit beside the one that does
                   the ordinary thing. */
                <Pressable
                  onPress={() => void removePhoto(slot.key)}
                  disabled={Boolean(busySlot)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove the photo of ${slot.label}`}
                  hitSlop={12}
                  style={{ alignSelf: "flex-start", paddingVertical: space[1] }}
                >
                  <Type variant="caption" style={{ color: theme.color.laterite["600"] }}>
                    Remove
                  </Type>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {state.submitted || !showSubmit ? null : (
        <ActionBar>
          <Pill
            label="Send for review"
            icon="shield-checkmark-outline"
            busy={submitting}
            busyLabel="Sending"
            disabled={!state.can_submit}
            grow
            onPress={submit}
          />
        </ActionBar>
      )}
    </View>
  );
}

/**
 * One slot's photograph, and the way to put one there.
 *
 * Every slot used to be its own card holding a 140px-tall image and two
 * buttons, so a property with six photographs to take ran past 1,700px — a card
 * inside the card the screen already is, six times over. What it cost in height
 * it did not buy in clarity: nothing could be compared at a glance, because no
 * two previews began at the same place.
 *
 * The photograph is the control now. Tapping it replaces what is there, which
 * is how changing a picture works everywhere else, and an empty slot is the
 * same square waiting — one 64px anchor per row, in a column you can run your
 * eye down to see what is still missing. It is above the 48px minimum for
 * something you tap, so the affordance costs nothing in reach.
 *
 * It stops being a control once a reviewer holds the submission: what they were
 * sent must not change under them, and the API refuses either way.
 */
function EvidenceTile({
  slot,
  locked,
  busy,
  disabled,
  onPress,
}: {
  slot: VerificationProgress["slots"][number];
  locked: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const box = {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    backgroundColor: slot.provided ? theme.color.field["100"] : "transparent",
    borderWidth: 1,
    borderStyle: (slot.provided ? "solid" : "dashed") as "solid" | "dashed",
    borderColor: slot.provided ? theme.color.field["200"] : theme.color.field["300"],
  };

  const face =
    slot.provided && slot.preview_url ? (
      <Image
        source={{ uri: slot.preview_url }}
        accessibilityIgnoresInvertColors
        style={{ width: "100%", height: "100%" }}
      />
    ) : (
      <Type variant="body" style={{ color: theme.color.ink["500"] }}>
        {busy ? "…" : slot.provided ? "✓" : "+"}
      </Type>
    );

  if (locked) {
    return <View style={box}>{face}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      // A square with a plus in it says nothing to a screen reader, and for a
      // slot that already has a photograph this is the whole affordance.
      accessibilityLabel={
        slot.provided ? `Replace the photo of ${slot.label}` : `Add a photo of ${slot.label}`
      }
      style={({ pressed }) => [box, pressed && { opacity: 0.7 }]}
    >
      {face}
    </Pressable>
  );
}
