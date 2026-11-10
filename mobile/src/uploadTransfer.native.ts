import { File, UploadType } from "expo-file-system";
import type { PreparedUpload } from "./photoUpload";
import type { TransferOptions, UploadReservation } from "./uploadTransfer";

// Read metadata and transfer from the native file directly, without the
// Response.blob -> native Blob store -> base64 -> JS multipart round trip.
export async function readUploadSource(uri: string): Promise<Blob> {
  return new File(uri);
}

export async function transferUpload(reservation: UploadReservation, prepared: PreparedUpload, options?: TransferOptions) {
  const file = new File(prepared.uri);
  const result = await file.upload(reservation.url, {
    httpMethod: reservation.method,
    signal: options?.signal,
    onProgress: options?.onProgress ? ({ bytesSent, totalBytes }) => options.onProgress?.(bytesSent, totalBytes) : undefined,
    uploadType: reservation.method === "POST" ? UploadType.MULTIPART : UploadType.BINARY_CONTENT,
    fieldName: "file",
    mimeType: prepared.mime,
    parameters: reservation.method === "POST" ? reservation.fields : undefined,
    headers: reservation.method === "PUT"
      ? { ...reservation.headers, "Content-Type": prepared.mime }
      : reservation.headers,
  });
  return { ok: result.status >= 200 && result.status < 300, status: result.status };
}
