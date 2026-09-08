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
    <li className="listing-card card-interactive">
      <div className="listing-card-photo media media-4x3">
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

        {/* Verification rides on the photograph, where the eye already is, and
            reads against any picture because it carries its own dark ground. */}
        {verified ? (
          <span className="tag tag-onmedia listing-card-badge">
            <Icon name="verification" />
            Verified
          </span>
        ) : null}

        {onSave ? (
          <button
            type="button"
            className="listing-save"
            aria-pressed={saved}
            aria-label={saved ? `Remove ${listing.headline} from saved` : `Save ${listing.headline}`}
            onClick={onSave}
          >
            {/* Was a bare "♥"/"♡" text character, which renders in whatever
                emoji or symbol font the device falls back to and sat next to a
                set of matched 1.5px line icons looking borrowed. */}
            <Icon name={saved ? "heart-filled" : "heart"} />
          </button>
        ) : null}
      </div>

      <div className="listing-card-body">
        {/* The rent is what the card is for, so it is set in the display face
            and given the line to itself. Tabular figures so a column of cards
            aligns down the page instead of shimmering. */}
        <p className="listing-price">
          {listing.rent_formatted} <span>/ month</span>
        </p>
        <p className="type-body-strong listing-card-headline">
          <Link href={href} onClick={onNavigate}>{listing.headline}</Link>
        </p>
        <p className="listing-card-where">
          <Icon name="pin" />
          {where || "Ghana"}
        </p>
        {facts ? <p className="listing-card-facts">{facts}</p> : null}
        <p className="listing-card-terms">
          <span className="listing-advance">{listing.advance_label} advance</span>
        </p>
      </div>
    </li>
  );
}
