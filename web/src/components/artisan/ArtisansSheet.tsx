"use client";

/**
 * Artisans, as a sheet that opens over whatever page somebody is on — the one
 * entry point tenants and property providers have to the artisan network.
 *
 * Three sections. **Find** browses approved artisans by trade and area, with a
 * Certified filter; a profile opens as a deeper view, so Back returns to the
 * results where they were. **Requests** and **Records** hold the quotes and
 * jobs that later phases add; until then they say so plainly.
 *
 * Danpa HQ connects people and keeps the record. Nothing here calls an artisan
 * trusted or guaranteed, and nothing shows a phone number or an address.
 */

import { FileBadge, Hammer, MapPin, ShieldCheck, Star, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { DistrictPicker } from "@/components/artisan/ApplicationForm";
import { Switch } from "@/components/Check";
import { Notice } from "@/components/Notice";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ModalViews, useModalViews } from "@/components/workspace/ModalViews";
import { PanelSkeleton, PanelState, SegmentedControl } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  CERTIFICATE_LABEL,
  TRADES,
  discoverArtisans,
  getArtisan,
  type ArtisanCard,
  type DiscoverResult,
  type District,
  type PublicArtisan,
} from "@/lib/artisan";
import { useSession } from "@/lib/session";
import { onDate } from "@/lib/time";

export type ArtisansTab = "find" | "requests" | "records";
export type ArtisansRequest = { tab?: ArtisansTab; trade?: string };

export const OPEN_ARTISANS = "danpahq:open-artisans";

/** Open the sheet over the current page, optionally at a tab or a trade. */
export function openArtisans(request: ArtisansRequest = {}) {
  window.dispatchEvent(new CustomEvent<ArtisansRequest>(OPEN_ARTISANS, { detail: request }));
}

type View = { kind: "profile"; id: string };

export function ArtisansSheet({
  open,
  request,
  onClose,
}: {
  open: boolean;
  request: ArtisansRequest;
  onClose: () => void;
}) {
  const nav = useModalViews<View>(open, request);
  const { state } = useSession();
  const artisan = state.status === "signed_in" ? state.me.capabilities.artisan : null;
  // Becoming one is offered here and only here — a quiet link, never a prompt.
  // Once approved, the account menu carries the switch instead.
  const becomeLabel = !artisan || artisan.workspace_access
    ? null
    : artisan.status === "not_started" ? "Become an artisan?" : "Your artisan application";
  const [tab, setTab] = useState<ArtisansTab>(request.tab ?? "find");
  const [seenRequest, setSeenRequest] = useState(request);
  if (seenRequest !== request) {
    setSeenRequest(request);
    setTab(request.tab ?? "find");
  }

  const top = nav.top;
  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      icon="hammer"
      title={top ? "Artisan" : "Artisans"}
      meta={top ? undefined : "Skilled help for your home, from approved artisans"}
      viewKey={top ? `profile:${top.id}` : "root"}
      onBack={nav.depth ? nav.back : undefined}
      backLabel="Back to artisans"
      className="art-sheet"
      headerAction={becomeLabel && !top ? (
        <Link href={"/artisan" as never} onClick={onClose}>{becomeLabel}</Link>
      ) : undefined}
    >
      <ModalViews depth={nav.depth} direction={nav.direction}>
        <div className="art-sheet-root">
          <SegmentedControl<ArtisansTab>
            label="Artisans"
            value={tab}
            onChange={setTab}
            options={[
              { key: "find", label: "Find" },
              { key: "requests", label: "Requests" },
              { key: "records", label: "Records" },
            ]}
          />
          {tab === "find" ? (
            <Find initialTrade={request.trade} onOpen={(id) => nav.push({ kind: "profile", id })} />
          ) : tab === "requests" ? (
            <PanelState
              icon="receipt"
              title="No quote requests yet"
              body="Quotes you ask for and receive appear here, with any waiting for your approval."
            />
          ) : (
            <PanelState
              icon="wrench"
              title="No artisan jobs yet"
              body="Ongoing and completed work stays here, with its photos, costs and reviews."
            />
          )}
        </div>
        {top ? <Profile id={top.id} /> : null}
      </ModalViews>
    </ModalSheet>
  );
}

