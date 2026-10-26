import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { FAINT, INK, KOLA, MUTED, RULE } from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { SheetCard, SheetGlassButton, SheetPrimaryButton } from "@/components/sheet/SheetParts";
import { Field, Notice, Type, space } from "@/components/ui";
import { requestPassportCorrection, type CorrectionRecordType, type PassportCorrection } from "@/passport";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

export type CorrectionTarget =
  | { kind: "identity" }
  | { kind: "tenancy"; tenancyId: string; label: string; hasPayments: boolean };

/**
 * Report a problem with a record — web's `CorrectionSheet.tsx`, in the app's sheet.
 *
 * It does not edit anything. The record belongs to the agreement, the ledger
 * or the identity check it came from; a Danpa HQ reviewer compares it with
 * that source and answers in Support. Until then it is shown as disputed to
 * the tenant and to anyone they have shared it with.
 */
export function CorrectionSheet({
  target,
  onClose,
  onReported,
}: {
  target: CorrectionTarget | null;
  onClose: () => void;
  onReported: (correction: PassportCorrection) => void;
}) {
  const [shown, setShown] = useState<CorrectionTarget | null>(target);
  const [which, setWhich] = useState<CorrectionRecordType>("tenancy");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A new target starts clean; closing keeps what was shown for the exit.
  if (target && target !== shown) {
    setShown(target);
    setWhich(target.kind === "identity" ? "identity" : "tenancy");
    setReason("");
    setError("");
  }
  const current = target ?? shown;
  if (!current) return null;
  const ready = reason.trim().length >= 10;

  async function send() {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const correction = await requestPassportCorrection({
        record_type: current.kind === "identity" ? "identity" : which,
        record_id: current.kind === "identity" ? "" : current.tenancyId,
        reason: reason.trim(),
      });
      onReported(correction);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "It wasn’t sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      visible={Boolean(target)}
      onClose={onClose}
      title="Report a problem"
      closeLabel="Close report"
      footer={(
        <>
          <SheetGlassButton label="Cancel" onPress={onClose} />
          <SheetPrimaryButton label="Send for review" busy={busy} busyLabel="Sending…" disabled={!ready} onPress={() => void send()} />
        </>
      )}
    >
      <Type variant="caption" numberOfLines={2} style={styles.meta}>{current.kind === "identity" ? "Identity checks" : current.label}</Type>
      {current.kind === "tenancy" ? (
        <>
          <Type variant="label" style={styles.group}>WHAT’S WRONG?</Type>
          <SheetCard>
            <View accessibilityRole="radiogroup" accessibilityLabel="What’s wrong?">
              <RadioRow first selected={which === "tenancy"} onPress={() => setWhich("tenancy")} label="The tenancy details" note="Dates, the place, or the agreement" />
              <RadioRow
                selected={which === "payments"}
                onPress={() => setWhich("payments")}
                label="The rent payments"
                note={current.hasPayments ? "A payment missing, wrong or not yours" : "A payment that should be here"}
              />
            </View>
          </SheetCard>
        </>
      ) : null}
      <SheetCard>
        <View style={styles.fieldPad}>
          <Field
            label="Tell the reviewer what to check"
            multiline
            maxLength={1000}
            value={reason}
            placeholder="e.g. I moved in on 3 March, not 1 March. The agreement shows the right date."
            onChangeText={setReason}
            style={styles.textarea}
            textAlignVertical="top"
          />
        </View>
      </SheetCard>
      {error ? <Notice tone="error" title={error} /> : null}
      <Type variant="caption" style={styles.fineprint}>
        A Danpa HQ reviewer checks it against the original record and replies in Support. Until then,
        this record shows as disputed here and on any link you’ve shared. Your words stay between you and Danpa HQ.
      </Type>
    </BottomSheet>
  );
}

function RadioRow({ label, note, selected, onPress, first = false }: {
  label: string;
  note: string;
  selected: boolean;
  onPress: () => void;
  first?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={label}
      accessibilityHint={note}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => [styles.radio, first ? null : styles.ruled, pressed ? { opacity: 0.8 } : null]}
    >
      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? KOLA : theme.color.ink["300"]} />
      <View style={styles.radioText}>
        <Type variant="body" style={{ color: INK }}>{label}</Type>
        <Type variant="caption" style={{ color: MUTED }}>{note}</Type>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  meta: { color: MUTED, paddingHorizontal: 2 },
  group: { color: FAINT, letterSpacing: 0.8, marginTop: space[1], paddingHorizontal: 2 },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  radio: { flexDirection: "row", alignItems: "flex-start", gap: space[3], minHeight: 56, paddingVertical: space[3] },
  radioText: { flex: 1, minWidth: 0, gap: 2 },
  fieldPad: { paddingVertical: space[4] },
  textarea: { minHeight: 104, paddingTop: space[3], paddingBottom: space[3] },
  fineprint: { color: FAINT, paddingHorizontal: 2, paddingBottom: space[2] },
});
