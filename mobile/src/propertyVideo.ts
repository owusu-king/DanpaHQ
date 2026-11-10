import type { ImagePickerAsset } from "expo-image-picker";
import { createVideoPlayer } from "expo-video";
import { apiFetch, idempotentMutation } from "@/api";
import { readUploadSource, transferUpload, type UploadReservation } from "@/uploadTransfer";

export type WalkthroughVideo = { id: string; url: string; duration_ms: number; content_type: string; size_bytes: number };
export type VideoSubject = "property" | "unit";
export const MAX_VIDEO_MS = 15_000;
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
export const videoPath = (subject: VideoSubject, id: string) => `/${subject === "property" ? "properties" : "units"}/${id}/video/`;

export async function prepareVideo(asset: ImagePickerAsset) {
  const name = (asset.fileName || asset.uri.split("?")[0]!).toLowerCase();
  const mime = asset.mimeType || (name.endsWith(".mov") ? "video/quicktime" : name.endsWith(".webm") ? "video/webm" : name.endsWith(".mp4") ? "video/mp4" : "");
  if (!["video/mp4", "video/quicktime", "video/webm"].includes(mime)) throw new Error("Choose an MP4, MOV or WebM video.");
  if (asset.fileSize && asset.fileSize > MAX_VIDEO_BYTES) throw new Error("Choose a video up to 30MB.");
  if (asset.duration && asset.duration > MAX_VIDEO_MS) throw new Error("Choose a video of 15 seconds or less.");
  const player = createVideoPlayer(asset.uri);
  try {
    for (let i = 0; i < 100 && player.status !== "readyToPlay" && player.status !== "error"; i++) await new Promise(resolve => setTimeout(resolve, 50));
    const duration = player.duration * 1000;
    if (player.status !== "readyToPlay" || !Number.isFinite(duration) || duration <= 0) throw new Error("This video could not be read. Choose another video.");
    if (duration > MAX_VIDEO_MS) throw new Error("Choose a video of 15 seconds or less.");
  } finally { player.release(); }
  const blob = await readUploadSource(asset.uri);
  if (!blob.size || blob.size > MAX_VIDEO_BYTES) throw new Error("Choose a video up to 30MB.");
  return { uri: asset.uri, mime, filename: asset.fileName || "video.mp4", blob };
}

type Upload = { id: string; upload_status: string; scan_status?: string; is_usable: boolean; status_message?: string; rejection_reason: string };

export function videoUpload(prepared: Awaited<ReturnType<typeof prepareVideo>>, subject: VideoSubject, progress: (label: string) => void) {
  const mutation = idempotentMutation();
  let reservation: UploadReservation | null = null;
  let transferred = false;
  return async () => {
    const starting = reservation === null;
    progress(starting ? "Preparing upload…" : "Checking upload status…");
    reservation ??= await apiFetch<UploadReservation>("/files/uploads/", {
      method: "POST", ...mutation,
      body: { purpose: `${subject}_video`, filename: prepared.filename, content_type: prepared.mime, size_bytes: prepared.blob.size },
    });
    let stored: Upload = starting && !transferred
      ? { id: reservation.file_id, is_usable: false, upload_status: "awaiting_upload", rejection_reason: "" }
      : await apiFetch<Upload>(`/files/${reservation.file_id}/`);
    if (stored.upload_status === "expired") throw new Error("This upload expired. Choose the video again.");
    if (stored.upload_status === "uploaded" && stored.scan_status === "failed") {
      progress("Restarting security check…");
      stored = await apiFetch<Upload>(`/files/uploads/${reservation.file_id}/complete/`, { method: "POST", timeoutMs: 90_000 });
    }
    if (stored.upload_status === "awaiting_upload") {
      if (!transferred) {
        progress("Uploading video…");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 180_000);
        let response: { status: number; ok: boolean };
        try {
          response = await transferUpload(reservation, prepared, {
            signal: controller.signal,
            onProgress: (sent, total) => {
              if (total > 0) progress(`Uploading video… ${Math.round(sent / total * 100)}%`);
            },
          });
        } catch {
          throw new Error(controller.signal.aborted ? "Sending the video timed out. Retry the upload." : "Couldn’t connect to video storage. Retry the upload.");
        } finally { clearTimeout(timeout); }
        if (response.status === 401 || response.status === 403) throw new Error("Video storage refused the upload. Try choosing the video again.");
        if (response.status === 413) throw new Error("Video storage rejected the size. Choose a smaller video.");
        if (response.status === 429) throw new Error("Video storage is busy. Wait a moment and retry.");
        if (!response.ok) throw new Error(`Video storage could not accept the file (HTTP ${response.status}). Retry the upload.`);
        transferred = true;
      }
      progress("Processing video…");
      stored = await apiFetch<Upload>(`/files/uploads/${reservation.file_id}/complete/`, { method: "POST", timeoutMs: 90_000 });
    }
    if (!stored.is_usable) progress("Checking video safety…");
    for (let i = 0; i < 10 && !stored.is_usable && !stored.rejection_reason && stored.scan_status !== "failed"; i++) {
      await new Promise(resolve => setTimeout(resolve, Math.min(1_000 * (i + 1), 5_000)));
      stored = await apiFetch<Upload>(`/files/${reservation.file_id}/`);
    }
    if (!stored.is_usable) throw new Error(stored.rejection_reason || (stored.scan_status === "failed"
      ? stored.status_message || "The video safety check could not finish. Retry to check the same upload."
      : "The video safety check is still running. Retry shortly to check its status."));
    return stored.id;
  };
}
