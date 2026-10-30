"use client";
import { useEffect, useId, useRef, useState } from "react";
import { apiBaseUrl } from "@/lib/api";
import { Field } from "@/components/Field";
import { Icon } from "@/components/portal/icons";
import { searchLocations, type LocationReference } from "@/lib/locations";

export function LocationAutocomplete({ value, onChange, onSelect, onSubmit, onClear, onShowArea, selected, compact = false, minimal = false, label = "Town or neighbourhood", error }: {
  value: string; onChange: (value: string) => void; onSelect: (row: LocationReference) => void;
  onSubmit?: (value: string) => void; onClear?: () => void; onShowArea?: (row: LocationReference) => void;
  selected?: LocationReference | null; compact?: boolean; minimal?: boolean; label?: string; error?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<LocationReference[]>([]);
  const [answeredQuery, setAnsweredQuery] = useState("");
  const visibleRows = answeredQuery === value ? rows : [];
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (!open || !compact) return;
    const fit = () => {
      if (!root.current) return;
      const rect = root.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const below = top + (viewport?.height ?? window.innerHeight) - rect.bottom - 16;
      const above = rect.top - top - 16;
      const flip = below < 240 && above > below;
      root.current.dataset.locationSide = flip ? "above" : "below";
      root.current.style.setProperty("--location-dropdown-space", `${Math.max(80, flip ? above : below)}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, [open, compact]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id, open]);
  useEffect(() => {
    if (!open || value.trim().length < 2) { setRows([]); setBusy(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true); setFailed(false);
      searchLocations(value, controller.signal).then((answer) => {
        if (!controller.signal.aborted) { setRows(answer.results); setAnsweredQuery(value); setActive(-1); }
      }).catch(() => { if (!controller.signal.aborted) { setRows([]); setFailed(true); } })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value, open]);
  const choose = (row: LocationReference) => { setOpen(false); onSelect(row); };
  const props = {
    value, role: "combobox", "aria-autocomplete": "list" as const, "aria-expanded": open,
    "aria-controls": `${id}-options`, "aria-activedescendant": open && visibleRows[active] ? `${id}-${active}` : undefined,
    autoComplete: "off", placeholder: "Search Ghana's towns and communities…",
    onFocus: () => setOpen(true), onChange: (event: React.ChangeEvent<HTMLInputElement>) => { onChange(event.target.value); setActive(-1); setOpen(true); },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") { setOpen(false); event.stopPropagation(); }
      if (event.key === "ArrowDown" && visibleRows.length) { event.preventDefault(); setOpen(true); setActive((current) => (current + 1) % visibleRows.length); }
      if (event.key === "ArrowUp" && visibleRows.length) { event.preventDefault(); setActive((current) => current < 0 ? visibleRows.length - 1 : (current - 1 + visibleRows.length) % visibleRows.length); }
      if (event.key === "Enter") { event.preventDefault(); if (open && active >= 0 && visibleRows[active]) choose(visibleRows[active]); else { setOpen(false); if (!selected || compact) onSubmit?.(value.trim()); } }
    },
  };
  return <div ref={root} className={compact ? "explore-search explore-place-search" : "cw-place"}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    {compact ? <><Icon name="explore" /><label><span className="sr-only">{label}</span><input {...props} type="search" enterKeyHint="search" /></label>
      {value ? <button type="button" className="explore-search-clear" aria-label="Clear search" onClick={() => { setOpen(false); onClear?.(); }}><Icon name="close" /></button> : null}</> : <Field {...props} label={minimal && value && !selected ? <>{label} <small className="cw-location-unverified">Unverified</small></> : label} error={error} />}
    {open && value.trim().length >= 2 ? <div className={compact ? "explore-suggestions location-suggestions" : "cw-places location-suggestions"}>
      {busy ? <p className="cw-places-credit" role="status">Searching Ghana locations…</p> : null}
      <div id={`${id}-options`} role="listbox" className="location-suggestions-list" aria-label="Ghana locations">
        {visibleRows.map((row, index) => <button type="button" role="option" aria-selected={active === index} id={`${id}-${index}`} key={row.id} onClick={() => choose(row)}>
          <span><strong>{row.name}</strong><small>{row.district_name || "District unverified"} · {row.region_name || "Region unverified"}</small></span>
        </button>)}
      </div>
      <button type="button" onClick={() => { setOpen(false); onSubmit?.(value.trim()); }}><span>{compact ? `Search listings for “${value}”` : `Use “${value}” — unverified location`}</span></button>
      {failed ? <p className="cw-places-credit" role="status">Location search is unavailable. You can still enter the name.</p> : null}
      <p className="cw-places-credit">Data: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames (CC BY)</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OSM (ODbL)</a> · <a href="https://data.humdata.org/dataset/cod-ab-gha" target="_blank" rel="noreferrer">GSS/HDX</a>. District matches use 2021 boundaries, not current verification. <a href={`${apiBaseUrl()}/geo/dataset/`}>Download location data</a>.</p>
    </div> : null}
    {!compact && minimal ? (selected && onShowArea && selected.latitude != null && selected.longitude != null ? <button type="button" className="explore-text-button cw-location-show" onClick={() => onShowArea(selected)}>Show on map</button> : null) : !compact ? <p className="type-caption">{selected ? `${selected.label}${selected.parent_status === "boundary_2021" ? " · District inferred from 2021 boundaries" : ""}` : value ? "Unverified location: entered by you, not in the reference database." : "Choose a reference location, or enter an unverified name."}
      {selected && onShowArea && selected.latitude != null && selected.longitude != null ? <> <button type="button" className="explore-text-button" onClick={() => onShowArea(selected)}>Show area on map</button></> : null}
    </p> : null}
  </div>;
}
