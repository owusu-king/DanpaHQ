"use client";

/**
 * What a space has, as a checklist the backend decides the shape of.
 *
 * The options come from the API filtered by scope and by this space's type, so
 * a hostel bed is never offered a porch and a shop is never offered a wardrobe.
 * Building that filter here would mean a second copy of a rule the backend
 * already enforces, drifting from it at its own pace.
 *
 * Saved as a whole set rather than one tick at a time: the screen *is* the set,
 * and an add-and-remove pair can half-land when a phone drops signal between
 * them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { CheckChip } from "@/components/Check";
import { Notice } from "@/components/Notice";
import { StepActions } from "@/components/creation/StepActions";
import { ApiFailure } from "@/lib/api";
import {
  getPropertyAmenities,
  getUnitAmenities,
  setPropertyAmenities,
  setUnitAmenities,
  type AmenityOption,
} from "@/lib/console";

type Scope = "unit" | "property";

export function SpaceAmenities({
  scope,
  id,
  onSaved,
  saveLabel = "Save what it has",
  saveForLaterLabel,
  onSavedForLater,
  autoSave = false,
  onBack,
}: {
  scope: Scope;
  /** The unit id, or the property id when `scope` is "property". */
  id: string;
  onSaved?: (names: string[]) => void | Promise<void>;
  saveLabel?: string;
  saveForLaterLabel?: string;
  onSavedForLater?: (names: string[]) => void | Promise<void>;
  /** Used by the guided create flow, where the step's own button advances. */
  autoSave?: boolean;
  /** In a creation step: the save is the step's one button; back and later are links. */
  onBack?: () => void;
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

  const save = useCallback(async (after?: (names: string[]) => void | Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      const ids = [...chosen];
      if (scope === "unit") await setUnitAmenities(id, ids);
      else await setPropertyAmenities(id, ids);
      setSaved(true);
      const names = options.filter((option) => chosen.has(option.id)).map((option) => option.name);
      await after?.(names);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }, [chosen, id, options, scope]);

  if (!options.length) {
    return (
      <p className="type-caption" style={{ margin: 0 }}>
        {error || "Loading what this kind of space can have…"}
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      {groups.map(([category, rows]) => (
        <fieldset key={category} style={{ border: "none", margin: 0, padding: 0 }}>
          <legend
            className="type-label"
            style={{ color: "var(--color-ink-500)", textTransform: "uppercase", padding: 0 }}
          >
            {category}
          </legend>
          <div
            style={{
              marginTop: "var(--space-3)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(13rem, 1fr))",
              gap: "var(--space-2)",
            }}
          >
            {rows.map((option) => (
              <CheckChip
                key={option.id}
                label={option.name}
                checked={chosen.has(option.id)}
                onChange={() => toggle(option.id)}
              />
            ))}
          </div>
        </fieldset>
      ))}

      {error ? <Notice tone="error" title={error} /> : null}

      {scope === "unit" && chosen.size ? (
        <Notice
          tone="info"
          title={`${chosen.size} amenity photo${chosen.size === 1 ? "" : "s"} needed next`}
        />
      ) : null}

      {autoSave ? null : onBack ? (
        <StepActions
          primary={
            <Button onClick={() => void save(onSaved)} busy={busy} busyLabel="Saving…">
              {saveLabel}
            </Button>
          }
          links={[
            { label: "Back", onClick: onBack },
            Boolean(onSavedForLater) && {
              label: saveForLaterLabel ?? "Save for later",
              onClick: () => void save(onSavedForLater),
              disabled: busy,
            },
          ]}
        />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <Button onClick={() => void save(onSaved)} busy={busy} busyLabel="Saving…" variant="secondary">
            {saveLabel}
          </Button>
          {saveForLaterLabel && onSavedForLater ? (
            <Button onClick={() => void save(onSavedForLater)} busy={busy} variant="quiet">
              {saveForLaterLabel}
            </Button>
          ) : null}
          {saved ? (
            <span className="type-caption" style={{ color: "var(--color-kola-600)" }}>
              Saved
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The same list, saved by whoever owns the step's own button. */
export function useAmenitySaver(scope: Scope, id: string) {
  return useCallback(
    (ids: string[]) =>
      scope === "unit" ? setUnitAmenities(id, ids) : setPropertyAmenities(id, ids),
    [scope, id],
  );
}
