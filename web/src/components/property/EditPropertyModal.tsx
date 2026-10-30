"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { updateProperty, type Property } from "@/lib/console";
import { loadPropertyVocabulary, type PropertyVocabulary } from "@/lib/propertyTypes";
import { SpaceAmenities } from "./SpaceAmenities";
import { LocationPicker, pinFromAddress } from "./LocationPicker";

/** Editing is a focused form; setup, evidence and verification stay in the wizard. */
export function EditPropertyModal({ open, property, amenitiesOnly = false, onClose, onSaved }: {
  open: boolean; property: Property; amenitiesOnly?: boolean; onClose: () => void; onSaved?: () => void;
}) {
  return <ModalSheet open={open} onClose={onClose} size="sm" icon="properties" title="Edit Property" className="compact-action-sheet property-edit-sheet">
    {(close) => <EditForm property={property} amenitiesOnly={amenitiesOnly} close={close} onSaved={onSaved} />}
  </ModalSheet>;
}

function EditForm({ property, amenitiesOnly, close, onSaved }: { property: Property; amenitiesOnly: boolean; close: () => void; onSaved?: () => void }) {
  const [title, setTitle] = useState(property.title);
  const [pin, setPin] = useState(() => pinFromAddress(property.address));
  const [notes, setNotes] = useState(property.notes);
  const [water, setWater] = useState(property.water_source);
  const [power, setPower] = useState(property.power_meter_type);
  const [compound, setCompound] = useState(property.compound_type);
  const [vocabulary, setVocabulary] = useState<PropertyVocabulary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amenitiesSave = useRef<(() => Promise<boolean>) | null>(null);
  const land = property.purpose === "sale" && property.property_type === "land";
  const editable = Boolean(property.permitted_actions.edit?.allowed);
  useEffect(() => {
    let active = true;
    loadPropertyVocabulary().then(value => { if (active) setVocabulary(value); }).catch(() => { if (active) setError("Could not load the choices. Close and try again."); });
    return () => { active = false; };
  }, []);
  if (!editable) return <Notice tone="info" title="Editing is unavailable" body={property.permitted_actions.edit?.message} />;
  return <form className="compact-form" onSubmit={async event => {
    event.preventDefault();
    if (busy || !title.trim() || !vocabulary || (!land && !amenitiesSave.current)) return;
    setBusy(true); setError("");
    let changed = false;
    let complete = false;
    try {
      if (!amenitiesOnly) { await updateProperty(property.id, { title: title.trim(), notes, location: { latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null }, ...(!land ? { water_source: water, power_meter_type: power, compound_type: compound } : {}) }); changed = true; }
      if (!land && !(await amenitiesSave.current?.())) { setError("The amenities could not be saved. Please try again."); return; }
      changed = true;
      complete = true;
    } catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not save your changes. Please try again."); }
    finally {
      if (changed) onSaved?.();
      setBusy(false);
      if (complete) close();
    }
  }}>
    <fieldset disabled={busy} className="compact-form-fields">
      {!amenitiesOnly ? <>
        <Field label="Property name" value={title} required onChange={event => setTitle(event.target.value)} />
        <p className="pd-note">The property type and address stay fixed.</p>
        <LocationPicker value={pin} onChange={setPin} />
        {!land && vocabulary ? <div className="compact-form-grid">
          <Select label="Water source" value={water} onChange={setWater} options={vocabulary.water_sources.map(row => [row.value, row.label] as const)} />
          <Select label="Power meter" value={power} onChange={setPower} options={vocabulary.power_meter_types.map(row => [row.value, row.label] as const)} />
          <Select label="Compound" value={compound} onChange={setCompound} options={vocabulary.compound_types.map(row => [row.value, row.label] as const)} />
        </div> : null}
        <label className="field"><span className="field-label type-caption">Notes</span><textarea className="select-control" rows={3} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      </> : null}
      {!land ? <section className="compact-form"><h3 className="pd-panel-title">Shared amenities</h3><SpaceAmenities scope="property" id={property.id} submitRef={amenitiesSave} /></section> : null}
    </fieldset>
    {error ? <Notice tone="error" title={error} /> : null}
    <div className="compact-form-actions"><Button type="button" variant="quiet" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" busy={busy} busyLabel="Saving…" disabled={!title.trim() || !vocabulary}>Save changes</Button></div>
  </form>;
}
