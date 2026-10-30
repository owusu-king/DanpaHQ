import { apiFetch } from "@/api";

export type LocationReference = {
  id: string; name: string; aliases: string[]; district: string | null; region: string | null;
  district_name: string; region_name: string; label: string; parent_status: string;
  latitude: string | null; longitude: string | null; kind: string;
  sources: { dataset: string; source_id: string; license: string; attribution: string }[];
};
export type LocationPage = { count: number; next: string | null; results: LocationReference[] };
export function searchLocations(query: string, signal?: AbortSignal) {
  return apiFetch<LocationPage>(`/geo/locations/?q=${encodeURIComponent(query.trim())}&limit=12`, {
    signal, anonymous: true, maxAttempts: 1, timeoutMs: 6000,
  });
}

export function referenceArea(row: LocationReference) {
  if (row.latitude == null || row.longitude == null) return null;
  const lat = Number(row.latitude), lng = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, bounds: { west: lng - .0135, east: lng + .0135, south: lat - .0135, north: lat + .0135 } };
}
