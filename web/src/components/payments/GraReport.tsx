"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { generateRentTaxReport, type RentTaxReportInput } from "@/lib/rentTaxReport";

export function GraReport({ organizationId, organizationName, properties = [] }: { organizationId: string; organizationName: string; properties?: { id: string; title: string }[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState<RentTaxReportInput>(() => {
    const today = new Date();
    return { period_start: `${today.getFullYear()}-01-01`, period_end: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
      format: "pdf", taxpayer_type: "individual", taxpayer_name: organizationName, taxpayer_tin: "", tax_office: "" };
  });
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);

  function close() {
    generation.current++;
    setOpen(false);
    setBusy(false);
    setError("");
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    const attempt = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const report = await generateRentTaxReport(organizationId, input);
      if (attempt !== generation.current) return;
      let file: Blob;
      if (input.format === "pdf") {
        if (!report.pdf_base64) throw new Error("The PDF report was not returned. Please try again.");
        const bytes = Uint8Array.from(atob(report.pdf_base64), character => character.charCodeAt(0));
        file = new Blob([bytes], { type: "application/pdf" });
      } else {
        if (typeof report.csv !== "string") throw new Error("The CSV export was not returned. Please try again.");
        file = new Blob([report.csv], { type: "text/csv;charset=utf-8" });
      }
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = report.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      close();
    } catch (cause) {
      if (attempt === generation.current) setError(cause instanceof Error ? cause.message : "Could not generate the report.");
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }

  return <>
    <Button variant="secondary" onClick={() => setOpen(true)}>Generate financial report</Button>
    <ModalSheet open={open} onClose={close} title="Property financial report" icon="reports" size="sm" className="compact-action-sheet">
      <form className="compact-form" onSubmit={event => void generate(event)}>
        <p className="record-hint">A financial statement with income, expenses, outstanding charges and net rental income. Choose CSV for raw supporting records.</p>
        <label className="lw-field"><span className="lw-label">Report format</span><select aria-label="Report format" className="select-control" value={input.format} disabled={busy} onChange={event => setInput(current => ({ ...current, format: event.target.value as "pdf" | "csv" }))}><option value="pdf">PDF financial statement</option><option value="csv">CSV raw data</option></select></label>
        <label className="lw-field"><span className="lw-label">Property</span><select aria-label="Property" className="select-control" value={input.property_id ?? ""} disabled={busy} onChange={event => setInput(current => ({ ...current, property_id: event.target.value || undefined }))}><option value="">All authorised properties</option>{properties.map(property => <option key={property.id} value={property.id}>{property.title}</option>)}</select></label>
        <label className="lw-field"><span className="lw-label">Taxpayer type</span><select aria-label="Taxpayer type" className="select-control" value={input.taxpayer_type} disabled={busy} onChange={event => setInput(current => ({ ...current, taxpayer_type: event.target.value as RentTaxReportInput["taxpayer_type"] }))}>
          <option value="individual">Individual landlord</option><option value="business">Registered business</option>
        </select></label>
        <Field label="Taxpayer / registered name" value={input.taxpayer_name} required maxLength={200} disabled={busy} onChange={event => setInput(current => ({ ...current, taxpayer_name: event.target.value }))} />
        <div className="lw-grid">
          <Field label="Period start" type="date" value={input.period_start} required disabled={busy} onChange={event => setInput(current => ({ ...current, period_start: event.target.value }))} />
          <Field label="Period end" type="date" value={input.period_end} min={input.period_start} required disabled={busy} onChange={event => setInput(current => ({ ...current, period_end: event.target.value }))} />
        </div>
        <Field label="TIN / Ghana Card PIN" hint="Optional for a draft" value={input.taxpayer_tin} maxLength={40} disabled={busy} onChange={event => setInput(current => ({ ...current, taxpayer_tin: event.target.value }))} />
        <Field label="Tax office" hint="Optional for a draft" value={input.tax_office} maxLength={120} disabled={busy} onChange={event => setInput(current => ({ ...current, tax_office: event.target.value }))} />
        <p className="type-caption">Outstanding balances are current at generation for charges due within the period. Taxpayer details are used only for this download. Tax calculation and filing remain separate. <a href="https://gra.gov.gh/domestic-tax/returns/" target="_blank" rel="noreferrer">GRA return requirements</a></p>
        {error ? <Notice tone="error" title={error} /> : null}
        <div className="compact-form-actions"><Button type="button" variant="quiet" onClick={close}>Cancel</Button><Button type="submit" busy={busy} busyLabel="Generating…">{input.format === "pdf" ? "Download PDF report" : "Export CSV data"}</Button></div>
      </form>
    </ModalSheet>
  </>;
}
