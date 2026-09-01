/**
 * What a space has, as a checklist the backend decides the shape of.
 *
 * The options arrive filtered by scope and by this space's type, so a hostel
 * bed is never offered a porch and a shop is never offered a wardrobe. Building
 * that filter here would be a second copy of a rule the backend enforces,
 * drifting from it at its own pace.
 *
 * Saved as a whole set rather than one tick at a time: the screen *is* the set,
 * and on a phone with patchy signal an add-and-remove pair can half-land.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Chip, Notice, Type, space } from "@/components/ui";
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
}: {
  scope: "unit" | "property";
  /** The unit id, or the property id when `scope` is "property". */
  id: string;
  saveLabel?: string;
  onSaved?: () => void | Promise<void>;
  saveForLaterLabel?: string;
  onSavedForLater?: () => void | Promise<void>;
}) {
  const [options, setOptions] = useState<AmenityOption[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data =
        scope === "unit" ? await getUnitAmenities(id) : await getPropertyAmenities(id);
      setOptions(data.options);
      setChosen(new Set(data.chosen.map((row) => row.id)));
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

  // Grouped so a long list reads as a few short ones. The categories come from
  // the backend, so a new one appears here without a change.
  const groups = useMemo(() => {
    const byCategory = new Map<string, AmenityOption[]>();
    for (const option of options) {
      const key = option.category || "other";
      byCategory.set(key, [...(byCategory.get(key) ?? []), option]);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  function toggle(amenityId: string) {
    setSaved(false);
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(amenityId)) next.delete(amenityId);
      else next.add(amenityId);
      return next;
    });
  }

  async function save(after?: () => void | Promise<void>) {
    setBusy(true);
    setError("");
    try {
      const ids = [...chosen];
      if (scope === "unit") await setUnitAmenities(id, ids);
      else await setPropertyAmenities(id, ids);
      setSaved(true);
      await after?.();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!options.length) {
    return (
      <Type variant="caption">
        {error || "Loading what this kind of space can have…"}
      </Type>
    );
  }

  return (
    <View style={{ gap: space[4] }}>
      {groups.map(([category, rows]) => (
        <View key={category} style={{ gap: space[2] }}>
          <Type variant="label">{category.toUpperCase()}</Type>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {/* The tick used to be a character prefixed to the label, so every
                chip after the one you pressed shifted by its width and the rows
                re-wrapped under your thumb. */}
            {rows.map((option) => (
              <Chip
                key={option.id}
                label={option.name}
                selected={chosen.has(option.id)}
                onPress={() => toggle(option.id)}
              />
            ))}
          </View>
        </View>
      ))}

      {error ? <Notice tone="error" title={error} /> : null}
      {scope === "unit" && chosen.size ? (
        <Notice
          tone="info"
          title={`${chosen.size} amenity photo${chosen.size === 1 ? "" : "s"} will be required`}
          body="The next step asks for one clear photo of every selected feature."
        />
      ) : null}
      {saved ? <Type variant="caption" style={{ color: theme.color.kola["600"] }}>Saved</Type> : null}

      <Button label={saveLabel} variant="secondary" busy={busy} onPress={() => void save(onSaved)} />
      {saveForLaterLabel && onSavedForLater ? (
        <Button label={saveForLaterLabel} variant="quiet" busy={busy} onPress={() => void save(onSavedForLater)} />
      ) : null}
    </View>
  );
}
