"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { Stamp } from "@/components/Stamp";
import { ListingCard } from "@/components/listings/ListingCard";
import { ListingLocation } from "@/components/listings/ListingLocation";
import { ApiFailure } from "@/lib/api";
import { isLive } from "@/lib/applicationMeaning";
import {
  getPublicListing,
  getRelatedListings,
  requestPublicViewing,
  savePublicListing,
  unsavePublicListing,
  type ListingDetail,
} from "@/lib/listings";
import { useSession } from "@/lib/session";
import { listMyApplications, listMyViewings, listSavedListings } from "@/lib/tenant";

/**
 * The page a tenant decides on.
 *
 * Glance → understand → decide → act. Photographs lead because that is how
 * anyone recognizes a place; the rent and the terms sit in a panel that follows
 * the decision down the page; every other answer is one scannable line.
 *
 * Two rules shape what is *not* here. Nothing is said twice — the locality is
 * stated once, the rent once, the availability once. And the street, house
 * number and entrance note are never on this page at all: the backend releases
 * those when a viewing is confirmed, which is a domain rule this page reflects
 * rather than explains.
 */
export default function PublicListingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { state } = useSession();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [related, setRelated] = useState<Awaited<ReturnType<typeof getRelatedListings>> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "viewing" | null>(null);
  const [application, setApplication] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingViewing, setConfirmingViewing] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<"shared" | "copied" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const signedIn = state.status === "signed_in";

  useEffect(() => {
    let current = true;
    setListing(null);
    setRelated(null);
    setError("");
    getPublicListing(params.id)
      .then((value) => { if (current) setListing(value); })
      .catch((cause) =>
        current && setError(cause instanceof ApiFailure ? cause.error.message : "We could not find that listing."),
      );
    getRelatedListings(params.id)
      .then((value) => { if (current) setRelated(value); })
      .catch(() => { if (current) setRelated([]); });
    return () => { current = false; };
  }, [params.id]);

  // What has already happened between this tenant and this listing. Without it
  // the page keeps offering "Request a viewing" to someone who has one booked.
  useEffect(() => {
    if (!signedIn || !listing) { setApplication(null); setViewing(null); setSaved(false); return; }
    void Promise.allSettled([listMyApplications(), listMyViewings(), listSavedListings()])
      .then(([applications, viewings, savedRows]) => {
        if (applications.status === "fulfilled") {
          // The rule lives in `applicationMeaning`, not here. Written out
          // by hand this missed that an accepted application stops blocking
          // once its tenancy ends.
          setApplication(applications.value.find((item) =>
            item.unit_id === listing.space.id && isLive(item),
          )?.status ?? null);
        }
        if (viewings.status === "fulfilled") {
          setViewing(viewings.value.find((item) =>
            item.listing_id === listing.id
            && ["requested", "offered", "confirmed"].includes(item.status),
          )?.status ?? null);
        }
        if (savedRows.status === "fulfilled") {
          setSaved(savedRows.value.some((row) => row.listing.id === listing.id));
        }
      });
  }, [listing, signedIn]);

  if (error && !listing) {
    return <main className="listing"><Notice tone="error" title={error} /></main>;
  }
  if (!listing) {
    return <main className="listing"><p className="type-caption">Loading…</p></main>;
  }

  const space = listing.space;
  const place = listing.property_context;
  const where = [place.locality_name, place.district_name].filter(Boolean).join(", ");
  const photos = listing.gallery.filter((photo) => photo.download_url);
  const taken = listing.status !== "active";

  const facts = [
    space.space_type_label,
    space.bedrooms === 0 ? "Single room" : `${space.bedrooms} bedroom${space.bedrooms === 1 ? "" : "s"}`,
    space.bathrooms ? `${space.bathrooms} bathroom${space.bathrooms === 1 ? "" : "s"}` : null,
    space.is_furnished ? "Furnished" : null,
    space.has_private_bathroom ? "Private bath" : null,
    space.has_private_kitchen ? "Private kitchen" : null,
    space.has_air_conditioning ? "Air conditioning" : null,
  ].filter(Boolean) as string[];

  const longDescription = space.description.length > 320;
  const verified = space.verification.checked && place.authority.state === "verified";

  function requireAccount(next: string) {
    router.push(`/sign-in?workspace=tenant&next=${encodeURIComponent(next)}` as never);
  }

  async function toggleSave() {
    if (!signedIn) return requireAccount(`/listings/${listing!.id}`);
    const was = saved;
    setSaved(!was);
    try {
      await (was ? unsavePublicListing(listing!.id) : savePublicListing(listing!.id));
    } catch {
      setSaved(was);
    }
  }

  async function shareListing() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: listing?.headline ?? "Rooomly rental",
          text: listing?.headline ?? "A rental on Rooomly",
          url,
        });
        setShareFeedback("shared");
      } else {
        await navigator.clipboard.writeText(url);
        setShareFeedback("copied");
      }
      window.setTimeout(() => setShareFeedback(null), 2000);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError("We could not open sharing. Please try again.");
    }
  }

  async function requestViewing() {
    if (viewing) { router.push("/viewings"); return; }
    if (!signedIn) return requireAccount(`/listings/${listing!.id}`);
    setBusy("viewing");
    setError("");
    try {
      await requestPublicViewing(listing!.id);
      setViewing("requested");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not send your request.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="listing">
      <p><Link href="/rentals" className="listing-back">← Keep looking</Link></p>

      {/* A preview, not the exploration. Three photographs at a capped height,
          and one plainly named way into the rest. */}
      {photos.length ? (
        <div className="listing-photos">
          <div className={`listing-gallery${photos.length === 1 ? " listing-gallery-solo" : ""}`}>
            {photos.slice(0, 3).map((photo, index) => (
              <button
                key={photo.id}
                type="button"
                aria-label={`Open photographs at ${index + 1} of ${photos.length}`}
                onClick={() => setLightbox(index)}
              >
                {/* Short-lived signed URLs from the files service. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.download_url ?? ""} alt={photo.caption || listing.headline} />
              </button>
            ))}
          </div>
          {photos.length > 1 ? (
            <button type="button" className="listing-gallery-all" onClick={() => setLightbox(0)}>
              View all {photos.length} photos
            </button>
          ) : null}
        </div>
      ) : (
        <div className="listing-gallery-empty"><span className="type-caption">Photos pending</span></div>
      )}

      <div className="listing-body">
        <div className="listing-main">
          <header className="listing-head">
            <h1>{listing.headline}</h1>
            <p>{where || "Ghana"}{place.landmark ? ` · near ${place.landmark}` : ""}</p>
          </header>

          <ul className="listing-facts">
            {facts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>

          {space.amenities.length ? (
            <section className="listing-section">
              <h2>What this space has</h2>
              <ul className="listing-tags">
                {space.amenities.map((row) => <li key={row.id} className="listing-tag">{row.name}</li>)}
              </ul>
            </section>
          ) : null}

          {space.description ? (
            <section className="listing-section">
              <h2>About this place</h2>
              <p className="type-body">
                {longDescription && !expanded ? `${space.description.slice(0, 320).trimEnd()}…` : space.description}
              </p>
              {longDescription ? (
                <button type="button" className="listing-readmore" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? "Show less" : "Read more"}
                </button>
              ) : null}
            </section>
          ) : null}

          <section className="listing-section listing-where">
            <h2>The property</h2>
            <p className="type-caption">
              {place.title} · {place.property_type_label}
              {place.region_name ? ` · ${place.region_name}` : ""}
            </p>
            {/* The Ghana facts that decide what living here costs and feels
                like. Each is one choice from a fixed set, so each is one line. */}
            <dl>
              <div><dt>Water</dt><dd>{place.features.water_source_label}</dd></div>
              <div><dt>Power</dt><dd>{place.features.power_meter_label}</dd></div>
              <div><dt>Compound</dt><dd>{place.features.compound_label}</dd></div>
              <div><dt>Security</dt><dd>{place.features.has_security ? "On site" : place.features.is_gated ? "Gated" : "None stated"}</dd></div>
            </dl>
            {place.amenities.length ? (
              <ul className="listing-tags" style={{ marginTop: "var(--space-3)" }}>
                {place.amenities.map((row) => <li key={row.id} className="listing-tag">{row.name}</li>)}
              </ul>
            ) : null}
          </section>

          <ListingLocation listing={listing} where={where} landmark={place.landmark} />
        </div>

        <aside className="listing-panel">
          <div>
            <p className="listing-rent">{listing.rent_formatted} <span>/ month</span></p>
            <p className={`listing-status ${taken ? "is-taken" : "is-available"}`}>
              {taken ? "No longer available" : "Available now"}
            </p>
          </div>

          <dl className="listing-terms">
            <div><dt>Advance</dt><dd>{listing.advance_label}</dd></div>
            {listing.caution_months ? (
              <div><dt>Deposit</dt><dd>{listing.caution_months} months</dd></div>
            ) : null}
            {listing.agency_fee_months ? (
              <div><dt>Agency fee</dt><dd>{listing.agency_fee_months} months</dd></div>
            ) : null}
            <div>
              <dt>To move in</dt>
              <dd>GH₵{(listing.total_move_in_minor / 100).toLocaleString("en-GH")}</dd>
            </div>
          </dl>

          {error ? <Notice tone="error" title={error} /> : null}

          {taken ? (
            <p className="type-caption">This place has been taken. Keep looking for something similar.</p>
          ) : (
            <div className="listing-actions">
              {/* Applying leads. It is the thing this page exists to produce,
                  and it was the secondary button under a viewing request. */}
              <Button
                onClick={() => {
                  if (application) { router.push("/applications"); return; }
                  const next = `/apply/${listing.id}`;
                  if (!signedIn) return requireAccount(next);
                  router.push(next as never);
                }}
              >{application ? "Application sent — open it" : "Apply to rent"}</Button>

              {/* A viewing request reaches a real person and cannot be taken
                  back, and it used to be sent by a single click on the most
                  prominent button on the page. It now asks. */}
              {viewing ? (
                <Button variant="secondary" onClick={() => router.push("/viewings")}>
                  {viewing === "confirmed" ? "Viewing confirmed — open it" : "Viewing requested — open it"}
                </Button>
              ) : confirmingViewing ? (
                <div className="listing-confirm">
                  <p className="type-caption">
                    Send a viewing request? {listing.provider_label} sees your name and phone
                    number, and replies with times.
                  </p>
                  <div className="listing-confirm-actions">
                    <Button busy={busy === "viewing"} onClick={() => void requestViewing()}>
                      Yes, send it
                    </Button>
                    <Button
                      variant="quiet"
                      disabled={busy === "viewing"}
                      onClick={() => setConfirmingViewing(false)}
                    >Not now</Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!signedIn) return requireAccount(`/listings/${listing.id}`);
                    setConfirmingViewing(true);
                  }}
                >Request a viewing</Button>
              )}

              <div className="listing-secondary">
                {/* `aria-pressed` is the toggle's real state, and it is what
                    fills the bookmark — so the mark and the announcement come
                    from one source rather than drifting apart. */}
                <Button
                  variant="quiet"
                  aria-pressed={saved}
                  onClick={() => void toggleSave()}
                >
                  <Icon name="bookmark" />
                  {saved ? "Saved" : "Save"}
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => void shareListing()}
                >
                  <Icon name="share" />
                  {shareFeedback === "shared" ? "Shared" : shareFeedback === "copied" ? "Link copied" : "Share"}
                </Button>
              </div>
            </div>
          )}

          {/* Stated, not hidden behind a disclosure. Three stamps and one
              line is short enough to read at a glance, and a dropdown made the
              reader open something to find out whether to trust the listing —
              which is the question they came with. */}
          <section className="listing-trust" aria-labelledby="listing-trust-title">
            <p className="listing-trust-title" id="listing-trust-title">
              <Icon name="verification" />
              {verified ? "Verified rental" : "Verification"}
            </p>
            <div className="listing-trust-stamps">
              <Stamp state={listing.trust_stamps.identity.state} what="Identity" />
              <Stamp state={place.authority.state} what={listing.provider_label} />
              <Stamp state={space.verification.checked ? "verified" : "unverified"} what="This space" />
            </div>
            <p className="type-caption">
              {listing.trust_stamps.relationship === "owner"
                ? "Checked as this property's owner."
                : "Checked as an authorized representative."}
            </p>
          </section>
        </aside>

        {/* Keep discovery inside the same grid as the decision panel. This gives
            the sticky panel a real containing area to travel through; when this
            section lived after `.listing-body`, the panel and its parent were
            often exactly the same height, so `position: sticky` had no effect. */}
        {related?.length ? (
          <section className="listing-related" aria-labelledby="related-rentals-title">
            <header>
              <h2 id="related-rentals-title">Related rentals</h2>
              <p>Nearby options at a similar rent.</p>
            </header>
            <ul className="listing-related-grid">
              {related.map((item) => <ListingCard key={item.id} listing={item} />)}
            </ul>
          </section>
        ) : null}
      </div>

      <Lightbox
        photos={photos}
        index={lightbox}
        onClose={() => setLightbox(null)}
        onMove={(next) => setLightbox(next)}
      />
    </main>
  );
}

/**
 * Where photographs are actually explored.
 *
 * One large image with restrained steppers, and a strip of every photograph
 * underneath, so reaching the eighth is one click rather than seven. The
 * backend orders the Unit's own photographs first and the building after; the
 * strip marks that change once instead of labelling every thumbnail.
 */
function Lightbox({
  photos,
  index,
  onClose,
  onMove,
}: {
  photos: ListingDetail["gallery"];
  index: number | null;
  onClose: () => void;
  onMove: (index: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (index !== null && !dialog.open) dialog.showModal();
    if (index === null && dialog.open) dialog.close();
  }, [index]);

  // Stepping past the edge of the strip should not leave the current
  // photograph off screen.
  useEffect(() => {
    if (index === null) return;
    strip.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);

  const photo = index === null ? null : photos[index];
  const step = (by: number) => onMove(((index ?? 0) + by + photos.length) % photos.length);
  const secondGroup = photos.findIndex((row) => row.source_label !== photos[0]?.source_label);

  return (
    <dialog
      ref={ref}
      className="listing-lightbox"
      aria-label="Photographs"
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === ref.current) onClose(); }}
      onKeyDown={(event) => {
        if (index === null) return;
        if (event.key === "ArrowRight") step(1);
        if (event.key === "ArrowLeft") step(-1);
      }}
    >
      {photo ? (
        <>
          <div className="listing-lightbox-stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.download_url ?? ""} alt={photo.caption || photo.source_label} />
            {photos.length > 1 ? (
              <>
                <button type="button" className="listing-lightbox-step is-prev" aria-label="Previous photo" onClick={() => step(-1)}>‹</button>
                <button type="button" className="listing-lightbox-step is-next" aria-label="Next photo" onClick={() => step(1)}>›</button>
              </>
            ) : null}
          </div>

          <div className="listing-lightbox-bar">
            <span className="type-caption" style={{ color: "inherit" }}>
              {photo.source_label} · {index! + 1} of {photos.length}
            </span>
            <button type="button" aria-label="Close photographs" onClick={onClose}>✕</button>
          </div>

          {photos.length > 1 ? (
            <div className="listing-lightbox-thumbs" ref={strip}>
              {photos.map((row, position) => (
                <button
                  key={row.id}
                  type="button"
                  className={`listing-lightbox-thumb${position === secondGroup ? " starts-group" : ""}`}
                  aria-current={position === index}
                  aria-label={`${row.source_label}. Photo ${position + 1} of ${photos.length}`}
                  onClick={() => onMove(position)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={row.download_url ?? ""} alt="" />
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
