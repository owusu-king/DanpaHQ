import { authedFetch } from "./auth";

export type ProviderPassportForm = {
  representative_id: string; representative_role: string; registered_business: boolean;
  registration_number: string; contact_email: string; contact_phone: string;
};
export type PublicProviderCredential = { name: string; category: string; verified: boolean; verified_at: string | null; valid_until: string | null };
export type ProviderPassport = {
  organization_id: string; name: string; category: string; category_label: string;
  credentials: ProviderPassportForm; status: string; editable: boolean; decision_note: string;
  missing: { field: string; message: string }[];
  identity: { id: string; name: string; phone: string; email: string; phone_verified: boolean; email_verified: boolean; identity_verified: boolean; photo_on_record: boolean };
  representatives: { id: string; name: string }[];
  documents: { id: string; filename: string; evidence_type: string; download_path: string }[];
  properties: { id: string; name: string; relationship: string; authority_verified: boolean; property_verified: boolean }[];
  activity: { completed_tenancies: number; active_tenancies: number; completed_maintenance: number; not_recorded: string[] };
  history: { id: string; status: string; submitted_at: string; decided_at: string | null; decision_note: string }[];
};
export const PASSPORT_STATUS: Record<string, string> = { not_started: "Not started", incomplete: "Incomplete", ready: "Ready to submit", submitted: "Submitted", under_review: "Under review", needs_more_info: "More information required", verified: "Verified", rejected: "Rejected" };
export const DOCUMENT_TYPES = [
  { value: "business_certificate", label: "Business registration" },
  { value: "agency_licence", label: "Agency licence" },
  { value: "authorization_letter", label: "Representative authorization" },
];
export function passportForm(passport: ProviderPassport): ProviderPassportForm {
  const c = passport.credentials;
  return { representative_id: c.representative_id, representative_role: c.representative_role, registered_business: c.registered_business, registration_number: c.registration_number, contact_email: c.contact_email, contact_phone: c.contact_phone };
}
export const passportPath = (id: string) => `/organizations/${id}/provider-passport/`;
export const getProviderPassport = (id: string) => authedFetch<ProviderPassport>(passportPath(id));
export const saveProviderPassport = (id: string, form: ProviderPassportForm) => authedFetch<ProviderPassport>(passportPath(id), { method: "PATCH", body: JSON.stringify(form) });
export const submitProviderPassport = (id: string) => authedFetch<ProviderPassport>(`${passportPath(id)}submit/`, { method: "POST" });
export const addPassportDocument = (id: string, file_id: string, evidence_type: string) => authedFetch<ProviderPassport>(`${passportPath(id)}documents/`, { method: "POST", body: JSON.stringify({ file_id, evidence_type }) });
export const removePassportDocument = (id: string, documentId: string) => authedFetch<ProviderPassport>(`${passportPath(id)}documents/${documentId}/`, { method: "DELETE" });
export const passportDownload = (path: string) => authedFetch<{ url: string }>(path);
