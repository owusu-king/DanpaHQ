import Link from "next/link";

import { Icon } from "@/components/portal/icons";
import type { Listing } from "@/lib/console";

/** The shared visual identity of a rental in Explore and related results. */
export function ListingCard({
  listing,
  saved = false,
  onSave,
  onNavigate,
}: {
  listing: Listing;
  saved?: boolean;
  onSave?: () => void;
  /** Lets Explore preserve its exact return position before leaving. */
  onNavigate?: () => void;
}) {
  const cover = listing.cover_url
    ?? listing.media.find((item) => item.is_cover)?.download_url
    ?? listing.media[0]?.download_url;
  const where = [listing.locality_name, listing.district_name].filter(Boolean).join(", ");
  const facts = [
    listing.bedrooms === 0 ? "Single room" : listing.bedrooms ? `${listing.bedrooms} bed` : null,
    listing.is_furnished ? "Furnished" : null,
  ].filter(Boolean).join(" · ");
  const verified = listing.trust_stamps.identity.state === "verified"
    && listing.trust_stamps.property.state === "verified";
  const href = `/listings/${listing.id}` as never;

  return (
    <li className="listing-card">
      <div className="listing-card-photo">
        <Link
          href={href}
          className="listing-card-photo-link"
          aria-label={`Open ${listing.headline}`}
          onClick={onNavigate}
        >
          {cover ? (
            // Active marketing photos use short-lived anonymous URLs. Evidence can never enter listing media.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" />
          ) : (
            <span>Photo pending</span>
          )}
        </Link>
        {onSave ? (
          <button
            type="button"
            className="listing-save"
            aria-pressed={saved}
            aria-label={saved ? `Remove ${listing.headline} from saved` : `Save ${listing.headline}`}
            onClick={onSave}
          >{saved ? "♥" : "♡"}</button>
        ) : null}
      </div>
      <div className="listing-card-body">
        <p className="listing-price">
          {listing.rent_formatted} <span>/ month</span>
        </p>
        <p className="type-body-strong">
          <Link href={href} onClick={onNavigate}>{listing.headline}</Link>
        </p>
        <p className="listing-card-where">
          <Icon name="pin" />
          {where || "Ghana"}
        </p>
        {facts ? <p className="listing-facts">{facts}</p> : null}

        {/* Trust and cost on one line. They were stacked, which gave a card two
            more short rows and read as a list of loose facts; side by side they
            are the two things a tenant weighs against each other before opening
            anything. The shield is the same glyph verification wears in the
            navigation, so the mark means one thing across the product. */}
        <p className="listing-card-terms">
          {verified ? (
            <span className="listing-verified">
              <Icon name="verification" />
              Verified
            </span>
          ) : null}
          <span className="listing-advance">{listing.advance_label} advance</span>
        </p>
      </div>
    </li>
  );
}
