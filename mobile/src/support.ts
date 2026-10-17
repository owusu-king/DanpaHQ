import { apiFetch } from "@/api";

export type SupportCategory = "account" | "verification" | "application" | "lease" | "payment" | "property" | "other";

export type SupportMessage = {
  id: string;
  body: string;
  mine: boolean;
  author_name: string;
  sender: "user" | "management";
  created_at: string;
};

export type SupportCase = {
  id: string;
  category: SupportCategory;
  summary: string;
  details: string;
  priority: string;
  status: "open" | "in_review" | "resolved" | "dismissed";
  last_message: string;
  last_message_at: string;
  unread: boolean;
  created_at: string;
};

export type SupportCaseDetail = SupportCase & {
  messages: SupportMessage[];
  legacy_message?: string;
};

export function listSupportCases(): Promise<SupportCase[]> {
  return apiFetch<SupportCase[]>("/me/support-cases/");
}

export function createSupportCase(input: { category: SupportCategory; summary: string; message: string }): Promise<SupportCaseDetail> {
  return apiFetch<SupportCaseDetail>("/me/support-cases/", { method: "POST", body: JSON.stringify(input) });
}

export function getSupportCase(id: string): Promise<SupportCaseDetail> {
  return apiFetch<SupportCaseDetail>(`/me/support-cases/${id}/`);
}

export function replyToSupportCase(id: string, message: string): Promise<SupportCaseDetail> {
  return apiFetch<SupportCaseDetail>(`/me/support-cases/${id}/`, { method: "POST", body: JSON.stringify({ message }) });
}
