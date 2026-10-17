"use client";

/**
 * A property for sale, as a buyer decides on it.
 *
 * The same shape as a rental's page — photographs, then what it is, then where —
 * with the price and one action in the panel beside it. The action is an
 * enquiry, never a phone number: the seller's contact stays private, and the
 * conversation happens in Enquiries (owner, 2026-09-28).
 *
 * Everything on this page is public only because its verification is current;
 * the backend answers 404 for anything else, so this page never has to decide.
 * The exact address is not here either — only the area.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuthDialog } from "@/components/auth/AuthDialog";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { ApiFailure } from "@/lib/api";
import { getSale, saleFacts, startEnquiry, type SaleDetail, type SalePhoto } from "@/lib/sales";
import { useSession } from "@/lib/session";

const LocationMap = dynamic(
  () => import("@/components/listings/ListingLocationMap").then((module) => module.ListingLocationMap),
  { ssr: false, loading: () => <div className="listing-location-map is-loading" aria-hidden="true" /> },
);

export default function SalePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { open: openAuth } = useAuthDialog();
  const { state } = useSession();
  const signedIn = state.status === "signed_in";
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    if (state.status === "loading") return;
    let current = true;
    setError("");
    getSale(params.id, signedIn)
      .then((value) => { if (current) setSale(value); })
      .catch((cause) => {
        if (current) setError(cause instanceof ApiFailure ? cause.error.message : "We could not find that property.");
      });
    return () => { current = false; };
  }, [params.id, signedIn, state.status]);

  if (error && !sale) {
    return (
      <main className="listing">
        <p><Link href={"/rentals?mode=buy" as never} className="listing-back">← Keep looking</Link></p>
        <Notice tone="error" title={error} body="It may have been sold or taken off the market." />
      </main>
    );
  }
  if (!sale) return <main className="listing"><p className="type-caption">Loading…</p></main>;

  const where = [sale.locality_name, sale.district_name].filter(Boolean).join(", ");
  const photos = sale.gallery.filter((photo) => photo.download_url);
  const land = sale.kind === "land";
  const facts = [
    sale.kind_label,
    ...saleFacts(sale),
    sale.tenure_label
      ? sale.tenure === "leasehold" && sale.lease_years_remaining
        ? `Leasehold · ${sale.lease_years_remaining} years left`
        : sale.tenure_label
      : null,
    land && sale.is_serviced ? "Serviced plot" : null,
  ].filter(Boolean) as string[];
  const longDescription = sale.description.length > 420;
  const next = `/sales/${sale.id}`;

  async function send() {
    if (!signedIn) {
      openAuth("sign-in", { next });
      return;
    }
    const body = message.trim();
    if (body.length < 10) {
      setError("Say a little more — at least a sentence the seller can answer.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const enquiry = await startEnquiry(sale!.id, body);
      router.push(`/enquiries/${enquiry.id}` as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not send your enquiry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="listing">
      <p><Link href={"/rentals?mode=buy" as never} className="listing-back">← Keep looking</Link></p>

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
                <img src={photo.download_url} alt={photo.caption || sale.headline} />
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
            <span className="sale-eyebrow">For sale</span>
            <h1>{sale.headline || `${sale.kind_label} for sale`}</h1>
            <p>{where || "Ghana"}{sale.landmark ? ` · near ${sale.landmark}` : ""}</p>
          </header>

          <ul className="listing-facts">
            {facts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>

          {sale.description ? (
            <section className="listing-section">
              <h2>About this {land ? "land" : "property"}</h2>
              <p className="type-body" style={{ whiteSpace: "pre-line" }}>
                {longDescription && !expanded ? `${sale.description.slice(0, 420).trimEnd()}…` : sale.description}
              </p>
              {longDescription ? (
                <button type="button" className="listing-readmore" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? "Show less" : "Read more"}
                </button>
              ) : null}
            </section>
          ) : null}

          {sale.features ? (
            <section className="listing-section listing-where">
              <h2>The building</h2>
              <dl>
                <div><dt>Water</dt><dd>{sale.features.water_source_label}</dd></div>
                <div><dt>Power</dt><dd>{sale.features.power_meter_label}</dd></div>
                <div><dt>Compound</dt><dd>{sale.features.compound_label}</dd></div>
                <div><dt>Security</dt><dd>{sale.features.has_security ? "On site" : sale.features.is_gated ? "Gated" : "None stated"}</dd></div>
              </dl>
              {sale.amenities.length ? (
                <ul className="listing-tags" style={{ marginTop: "var(--space-3)" }}>
                  {sale.amenities.map((row) => <li key={row.id} className="listing-tag">{row.name}</li>)}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section className="listing-section listing-location" aria-labelledby="sale-location-title">
            <h2 id="sale-location-title">Location</h2>
            <p className="listing-location-where">
              <Icon name="pin" />
              <span>{[where, sale.region_name].filter(Boolean).join(" · ") || "Ghana"}</span>
            </p>
            {sale.location ? (
              <LocationMap
                latitude={sale.location.latitude}
                longitude={sale.location.longitude}
                radius={sale.location.radius_m}
                precision={sale.location.precision}
                label={`Approximate location of ${sale.headline}`}
              />
            ) : null}
            <p className="listing-location-note">
              <Icon name="info" />
              <span>The area only. The seller shares the exact location when you arrange to see it.</span>
            </p>
          </section>
        </div>

        <aside className="listing-panel">
          <div>
            <p className="listing-rent">{sale.price_formatted ?? "Price on request"}</p>
            <p className="listing-status is-available">
              {sale.price_negotiable ? "Price negotiable" : "Asking price"}
            </p>
          </div>

          <dl className="listing-terms">
            <div><dt>What it is</dt><dd>{sale.kind_label}</dd></div>
            {sale.tenure_label ? <div><dt>Tenure</dt><dd>{sale.tenure_label}</dd></div> : null}
            <div><dt>Sold by</dt><dd>{sale.seller_label}</dd></div>
          </dl>

          {error ? <Notice tone="error" title={error} /> : null}

          <div className="listing-actions">
            {sale.my_enquiry_id ? (
              <Button onClick={() => router.push(`/enquiries/${sale.my_enquiry_id}` as never)}>
                Open your enquiry
              </Button>
            ) : writing ? (
              <div className="sale-enquiry">
                <label htmlFor="sale-enquiry-message" className="type-caption">
                  Your message to {sale.seller_label}
                </label>
                <textarea
                  id="sale-enquiry-message"
                  rows={4}
                  maxLength={2000}
                  value={message}
                  placeholder="Is it still available? When could I see it?"
                  onChange={(event) => setMessage(event.target.value)}
                />
                <p className="type-caption">Your name goes with it. Your phone number does not.</p>
                <div className="listing-confirm-actions">
                  <Button busy={busy} busyLabel="Sending…" onClick={() => void send()}>
                    Send enquiry
                  </Button>
                  <Button variant="quiet" disabled={busy} onClick={() => setWriting(false)}>Not now</Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={() => {
                  if (!signedIn) {
                    openAuth("sign-in", { next });
                    return;
                  }
                  setWriting(true);
                }}
              >
                Send an enquiry
              </Button>
            )}
          </div>

          <section className="listing-trust" aria-labelledby="sale-trust-title">
            <p className="listing-trust-title" id="sale-trust-title">
              <Icon name="verification" />
              Verified for sale
            </p>
            <p className="type-caption">
              Our team read the title and checked the seller may sell it. Still have a lawyer search the title before you pay anything.
            </p>
          </section>
        </aside>
      </div>

      <Lightbox photos={photos} index={lightbox} onClose={() => setLightbox(null)} onMove={setLightbox} />
    </main>
  );
}

/** Every photograph, one at a time — the rental page's viewer, without its groups. */
function Lightbox({
  photos,
  index,
  onClose,
  onMove,
}: {
  photos: SalePhoto[];
  index: number | null;
  onClose: () => void;
  onMove: (index: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (index !== null && !dialog.open) dialog.showModal();
    if (index === null && dialog.open) dialog.close();
  }, [index]);

  const photo = index === null ? null : photos[index];
  const step = (by: number) => onMove(((index ?? 0) + by + photos.length) % photos.length);

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
            <img src={photo.download_url} alt={photo.caption || "Photograph"} />
            {photos.length > 1 ? (
              <>
                <button type="button" className="listing-lightbox-step is-prev" aria-label="Previous photo" onClick={() => step(-1)}>‹</button>
                <button type="button" className="listing-lightbox-step is-next" aria-label="Next photo" onClick={() => step(1)}>›</button>
              </>
            ) : null}
          </div>
          <div className="listing-lightbox-bar">
            <span className="type-caption" style={{ color: "inherit" }}>
              {index! + 1} of {photos.length}
            </span>
            <button type="button" aria-label="Close photographs" onClick={onClose}>✕</button>
          </div>
          {photos.length > 1 ? (
            <div className="listing-lightbox-thumbs">
              {photos.map((row, position) => (
                <button
                  key={row.id}
                  type="button"
                  className="listing-lightbox-thumb"
                  aria-current={position === index}
                  aria-label={`Photo ${position + 1} of ${photos.length}`}
                  onClick={() => onMove(position)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={row.download_url} alt="" />
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
