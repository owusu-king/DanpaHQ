import type { EnquiryDetail } from "@/lib/sales";

export type EnquirySide = "buyer" | "seller";
export type EnquiriesRequest = { id?: string; side?: EnquirySide; view?: "support"; record?: EnquiryDetail };
export const OPEN_ENQUIRIES = "danpahq:open-enquiries";
export function openEnquiries(request: EnquiriesRequest = {}) {
  window.dispatchEvent(new CustomEvent<EnquiriesRequest>(OPEN_ENQUIRIES, { detail: request }));
}