function Find({ initialTrade, onOpen }: { initialTrade?: string; onOpen: (id: string) => void }) {
  const [trade, setTrade] = useState(initialTrade ?? "");
  const [area, setArea] = useState<District[]>([]);
  const [certified, setCertified] = useState(false);
  const [showUncertified, setShowUncertified] = useState(false);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [error, setError] = useState("");

  // A different trade starts the electrical choice afresh: opting in to see
  // uncertified electricians is a choice about wiring, not a lasting setting.
  const [seenTrade, setSeenTrade] = useState(trade);
  if (seenTrade !== trade) {
    setSeenTrade(trade);
    setShowUncertified(false);
  }

  const district = area[0]?.id ?? "";
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    discoverArtisans({ trade, district, certified, showUncertified }, controller.signal)
      .then((next) => { setResult(next); setError(""); })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setResult({ results: [], electrical: false, hidden_uncertified: 0 });
        setError(cause instanceof ApiFailure ? cause.error.message : "Could not load artisans.");
      });
    return () => controller.abort();
  }, [trade, district, certified, showUncertified]);

  const electrical = trade === "electrical";

  return (
    <div className="art-find">
      <div className="art-find-trades" role="group" aria-label="Trade">
        <button type="button" className="art-chip" aria-pressed={trade === ""} onClick={() => setTrade("")}>
          All trades
        </button>
        {TRADES.map((option) => (
          <button
            key={option.value}
            type="button"
            className="art-chip"
            aria-pressed={trade === option.value}
            onClick={() => setTrade(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={`art-find-filters${electrical ? " is-single" : ""}`}>
        <DistrictPicker selected={area} onChange={setArea} max={1} label="Area" chosenLabel="Area" placeholder="Any district — type to choose" />
        {electrical ? null : (
          <label className="art-toggle">
            <span>
              <strong>Certified only</strong>
              <small>Artisans with a certificate Danpa HQ has verified</small>
            </span>
            <Switch checked={certified} onChange={setCertified} label="Certified only" />
          </label>
        )}
      </div>

      {electrical ? (
        <div className="art-electrical" role="note">
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>Wiring work needs a certified professional</strong>
            <p>
              {showUncertified
                ? "Showing every electrician. Those without a verified electrical certificate are listed after the certified ones."
                : "Only electricians with a verified electrical certificate are shown."}
            </p>
            {showUncertified ? (
              <button type="button" className="art-link" onClick={() => setShowUncertified(false)}>
                Show certified electricians only
              </button>
            ) : result && result.hidden_uncertified > 0 ? (
              <button type="button" className="art-link" onClick={() => setShowUncertified(true)}>
                Also show {result.hidden_uncertified} uncertified electrician{result.hidden_uncertified === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      {result === null ? (
        <PanelSkeleton rows={3} />
      ) : result.results.length ? (
        <ul className="art-results" aria-label="Artisans">
          {result.results.map((artisan) => (
            <li key={artisan.id}>
              <ArtisanRow artisan={artisan} onOpen={() => onOpen(artisan.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <PanelState
          icon="hammer"
          title="No artisans match yet"
          body={
            trade || district || certified
              ? "Try another trade or area, or include artisans without a certificate."
              : "Approved artisans appear here as they join Danpa HQ."
          }
        />
      )}
    </div>
  );
}

function ArtisanRow({ artisan, onOpen }: { artisan: ArtisanCard; onOpen: () => void }) {
  return (
    <button type="button" className="art-result" onClick={onOpen}>
      <span className="art-result-cover" aria-hidden="true">
        {artisan.cover_url ? (
          // A short-lived signed URL, which next/image would re-optimise every few minutes.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artisan.cover_url} alt="" loading="lazy" />
        ) : (
          <Hammer />
        )}
      </span>
      <span className="art-result-body">
        <strong>{artisan.name}</strong>
        <span className="art-result-trades">{artisan.trades.map((trade) => trade.label).join(" · ")}</span>
        <span className="art-result-area">
          <MapPin aria-hidden="true" />
          {artisan.districts.map((district) => district.name).join(", ")}
        </span>
        <Facts artisan={artisan} />
      </span>
    </button>
  );
}

/** The facts a listing states, in the same order everywhere. Never a score. */
function Facts({ artisan }: { artisan: ArtisanCard }) {
  return (
    <span className="art-facts-chips">
      {artisan.id_checked ? (
        <span className="art-fact is-kola"><ShieldCheck aria-hidden="true" />ID checked</span>
      ) : null}
      {artisan.certified_trades.map((trade) => (
        <span key={trade} className="art-fact is-lagoon">{trade} certificate verified</span>
      ))}
      <span className="art-fact"><Wrench aria-hidden="true" />{artisan.jobs_completed} job{artisan.jobs_completed === 1 ? "" : "s"} on Danpa HQ</span>
      <span className="art-fact"><Star aria-hidden="true" />{artisan.reviews_count ? `${artisan.reviews_count} reviews` : "No reviews yet"}</span>
    </span>
  );
}

function Profile({ id }: { id: string }) {
  const [artisan, setArtisan] = useState<PublicArtisan | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getArtisan(id)
      .then((next) => { if (live) setArtisan(next); })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not open this artisan."); });
    return () => { live = false; };
  }, [id]);

  if (error) return <PanelState tone="error" icon="warning" title={error} />;
  if (!artisan) return <PanelSkeleton rows={4} />;

  return (
    <article className="art-profile">
      <header className="art-profile-head">
        <h3>{artisan.name}</h3>
        <p>{artisan.trades.map((trade) => trade.label).join(" · ")}</p>
        <p className="art-result-area">
          <MapPin aria-hidden="true" />
          Works in {artisan.districts.map((district) => district.name).join(", ")}
        </p>
        <Facts artisan={artisan} />
      </header>

      {artisan.portfolio.length ? (
        <section aria-label="Their work" className="art-profile-gallery">
          {artisan.portfolio.map((photo, index) =>
            photo.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={photo.id} src={photo.url} alt={`Work photo ${index + 1}`} loading="lazy" />
            ) : null,
          )}
        </section>
      ) : null}

      {artisan.bio ? (
        <section className="art-profile-section">
          <h4>About</h4>
          <p className="art-bio">{artisan.bio}</p>
        </section>
      ) : null}

      <section className="art-profile-section">
        <h4>Certificates</h4>
        {artisan.certificates.length ? (
          <ul className="art-certs">
            {artisan.certificates.map((certificate) => (
              <li key={certificate.id}>
                <FileBadge aria-hidden="true" />
                <span>
                  <strong>{certificate.trade_label}</strong>
                  <small>
                    {certificate.issuing_body}
                    {certificate.expires_on ? ` · expires ${onDate(certificate.expires_on)}` : ""}
                  </small>
                </span>
                <span className={`art-cert-status is-${certificate.status}`}>
                  {CERTIFICATE_LABEL[certificate.status]}
                  {certificate.status === "verified" && certificate.verified_at ? ` ${onDate(certificate.verified_at)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="art-bio is-quiet">None shown. Certificates are optional.</p>
        )}
      </section>

      <section className="art-profile-section">
        <h4>Reviews</h4>
        <p className="art-bio is-quiet">No reviews yet. Reviews come from customers after a confirmed job.</p>
      </section>

      <p className="art-profile-foot">
        On Danpa HQ since {onDate(artisan.member_since)}. Danpa HQ checks identity and certificates and keeps a
        record of each job; it does not guarantee anybody&apos;s work.
      </p>
    </article>
  );
}
