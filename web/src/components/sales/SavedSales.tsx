"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { listSavedSales, unsaveSale, type SavedSale } from "@/lib/sales";
import { SaleCard } from "./SaleCard";

export function SavedSales() {
  const [rows, setRows] = useState<SavedSale[] | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string[]>([]);
  const load = useCallback(async () => {
    try { setRows(await listSavedSales()); setError(""); }
    catch { setError("Could not load your saved sale properties."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove(id: string) {
    setRemoving(current => [...current, id]);
    try {
      await unsaveSale(id);
      setRows(current => current?.filter(row => row.sale.id !== id) ?? null);
      setError("");
    } catch { setError("Could not remove the property. Please try again."); }
    finally { setRemoving(current => current.filter(value => value !== id)); }
  }

  if (rows?.length === 0 && !error) return null;
  return <section className="ws-panel is-canvas saved-panel" aria-label="Saved properties for sale">
    <div className="ws-panel-head"><h2>For sale</h2></div>
    {error ? <Notice tone="error" title={error} /> : null}
    {error && rows === null ? <Button variant="secondary" onClick={() => void load()}>Try again</Button> : null}
    {rows === null && !error ? <p role="status">Loading saved sale properties…</p> : null}
    {rows?.length ? <div className="ws-canvas"><ul className="saved-grid">{rows.map(row => <SaleCard
      key={row.id} sale={row.sale}
      savedAction={<button type="button" className="listing-save" aria-label={`Remove ${row.sale.headline || "property"} from saved`} aria-pressed="true" disabled={removing.includes(row.sale.id)} onClick={() => void remove(row.sale.id)}><Icon name="bookmark" /></button>}
    />)}</ul></div> : null}
  </section>;
}
