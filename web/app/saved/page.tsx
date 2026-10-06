"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ListingCard } from "@/components/listings/ListingCard";
import { Icon } from "@/components/portal/icons";
import { FilterMenu, PanelSearch, PanelState, WorkspaceHead, gridKeyNavigation } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { savePublicListing, unsavePublicListing } from "@/lib/listings";
import { listSavedListings, type SavedListing } from "@/lib/tenant";
import { onDate } from "@/lib/time";

type Order = "recent" | "rent" | "move_in";

const ORDERS: { value: Order; label: string }[] = [
  { value: "recent", label: "Recently saved" },
  { value: "rent", label: "Lowest rent" },
  { value: "move_in", label: "Lowest move-in" },
];

/** How long a removed place offers its Undo before the tile goes. */
const UNDO_MS = 6000;

/**
 * The shortlist, on the shared workspace.
 *
 * Each place is the same card Explore shows — a saved place should not look
 * like a different kind of object from the one that was saved — on the same
 * fixed columns, so one saved place is one card, never a banner stretched
 * across the page. A short list says so with a quiet way to keep looking in
 * the next column, rather than leaving the rest of the row empty.
 *
 * Removing is one press on the heart, and forgiving: the card folds into a
 * slim tile with Undo for a few seconds. The server is told at once, so leaving
 * the page never resurrects it; Undo saves it again.
 */
