/** Provider-neutral map API; Leaflet is loaded only after a browser map mounts. */
import type { DanpaHQMap, MapOptions } from "./types";
export * from "./types";
// The bundled renderer is available; the server configuration is resolved at mount.
export const mapsConfigured = () => true;
export const mapSetupHint = (): string | null => null;
export async function createMap(container: HTMLElement, options: MapOptions): Promise<DanpaHQMap> {
  const { createLeafletMap } = await import("./leaflet/map");
  return createLeafletMap(container, options);
}
export { onMapRefused } from "./events";
