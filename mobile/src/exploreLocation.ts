import { referenceArea, type LocationReference } from "./locations";

/** Only coordinates supplied by the reference dataset can move the map. */
export function locationSearchArea(row: LocationReference) {
  const point = referenceArea(row);
  return point ? { name: row.label || row.name, ref: row.id, bounds: point.bounds } : null;
}

/** Homonymous towns require an explicit choice; a keyboard search must not guess. */
export function uniqueLocationMatch(query: string, rows: LocationReference[]) {
  const normalize = (name: string) => name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const needle = normalize(query);
  if (!needle) return null;
  const matches = rows.filter((row) => [row.name, ...row.aliases].some((name) => normalize(name) === needle));
  return matches.length === 1 ? matches[0] : null;
}