export default function SavedPage() {
  const [saved, setSaved] = useState<SavedListing[] | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [order, setOrder] = useState<Order>("recent");
  const [query, setQuery] = useState("");
  /** Removed places still showing their Undo tile, by listing id. */
  const [removed, setRemoved] = useState<Record<string, SavedListing>>({});
  const timers = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      setSaved(await listSavedListings());
      setError("");
    } catch (cause) {
      setSaved((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your shortlist.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { Object.values(timers.current).forEach((timer) => window.clearTimeout(timer)); }, []);

  async function retry() {
    setRetrying(true);
    await load();
    setRetrying(false);
  }

  /** Ends the Undo tile: `drop` takes the place off the list for good. */
  function forget(listingId: string, drop: boolean) {
    window.clearTimeout(timers.current[listingId]);
    delete timers.current[listingId];
    setRemoved((current) => {
      const next = { ...current };
      delete next[listingId];
      return next;
    });
    if (drop) setSaved((current) => current?.filter((row) => row.listing.id !== listingId) ?? null);
  }

  async function removeSaved(row: SavedListing) {
    const listingId = row.listing.id;
    setRemoved((current) => ({ ...current, [listingId]: row }));
    timers.current[listingId] = window.setTimeout(() => forget(listingId, true), UNDO_MS);
    setError("");
    try {
      await unsavePublicListing(listingId);
    } catch (cause) {
      // The server still has it, so the card comes back.
      forget(listingId, false);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not update your shortlist.");
    }
  }

  async function undo(listingId: string) {
    forget(listingId, false);
    setError("");
    try {
      await savePublicListing(listingId);
    } catch (cause) {
      setSaved((current) => current?.filter((row) => row.listing.id !== listingId) ?? null);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not save it again.");
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    const rows = (saved ?? []).filter((row) => !needle || [
      row.listing.headline,
      row.listing.locality_name,
      row.listing.district_name,
      row.listing.landmark,
    ].filter(Boolean).join(" ").toLocaleLowerCase("en-GH").includes(needle));
    const rent = (row: SavedListing) => row.listing.rent_minor ?? Number.MAX_SAFE_INTEGER;
    if (order === "rent") return [...rows].sort((a, b) => rent(a) - rent(b));
    if (order === "move_in") return [...rows].sort((a, b) => (a.listing.total_move_in_minor || Number.MAX_SAFE_INTEGER) - (b.listing.total_move_in_minor || Number.MAX_SAFE_INTEGER));
    return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [order, query, saved]);

  const kept = (saved ?? []).filter((row) => !(row.listing.id in removed));
  const available = kept.filter((row) => row.listing.status === "active");
  const cheapest = available.reduce<SavedListing | null>(
    (best, row) => row.listing.rent_minor !== null && (!best || row.listing.rent_minor < (best.listing.rent_minor ?? Infinity)) ? row : best,
    null,
  );
  const loading = saved === null;
  const none = !loading && kept.length === 0 && !Object.keys(removed).length;
  const failed = Boolean(error) && !loading && !(saved ?? []).length;
  // Tools earn their space: an order once there is something to order, search
  // once the list is long enough to lose a place in.
  const showOrder = kept.length > 1;
  const showSearch = kept.length > 6 || Boolean(query);
  const short = visible.length > 0 && visible.length <= 3 && !query;

  return (
    <div className="ws-page saved-workspace">
      <WorkspaceHead
        icon="saved"
        title="Saved"
        summary={loading || failed ? null : kept.length ? (
          <>
            <strong>{kept.length} {kept.length === 1 ? "place" : "places"}</strong>
            {cheapest?.listing.rent_formatted ? <><span className="ws-summary-sep" aria-hidden="true">·</span>from {cheapest.listing.rent_formatted}</> : null}
            {kept.length > available.length ? <><span className="ws-summary-sep" aria-hidden="true">·</span><span data-tone="warning">{kept.length - available.length} no longer available</span></> : null}
          </>
        ) : "Places you are keeping an eye on."}
        actions={kept.length ? <Link href="/rentals" className="ws-action"><Icon name="explore" />Find more</Link> : null}
      />

      <section className="ws-panel is-canvas saved-panel" aria-label="Saved places" aria-busy={loading || undefined}>
        {showOrder || showSearch ? (
          <div className="ws-panel-head">
            <div className="ws-panel-tools">
              {showSearch ? <PanelSearch label="Search saved places" placeholder="Search name or area" value={query} onChange={setQuery} /> : null}
              {showOrder ? <FilterMenu label="Order" icon="filters" prefix="Sort" value={order} options={ORDERS} onChange={setOrder} active={order !== "recent"} /> : null}
            </div>
            <p className="ws-range"><strong>{visible.filter((row) => !(row.listing.id in removed)).length}</strong> {kept.length === 1 ? "place" : "places"}</p>
          </div>
        ) : null}

        {error && (saved ?? []).length ? (
          <div className="ws-inline-error" role="alert">
            <Icon name="warning" /><span>{error}</span>
            <button type="button" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button>
          </div>
        ) : null}

        {loading ? (
          <div className="ws-canvas">
            <ul className="saved-grid" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, index) => (
                <li key={index} className="saved-skeleton" style={{ "--saved-order": index } as React.CSSProperties}>
                  <span className="ws-skeleton-block saved-skeleton-photo" />
                  <span className="ws-skeleton-lines">
                    <span className="ws-skeleton-block" style={{ width: "48%" }} />
                    <span className="ws-skeleton-block is-thin" style={{ width: "80%" }} />
                    <span className="ws-skeleton-block is-thin" style={{ width: "60%" }} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : failed ? (
          <div className="saved-state">
            <PanelState
              tone="error"
              icon="warning"
              title="Your shortlist didn’t load"
              body={`${error} Check your connection and try again.`}
              action={<button type="button" className="ws-action" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button>}
            />
          </div>
        ) : none ? (
          <div className="saved-state">
            <PanelState
              icon="saved"
              title="Nothing saved yet"
              body="Tap the heart on a rental while you look and it waits here, so you can compare a shortlist instead of trying to remember."
              action={<Link href="/rentals" className="ws-action is-primary"><Icon name="explore" />Explore rentals</Link>}
            />
          </div>
        ) : visible.length ? (
          <div className="ws-canvas">
            <ul className="saved-grid" onKeyDown={moveSavedFocus}>
              {visible.map((row) => row.listing.id in removed ? (
                <li key={row.id} className="saved-removed" role="status">
                  <span className="saved-removed-mark" aria-hidden="true"><Icon name="heart" /></span>
                  <span className="saved-removed-copy">
                    <strong>Removed from saved</strong>
                    <span>{row.listing.headline}</span>
                  </span>
                  <button type="button" className="ws-action is-primary" onClick={() => void undo(row.listing.id)}>Undo</button>
                </li>
              ) : (
                <ListingCard
                  key={row.id}
                  listing={row.listing}
                  saved
                  onSave={() => void removeSaved(row)}
                  unavailable={row.listing.status !== "active"}
                  footnote={(
                    <>
                      {row.listing.status !== "active" ? <span className="saved-gone"><Icon name="warning" />No longer available</span> : null}
                      <span>Saved {onDate(row.created_at)}</span>
                    </>
                  )}
                />
              ))}
              {short ? (
                <li className="saved-more">
                  <Link href="/rentals" className="saved-more-link">
                    <span className="saved-more-mark" aria-hidden="true"><Icon name="explore" /></span>
                    <strong>Keep looking</strong>
                    <span>Save a few more to compare rent, advance and area side by side.</span>
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        ) : (
          <div className="saved-state">
            <PanelState
              icon="explore"
              title={`Nothing matches “${query.trim()}”`}
              body="Try another name or area."
              action={<button type="button" className="ws-action" onClick={() => setQuery("")}>Clear search</button>}
            />
          </div>
        )}
      </section>
    </div>
  );
}

/** Arrow keys move between cards the way the eye does. */
const moveSavedFocus = gridKeyNavigation(".listing-card-headline a, .saved-more-link");
