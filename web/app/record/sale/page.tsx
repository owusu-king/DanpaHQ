"use client";

/**
 * A property for sale, as a buyer decides on it.
 *
 * The same shape as a rental's page — photographs, then what it is, then where —
 * with the price and one action in the panel beside it. The action is an
 * private enquiry: buyers choose what contact details to share with the seller.
 *
 * Everything on this page is public only because its verification is current;
 * the backend answers 404 for anything else, so this page never has to decide.
 * The exact address is not here either — only the area.
 */

import { VideoPlayer } from "@/components/property/WalkthroughVideo";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useAuthDialog } from "@/components/auth/AuthDialog";
import { usePageTitle } from "@/components/PageTitle";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { openEnquiries } from "@/components/enquiries/EnquiriesInbox";
import { Notice } from "@/components/Notice";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { PropertyAsk } from "@/components/listings/PropertyAsk";
import { saleIntelContext } from "@/lib/propertyIntel";
import { Icon } from "@/components/portal/icons";
import { ApiFailure } from "@/lib/api";
import { fieldErrorsFrom, summaryErrorFrom, type FieldErrors } from "@/lib/formErrors";
import { getSale, listSavedSales, saveSale, unsaveSale, saleFacts, startEnquiry, type SaleDetail, type SalePhoto } from "@/lib/sales";
import { useSession } from "@/lib/session";
import { exploreReturnPath, saleDetailPath } from "@/lib/exploreReturn";

const LocationMap = dynamic(
  () => import("@/components/listings/ListingLocationMap").then((module) => module.ListingLocationMap),
  { ssr: false, loading: () => <div className="listing-location-map is-loading" aria-hidden="true" /> },
);

