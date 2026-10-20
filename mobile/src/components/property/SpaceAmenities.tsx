/**
 * What a space has, as one compact grid of drawn tiles.
 *
 * The options arrive filtered by scope and by this space's type, so a hostel
 * bed is never offered a porch and a shop is never offered a wardrobe. Building
 * that filter here would be a second copy of a rule the backend enforces,
 * drifting from it at its own pace.
 *
 * One grid, ordered by category, rather than a heading over each category
 * (owner, 2026-10-20: the checkboxes were "thrown around"). Each tile carries
 * its own glyph, and a chosen one turns kola — the twin of the web grid.
 *
 * Saved as a whole set rather than one tick at a time: the screen *is* the set,
 * and on a phone with patchy signal an add-and-remove pair can half-land.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { ActionBar, EDGE, INK, KOLA, MUTED, PAPER, Pill, QuietAct } from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import { amenityGlyph } from "@/creationGlyphs";
import {
  getPropertyAmenities,
  getUnitAmenities,
  setPropertyAmenities,
  setUnitAmenities,
  type AmenityOption,
} from "@/provider";
import { theme } from "@/theme";

export function SpaceAmenities({
  scope,
  id,
  saveLabel = "Save what it has",
  onSaved,
  saveForLaterLabel,
  onSavedForLater,
  submitRef,
}: {
  scope: "unit" | "property";
  /** The unit id, or the property id when `scope` is "property". */
  id: string;
  saveLabel?: string;
  onSaved?: () => void | Promise<void>;
  saveForLaterLabel?: string;
  onSavedForLater?: () => void | Promise<void>;
  /** Filled with this grid's save, so a wizard's one footer button can run it.
   *  Resolves true once the set is stored. Hides this grid's own buttons. */
  submitRef?: { current: (() => Promise<boolean>) | null };
}) {
  const [options, setOptions] = useState<AmenityOption[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data =
        scope === "unit" ? await getUnitAmenities(id) : await getPropertyAmenities(id);
      setOptions(data.options);
      setChosen(new Set(data.chosen.map((row) => row.id)));
      setLoaded(true);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load the amenities.",
      );
    }
  }, [scope, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ordered by category so related things sit together, without a heading
  // over each pair. The categories come from the backend.
  const ordered = useMemo(
    () =>
      [...options].sort(
        (a, b) =>
          (a.category || "other").localeCompare(b.category || "other") || a.name.localeCompare(b.name),
      ),
    [options],
  );

  function toggle(amenityId: string) {
    setSaved(false);
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(amenityId)) next.delete(amenityId);
      else next.add(amenityId);
      return next;
    });
  }

  async function save(after?: () => void | Promise<void>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const ids = [...chosen];
      if (scope === "unit") await setUnitAmenities(id, ids);
      else await setPropertyAmenities(id, ids);
      setSaved(true);
      await after?.();
      return true;
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Written in an effect, never during render, so the ref holds the latest save.
  useEffect(() => {
    if (submitRef) submitRef.current = () => save(onSaved);
  });

  if (!loaded) {
    return (
      <Type variant="caption">
        {error || "Loading what this kind of space can have…"}
      </Type>
    );
  }

  return (
    <View style={{ gap: space[3] }}>
      {options.length ? (
        <View style={styles.grid} accessibilityLabel={scope === "unit" ? "This Unit's amenities" : "Shared amenities"}>
          {ordered.map((option) => {
            const on = chosen.has(option.id);
            return (
              <Pressable
                key={option.id}
                accessibilityRole="checkbox"
                aria-checked={on}
                accessibilityLabel={option.name}
                onPress={() => toggle(option.id)}
                style={({ pressed }) => [styles.tile, on ? styles.tileOn : null, pressed ? { opacity: 0.85 } : null]}
              >
                <View style={[styles.mark, on ? styles.markOn : null]}>
                  <Ionicons name={amenityGlyph(option.name, option.category)} size={18} color={on ? PAPER : theme.color.ink["700"]} />
                </View>
                <Type variant="captionStrong" numberOfLines={2} style={styles.name}>{option.name}</Type>
                {on ? (
                  <View style={styles.tick}>
                    <Ionicons name="checkmark" size={11} color={PAPER} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Type variant="caption">Nothing to choose for this kind of space.</Type>
      )}

      <Type variant="caption" style={styles.count}>
        {chosen.size
          ? `${chosen.size} chosen${scope === "unit" ? " · a photo of each comes next" : ""}`
          : "None chosen. That is an answer too."}
      </Type>

      {error ? <Notice tone="error" title={error} /> : null}
      {saved && !submitRef ? <Type variant="caption" style={{ color: KOLA }}>Saved</Type> : null}

      {submitRef ? null : (
        <ActionBar>
          <Pill label={saveLabel} icon="checkmark" busy={busy} busyLabel="Saving" grow onPress={() => void save(onSaved)} />
          {saveForLaterLabel && onSavedForLater ? (
            <QuietAct label={saveForLaterLabel} disabled={busy} onPress={() => void save(onSavedForLater)} />
          ) : null}
        </ActionBar>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  tile: {
    // Three to a row, and a lone last tile keeps its size rather than
    // stretching across the row.
    width: "31.5%",
    minHeight: 92,
    justifyContent: "space-between",
    gap: space[2],
    padding: space[3],
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: PAPER,
  },
  tileOn: { borderWidth: 1.5, borderColor: KOLA, backgroundColor: theme.color.kola["50"] },
  mark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["100"],
  },
  markOn: { backgroundColor: KOLA },
  name: { color: INK, fontSize: 13, lineHeight: 17 },
  tick: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: KOLA,
  },
  count: { color: MUTED },
});
