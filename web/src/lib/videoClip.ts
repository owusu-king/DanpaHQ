/**
 * Five seconds of video, made in the browser.
 *
 * A maintenance request may carry a clip of at most five seconds
 * (`MAX_CLIP_MS`). There is no ffmpeg anywhere in this product, so the clip is
 * cut on the device: the chosen window is played once, silently, into a
 * `MediaRecorder`, and what it records *is* the clip. That takes as long as the
 * clip — at most five seconds — and needs nothing beyond the platform.
 *
 * Where a `<video>` cannot be captured directly (Safari), its frames are drawn
 * onto a canvas and the canvas is recorded instead; that path carries no sound,
 * which a repair clip can live without.
 */

import { MAX_CLIP_MS } from "./maintenance";

type Capturable = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

/** "4.8" — seconds to one decimal, for clip lengths and the recording timer. */
export function seconds(ms: number): string {
  return (Math.round(ms / 100) / 10).toLocaleString("en-GH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** The container this browser records into, best first. */
export function recordingType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) ?? ""
  );
}

export function canRecordInBrowser(): boolean {
  return Boolean(recordingType()) && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** A Blob as a File the upload pipeline accepts, named for what it is. */
export function clipFile(blob: Blob, stem = "clip"): File {
  const type = (blob.type || recordingType()).split(";")[0] || "video/webm";
  const extension = type === "video/mp4" ? "mp4" : type === "video/quicktime" ? "mov" : "webm";
  return new File([blob], `${stem}.${extension}`, { type });
}

/** How long a video file runs, in milliseconds. */
export function videoDuration(source: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      if (value === null) reject(new Error("We could not read that video. Try another file."));
      else resolve(value);
    };
    video.onloadedmetadata = () => {
      // A freshly recorded WebM reports Infinity until it has been seeked to
      // the end once; asking for a far-off time makes the browser find it.
      if (Number.isFinite(video.duration)) return done(Math.round(video.duration * 1000));
      video.ontimeupdate = () => {
        video.ontimeupdate = null;
        done(Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0);
      };
      video.currentTime = 1e7;
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}

/**
 * Record ``[startMs, endMs)`` of ``source`` into a new clip.
 *
 * ``onProgress`` receives 0–1 as the window plays through.
 */
export async function cutClip(
  source: Blob,
  startMs: number,
  endMs: number,
  onProgress?: (share: number) => void,
): Promise<File> {
  const length = Math.min(endMs - startMs, MAX_CLIP_MS);
  if (length <= 0) throw new Error("Choose a part of the video to keep.");
  const type = recordingType();
  if (!type) throw new Error("This browser cannot cut video. Record a clip of five seconds or less instead.");

  const url = URL.createObjectURL(source);
  const video = document.createElement("video") as Capturable;
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const cleanup: Array<() => void> = [() => URL.revokeObjectURL(url)];
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("We could not read that video. Try another file."));
    });
    await seek(video, startMs / 1000);

    const stream = streamOf(video, cleanup);
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    recorder.start(250);
    await video.play();
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const elapsed = performance.now() - startedAt;
        onProgress?.(Math.min(1, elapsed / length));
        if (elapsed >= length || video.ended) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    video.pause();
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    onProgress?.(1);
    return clipFile(new Blob(chunks, { type: type.split(";")[0] }));
  } finally {
    cleanup.forEach((run) => run());
  }
}

function seek(video: HTMLVideoElement, seconds: number) {
  return new Promise<void>((resolve) => {
    if (Math.abs(video.currentTime - seconds) < 0.01) return resolve();
    video.onseeked = () => { video.onseeked = null; resolve(); };
    video.currentTime = seconds;
  });
}

/** The element's own stream where the browser offers one; a canvas otherwise. */
function streamOf(video: Capturable, cleanup: Array<() => void>): MediaStream {
  const direct = video.captureStream?.() ?? video.mozCaptureStream?.();
  if (direct) return direct;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");
  let frame = 0;
  const draw = () => {
    context?.drawImage(video, 0, 0, canvas.width, canvas.height);
    frame = requestAnimationFrame(draw);
  };
  draw();
  cleanup.push(() => cancelAnimationFrame(frame));
  return canvas.captureStream(30);
}
