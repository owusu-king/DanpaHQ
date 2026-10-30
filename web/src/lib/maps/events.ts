const refused = new Set<() => void>();
export function onMapRefused(listener: () => void): () => void { refused.add(listener); return () => { refused.delete(listener); }; }
export function reportMapUnavailable() { refused.forEach((listener) => listener()); }
