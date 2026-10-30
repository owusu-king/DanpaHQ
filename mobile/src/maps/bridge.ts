import type { GeoBounds } from "@/places";

export const validPoint = (lat: unknown, lng: unknown): boolean => typeof lat === "number" && typeof lng === "number"
  && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
export function validBounds(value: unknown): value is GeoBounds {
  if (!value || typeof value !== "object") return false;
  const box = value as GeoBounds;
  return validPoint(box.south, box.west) && validPoint(box.north, box.east) && box.west < box.east && box.south < box.north;
}
export type BridgeMessage =
  | { type: "ready" }
  | { type: "unavailable" }
  | { type: "background" }
  | { type: "marker"; key: string }
  | { type: "pin"; latitude: number; longitude: number }
  | { type: "move"; bounds: GeoBounds; zoom: number; byUser: boolean };
export function parseMapMessage(raw: string, keys: ReadonlySet<string>, canSelectPin: boolean): BridgeMessage | null {
  if (raw.length > 4096) return null;
  try {
    const row = JSON.parse(raw);
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    if (row.type === "ready" || row.type === "background" || row.type === "unavailable") return { type: row.type };
    if (row.type === "marker" && typeof row.key === "string" && keys.has(row.key)) return { type: "marker", key: row.key };
    if (row.type === "pin" && canSelectPin && validPoint(row.latitude, row.longitude)) return { type: "pin", latitude: row.latitude, longitude: row.longitude };
    if (row.type === "move" && validBounds(row.bounds) && typeof row.zoom === "number" && Number.isFinite(row.zoom) && row.zoom >= 0 && row.zoom <= 22 && typeof row.byUser === "boolean") return { type: "move", bounds: row.bounds, zoom: row.zoom, byUser: row.byUser };
  } catch { /* Ignore malformed messages; no bridge message executes native code. */ }
  return null;
}
export function safeScriptJSON(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
