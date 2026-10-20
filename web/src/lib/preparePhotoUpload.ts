/** Reduce oversized photos before the browser sends them directly to storage. */

export const PILOT_SCAN_MAX_BYTES = 3_500_000;

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_SOURCE_BYTES = 25_000_000;
const TARGET_LONG_EDGES = [2400, 2000, 1600];
const DOCUMENT_PURPOSES = new Set(["identity_document", "property_document", "payment_evidence"]);
const JPEG_QUALITIES = [0.86, 0.78];

function asJpegName(name: string): string {
  return `${name.replace(/\.[^.]+$/, "")}.jpg`;
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("This photo could not be compressed. Try another photo.")),
      "image/jpeg",
      quality,
    );
  });
}

export async function preparePhotoUpload(file: File, purpose: string): Promise<File> {
  if (file.size <= PILOT_SCAN_MAX_BYTES) return file;
  if (!PHOTO_TYPES.has(file.type)) {
    throw new Error("This file exceeds the 3.5 MB pilot limit. Choose a smaller PDF or video.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("This photo is too large to process on this device. Choose a smaller photo.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This photo could not be opened here. Try a JPEG or PNG instead.");
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (!longEdge) throw new Error("This photo is empty. Choose another photo.");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Photo compression is unavailable in this browser.");

    for (const edge of DOCUMENT_PURPOSES.has(purpose) ? TARGET_LONG_EDGES.slice(0, 2) : TARGET_LONG_EDGES) {
      const scale = Math.min(1, edge / longEdge);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of JPEG_QUALITIES) {
        const blob = await encodeJpeg(canvas, quality);
        if (blob.size > 0 && blob.size <= PILOT_SCAN_MAX_BYTES) {
          return new File([blob], asJpegName(file.name), { type: "image/jpeg" });
        }
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("This photo cannot fit under 3.5 MB without losing detail. Choose a clearer, smaller photo.");
}
