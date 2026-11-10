import type { WorkKind } from "@/lib/artisan";

export type ArtisansTab = "find" | "requests" | "records";
/** Opened for a repair or a posted job: profiles offer to invite (or suggest) for it. */
export type ArtisansForRequest = {
  id: string;
  mode: "invite" | "suggest";
  label: string;
  /** A repair unless said otherwise. */
  kind?: WorkKind;
};
export type ArtisansRequest = {
  tab?: ArtisansTab;
  trade?: string;
  forRequest?: ArtisansForRequest;
  /** Open this posted job in Requests. */
  job?: string;
};

export const OPEN_ARTISANS = "danpahq:open-artisans";

export function artisansHref(request: ArtisansRequest = {}) {
  const query = new URLSearchParams();
  if (request.tab || request.job) query.set("tab", request.tab ?? "requests");
  if (request.trade) query.set("trade", request.trade);
  if (request.job) { query.set("view", "job"); query.set("id", request.job); }
  if (request.forRequest) query.set("for", JSON.stringify(request.forRequest));
  return `/artisans${query.size ? `?${query}` : ""}`;
}

/** Navigate to the artisan workspace, preserving repair and job context. */
export function openArtisans(request: ArtisansRequest = {}) {
  window.dispatchEvent(new CustomEvent<ArtisansRequest>(OPEN_ARTISANS, { detail: request }));
}
