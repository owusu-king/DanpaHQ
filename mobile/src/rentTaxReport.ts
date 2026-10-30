import { apiFetch } from "@/api";

export type RentTaxReportInput = {
  format?: "pdf" | "csv";
  property_id?: string;
  period_start: string;
  period_end: string;
  taxpayer_type: "individual" | "business";
  taxpayer_name: string;
  taxpayer_tin: string;
  tax_office: string;
};
export type RentTaxReportDownload = { filename: string; mime_type?: string; csv?: string; pdf_base64?: string };

export function generateRentTaxReport(organizationId: string, input: RentTaxReportInput) {
  return apiFetch<RentTaxReportDownload>(`/organizations/${organizationId}/finance/rent-tax-report/`, {
    method: "POST", body: input,
  });
}
