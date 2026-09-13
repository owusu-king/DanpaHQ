"use client";

import Link from "next/link";

import { Icon } from "@/components/portal/icons";
import type { Listing } from "@/lib/console";

/**
 * The card a marker opens: enough to decide whether to look closer.
 *
 * Marker → preview → listing. Touching a marker never leaves the map; only the
 * card does. A stack of listings on one point pages through them here rather
 * than zooming into a point that will never separate.
 */
export function MapListingPreview({
  listings,
  index,
  loading,
  failed,
  savedIds,
  onSave,
  onStep,
  onClose,
  onRetry,
  onOpen,
  variant,
}: {
  listings: Listing[];
  index: number;
  loading: boolean;
  failed: boolean;
  savedIds: ReadonlySet<string>;
  /** Absent when there is no account to save against. */
  onSave?: (listing: Listing) => void;
  onStep: (next: number) => void;
  onClose: () => void;
  onRetry: () => void;
  /** Called as the tenant leaves for the listing, to keep their place. */
  onOpen: (listing: Listing) => void;
  variant: "popup" | "sheet";
}) {
  const listing = listings[index] ?? null;
  const count = listings.length;

  return (
    <article className={`explore-preview is-${variant}`} aria-live="polite" aria-busy={loading}>
      {loading && !listing ? (
        <div className="explore-preview-skeleton" aria-label="Loading this rental">
          <span className="explore-preview-photo" />
          <span className="explore-preview-lines"><span /><span /><span /></span>
        </div>
      ) : failed && !listing ? (
        <div className="explore-preview-failed">
          <p>We could not load this rental.</p>
          <button type="button" className="explore-text-button" onClick={onRetry}>Try again</button>
        </div>
      ) : listing ? (
        <PreviewBody listing={listing} saved={savedIds.has(listing.id)} onSave={onSave} onOpen={onOpen} />
      ) : (
        <div className="explore-preview-failed">
          <p>This rental is no longer available.</p>
        </div>
      )}

      <button type="button" className="explore-preview-close" aria-label="Close preview" onClick={onClose}>
        <Icon name="close" />
      </button>

      {count > 1 ? (
        <div className="explore-preview-pager">
          <button
            type="button"
            aria-label="Previous rental here"
            onClick={() => onStep((index - 1 + count) % count)}
          ><Icon name="chevron-down" /></button>
          <span>{index + 1} of {count} here</span>
          <button
            type="button"
            aria-label="Next rental here"
            onClick={() => onStep((index + 1) % count)}
          ><Icon name="chevron-down" /></button>
        </div>
      ) : null}
    </article>
  );
}

function PreviewBody({
  listing,
  saved,
  onSave,
  onOpen,
}: {
  listing: Listing;
  saved: boolean;
  onSave?: (listing: Listing) => void;
  onOpen: (listing: Listing) => void;
}) {
  const photo = listing.card_media?.find((item) => item.download_url)?.download_url ?? listing.cover_url;
  const where = [listing.locality_name, listing.district_name].filter(Boolean).join(", ") || "Ghana";
  const kind = [
    typeof listing.bedrooms === "number" && listing.bedrooms > 0 ? `${listing.bedrooms}-bed` : null,
    listing.space_type ? spaceLabel(listing.space_type) : null,
  ].filter(Boolean).join(" ");
  const href = `/listings/${listing.id}` as never;

  return (
    <div className="explore-preview-body">
      <Link href={href} className="explore-preview-link" onClick={() => onOpen(listing)}>
        <span className="explore-preview-photo">
          {photo ? (
            // Short-lived signed storage URLs, loaded directly as the cards do.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" loading="lazy" draggable={false} />
          ) : (
            <span className="explore-preview-photo-empty"><Icon name="photos" /></span>
          )}
        </span>
        <span className="explore-preview-copy">
          <span className="explore-preview-price">
            {listing.rent_formatted ?? "Rent unavailable"}
            {listing.rent_formatted ? <span> / {listing.rent_period === "yearly" ? "year" : "month"}</span> : null}
          </span>
          {kind ? <span className="explore-preview-kind">{kind}</span> : null}
          <span className="explore-preview-headline">{listing.headline}</span>
          <span className="explore-preview-where"><Icon name="pin" />{where}</span>
        </span>
        <span className="explore-preview-go" aria-hidden="true"><Icon name="chevron-down" /></span>
      </Link>
      {onSave ? (
        <button
          type="button"
          className="explore-preview-save"
          aria-pressed={saved}
          aria-label={saved ? `Remove ${listing.headline} from saved` : `Save ${listing.headline}`}
          onClick={() => onSave(listing)}
        >
          <Icon name={saved ? "heart-filled" : "heart"} />
        </button>
      ) : null}
    </div>
  );
}

function spaceLabel(value: string): string {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toLocaleLowerCase("en-GH") + text.slice(1);
}
