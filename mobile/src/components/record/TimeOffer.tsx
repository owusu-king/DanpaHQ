import { useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  EDGE,
  Footnote,
  GroupLabel,
  INK,
  MUTED,
  Pill,
  QuietAct,
  RecordPanel,
} from "@/components/record/RecordSurfaces";
import { Field, Notice, Type, space } from "@/components/ui";

/**
 * Proposing viewing times — up to the five the backend accepts.
 *
 * `offer_slots` takes a list (`MAX_SLOTS = 5`, "Offer at least one time"), and
 * the other side's record renders that list as a choice. Both clients used to
 * send a single time, which quietly made the tenant's "Pick a time" a list of
 * one and turned a negotiation into a yes/no.
 *
 * Re-offering **replaces** the times proposed before — deliberately, so nobody
 * chooses from a list where half the entries are stale — so this says as much
 * where the decision is made rather than leaving it to be discovered.
 */

/** What the backend accepts in one offer. */
export const MAX_SLOTS = 5;

export function TimeOffer({
  title,
  verb,
  replacing,
  busy,
  backLabel,
  onBack,
  onSubmit,
}: {
  title: string;
  /** A landlord offers times; a tenant suggests them. */
  verb: "Offer" | "Suggest";
  /**
   * The times already proposed, which this offer will replace.
   *
   * Named rather than counted: "replaces the 2 times proposed before" asks
   * somebody to remember what those were, and the whole complaint about this
   * screen was that the times already on the table were nowhere to be seen.
   */
  replacing: string[];
  busy: boolean;
  backLabel: string;
  onBack: () => void;
  onSubmit: (slots: { starts_at: string; duration_minutes: number }[]) => void;
}) {
  const [day, setDay] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [time, setTime] = useState("10:00");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState("");

  function add() {
    const at = new Date(`${day}T${time}:00`);
    if (Number.isNaN(at.getTime()) || at <= new Date()) {
      setError("Choose a date and time that is still ahead.");
      return;
    }
    const iso = at.toISOString();
    if (chosen.includes(iso)) {
      setError("That time is already on the list.");
      return;
    }
    setError("");
    setChosen((current) => [...current, iso].sort());
    // Move to the next day, so offering three times is three taps rather than
    // three edits. Somebody proposing several rarely means the same day twice.
    setDay(new Date(at.getTime() + 86_400_000).toISOString().slice(0, 10));
  }

  const full = chosen.length >= MAX_SLOTS;

  return (
    <View style={styles.section}>
      <GroupLabel>{title}</GroupLabel>
      <RecordPanel style={styles.panel}>
        {chosen.length ? (
          <View style={styles.chosen}>
            {chosen.map((iso, index) => (
              <View key={iso} style={[styles.chosenRow, index ? styles.ruled : null]}>
                <Type variant="bodyStrong" numberOfLines={1} style={styles.chosenText}>{whenLabel(iso)}</Type>
                <QuietAct
                  icon="close-outline"
                  label="Remove"
                  accessibilityLabel={`Remove ${whenLabel(iso)}`}
                  disabled={busy}
                  onPress={() => setChosen((current) => current.filter((row) => row !== iso))}
                />
              </View>
            ))}
          </View>
        ) : null}

        {full ? (
          <Type variant="caption" style={styles.note}>
            That is the most times one offer can carry.
          </Type>
        ) : (
          <View style={styles.pair}>
            <View style={styles.pairField}>
              <Field label="Date" hint="YYYY-MM-DD" value={day} onChangeText={setDay} />
            </View>
            <View style={styles.pairField}>
              <Field label="Time" hint="24-hour" value={time} onChangeText={setTime} />
            </View>
          </View>
        )}

        {error ? <Notice tone="error" title={error} /> : null}

        {full ? null : (
          <QuietAct
            icon="add-outline"
            label={chosen.length ? "Add another time" : "Add this time"}
            disabled={busy}
            onPress={add}
          />
        )}

        <Pill
          grow
          label={chosen.length > 1 ? `${verb} ${chosen.length} times` : `${verb} this time`}
          busy={busy}
          busyLabel="Sending…"
          disabled={chosen.length === 0}
          onPress={() =>
            onSubmit(chosen.map((starts_at) => ({ starts_at, duration_minutes: 30 })))
          }
        />
        <QuietAct label={backLabel} disabled={busy} onPress={onBack} />

        {replacing.length ? (
          <View style={styles.replacing}>
            <Type variant="caption" style={styles.note}>
              {`This replaces ${replacing.length === 1 ? "the time" : `the ${replacing.length} times`} already proposed, so nobody picks from a stale list:`}
            </Type>
            {replacing.map((iso) => (
              <Type key={iso} variant="caption" style={styles.replaced}>{`· ${whenLabel(iso)}`}</Type>
            ))}
          </View>
        ) : (
          <Footnote>Offer up to five times and the other side confirms one — that becomes the appointment.</Footnote>
        )}
      </RecordPanel>
    </View>
  );
}

/** The day and the time, as somebody with a week to plan reads them. */
function whenLabel(iso: string) {
  const at = new Date(iso);
  return `${at.toLocaleDateString("en-GH", { weekday: "short", day: "numeric", month: "short" })} · ${at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })}`;
}

const styles = StyleSheet.create({
  section: {
    gap: space[2],
  },
  panel: {
    gap: space[3],
    padding: space[4],
  },
  chosen: {
    marginHorizontal: -space[4],
    marginTop: -space[4],
  },
  chosenRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingVertical: space[2],
    paddingHorizontal: 14,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  chosenText: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
  },
  pair: {
    flexDirection: "row",
    gap: space[3],
  },
  pairField: {
    flex: 1,
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  replacing: {
    gap: 2,
  },
  replaced: {
    fontSize: 13,
    lineHeight: 19,
    color: INK,
  },
});
