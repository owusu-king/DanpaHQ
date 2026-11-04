import type { ImagePickerAsset } from "expo-image-picker";
import { createVideoPlayer } from "expo-video";
import { apiFetch, idempotentMutation } from "@/api";
import { readUploadSource, transferUpload, type UploadReservation } from "@/uploadTransfer";

export type WalkthroughVideo = { id: string; url: string; duration_ms: number; content_type: string; size_bytes: number };
export type VideoSubject = "property" | "unit";
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
export const videoPath = (subject: VideoSubject, id: string) => `/${subject === "property" ? "properties" : "units"}/${id}/video/`;

export async function prepareVideo(asset: ImagePickerAsset) {
  const mime = asset.mimeType || (asset.uri.split("?")[0]!.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4");
  if (!["video/mp4", "video/quicktime", "video/webm"].includes(mime)) throw new Error("Choose an MP4, MOV or WebM video.");
  if (asset.fileSize && asset.fileSize > MAX_VIDEO_BYTES) throw new Error("Choose a video up to 30MB.");
  const player = createVideoPlayer(asset.uri);
  try {
    for (let i = 0; i < 100 && player.status !== "readyToPlay" && player.status !== "error"; i++) await new Promise(resolve => setTimeout(resolve, 50));
    const duration = player.duration * 1000;
    if (player.status !== "readyToPlay" || !Number.isFinite(duration) || duration <= 0) throw new Error("This video could not be read. Choose another video.");
    if (duration > 10_000) throw new Error("Choose a video of 10 seconds or less.");
  } finally { player.release(); }
  const blob = await readUploadSource(asset.uri);
  if (!blob.size || blob.size > MAX_VIDEO_BYTES) throw new Error("Choose a video up to 30MB.");
  return { uri: asset.uri, mime, filename: asset.fileName || "video.mp4", blob };
}

type Upload = { id: string; upload_status: string; scan_status?: string; is_usable: boolean; rejection_reason: string };

export function videoUpload(prepared: Awaited<ReturnType<typeof prepareVideo>>, subject: VideoSubject) {
  const mutation = idempotentMutation();
  let reservation: UploadReservation | null = null;
  let transferred = false;
  return async () => {
    reservation ??= await apiFetch<UploadReservation>("/files/uploads/", {
      method: "POST", ...mutation,
      body: { purpose: `${subject}_video`, filename: prepared.filename, content_type: prepared.mime, size_bytes: prepared.blob.size },
    });
    let stored = await apiFetch<Upload>(`/files/${reservation.file_id}/`);
    if (stored.upload_status === "expired") throw new Error("This upload expired. Choose the video again.");
    if (stored.upload_status === "uploaded" && stored.scan_status === "failed") {
      stored = await apiFetch<Upload>(`/files/uploads/${reservation.file_id}/complete/`, { method: "POST", timeoutMs: 90_000 });
    }
    if (stored.upload_status === "awaiting_upload") {
      if (!transferred) {
        const response = await transferUpload(reservation, prepared);
        if (!response.ok) throw new Error("Video upload failed. Try again.");
        transferred = true;
      }
      stored = await apiFetch<Upload>(`/files/uploads/${reservation.file_id}/complete/`, { method: "POST", timeoutMs: 90_000 });
    }
    for (let i = 0; i < 40 && !stored.is_usable && !stored.rejection_reason; i++) {
      await new Promise(resolve => setTimeout(resolve, 750));
      stored = await apiFetch<Upload>(`/files/${reservation.file_id}/`);
    }
    if (!stored.is_usable) throw new Error(stored.rejection_reason || "Video is still being checked. Try again shortly.");
    return stored.id;
  };
}
