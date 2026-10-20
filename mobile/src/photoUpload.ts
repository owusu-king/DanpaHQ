import type { ImagePickerAsset } from "expo-image-picker";

export const PILOT_SCAN_MAX_BYTES = 3_500_000;

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_SOURCE_BYTES = 25_000_000;
const TARGET_LONG_EDGES = [2400, 2000, 1600];
const DOCUMENT_PURPOSES = new Set(["identity_document", "property_document", "payment_evidence"]);
const JPEG_QUALITIES = [0.86, 0.78];

export type PreparedUpload = {
  uri: string;
  mime: string;
  filename: string;
  blob: Blob;
};

export async function preparePhotoUpload(
  asset: ImagePickerAsset,
  mime: string,
  filename: string,
  purpose: string,
): Promise<PreparedUpload> {
  if (PHOTO_TYPES.has(mime) && asset.fileSize && asset.fileSize > MAX_SOURCE_BYTES) {
    throw new Error("This photo is too large to process on this device. Choose a smaller photo.");
  }

  // Use the actual Blob size for both the reservation and the scanner limit.
  // A picker-provided fileSize can be missing or stale after conversion.
  let original: Blob | null = null;
  if (!asset.fileSize || asset.fileSize <= PILOT_SCAN_MAX_BYTES) {
    original = await (await fetch(asset.uri)).blob();
    if (original.size <= PILOT_SCAN_MAX_BYTES) {
      return { uri: asset.uri, mime, filename, blob: original };
    }
  }

  if (!PHOTO_TYPES.has(mime) || asset.type === "video") {
    throw new Error("This file exceeds the 3.5 MB pilot limit. Choose a smaller video or document.");
  }
  if ((original?.size ?? asset.fileSize ?? 0) > MAX_SOURCE_BYTES) {
    throw new Error("This photo is too large to process on this device. Choose a smaller photo.");
  }

  const longEdge = Math.max(asset.width, asset.height);
  if (!longEdge) throw new Error("This photo is empty. Choose another photo.");
  try {
    // Most uploads never load the native image processor at all.
    const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
    for (const edge of DOCUMENT_PURPOSES.has(purpose) ? TARGET_LONG_EDGES.slice(0, 2) : TARGET_LONG_EDGES) {
      const scale = Math.min(1, edge / longEdge);
      const context = ImageManipulator.manipulate(asset.uri);
      if (scale < 1) {
        context.resize({
          width: Math.max(1, Math.round(asset.width * scale)),
          height: Math.max(1, Math.round(asset.height * scale)),
        });
      }
      const image = await context.renderAsync();
      for (const quality of JPEG_QUALITIES) {
        const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
        const blob = await (await fetch(result.uri)).blob();
        if (blob.size > 0 && blob.size <= PILOT_SCAN_MAX_BYTES) {
          return {
            uri: result.uri,
            mime: "image/jpeg",
            filename: `${filename.replace(/\.[^.]+$/, "")}.jpg`,
            blob,
          };
        }
      }
    }
  } catch {
    throw new Error("This photo could not be compressed on your device. Try a smaller JPEG photo.");
  }
  throw new Error("This photo cannot fit under 3.5 MB without losing detail. Choose a clearer, smaller photo.");
}
