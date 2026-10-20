"use client";

/**
 * What a space has, as one compact grid of drawn tiles.
 *
 * The options come from the API filtered by scope and by this space's type, so
 * a hostel bed is never offered a porch and a shop is never offered a wardrobe.
 * Building that filter here would mean a second copy of a rule the backend
 * already enforces, drifting from it at its own pace.
 *
 * One grid, ordered by category, rather than a heading per category (owner,
 * 2026-10-20: the checkboxes were "thrown around"). Seven property amenities in
 * six categories made six headings over one or two boxes each; as tiles they
 * read at a glance, each with its own glyph, and a chosen one turns kola.
 *
 * Saved as a whole set rather than one tick at a time: the screen *is* the set,
 * and an add-and-remove pair can half-land when a phone drops signal between
 * them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { StepActions } from "@/components/creation/StepActions";
import { Icon } from "@/components/portal/icons";
import { ApiFailure } from "@/lib/api";
import { amenityGlyph } from "@/lib/creationGlyphs";
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
  submitRef,
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

  const save = useCallback(
    async (after?: (names: string[]) => void | Promise<void>): Promise<boolean> => {
      setBusy(true);
      setError("");
      try {
        const ids = [...chosen];
        if (scope === "unit") await setUnitAmenities(id, ids);
        else await setPropertyAmenities(id, ids);
        setSaved(true);
        const names = options.filter((option) => chosen.has(option.id)).map((option) => option.name);
        await after?.(names);
        return true;
      } catch (cause) {
        setError(cause instanceof ApiFailure ? cause.error.message : "That did not save.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [chosen, id, options, scope],
  );

  // Written in an effect, never during render: the ref must hold the closure
  // from the latest render, and render is reserved for pure work.
  useEffect(() => {
    if (submitRef) submitRef.current = () => save(onSaved);
  });

  if (!loaded) {
    return (
      <p className="type-caption" style={{ margin: 0 }}>
        {error || "Loading what this kind of space can have…"}
      </p>
    );
  }

  return (
    <div className="cw-amenities-wrap">
      {options.length ? (
        <div
          className="cw-amenities"
          role="group"
          aria-label={scope === "unit" ? "This Unit's amenities" : "Shared amenities"}
        >
          {ordered.map((option) => (
            <button
              key={option.id}
              type="button"
              className="cw-amenity"
              aria-pressed={chosen.has(option.id)}
              onClick={() => toggle(option.id)}
            >
              <span className="cw-amenity-mark" aria-hidden="true">
                <Icon name={amenityGlyph(option.name, option.category)} />
              </span>
              <span className="cw-amenity-name">{option.name}</span>
              <span className="cw-amenity-tick" aria-hidden="true">
                <Icon name="check" />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="type-caption" style={{ margin: 0 }}>
          Nothing to choose for this kind of space.
        </p>
      )}

      <p className="cw-amenities-count" aria-live="polite">
        {chosen.size
          ? `${chosen.size} chosen${scope === "unit" ? " · a photo of each comes next" : ""}`
          : "None chosen. That is an answer too."}
      </p>

      {error ? <Notice tone="error" title={error} /> : null}

      {submitRef || autoSave ? null : onBack ? (
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