export default function SalePage() {
  const search = useSearchParams();
  const id = search.get("id") ?? "";
  const returnTo = exploreReturnPath(search.get("returnTo"));
  const router = useRouter();
  const { open: openAuth } = useAuthDialog();
  const { state } = useSession();
  const signedIn = state.status === "signed_in";
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveReady, setSaveReady] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<"shared" | "copied" | null>(null);
  const [actionError, setActionError] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [contactError, setContactError] = useState("");
  const [contactErrors, setContactErrors] = useState<FieldErrors>({});
  const saved = savedId === id;
  usePageTitle(sale ? sale.headline || `${sale.kind_label} for sale` : null);

  useEffect(() => {
    if (state.status === "loading") return;
    let current = true;
    setError("");
    if (!id) return;
    getSale(id, signedIn)
      .then((value) => { if (current) setSale(value); })
      .catch((cause) => {
        if (current) setError(cause instanceof ApiFailure ? cause.error.message : "We could not find that property.");
      });
    return () => { current = false; };
  }, [id, signedIn, state.status]);

  useEffect(() => {
    let current = true;
    setSavedId(null);
    setSaveReady(false);
    setActionError("");
    if (signedIn) {
      void listSavedSales().then(rows => {
        if (current) { setSavedId(rows.some(row => row.sale.id === id) ? id : null); setSaveReady(true); }
      }).catch(() => { if (current) setActionError("Could not load your saved properties. Refresh to try again."); });
    }
    return () => { current = false; };
  }, [id, signedIn]);

  if (error && !sale) {
    return (
      <main className="listing">
        <p><Link href={returnTo as never} className="listing-back">← Keep looking</Link></p>
        <Notice tone="error" title={error} />
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
  const next = saleDetailPath(sale.id, returnTo);

  async function toggleSave() {
    if (!signedIn) { openAuth("sign-in", { next }); return; }
    if (saving || !saveReady) return;
    setSaving(true);
    setActionError("");
    try {
      await (saved ? unsaveSale(sale!.id) : saveSale(sale!.id));
      setSavedId(saved ? null : sale!.id);
    } catch (cause) {
      setActionError(cause instanceof ApiFailure ? cause.error.message : "Could not update your saved properties.");
    } finally { setSaving(false); }
  }

  async function shareSale() {
    setActionError("");
    try {
      const url = window.location.href;
      if (navigator.share) {
        await navigator.share({ title: sale!.headline || "Property for sale on Danpa HQ", url });
        setShareFeedback("shared");
      } else {
        await navigator.clipboard.writeText(url);
        setShareFeedback("copied");
      }
      window.setTimeout(() => setShareFeedback(null), 2000);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setActionError("We could not open sharing. Please try again.");
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signedIn || busy || !sale) return;
    setBusy(true);
    setContactError("");
    setContactErrors({});
    try {
      const enquiry = await startEnquiry(sale.id, { contact_phone: phone.trim(), contact_email: email.trim() });
      setSale((current) => current?.id === sale.id ? { ...current, my_enquiry_id: enquiry.id } : current);
      setWriting(false);
      openEnquiries({ id: enquiry.id, side: "buyer", record: enquiry });
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setContactErrors(fields);
      setContactError(summaryErrorFrom(cause, fields));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="listing">
      <p><Link href={returnTo as never} className="listing-back">← Keep looking</Link></p>

      {photos.length ? (
        <div className="listing-photos">
          <div className={`listing-gallery${photos.length === 1 ? " listing-gallery-solo" : ""}`} data-count={Math.min(photos.length, 5)}>
            {photos.slice(0, 5).map((photo, index) => (
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

      <VideoPlayer video={sale.video} label="Property video" />
      <div className="listing-discovery-tools">
        <PropertyAsk property={saleIntelContext(sale)} />
        <div className="listing-secondary">
          <Button variant="quiet" aria-pressed={saved} busy={saving} disabled={signedIn && !saveReady} onClick={() => void toggleSave()}>
            <Icon name="bookmark" /><span className="listing-action-label">{saved ? "Saved" : "Save"}</span>
          </Button>
          <Button variant="quiet" onClick={() => void shareSale()}>
            <Icon name="share" /><span className="listing-action-label">{shareFeedback === "shared" ? "Shared" : shareFeedback === "copied" ? "Link copied" : "Share"}</span>
          </Button>
        </div>
      </div>

      {actionError ? <Notice tone="error" title={actionError} /> : null}

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
              <Button onClick={() => router.push(`/record/enquiry?id=${sale.my_enquiry_id}` as never)}>
                View your interest
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (state.status !== "signed_in") {
                    openAuth("sign-in", { next });
                    return;
                  }
                  setPhone(state.me.is_phone_verified ? state.me.phone_display : "");
                  setEmail(state.me.is_email_verified ? state.me.email ?? "" : "");
                  setContactError("");
                  setContactErrors({});
                  setWriting(true);
                }}
              >
                Express interest
              </Button>
            )}
          </div>

          <section className="listing-trust" aria-labelledby="sale-trust-title">
            <p className="listing-trust-title" id="sale-trust-title">
              <Icon name="verification" />
              Verified for sale
            </p>
            {sale.provider_passports?.map(passport => <p className="type-caption" key={passport.name}>{passport.name} · Provider Passport verified</p>)}
            <p className="type-caption">
              Our team read the title and checked the seller may sell it. Still have a lawyer search the title before you pay anything.
            </p>
          </section>
        </aside>
      </div>

      <ModalSheet open={writing} onClose={() => setWriting(false)} dismissible={!busy} closeDisabled={busy}
        bodyBusy={busy} size="sm" className="sale-interest-dialog" icon="heart" title="Share your contact details" meta={sale.headline || `${sale.kind_label} for sale`}>
        {(close) => <form className="sale-enquiry" onSubmit={send}>
          <p className="type-body">Send your phone and email to {sale.seller_label} so they can follow up about this property.</p>
          <Field label="Phone number" type="tel" autoComplete="tel" placeholder="024 123 4567 or +233…" required maxLength={40}
            value={phone} onChange={(event) => setPhone(event.target.value)} error={contactErrors.contact_phone} disabled={busy} />
          <Field label="Email address" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254}
            value={email} onChange={(event) => setEmail(event.target.value)} error={contactErrors.contact_email} disabled={busy} />
          <p className="type-caption sale-enquiry-privacy"><Icon name="shield" /> Your contact details are shared privately with the provider for this listing.</p>
          {contactError ? <Notice tone="error" title={contactError} /> : null}
          <div className="listing-confirm-actions">
            <Button type="submit" busy={busy} busyLabel="Sending…">Send interest</Button>
            <Button variant="quiet" type="button" disabled={busy} onClick={close}>Not now</Button>
          </div>
        </form>}
      </ModalSheet>
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
