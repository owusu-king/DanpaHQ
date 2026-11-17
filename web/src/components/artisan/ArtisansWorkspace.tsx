"use client";

/** The artisan directory and customer work, presented as an addressable workspace. */

import { ChevronRight, ClipboardList, FileBadge, Hammer, MapPin, Plus, Search, ShieldCheck, Star, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { DistrictPicker } from "@/components/artisan/ApplicationForm";
import { DirectJobView, PostJob } from "@/components/artisan/DirectJobs";
import { ProblemReport } from "@/components/artisan/WorkFinish";
import { Switch } from "@/components/Check";
import { Notice } from "@/components/Notice";
import { PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  ARTISAN_WORK_CHANGED,
  CERTIFICATE_LABEL,
  DISCOVERY_TRADES,
  discoverArtisans,
  getArtisan,
  getArtisanWork,
  inviteArtisan,
  inviteToDirectJob,
  listMyDirectJobs,
  suggestArtisan,
  type CustomerWorkItem,
  type DirectJob,
  type ArtisanCard,
  type DiscoverResult,
  type District,
  type PublicArtisan,
} from "@/lib/artisan";
import { useSession } from "@/lib/session";
import { onDate } from "@/lib/time";

import type { ArtisansForRequest, ArtisansTab } from "./artisanNavigation";

/** The artisan a new job is posted for, from their profile. */
export type AskFor = { id: string; name: string; trade?: string };

type View =
  | { kind: "profile"; id: string; forRequest?: ArtisansForRequest }
  | { kind: "post"; invite?: AskFor }
  | { kind: "job"; id: string }
  | { kind: "find"; trade: string; forRequest: ArtisansForRequest };

const VIEW_TITLE: Record<View["kind"], string> = {
  profile: "Artisan",
  post: "Post a job",
  job: "Your job",
  find: "Find an artisan",
};

const SECTIONS = [
  { key: "find", label: "Find", icon: Search },
  { key: "requests", label: "Requests", icon: ClipboardList },
  { key: "records", label: "Records", icon: FileBadge },
] as const;

function ArtisansNav({ tab, onChange, placement, panelId }: {
  tab: ArtisansTab;
  onChange: (tab: ArtisansTab) => void;
  placement: "desktop" | "mobile";
  panelId: string;
}) {
  return (
    <nav className="art-section-nav" data-placement={placement} aria-label="Artisans sections">
      {SECTIONS.map(({ key, label, icon: SectionIcon }) => (
        <button key={key} type="button" aria-pressed={tab === key} aria-controls={panelId} onClick={() => onChange(key)}>
          <SectionIcon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function ArtisansWorkspace() {
  const router = useRouter();
  const search = useSearchParams();
  const readContext = (): ArtisansForRequest | undefined => {
    try {
      const value = JSON.parse(search.get("for") ?? "null");
      return value && typeof value.id === "string" && typeof value.label === "string" &&
        (value.mode === "invite" || value.mode === "suggest") &&
        (!value.kind || value.kind === "direct_job" || value.kind === "maintenance") ? value : undefined;
    } catch { return undefined; }
  };
  const forRequest = readContext();
  const askedTab = search.get("tab");
  const tab: ArtisansTab = askedTab === "requests" || askedTab === "records" ? askedTab : "find";
  const request = { trade: search.get("trade") ?? undefined, forRequest };
  const kind = search.get("view");
  const id = search.get("id");
  let top: View | undefined;
  if (kind === "profile" && id) top = { kind, id, forRequest };
  if (kind === "job" && id) top = { kind, id };
  if (kind === "find" && forRequest) top = { kind, trade: request.trade ?? "", forRequest };
  if (kind === "post") top = { kind, invite: id ? { id, name: search.get("name") ?? "Artisan", trade: request.trade } : undefined };
  const navigate = (query: URLSearchParams, replace = false) => {
    router[replace ? "replace" : "push"](`/artisans${query.size ? `?${query}` : ""}` as never, { scroll: false });
  };
  const nav = {
    push(view: View, replace = false) {
      const query = new URLSearchParams(search.toString());
      query.set("back", replace ? search.get("back") ?? "tab=requests" : search.toString());
      for (const key of ["view", "id", "name"]) query.delete(key);
      query.set("view", view.kind);
      if (view.kind === "profile" || view.kind === "job") query.set("id", view.id);
      if (view.kind === "profile" && view.forRequest) query.set("for", JSON.stringify(view.forRequest));
      if (view.kind === "find") { query.set("trade", view.trade); query.set("for", JSON.stringify(view.forRequest)); }
      if (view.kind === "post" && view.invite) {
        query.set("id", view.invite.id); query.set("name", view.invite.name);
        if (view.invite.trade) query.set("trade", view.invite.trade);
      }
      navigate(query, replace);
    },
    back() { navigate(new URLSearchParams(search.get("back") ?? (kind === "job" ? "tab=requests" : ""))); },
  };
  const panelId = useId();
  const { state } = useSession();
  const artisan = state.status === "signed_in" ? state.me.capabilities.artisan : null;
  // Keep application access in the page heading, away from discovery filters.
  // Once approved, the account menu carries the switch instead.
  const becomeLabel = !artisan || artisan.workspace_access
    ? null
    : artisan.status === "not_started" ? "Become an artisan?" : "Your artisan application";
  const chooseSection = (next: ArtisansTab) => navigate(new URLSearchParams(next === "find" ? "" : `tab=${next}`));
  const renderView = (view: View) => {
    switch (view.kind) {
      case "profile": return <Profile id={view.id} forRequest={view.forRequest} onPostFor={(invite) => nav.push({ kind: "post", invite })} onOpenJob={(id) => nav.push({ kind: "job", id })} />;
      case "post": return <PostJob invite={view.invite} onPosted={(posted) => nav.push({ kind: "job", id: posted.job.id }, true)} />;
      case "job": return <DirectJobView id={view.id} onFind={(job) => nav.push({ kind: "find", trade: job.job.trade, forRequest: { id: job.job.id, kind: "direct_job", mode: "invite", label: job.job.title } })} />;
      case "find": return <><ForRequest forRequest={view.forRequest} /><Find key={view.forRequest.id} initialTrade={view.trade} onOpen={(id) => nav.push({ kind: "profile", id, forRequest: view.forRequest })} /></>;
    }
  };
  return (
    <div className="ws-page artisans-workspace">
      <WorkspaceHead icon="hammer" title={top ? VIEW_TITLE[top.kind] : "Artisans"}
        path={top ? <button type="button" className="art-link" onClick={nav.back}>← Back to artisans</button> : undefined}
        actions={becomeLabel && !top ? <Link className="art-application-entry" href={"/artisan" as never}>{becomeLabel}<ChevronRight aria-hidden="true" /></Link> : undefined}
      />
      <ArtisansNav tab={tab} onChange={chooseSection} placement="desktop" panelId={panelId} />
      <div id={panelId} className="art-section-content">
        <div hidden={!!top}>
          {request.forRequest ? <ForRequest forRequest={request.forRequest} /> : null}
          {tab === "find" ? (
            <Find key={`${request.trade ?? ""}:${request.forRequest?.id ?? ""}`} initialTrade={request.trade} onOpen={(id) => nav.push({ kind: "profile", id, forRequest: request.forRequest })} />
          ) : (
            <div className="art-work-layout">
              <aside className="art-directory-aside" aria-label="Work options">
                <h2>Your work</h2>
                <button type="button" className="ws-action" onClick={() => nav.push({ kind: "post" })}><Plus aria-hidden="true" /> Post a job</button>
              </aside>
              <div className="art-work-content"><Work tab={tab} onOpenJob={(id) => nav.push({ kind: "job", id })} /></div>
            </div>
          )}
        </div>
        {top ? <div className={top.kind === "find" ? "art-context-directory" : "art-detail-panel"} key={search.toString()}>{renderView(top)}</div> : null}
      </div>
    </div>
  );
}

function ForRequest({ forRequest }: { forRequest: ArtisansForRequest }) {
  const invite = forRequest.mode === "invite";
  return (
    <p className="art-for-request">
      {invite ? "Asking artisans to quote for" : "Suggesting an artisan for"} <strong>{forRequest.label}</strong>.
      Open a profile to {invite ? "ask them." : "suggest them to your landlord."}
    </p>
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
      <aside className="art-directory-aside art-trades-aside" aria-label="Trades">
      <h2>Trades</h2>
      <div className="art-find-trades" role="group" aria-label="Trade">
        <button type="button" className="art-chip" aria-pressed={trade === ""} onClick={() => setTrade("")}>
          All trades
        </button>
        {DISCOVERY_TRADES.map((option) => (
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
      </aside>
      <section className="art-directory-results" aria-label="Matching artisans">
      <div className="art-directory-heading"><div><h2>Find an artisan</h2></div>{result ? <span>{result.results.length} available</span> : null}</div>

      <div className="art-discovery-toolbar" role="group" aria-label="Search filters">
        <DistrictPicker selected={area} onChange={setArea} max={1} label="Area" chosenLabel="Area" placeholder="Search by area" search />
        {electrical ? null : (
          <label className="art-certification-filter" title="Artisans with a certificate Danpa HQ has verified">
            <span>Certified only</span>
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
        />
      )}
      </section>
    </div>
  );
}

function ArtisanRow({ artisan, onOpen }: { artisan: ArtisanCard; onOpen: () => void }) {
  return (
    <button type="button" className="art-result" onClick={onOpen}>
      <span className="art-result-main">
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
        </span>
        <ChevronRight className="art-result-arrow" aria-hidden="true" />
      </span>
      <Facts artisan={artisan} />
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
      <span className="art-fact"><Star aria-hidden="true" />{artisan.reviews_count ? `${artisan.reviews_count} review${artisan.reviews_count === 1 ? "" : "s"}` : "No reviews yet"}</span>
    </span>
  );
}

function Profile({
  id,
  forRequest,
  onPostFor,
  onOpenJob,
}: {
  id: string;
  forRequest?: ArtisansForRequest;
  onPostFor: (invite: AskFor) => void;
  onOpenJob: (id: string) => void;
}) {
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
        <div className="art-profile-identity">
          <span className="art-profile-portrait" aria-hidden="true">
            {artisan.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={artisan.cover_url} alt="" />
            ) : <Hammer />}
          </span>
          <div className="art-profile-intro">
            <span className="art-profile-eyebrow">Artisan profile</span>
            <h3>{artisan.name}</h3>
            <p>{artisan.trades.map((trade) => trade.label).join(" · ")}</p>
            <p className="art-result-area">
              <MapPin aria-hidden="true" />
              Works in {artisan.districts.map((district) => district.name).join(", ")}
            </p>
          </div>
        </div>
        <Facts artisan={artisan} />
        <div className="art-profile-contact">
          {artisan.is_you ? null : forRequest ? (
            <AskAction artisanId={artisan.id} name={artisan.name} forRequest={forRequest} />
          ) : (
            <QuoteAsk artisan={artisan} onPostFor={onPostFor} onOpenJob={onOpenJob} />
          )}
        </div>
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
        {artisan.reviews.length ? (
          <div className="art-reviews">
            {artisan.reviews.map((review) => (
              <blockquote key={review.id} className="art-review">
                <p>{review.text}</p>
                <footer>
                  {review.author} · {onDate(review.at)} · {review.would_hire_again ? "Would hire again" : "Would not hire again"}
                </footer>
              </blockquote>
            ))}
          </div>
        ) : (
          <p className="art-bio is-quiet">No reviews yet.</p>
        )}
      </section>

      <p className="art-profile-foot">
        On Danpa HQ since {onDate(artisan.member_since)}. Danpa HQ checks identity and certificates and keeps a
        record of each job; it does not guarantee anybody&apos;s work.
      </p>
      {artisan.is_you ? null : <ProblemReport target={{ kind: "artisan", artisanId: artisan.id }} />}
    </article>
  );
}

/**
 * Invite (or, for a tenant, suggest) this artisan for the request the sheet was
 * opened from. Inviting tells the artisan the area and the problem, never the
 * address; a suggestion tells only the people who run the property.
 */
function AskAction({ artisanId, name, forRequest }: { artisanId: string; name: string; forRequest: ArtisansForRequest }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  const invite = forRequest.mode === "invite";

  async function ask() {
    setState("busy");
    setError("");
    try {
      if (forRequest.kind === "direct_job") await inviteToDirectJob(forRequest.id, artisanId);
      else if (invite) await inviteArtisan(forRequest.id, artisanId);
      else await suggestArtisan(forRequest.id, artisanId);
      setState("done");
      window.dispatchEvent(new CustomEvent(ARTISAN_WORK_CHANGED, { detail: { requestId: forRequest.id } }));
    } catch (cause) {
      setState("idle");
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    }
  }

  if (state === "done") {
    return (
      <p className="art-asked" role="status">
        {invite
          ? `${name} has been asked to quote. They see the area and the job, not the address.`
          : `Suggested. Your landlord decides whether to ask ${name} to quote.`}
      </p>
    );
  }
  return (
    <div className="art-ask">
      <button type="button" className="ws-action is-primary" disabled={state === "busy"} onClick={() => void ask()}>
        {state === "busy" ? "Sending…" : invite ? "Invite to quote" : "Suggest to your landlord"}
      </button>
      {error ? <span className="art-missing" role="alert">{error}</span> : null}
    </div>
  );
}

/**
 * A profile opened from browsing: ask this artisan to quote. For one of your
 * open jobs, or a new job posted for them — they are asked as it is posted.
 * A repair on a rented home is asked about from the repair itself.
 */
function QuoteAsk({
  artisan,
  onPostFor,
  onOpenJob,
}: {
  artisan: PublicArtisan;
  onPostFor: (invite: AskFor) => void;
  onOpenJob: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<DirectJob[] | null>(null);
  const [asked, setAsked] = useState<Record<string, "busy" | "done">>({});
  const [error, setError] = useState("");
  const first = artisan.name.split(" ")[0] || artisan.name;

  useEffect(() => {
    if (!open || jobs) return;
    listMyDirectJobs()
      .then((rows) => setJobs(rows.filter((row) => row.permissions.invite)))
      .catch(() => setJobs([]));
  }, [open, jobs]);

  async function ask(job: DirectJob) {
    setAsked((current) => ({ ...current, [job.job.id]: "busy" }));
    setError("");
    try {
      await inviteToDirectJob(job.job.id, artisan.id);
      setAsked((current) => ({ ...current, [job.job.id]: "done" }));
      window.dispatchEvent(new CustomEvent(ARTISAN_WORK_CHANGED, { detail: { requestId: job.job.id } }));
    } catch (cause) {
      setAsked((current) => { const next = { ...current }; delete next[job.job.id]; return next; });
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    }
  }

  const post = () => onPostFor({ id: artisan.id, name: artisan.name, trade: artisan.trades[0]?.value });

  if (!open) {
    return (
      <div className="art-ask">
        <button type="button" className="ws-action is-primary" onClick={() => setOpen(true)}>
          Ask {first} for a quote
        </button>
      </div>
    );
  }
  return (
    <div className="art-quote-ask">
      <strong>What should {first} quote for?</strong>
      {error ? <span className="art-missing" role="alert">{error}</span> : null}
      {jobs === null ? <PanelSkeleton rows={1} /> : jobs.length ? (
        <ul>
          {jobs.map((job) => (
            <li key={job.job.id}>
              <span>
                <strong>{job.job.title}</strong>
                <small>{job.job.trade_display} · {job.job.area.locality}</small>
              </span>
              {asked[job.job.id] === "done" ? (
                <button type="button" className="art-link" onClick={() => onOpenJob(job.job.id)}>Asked · open job</button>
              ) : (
                <button type="button" className="ws-action" disabled={asked[job.job.id] === "busy"} onClick={() => void ask(job)}>
                  {asked[job.job.id] === "busy" ? "Asking…" : "Ask about this"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="ws-action is-primary art-post-button" onClick={post}>
        <Plus aria-hidden="true" /> Post a new job for {first}
      </button>
    </div>
  );
}

/**
 * Requests and Records: quotes asked for and waiting, and the work under way
 * or done. A repair opens on its maintenance page; a posted job opens here.
 */
function Work({
  tab,
  onOpenJob,
}: {
  tab: "requests" | "records";
  onOpenJob: (id: string) => void;
}) {
  const [work, setWork] = useState<{ requests: CustomerWorkItem[]; records: CustomerWorkItem[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const load = () =>
      getArtisanWork()
        .then((next) => { if (live) setWork(next); })
        .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load artisan work."); });
    void load();
    // A job posted, asked about or decided in a deeper view lands here on the way back.
    window.addEventListener(ARTISAN_WORK_CHANGED, load);
    return () => { live = false; window.removeEventListener(ARTISAN_WORK_CHANGED, load); };
  }, []);


  if (error) return <PanelState tone="error" icon="warning" title={error} />;
  if (!work) return <PanelSkeleton rows={3} />;
  const rows = tab === "requests" ? work.requests : work.records;
  if (!rows.length) {
    return tab === "requests" ? (
      <PanelState
        icon="receipt"
        title="No quote requests yet"
      />
    ) : (
      <PanelState icon="wrench" title="No artisan jobs yet" />
    );
  }
  return (
    <>
      <header className="art-work-head">
        <div>
          <h3>{tab === "requests" ? "Quote requests" : "Work records"}</h3>
          <p>{tab === "requests" ? "Review the people asked to quote and their replies." : "The artisans you chose, with the agreed price and progress."}</p>
        </div>
      </header>
      <ul className="art-work" aria-label={tab === "requests" ? "Quote requests" : "Artisan jobs"}>
        {rows.map((item) => {
          const waiting = item.invitations.flatMap((row) => row.quotes).filter((quote) => quote.status === "submitted").length;
          const who = item.assigned?.artisan.name
            ?? (item.invitations.map((row) => row.artisan.name).join(", ") || "Nobody asked yet");
          const direct = item.request.kind === "direct_job";
          const body = (
            <>
              <span className={`art-work-icon${direct ? " is-direct" : ""}`} aria-hidden="true">
                {direct ? <ClipboardList /> : <Wrench />}
              </span>
              <span className="art-work-body">
                <span className="art-work-heading">
                  <strong>{item.request.title}</strong>
                  <span className="art-work-status">{item.request.status_display}</span>
                </span>
                <small>{direct ? `${item.request.category_display} · ${item.request.place}` : item.request.place}</small>
                <span className="art-work-person">{who}</span>
                {waiting ? <span className="art-work-waiting">{waiting} quote{waiting === 1 ? "" : "s"} waiting</span> : null}
              </span>
              <span className="art-work-side">
                {item.assigned?.price_on_record ? <><small>Agreed price</small><strong>{item.assigned.price_on_record.price_display}</strong></> : null}
                <ChevronRight aria-hidden="true" />
              </span>
            </>
          );
          return (
            <li key={`${item.request.kind}:${item.request.id}`}>
              {direct ? (
                <button type="button" className="art-work-row" onClick={() => onOpenJob(item.request.id)}>{body}</button>
              ) : (
                <Link href={`/maintenance?request=${item.request.id}` as never} className="art-work-row">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
