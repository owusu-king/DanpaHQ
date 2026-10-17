import { apiFetch } from "@/lib/api";

export type SupportCategory = "account" | "verification" | "application" | "lease" | "payment" | "property" | "other";
export type SupportMessage = { id: string; body: string; mine: boolean; author_name: string; sender: "user" | "management"; created_at: string };
export type SupportCase = { id: string; category: SupportCategory; summary: string; details: string; priority: string; status: "open" | "in_review" | "resolved" | "dismissed"; last_message: string; last_message_at: string; unread: boolean; created_at: string };
export type SupportCaseDetail = SupportCase & { messages: SupportMessage[]; legacy_message?: string };

export const listSupportCases = () => apiFetch<SupportCase[]>("/me/support-cases/");
export const getSupportCase = (id: string) => apiFetch<SupportCaseDetail>(`/me/support-cases/${id}/`);
export const createSupportCase = (input: { category: SupportCategory; summary: string; message: string }) => apiFetch<SupportCaseDetail>("/me/support-cases/", { method: "POST", body: JSON.stringify(input) });
export const replyToSupportCase = (id: string, message: string) => apiFetch<SupportCaseDetail>(`/me/support-cases/${id}/`, { method: "POST", body: JSON.stringify({ message }) });
