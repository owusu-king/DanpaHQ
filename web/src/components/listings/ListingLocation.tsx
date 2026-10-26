"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

import { Icon } from "@/components/portal/icons";
import type { Listing } from "@/lib/console";

const LocationMap = dynamic(
  () => import("./ListingLocationMap").then((module) => module.ListingLocationMap),
  { ssr: false, loading: () => <div className="listing-location-map is-loading" aria-hidden="true" /> },
);

/**
 * Where a rental is — as closely as the product publishes, and no closer.
 *
 * The point and how precise it is are the backend's decision
 * (`apps.listing.location`, ADR 0033): a snapped cell about 300 m across, or the
 * neighbourhood's centre. This section draws what it is given as an area, never
 * a pin on a door, and says in words how approximate it is. The street, house
 * number and directions arrive with a confirmed viewing, not on this page.
 *
 * It is the section a card's address opens (`/listings/<id>#location`). The page
 * renders after its data arrives, so the browser's own jump to the fragment has
 * already happened on an empty page; the section makes it again once it exists.
 */
export function ListingLocation({ listing, where, landmark }: {
  listing: Listing;
  where: string;
  landmark: string;
}) {
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.location.hash !== "#location") return;
    // Instant, as an anchor is: the site's smooth scrolling would animate down
    // the whole page on arrival, and does not move a tab that is not being shown.
    section.current?.scrollIntoView({ block: "start", behavior: "instant" });
    section.current?.focus({ preventScroll: true });
  }, []);

  const location = listing.public_location;
  const note = !location
    ? "This rental does not have a map position yet. The area above is where it is listed."
    : location.precision === "area"
      ? `Shown within about ${location.radius_m} metres. The exact address is shared once a viewing is confirmed.`
      : `Shown at the centre of ${listing.locality_name ?? "its neighbourhood"}. The exact address is shared once a viewing is confirmed.`;

  return (
    <section
      ref={section}
      id="location"
      tabIndex={-1}
      className="listing-section listing-location"
      aria-labelledby="listing-location-title"
    >
      <h2 id="listing-location-title" className="listing-section-title">
        <span aria-hidden="true"><Icon name="map" /></span>
        Location
      </h2>
      <p className="listing-location-where">
        <Icon name="pin" />
        <span>{where || "Ghana"}{landmark ? ` · near ${landmark}` : ""}</span>
      </p>
      {location ? (
        <LocationMap
          latitude={location.latitude}
          longitude={location.longitude}
          radius={location.radius_m}
          precision={location.precision}
          label={`Approximate location of ${listing.headline}`}
        />
      ) : null}
      <p className="listing-location-note">
        <Icon name="info" />
        <span>{note}</span>
      </p>
    </section>
  );
}
