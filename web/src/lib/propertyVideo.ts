import { authedFetch } from "./auth";
import { idempotentMutation } from "./api";
import { videoDuration } from "./videoClip";

export type WalkthroughVideo = { id: string; url: string; duration_ms: number; content_type: string; size_bytes: number };
export type VideoSubject = "property" | "unit";
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_MS = 10_000;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const videoPath = (subject: VideoSubject, id: string) => `/${subject === "property" ? "properties" : "units"}/${id}/video/`;

export async function validateVideo(file: File) {
  if (!VIDEO_TYPES.includes(file.type)) throw new Error("Choose an MP4, MOV or WebM video.");
  if (!file.size || file.size > MAX_VIDEO_BYTES) throw new Error("Choose a video up to 30MB.");
  const duration = await videoDuration(file);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_MS) throw new Error("Choose a video of 10 seconds or less.");
}

type Reservation = { file_id: string; url: string; method: string; fields?: Record<string, string>; headers?: Record<string, string> };
type Upload = { id: string; is_usable: boolean; upload_status: string; scan_status?: string; rejection_reason: string };

/** A logical selection retains its reservation across transfer, scan and attach retries. */
export function videoUpload(file: File, subject: VideoSubject) {
  const mutation = idempotentMutation();
  let reservation: Reservation | null = null;
  let transferred = false;
  return async function upload(): Promise<string> {
    reservation ??= await authedFetch<Reservation>("/files/uploads/", {
      method: "POST", ...mutation,
      body: JSON.stringify({ purpose: `${subject}_video`, filename: file.name, content_type: file.type, size_bytes: file.size }),
    });
    let stored = await authedFetch<Upload>(`/files/${reservation.file_id}/`);
    if (stored.upload_status === "expired") throw new Error("This upload expired. Choose the video again.");
    if (stored.upload_status === "uploaded" && stored.scan_status === "failed") {
      stored = await authedFetch<Upload>(`/files/uploads/${reservation.file_id}/complete/`, { method: "POST", timeoutMs: 90_000 });
    }
    if (stored.upload_status === "awaiting_upload") {
      if (!transferred) {
        const form = new FormData();
        for (const [key, value] of Object.entries(reservation.fields ?? {})) form.append(key, value);
        form.append("file", file);
        const response = await fetch(reservation.url, {
          method: reservation.method, body: reservation.method === "PUT" ? file : form,
          headers: reservation.method === "PUT" ? { ...reservation.headers, "Content-Type": file.type } : undefined,
        });
        if (!response.ok) throw new Error("Video upload failed. Try again.");
        transferred = true;
      }
      stored = await authedFetch<Upload>(`/files/uploads/${reservation.file_id}/complete/`, {
        method: "POST", body: "{}", timeoutMs: 90_000,
      });
    }
    for (let i = 0; i < 40 && !stored.is_usable && !stored.rejection_reason; i++) {
      await new Promise(resolve => setTimeout(resolve, 750));
      stored = await authedFetch<Upload>(`/files/${reservation.file_id}/`);
    }
    if (!stored.is_usable) throw new Error(stored.rejection_reason || "Video is still being checked. Try again shortly.");
    return stored.id;
  };
}
