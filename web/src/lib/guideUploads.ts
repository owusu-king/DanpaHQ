import { managementFetch } from "@/lib/management";

type UploadSlot = { file_id: string; url: string; method: string; headers: Record<string, string>; fields: Record<string, string> };
type UploadState = { is_usable: boolean; upload_status: string; scan_status: string; status_message: string };
export async function uploadGuideAsset(file: File, purpose: "guide_video" | "guide_thumbnail" | "guide_captions", progress: (message: string) => void): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", vtt: "text/vtt" };
  const contentType = types[extension ?? ""] ?? file.type;
  progress("Starting upload…");
  const slot = await managementFetch<UploadSlot>("/how-it-works/uploads/", { method: "POST", body: JSON.stringify({ filename: file.name, content_type: contentType, size_bytes: file.size, purpose }) });
  progress("Uploading…");
  const multipart = slot.method === "POST";
  const form = new FormData();
  if (multipart) { for (const [key, value] of Object.entries(slot.fields)) form.append(key, value); form.append("file", file); }
  const uploaded = await fetch(slot.url, { method: slot.method, headers: multipart ? undefined : slot.headers, body: multipart ? form : file, signal: AbortSignal.timeout(120_000) });
  if (!uploaded.ok) throw new Error("The upload did not finish. Please try again.");
  let state = await managementFetch<UploadState>(`/how-it-works/uploads/${slot.file_id}/`, { method: "POST", body: "{}" });
  const deadline = Date.now() + 120_000;
  while (!state.is_usable) {
    if (["failed", "infected"].includes(state.scan_status) || ["rejected", "expired"].includes(state.upload_status)) throw new Error(state.status_message || "The file did not pass its checks.");
    if (Date.now() > deadline) throw new Error("The file is still being checked. Please try uploading again later.");
    progress("Checking the file…");
    await new Promise(resolve => setTimeout(resolve, 1500));
    state = await managementFetch<UploadState>(`/how-it-works/uploads/${slot.file_id}/`);
  }
  return slot.file_id;
}
