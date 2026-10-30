/** Public tile configuration. Never put a private service key in a tile URL. */
export const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || "© OpenStreetMap contributors";
export const TILE_ATTRIBUTION_URL = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION_URL || "https://www.openstreetmap.org/copyright";

export function tilesConfigured(config = { url: TILE_URL, attributionUrl: TILE_ATTRIBUTION_URL }): boolean {
  try {
    return new URL(config.url).protocol === "https:" && ["{z}", "{x}", "{y}"].every((key) => config.url.includes(key))
      && new URL(config.attributionUrl).protocol === "https:";
  } catch { return false; }
}
