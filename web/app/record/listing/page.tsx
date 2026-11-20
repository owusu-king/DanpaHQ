"use client";

import { MediaGallery } from "@/components/property/MediaGallery";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuthDialog } from "@/components/auth/AuthDialog";
import { usePageTitle } from "@/components/PageTitle";
import { Button } from "@/components/Button";
import { useToast } from "@/components/toast/Toaster";
import { PropertyAsk } from "@/components/listings/PropertyAsk";
import { rentalIntelContext } from "@/lib/propertyIntel";
import { Icon, type IconName } from "@/components/portal/icons";
import { ListingCard } from "@/components/listings/ListingCard";
import { ListingProviderCard } from "@/components/listings/ListingProviderCard";
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

const RentalApplication = dynamic(() => import("../apply/RentalApplication").then((module) => module.RentalApplication));

/**
 * The page a tenant decides on.
 *
 * Glance → understand → decide → act. Photographs lead because that is how
 * anyone recognizes a place; the rent and the terms sit in a panel that follows
 * the decision down the page; every other answer is one scannable line.
 *
 * Drawn in the workspace's vocabulary (Saved, Applications, the tenancy
 * request): glass sections on a kola-and-gold wash, facts as tiles with their
 * glyph, the money to move in as the same compact receipt the lease wizard
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
  const { toast } = useToast();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [related, setRelated] = useState<Awaited<ReturnType<typeof getRelatedListings>> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "viewing" | null>(null);
  const [application, setApplication] = useState<string | null>(null);
  const [applyingTo, setApplyingTo] = useState<string | null>(null);
  const applyTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreApplyFocus = useRef(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingViewing, setConfirmingViewing] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<"shared" | "copied" | null>(null);
  const [expanded, setExpanded] = useState(false);
  usePageTitle(listing?.headline);

  const signedIn = state.status === "signed_in";

  useEffect(() => {
    if (applyingTo || !restoreApplyFocus.current) return;
    restoreApplyFocus.current = false;
    applyTrigger.current?.focus({ preventScroll: true });
  }, [applyingTo]);

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
            body="It may no longer be listed, or we couldn’t load its details."
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

  // The space itself, in the measures a renter compares first.
  const area = space.floor_area_sqm ? Number(space.floor_area_sqm) : 0;
  const specs: Array<{ icon: IconName; label: string; value: string }> = [
    space.bedrooms === 0
      ? { icon: "bed", label: "Bedrooms", value: "Single room" }
      : { icon: "bed", label: space.bedrooms === 1 ? "Bedroom" : "Bedrooms", value: String(space.bedrooms) },
    ...(space.bathrooms ? [{ icon: "bath" as const, label: space.bathrooms === 1 ? "Bathroom" : "Bathrooms", value: String(space.bathrooms) }] : []),
    ...(area > 0 ? [{ icon: "tiles" as const, label: "Floor area", value: `${area.toLocaleString("en-GH")} m²` }] : []),
    { icon: "sofa", label: "Furnishing", value: space.is_furnished ? "Furnished" : "Unfurnished" },
  ];

  // What the building provides: the Ghana questions — water, power, the
  // compound — answered once, as a reference list rather than as chips.
  const building: Array<{ icon: IconName; label: string; value: string }> = [
    { icon: "water" as const, label: "Water", value: place.features.water_source_label },
    { icon: "power" as const, label: "Power", value: place.features.power_meter_label },
    { icon: "gate" as const, label: "Compound", value: place.features.compound_label },
  ].filter((row) => row.value);

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

  // Pesewas, shown the way the rent itself is shown: always two decimals.
  const cedis = (minor: number) => `GH₵${(minor / 100).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const months = (count: number) => `${count} month${count === 1 ? "" : "s"}`;
  const period = listing.rent_period === "yearly" ? "year" : "month";

  // What the move-in total is made of, by the backend's own formula: monthly
  // rent (a yearly rent divided by twelve) times each number of months. Shown
  // only when the parts add up to the total the API sent.
  const monthly = listing.rent_minor == null
    ? null
    : listing.rent_period === "yearly" ? Math.floor(listing.rent_minor / 12) : listing.rent_minor;
  const moveIn = monthly == null ? [] : [
    { label: "Advance rent", months: listing.advance_months },
    { label: "Deposit", months: listing.caution_months },
    { label: "Agency fee", months: listing.agency_fee_months },
  ].filter((line) => line.months > 0).map((line) => ({ ...line, minor: monthly * line.months }));
  const moveInAddsUp = moveIn.length > 0
    && moveIn.reduce((sum, line) => sum + line.minor, 0) === listing.total_move_in_minor;

  const longDescription = space.description.length > 320;
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
    } catch (cause) {
      setSaved(was);
      toast({
        tone: "error",
        title: was ? "Couldn’t remove this rental" : "Couldn’t save this rental",
        description: cause instanceof ApiFailure ? cause.error.message : "Please try again.",
      });
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
      toast({ tone: "error", title: "Couldn’t share this rental", description: "Please try again." });
    }
  }

  async function requestViewing() {
    if (viewing) { router.push("/viewings"); return; }
    if (!signedIn) return requireAccount(`/record/listing?id=${listing!.id}`);
    setBusy("viewing");
    try {
      await requestPublicViewing(listing!.id);
      setViewing("requested");
    } catch (cause) {
      toast({
        tone: "error",
        title: "Viewing request wasn’t sent",
        description: cause instanceof ApiFailure ? cause.error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="listing is-rental">
      <ListingPath headline={listing.headline} />

      <MediaGallery
        key={listing.id}
        layout="listing"
        title={listing.headline}
        photos={photos.map((photo) => ({
          id: photo.id,
          url: photo.download_url!,
          label: photo.caption || listing.headline,
          sourceLabel: photo.source_label,
        }))}
        videos={[
          { label: "Unit video", video: listing.space.video },
          { label: "Property video", video: listing.property_context.video },
        ]}
        empty={<div className="listing-gallery-empty"><Icon name="photos" /><span>Property media pending</span></div>}
        tools={(
          <>
            <PropertyAsk property={rentalIntelContext(listing)} />
            {!taken ? (
              <div className="listing-secondary">
                <Button
                  variant="quiet"
                  aria-pressed={saved}
                  onClick={() => void toggleSave()}
                >
                  <Icon name="bookmark" />
                  <span className="listing-action-label">{saved ? "Saved" : "Save"}</span>
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => void shareListing()}
                >
                  <Icon name="share" />
                  <span className="listing-action-label">{shareFeedback === "shared" ? "Shared" : shareFeedback === "copied" ? "Link copied" : "Share"}</span>
                </Button>
              </div>
            ) : null}
          </>
        )}
      />

      <div className="listing-body">
        <div className="listing-main">
          <header className="listing-head">
            <p className="listing-kind">
              {[space.space_type_label, place.property_type_label].filter(Boolean).join(" · ")}
            </p>
            <h1>{listing.headline}</h1>
            <p className="listing-where"><Icon name="pin" /><span>{[where, place.region_name].filter(Boolean).join(", ") || "Ghana"}</span></p>
          </header>

          <dl className="listing-specs" aria-label="At a glance">
            {specs.map((spec) => (
              <div key={spec.label}>
                <dt><Icon name={spec.icon} /><span>{spec.label}</span></dt>
                <dd>{spec.value}</dd>
              </div>
            ))}
          </dl>

          {features.length ? (
            <section className="listing-section">
              <SectionTitle icon="amenities">What this space has</SectionTitle>
              <ul className="listing-features">
                {features.map((name) => (
                  <li key={name}><span aria-hidden="true"><Icon name={featureIcon(name)} /></span>{name}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {building.length || place.amenities.length ? (
            <section className="listing-section">
              <SectionTitle icon="properties">The building</SectionTitle>
              {building.length ? (
                <dl className="listing-building">
                  {building.map((row) => (
                    <div key={row.label}>
                      <dt><span aria-hidden="true"><Icon name={row.icon} /></span>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {place.amenities.length ? (
                <div className="listing-shared">
                  <h3>Shared with the building</h3>
                  <ul className="listing-features is-shared">
                    {place.amenities.map((row) => (
                      <li key={row.id}><span aria-hidden="true"><Icon name={featureIcon(row.name)} /></span>{row.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
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

          <ListingLocation listing={listing} where={where} landmark={place.landmark} />
        </div>

        <aside className="listing-panel" aria-label="Rent and next steps">
          <div className="listing-pricing">
            <p className={`listing-status ${taken ? "is-taken" : opensLater ? "is-later" : "is-available"}`}>
              <i aria-hidden="true" />
              {taken ? "No longer available" : opensLater ? `Available from ${onDate(opensLater)}` : "Available now"}
            </p>
            <p className="listing-rent">{listing.rent_formatted} <span>/ {period}</span></p>
            {listing.minimum_lease_months ? (
              <p className="listing-minimum"><Icon name="clock" />{months(listing.minimum_lease_months)} minimum stay</p>
            ) : null}
          </div>


          {taken ? (
            <p className="listing-taken"><Icon name="info" />This place has been taken. Keep looking for something similar.</p>
          ) : (
            <div className="listing-actions is-rental">
              {/* Applying leads. It is the thing this page exists to produce,
                  and it was the secondary button under a viewing request. */}
              <Button
                ref={applyTrigger}
                onClick={() => {
                  if (application) { router.push("/applications"); return; }
                  const next = `/record/apply?id=${listing.id}`;
                  if (!signedIn) return requireAccount(next);
                  if (state.me.capabilities.active_workspace === "tenant" && state.me.capabilities.tenant.workspace_access) {
                    restoreApplyFocus.current = true;
                    setApplyingTo(listing.id);
                  } else {
                    router.push(next as never);
                  }
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


            </div>
          )}

          <section className="listing-movein" aria-labelledby="listing-movein-title">
            <h2 id="listing-movein-title">Cost to move in</h2>
            {moveInAddsUp ? (
              <dl>
                {moveIn.map((line) => (
                  <div key={line.label}>
                    <dt>{line.label}<span>{months(line.months)}</span></dt>
                    <dd>{cedis(line.minor)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <p className="listing-movein-total"><span>Total</span><strong>{cedis(listing.total_move_in_minor)}</strong></p>
          </section>

          <ListingProviderCard listing={listing} />

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

      {applyingTo === listing.id ? (
        <RentalApplication key={listing.id} id={listing.id} initialListing={listing}
          onClose={() => setApplyingTo(null)}
          onSent={(created) => setApplication(created.status)} />
      ) : null}
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

/** A recognisable glyph for a named feature; a tick when there is none. */
function featureIcon(name: string): IconName {
  const value = name.toLowerCase();
  const glyphs: Array<[RegExp, IconName]> = [
    [/kitchen|cook/, "kitchen"],
    [/toilet|\bwc\b/, "toilet"],
    [/bath|shower/, "bath"],
    [/air.?condition|\ba\/?c\b|cooling/, "snow"],
    [/wi-?fi|internet/, "wifi"],
    [/wardrobe|closet/, "wardrobe"],
    [/balcon|terrace|veranda/, "balcony"],
    [/parking|garage|\bcar\b/, "car"],
    [/pool/, "pool"],
    [/gym|fitness/, "dumbbell"],
    [/wash|laundry/, "washer"],
    [/borehole|water|tank/, "tank"],
    [/security|guard|gate|cctv/, "shield"],
    [/garden|lawn/, "tree"],
    [/desk|study|office/, "desk"],
    [/power|generator|solar|electric/, "power"],
  ];
  return glyphs.find(([pattern]) => pattern.test(value))?.[1] ?? "check";
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
