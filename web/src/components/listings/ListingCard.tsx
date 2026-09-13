"use client";

import Link from "next/link";
import { useRef, useState, type PointerEvent } from "react";

import { Icon } from "@/components/portal/icons";
import type { Listing } from "@/lib/console";

/**
 * The shared recognition card for Explore, Saved and related rentals.
 *
 * Its reading order is deliberate: image → rent/advance → identity → place →
 * essentials → trust. Search data is enough; the card never fetches detail or
 * reconstructs a Property/Unit relationship in the client.
 */
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
  const photos = cardPhotos(listing);
  const [activePhoto, setActivePhoto] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pointerStart = useRef<number | null>(null);
  const didSwipe = useRef(false);
  const cover = photos[activePhoto]?.download_url ?? photos[0]?.download_url ?? null;
  const where = [listing.locality_name, listing.district_name].filter(Boolean).join(", ");
  const facts = essentialFacts(listing);
  const verified = listing.trust_stamps.identity.state === "verified"
    && listing.trust_stamps.property.state === "verified";
  const href = `/listings/${listing.id}` as never;

  function showPhoto(index: number) {
    if (!photos.length) return;
    setActivePhoto((index + photos.length) % photos.length);
  }

  function startSwipe(event: PointerEvent<HTMLAnchorElement>) {
    pointerStart.current = event.clientX;
    didSwipe.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSwipe(event: PointerEvent<HTMLAnchorElement>) {
    if (pointerStart.current === null) return;
    setDragOffset(event.clientX - pointerStart.current);
  }

  function finishSwipe(event: PointerEvent<HTMLAnchorElement>) {
    if (pointerStart.current === null) return;
    const distance = event.clientX - pointerStart.current;
    pointerStart.current = null;
    setDragging(false);
    setDragOffset(0);
    didSwipe.current = Math.abs(distance) > 6;
    if (Math.abs(distance) >= 34 && photos.length > 1) {
      showPhoto(activePhoto + (distance < 0 ? 1 : -1));
    }
  }

  function cancelSwipe() {
    pointerStart.current = null;
    setDragging(false);
    setDragOffset(0);
  }

  return (
    <li className="listing-card card-interactive">
      <div className="listing-card-photo media">
        <Link
          href={href}
          className={`listing-card-photo-link${dragging ? " is-dragging" : ""}`}
          aria-label={`Open ${listing.headline}`}
          draggable={false}
          onPointerDown={startSwipe}
          onPointerMove={moveSwipe}
          onPointerUp={finishSwipe}
          onPointerCancel={cancelSwipe}
          onDragStart={(event) => event.preventDefault()}
          onClick={(event) => {
            if (didSwipe.current) {
              event.preventDefault();
              didSwipe.current = false;
              return;
            }
            onNavigate?.();
          }}
        >
          {cover ? (
            // Presigned storage URLs change often and may point to MinIO or S3;
            // the browser should load them directly rather than re-optimising
            // every signature through Next Image.
            <span
              className="listing-photo-track"
              style={{ transform: `translate3d(calc(${-activePhoto * 100}% + ${dragOffset}px), 0, 0)` }}
            >
              {photos.map((photo) => (
                <span className="listing-photo-slide" key={photo.file_id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.download_url} alt="" loading="lazy" draggable={false} />
                </span>
              ))}
            </span>
          ) : (
            <span className="listing-photo-empty"><Icon name="photos" />Photo pending</span>
          )}
        </Link>

        {photos.length > 1 ? (
          <div
            className="listing-photo-dots"
            role="group"
            aria-label={`Photo ${activePhoto + 1} of ${photos.length}`}
          >
            {photos.map((photo, index) => (
              <button
              type="button"
                key={photo.file_id}
                data-current={index === activePhoto}
                aria-label={`Show photo ${index + 1}`}
                aria-current={index === activePhoto ? "true" : undefined}
                onClick={() => showPhoto(index)}
              />
            ))}
          </div>
        ) : null}

        {photos.length > 1 ? (
          <>
            <button
              type="button"
              className="listing-photo-control is-previous"
              aria-label="Previous photo"
              onClick={() => showPhoto(activePhoto - 1)}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              className="listing-photo-control is-next"
              aria-label="Next photo"
              onClick={() => showPhoto(activePhoto + 1)}
            >
              <span aria-hidden="true">›</span>
            </button>
          </>
        ) : null}

        {onSave ? (
          <button
            type="button"
            className="listing-save"
            aria-pressed={saved}
            aria-label={saved ? `Remove ${listing.headline} from saved` : `Save ${listing.headline}`}
            onClick={onSave}
          >
            <Icon name={saved ? "heart-filled" : "heart"} />
          </button>
        ) : null}
      </div>

      <div className="listing-card-body">
        <div className="listing-card-price-row">
          <p className="listing-price">
            {listing.rent_formatted ?? "Rent unavailable"}
            {listing.rent_formatted ? <span> / {rentPeriod(listing.rent_period)}</span> : null}
          </p>
          <p className="listing-advance">{advanceTerm(listing.advance_label)}</p>
        </div>

        <h3 className="listing-card-headline">
          <Link href={href} onClick={onNavigate}>{listing.headline}</Link>
        </h3>

        <p className="listing-card-where">
          <Icon name="pin" />
          <span>{where || "Ghana"}</span>
        </p>

        {facts.length ? (
          <ul className="listing-card-facts" aria-label="Rental essentials">
            {facts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        ) : null}

        {verified ? (
          <div className="listing-card-trust">
            <span className="listing-verified"><Icon name="verification" />Verified rental</span>
            {listing.provider_label ? <span>{listing.provider_label}</span> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function cardPhotos(listing: Listing) {
  const photos = listing.card_media?.filter((item) => Boolean(item.download_url)) ?? [];
  if (photos.length || !listing.cover_url) return photos;
  return [{ file_id: `cover-${listing.id}`, caption: "", download_url: listing.cover_url }];
}

function essentialFacts(listing: Listing): string[] {
  return [
    listing.bedrooms === 0
      ? "Single room"
      : typeof listing.bedrooms === "number"
        ? `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"}`
        : null,
    typeof listing.bathrooms === "number" && listing.bathrooms > 0
      ? `${listing.bathrooms} bath${listing.bathrooms === 1 ? "" : "s"}`
      : null,
    typeof listing.is_furnished === "boolean"
      ? listing.is_furnished ? "Furnished" : "Unfurnished"
      : null,
  ].filter((fact): fact is string => Boolean(fact));
}

function advanceTerm(label: string): string {
  if (!label || label.toLocaleLowerCase("en-GH").startsWith("no advance")) return "No advance";
  return `${label} advance`;
}

function rentPeriod(period: string): string {
  return ({ monthly: "month", yearly: "year", weekly: "week", daily: "day" } as Record<string, string>)[period]
    ?? period.replaceAll("_", " ");
}
