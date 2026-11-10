import type { PreparedUpload } from "./photoUpload";

export type UploadReservation = {
  file_id: string;
  url: string;
  method: "PUT" | "POST";
  fields?: Record<string, string>;
  headers?: Record<string, string>;
};

export async function readUploadSource(uri: string): Promise<Blob> {
  return (await fetch(uri)).blob();
}

export type TransferOptions = {
  signal?: AbortSignal;
  onProgress?: (sent: number, total: number) => void;
};

export async function transferUpload(reservation: UploadReservation, prepared: PreparedUpload, options?: TransferOptions) {
  const signal = options?.signal;
  const file = prepared.blob.type === prepared.mime
    ? prepared.blob
    : new Blob([prepared.blob], { type: prepared.mime });
  if (reservation.method === "PUT") {
    return fetch(reservation.url, {
      method: "PUT", signal,
      headers: { ...reservation.headers, "Content-Type": prepared.mime },
      body: file,
    });
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(reservation.fields ?? {})) form.append(key, value);
  form.append("file", file, prepared.filename);
  return fetch(reservation.url, { method: "POST", body: form, signal });
}
