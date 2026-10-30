import { useEffect, useRef, useState } from "react";
import { Linking, Modal, ScrollView, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { Select } from "@/components/form/Select";
import { ModalSafeArea, SafeBottom } from "@/components/sheet/ModalSafeArea";
import { generateRentTaxReport, type RentTaxReportInput } from "@/rentTaxReport";

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
  function close() { generation.current++; setOpen(false); setBusy(false); setError(""); }

  async function generate() {
    if (!input.taxpayer_name.trim()) { setError("Enter the taxpayer or registered name."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.period_start) || !/^\d{4}-\d{2}-\d{2}$/.test(input.period_end)) {
      setError("Enter both dates as YYYY-MM-DD."); return;
    }
    const attempt = ++generation.current;
    setBusy(true); setError("");
    let path: string | null = null;
    try {
      if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) throw new Error("Saving reports is unavailable on this device.");
      const report = await generateRentTaxReport(organizationId, input);
      if (attempt !== generation.current) return;
      path = `${FileSystem.cacheDirectory}${organizationId}-${Date.now()}-${attempt}-${report.filename}`;
      if (input.format === "pdf") {
        if (!report.pdf_base64) throw new Error("The PDF report was not returned. Please try again.");
        await FileSystem.writeAsStringAsync(path, report.pdf_base64, { encoding: FileSystem.EncodingType.Base64 });
      } else {
        if (typeof report.csv !== "string") throw new Error("The CSV export was not returned. Please try again.");
        await FileSystem.writeAsStringAsync(path, report.csv);
      }
      if (attempt !== generation.current) return;
      await Sharing.shareAsync(path, { mimeType: input.format === "pdf" ? "application/pdf" : "text/csv", UTI: input.format === "pdf" ? "com.adobe.pdf" : "public.comma-separated-values-text", dialogTitle: "Save financial report" });
    } catch (cause) {
      if (attempt === generation.current) setError(cause instanceof Error ? cause.message : "Could not generate the report.");
    } finally {
      if (path) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      if (attempt === generation.current) setBusy(false);
    }
  }

  return <>
    <Button label="Generate financial report" variant="secondary" onPress={() => setOpen(true)} />
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <ModalSafeArea><SafeBottom render={bottom => <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space[5], paddingBottom: bottom + space[6], gap: space[4] }}>
        <Type variant="title1" accessibilityRole="header">Property financial report</Type>
        <Type variant="caption">A statement of income, expenses, outstanding charges and net rental income. CSV exports the raw supporting records.</Type>
        <Select label="Report format" value={input.format ?? "pdf"} disabled={busy} options={[{ value: "pdf", label: "PDF financial statement" }, { value: "csv", label: "CSV raw data" }]} onChange={format => setInput(current => ({ ...current, format }))} />
        <Select label="Property" value={input.property_id ?? ""} disabled={busy} options={[{ value: "", label: "All authorised properties" }, ...properties.map(property => ({ value: property.id, label: property.title }))]} onChange={propertyId => setInput(current => ({ ...current, property_id: propertyId || undefined }))} />
        <Select label="Taxpayer type" value={input.taxpayer_type} disabled={busy} options={[{ value: "individual", label: "Individual landlord" }, { value: "business", label: "Registered business" }]} onChange={value => setInput(current => ({ ...current, taxpayer_type: value }))} />
        <Field label="Taxpayer / registered name" value={input.taxpayer_name} maxLength={200} editable={!busy} onChangeText={value => setInput(current => ({ ...current, taxpayer_name: value }))} />
        <Field label="Period start (YYYY-MM-DD)" value={input.period_start} editable={!busy} onChangeText={value => setInput(current => ({ ...current, period_start: value }))} />
        <Field label="Period end (YYYY-MM-DD)" value={input.period_end} editable={!busy} onChangeText={value => setInput(current => ({ ...current, period_end: value }))} />
        <Field label="TIN / Ghana Card PIN (optional for draft)" value={input.taxpayer_tin} maxLength={40} editable={!busy} autoCapitalize="characters" onChangeText={value => setInput(current => ({ ...current, taxpayer_tin: value }))} />
        <Field label="Tax office (optional for draft)" value={input.tax_office} maxLength={120} editable={!busy} onChangeText={value => setInput(current => ({ ...current, tax_office: value }))} />
        <Type variant="caption">Outstanding balances are current at generation for charges due within the period. Taxpayer details are used only for this report. Tax calculation and filing remain separate.</Type>
        <Button label="GRA return requirements" variant="quiet" onPress={() => { void Linking.openURL("https://gra.gov.gh/domestic-tax/returns/").catch(() => setError("Could not open GRA guidance.")); }} />
        {error ? <Notice tone="error" title={error} /> : null}
        <View style={{ gap: space[2] }}><Button label={input.format === "pdf" ? "Generate and save PDF" : "Export CSV data"} busy={busy} busyLabel="Generating…" onPress={() => void generate()} /><Button label="Close" variant="quiet" onPress={close} /></View>
      </ScrollView>} /></ModalSafeArea>
    </Modal>
  </>;
}
