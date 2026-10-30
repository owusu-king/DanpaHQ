/** A listing may return only to Explore, never to an arbitrary supplied URL. */
export function exploreReturnPath(value?: string | null): string {
  return value === "/rentals" || value?.startsWith("/rentals?") ? value : "/rentals";
}

export function saleDetailPath(id: string, returnTo = "/rentals"): string {
  const params = new URLSearchParams({ id, returnTo: exploreReturnPath(returnTo) });
  return `/record/sale?${params.toString()}`;
}
