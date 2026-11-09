import { authedFetch } from "./auth";
import { idempotentMutation } from "./api";
import { videoDuration } from "./videoClip";

export type WalkthroughVideo = { id: string; url: string; duration_ms: number; content_type: string; size_bytes: number };
export type VideoSubject = "property" | "unit";
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_MS = 15_000;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const videoPath = (subject: VideoSubject, id: string) => `/${subject === "property" ? "properties" : "units"}/${id}/video/`;

export async function validateVideo(file: File) {
  if (!VIDEO_TYPES.includes(videoType(file))) throw new Error("Choose an MP4, MOV or WebM video.");
  if (!file.size || file.size > MAX_VIDEO_BYTES) throw new Error("Choose a video up to 30MB.");
  const duration = await videoDuration(file);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("This video could not be read. Choose another video.");
  if (duration > MAX_VIDEO_MS) throw new Error("Choose a video of 15 seconds or less.");
}

function videoType(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension === "mp4" ? "video/mp4" : extension === "mov" ? "video/quicktime" : extension === "webm" ? "video/webm" : "";
}

type Reservation = { file_id: string; url: string; method: string; fields?: Record<string, string>; headers?: Record<string, string> };
type Upload = { id: string; is_usable: boolean; upload_status: string; scan_status?: string; status_message?: string; rejection_reason: string };

/** A logical selection retains its reservation across transfer, scan and attach retries. */
export function videoUpload(file: File, subject: VideoSubject, progress: (label: string) => void) {
  const mime = videoType(file);
  const mutation = idempotentMutation();
  let reservation: Reservation | null = null;
  let transferred = false;
  return async function upload(): Promise<string> {
    const starting = reservation === null;
    progress(starting ? "Preparing upload…" : "Checking upload status…");
    reservation ??= await authedFetch<Reservation>("/files/uploads/", {
      method: "POST", ...mutation,
      body: JSON.stringify({ purpose: `${subject}_video`, filename: file.name, content_type: mime, size_bytes: file.size }),
    });
    let stored: Upload = starting && !transferred
      ? { id: reservation.file_id, is_usable: false, upload_status: "awaiting_upload", rejection_reason: "" }
      : await authedFetch<Upload>(`/files/${reservation.file_id}/`);
    if (stored.upload_status === "expired") throw new Error("This upload expired. Choose the video again.");
    if (stored.upload_status === "uploaded" && stored.scan_status === "failed") {
      progress("Restarting security check…");
      stored = await authedFetch<Upload>(`/files/uploads/${reservation.file_id}/complete/`, { method: "POST", timeoutMs: 90_000 });
    }
    if (stored.upload_status === "awaiting_upload") {
      if (!transferred) {
        const form = new FormData();
        for (const [key, value] of Object.entries(reservation.fields ?? {})) form.append(key, value);
        form.append("file", file.slice(0, file.size, mime), file.name);
        progress("Uploading video…");
        await transfer(reservation, file, form, mime, progress);
        transferred = true;
      }
      progress("Processing video…");
      stored = await authedFetch<Upload>(`/files/uploads/${reservation.file_id}/complete/`, {
        method: "POST", body: "{}", timeoutMs: 90_000,
      });
    }
    if (!stored.is_usable) progress("Checking video safety…");
    for (let i = 0; i < 10 && !stored.is_usable && !stored.rejection_reason && stored.scan_status !== "failed"; i++) {
      await new Promise(resolve => setTimeout(resolve, Math.min(1_000 * (i + 1), 5_000)));
      stored = await authedFetch<Upload>(`/files/${reservation.file_id}/`);
    }
    if (!stored.is_usable) throw new Error(stored.rejection_reason || (stored.scan_status === "failed"
      ? stored.status_message || "The video safety check could not finish. Retry to check the same upload."
      : "The video safety check is still running. Retry shortly to check its status."));
    return stored.id;
  };
}

function transfer(reservation: Reservation, file: File, form: FormData, mime: string, progress: (label: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(reservation.method, reservation.url);
    xhr.timeout = 180_000;
    if (reservation.method === "PUT") {
      for (const [key, value] of Object.entries({ ...reservation.headers, "Content-Type": mime })) xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(`Uploading video… ${Math.round(event.loaded / event.total * 100)}%`);
    };
    xhr.onerror = () => reject(new Error(navigator.onLine === false ? "You’re offline. Reconnect and retry the upload." : "Couldn’t connect to video storage. Retry the upload."));
    xhr.ontimeout = () => reject(new Error("Sending the video timed out. Retry the upload."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(videoTransferMessage(xhr.status)));
    };
    xhr.send(reservation.method === "PUT" ? file : form);
  });
}

function videoTransferMessage(status: number) {
  if (status === 401 || status === 403) return "Video storage refused the upload. Try choosing the video again.";
  if (status === 413) return "Video storage rejected the size. Choose a smaller video.";
  if (status === 429) return "Video storage is busy. Wait a moment and retry.";
  return `Video storage could not accept the file (HTTP ${status}). Retry the upload.`;
}
