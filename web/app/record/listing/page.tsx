"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuthDialog } from "@/components/auth/AuthDialog";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon, type IconName } from "@/components/portal/icons";
import { ListingCard } from "@/components/listings/ListingCard";
import { ListingLocation } from "@/components/listings/ListingLocation";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { PanelState } from "@/components/workspace/Workspace";
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
import { onDate } from "@/lib/time";
import { STATE_LABEL, type TrustState } from "@/lib/trust";

/**
 * The page a tenant decides on.
 *
 * Glance → understand → decide → act. Photographs lead because that is how
 * anyone recognizes a place; the rent and the terms sit in a panel that follows
 * the decision down the page; every other answer is one scannable line.
 *
 * Drawn in the workspace's vocabulary (Saved, Applications, the tenancy
 * request): glass sections on a kola-and-gold wash, facts as tiles with their
 * glyph, the money to move in as the same deep-kola receipt the lease wizard
 * totals with, and verification as rows that say what was checked.
 *
 * Two rules shape what is *not* here. Nothing is said twice — the locality is
 * stated once, the rent once, the availability once. And the street, house
 * number and entrance note are never on this page at all: the backend releases
 * those when a viewing is confirmed, which is a domain rule this page reflects
 * rather than explains.
 */
export default function PublicListingPage() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { open: openAuth } = useAuthDialog();
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
    if (!id) return;
    getPublicListing(id)
      .then((value) => { if (current) setListing(value); })
      .catch((cause) =>
        current && setError(cause instanceof ApiFailure ? cause.error.message : "We could not find that listing."),
      );
    getRelatedListings(id)
      .then((value) => { if (current) setRelated(value); })
      .catch(() => { if (current) setRelated([]); });
    return () => { current = false; };
  }, [id]);

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
    return (
      <main className="listing">
        <ListingPath />
        <section className="ws-panel listing-missing">
          <PanelState
            icon="listings"
            title="This rental isn’t available"
            body={`${error} It may have been taken or withdrawn — there are others like it in Explore.`}
            action={<Link href="/rentals" className="ws-action is-primary"><Icon name="explore" />Back to Explore</Link>}
          />
        </section>
      </main>
    );
  }
  if (!listing) return <ListingSkeleton />;

  const space = listing.space;
  const place = listing.property_context;
  const where = [place.locality_name, place.district_name].filter(Boolean).join(", ");
  const photos = listing.gallery.filter((photo) => photo.download_url);
  const taken = listing.status !== "active";
  // A date in the future is when it opens; today or earlier is simply now.
  const opensLater = listing.available_from && new Date(listing.available_from) > new Date()
    ? listing.available_from
    : null;

  // The four things a tenant compares rentals on, each a tile with its glyph.
  const facts: Array<{ icon: IconName; label: string; value: string }> = [
    { icon: "properties", label: "Type", value: space.space_type_label },
    { icon: "bed", label: "Bedrooms", value: space.bedrooms === 0 ? "Single room" : String(space.bedrooms) },
    ...(space.bathrooms ? [{ icon: "bath" as const, label: "Bathrooms", value: String(space.bathrooms) }] : []),
    { icon: "sofa", label: "Furnishing", value: space.is_furnished ? "Furnished" : "Unfurnished" },
  ];

  // The space's own amenities and its private features are one list to a
  // tenant. Merged here, by name, so "Air conditioning" is never said twice.
  const features = [
    ...space.amenities.map((row) => row.name),
    space.has_private_bathroom ? "Private bathroom" : null,
    space.has_private_toilet ? "Private toilet" : null,
    space.has_private_kitchen ? "Private kitchen" : null,
    space.has_air_conditioning ? "Air conditioning" : null,
  ].filter((name, index, all): name is string =>
    Boolean(name) && all.findIndex((other) => other?.toLowerCase() === name!.toLowerCase()) === index,
  );

  const security = place.features.has_security ? "On site" : place.features.is_gated ? "Gated" : "None stated";
  const utilities: Array<{ kind: string; icon: IconName; label: string; value: string; quiet?: boolean }> = [
    { kind: "water", icon: "water", label: "Water", value: place.features.water_source_label },
    { kind: "power", icon: "power", label: "Power", value: place.features.power_meter_label },
    { kind: "compound", icon: "home", label: "Compound", value: place.features.compound_label },
    { kind: "security", icon: "shield", label: "Security", value: security, quiet: security === "None stated" },
  ];

  // What it costs to move in, line by line. The backend's total is the sum of
  // these months of rent, so each line is the rent times its months.
  const cedis = (minor: number) => `GH₵${(minor / 100).toLocaleString("en-GH")}`;
  const months = (count: number) => `${count} month${count === 1 ? "" : "s"}`;
  const rentMinor = listing.rent_minor;
  const moveIn = [
    { label: "Advance", detail: listing.advance_label, months: listing.advance_months },
    { label: "Deposit", detail: months(listing.caution_months), months: listing.caution_months },
    { label: "Agency fee", detail: months(listing.agency_fee_months), months: listing.agency_fee_months },
  ].filter((row) => row.months > 0);

  const longDescription = space.description.length > 320;
  const verified = space.verification.checked && place.authority.state === "verified";
  const checks: Array<{ what: string; state: TrustState }> = [
    { what: "Identity", state: listing.trust_stamps.identity.state },
    { what: listing.trust_stamps.relationship === "owner" ? "Ownership" : "Authority to let", state: place.authority.state },
    { what: "This space", state: space.verification.checked ? "verified" : "unverified" },
  ];

  // Over this page, from state; signed in, the person comes back to it.
  function requireAccount(next: string) {
    openAuth("sign-in", { workspace: "tenant", next });
  }

  async function toggleSave() {
    if (!signedIn) return requireAccount(`/record/listing?id=${listing!.id}`);
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
          title: listing?.headline ?? "Danpa HQ rental",
          text: listing?.headline ?? "A rental on Danpa HQ",
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
    if (!signedIn) return requireAccount(`/record/listing?id=${listing!.id}`);
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
      <ListingPath headline={listing.headline} />

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
              <Icon name="photos" />
              View all {photos.length} photos
            </button>
          ) : null}
        </div>
      ) : (
        <div className="listing-gallery-empty">
          <Icon name="photos" />
          <span>Photos pending</span>
        </div>
      )}

      <div className="listing-body">
        <div className="listing-main">
          <header className="listing-head">
            <h1>{listing.headline}</h1>
            <p><Icon name="pin" /><span>{where || "Ghana"}{place.landmark ? ` · near ${place.landmark}` : ""}</span></p>
          </header>

          <ul className="listing-facts" aria-label="At a glance">
            {facts.map((fact) => (
              <li key={fact.label}>
                <span className="listing-fact-mark" aria-hidden="true"><Icon name={fact.icon} /></span>
                <span className="listing-fact-copy"><small>{fact.label}</small><strong>{fact.value}</strong></span>
              </li>
            ))}
          </ul>

          {features.length ? (
            <section className="listing-section">
              <SectionTitle icon="amenities">What this space has</SectionTitle>
              <ul className="listing-tags">
                {features.map((name) => <li key={name} className="listing-tag"><Icon name="check" />{name}</li>)}
              </ul>
            </section>
          ) : null}

          {space.description ? (
            <section className="listing-section">
              <SectionTitle icon="details">About this place</SectionTitle>
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
            <SectionTitle icon="city">The property</SectionTitle>
            <p className="listing-where-name">
              <strong>{place.title}</strong>
              <span>{place.property_type_label}{place.region_name ? ` · ${place.region_name}` : ""}</span>
            </p>
            {/* The Ghana facts that decide what living here costs and feels
                like. Each is one choice from a fixed set, so each is one tile. */}
            <dl className="listing-utilities">
              {utilities.map((row) => (
                <div key={row.kind} data-kind={row.kind} data-quiet={row.quiet || undefined}>
                  <span className="listing-utility-mark" aria-hidden="true"><Icon name={row.icon} /></span>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            {place.amenities.length ? (
              <ul className="listing-tags is-shared" aria-label="Shared on the property">
                {place.amenities.map((row) => <li key={row.id} className="listing-tag">{row.name}</li>)}
              </ul>
            ) : null}
          </section>

          <ListingLocation listing={listing} where={where} landmark={place.landmark} />
        </div>

        <aside className="listing-panel" aria-label="Rent and next steps">
          <div className="listing-pricing">
            <p className="listing-rent">{listing.rent_formatted} <span>/ month</span></p>
            <p className={`listing-status ${taken ? "is-taken" : opensLater ? "is-later" : "is-available"}`}>
              <i aria-hidden="true" />
              {taken ? "No longer available" : opensLater ? `Available from ${onDate(opensLater)}` : "Available now"}
            </p>
            {listing.minimum_lease_months ? (
              <p className="listing-minimum"><Icon name="clock" />{months(listing.minimum_lease_months)} minimum stay</p>
            ) : null}
          </div>

          <div className="listing-receipt">
            <small>To move in</small>
            <strong>{cedis(listing.total_move_in_minor)}</strong>
            <dl className="listing-terms">
              {moveIn.map((row) => (
                <div key={row.label}>
                  <dt>{row.label} <em>{row.detail}</em></dt>
                  <dd>{rentMinor !== null ? cedis(rentMinor * row.months) : row.detail}</dd>
                </div>
              ))}
            </dl>
          </div>

          {error ? <Notice tone="error" title={error} /> : null}

          {taken ? (
            <p className="listing-taken"><Icon name="info" />This place has been taken. Keep looking for something similar.</p>
          ) : (
            <div className="listing-actions">
              {/* Applying leads. It is the thing this page exists to produce,
                  and it was the secondary button under a viewing request. */}
              <Button
                onClick={() => {
                  if (application) { router.push("/applications"); return; }
                  const next = `/record/apply?id=${listing.id}`;
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
                <div className="listing-confirm" role="group" aria-label="Confirm viewing request">
                  <p>
                    <Icon name="viewings" />
                    <span>
                      <strong>Send a viewing request?</strong>
                      <small>{listing.provider_label} sees your name and phone number, and replies with times.</small>
                    </span>
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
                    if (!signedIn) return requireAccount(`/record/listing?id=${listing.id}`);
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

          {/* Stated, not hidden behind a disclosure. Three checks and one
              line is short enough to read at a glance, and a dropdown made the
              reader open something to find out whether to trust the listing —
              which is the question they came with. */}
          <section className="listing-trust" data-verified={verified || undefined} aria-labelledby="listing-trust-title">
            <p className="listing-trust-title" id="listing-trust-title">
              <span className="listing-trust-seal" aria-hidden="true"><Icon name="verification" /></span>
              <span>
                <strong>{verified ? "Verified rental" : "Verification"}</strong>
                <small>
                  {listing.trust_stamps.relationship === "owner"
                    ? "Listed by its owner"
                    : "Listed by an authorized representative"}
                </small>
              </span>
            </p>
            <ul className="listing-trust-stamps">
              {checks.map((check) => (
                <li key={check.what} className="listing-check" data-state={check.state}>
                  <span className="listing-check-mark" aria-hidden="true">
                    <Icon name={check.state === "verified" ? "check" : check.state === "pending" ? "clock" : check.state === "expired" ? "warning" : "info"} />
                  </span>
                  <span className="listing-check-what">{check.what}</span>
                  <span className="listing-check-state">{STATE_LABEL[check.state]}</span>
                </li>
              ))}
            </ul>
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

/** Where this page sits: one level into Explore, and the way back to it. */
function ListingPath({ headline }: { headline?: string }) {
  return (
    <div className="listing-path">
      <EntityPath
        items={[
          { label: "Explore", href: "/rentals", mobileLabel: "Back to Explore" },
          { label: headline ?? "Rental" },
        ]}
      />
    </div>
  );
}

/** A section's heading with its glyph, so the page scans by mark as well as word. */
function SectionTitle({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <h2 className="listing-section-title">
      <span aria-hidden="true"><Icon name={icon} /></span>
      {children}
    </h2>
  );
}

/** Loading in the page's own shape, so nothing jumps when the listing lands. */
function ListingSkeleton() {
  return (
    <main className="listing" aria-busy="true" aria-label="Loading rental">
      <span className="ws-skeleton-block listing-skeleton-path" />
      <span className="ws-skeleton-block listing-skeleton-gallery" />
      <div className="listing-body">
        <div className="listing-main">
          <span className="ws-skeleton-lines">
            <span className="ws-skeleton-block listing-skeleton-title" />
            <span className="ws-skeleton-block is-thin" style={{ width: "40%" }} />
          </span>
          <span className="listing-skeleton-facts">
            {Array.from({ length: 4 }).map((_, index) => <span key={index} className="ws-skeleton-block" />)}
          </span>
          <span className="ws-skeleton-block listing-skeleton-card" />
        </div>
        <span className="ws-skeleton-block listing-skeleton-panel" />
      </div>
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
