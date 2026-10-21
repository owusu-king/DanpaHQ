"use client";

/**
 * Direct jobs: work somebody hires an artisan for themselves — a wardrobe to
 * assemble, a room to paint — with no property or repair behind it.
 *
 * Whoever posts the job is its payer: they ask up to three artisans to quote,
 * approve one price, and may call the job off. An invited artisan reads the job
 * and the area; the address below opens only to the one whose quote is approved.
 */

import { Hammer, ImagePlus, Lock, MapPin, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Brief, QuoteCard } from "@/components/artisan/MaintenanceArtisans";
import { ProblemReport, WorkFinish } from "@/components/artisan/WorkFinish";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { useToast } from "@/components/toast/Toaster";
import { PanelSkeleton, PanelState } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  ARTISAN_WORK_CHANGED,
  INVITATION_STATE_LABEL,
  TRADES,
  approveQuote,
  cancelDirectJob,
  declineQuote,
  getDirectJob,
  postDirectJob,
  type DirectJob,
  type QuoteView,
} from "@/lib/artisan";
import { searchLocalities, uploadFile, type Locality } from "@/lib/console";
import { onDate } from "@/lib/time";

function failure(cause: unknown, fallback: string) {
  if (cause instanceof ApiFailure) return cause.error.message;
  return cause instanceof Error ? cause.message : fallback;
}

/** Tell any open list or job view that this job changed. */
function announce(jobId: string) {
  window.dispatchEvent(new CustomEvent(ARTISAN_WORK_CHANGED, { detail: { requestId: jobId } }));
}

// --- posting ---------------------------------------------------------------------

export function PostJob({ onPosted }: { onPosted: (job: DirectJob) => void }) {
  const [trade, setTrade] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locality, setLocality] = useState<Locality | null>(null);
  const [houseNumber, setHouseNumber] = useState("");
  const [street, setStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const missing = {
    trade: !trade,
    title: title.trim().length < 3,
    description: description.trim().length < 10,
    locality: !locality,
  };
  const ready = !Object.values(missing).some(Boolean);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!ready || !locality) return;
    setError("");
    try {
      let photoId: string | null = null;
      if (photo) {
        setBusy("Uploading the photo…");
        photoId = (await uploadFile(photo.file, "artisan_job_photo")).id;
      }
      setBusy("Posting…");
      const job = await postDirectJob({
        trade,
        title: title.trim(),
        description: description.trim(),
        locality_id: locality.id,
        photo_file_id: photoId,
        house_number: houseNumber.trim(),
        street: street.trim(),
        landmark: landmark.trim(),
      });
      announce(job.job.id);
      onPosted(job);
    } catch (cause) {
      setError(failure(cause, "Could not post the job."));
    } finally {
      setBusy("");
    }
  }

  return (
    <form className="art-post" onSubmit={submit} noValidate>
      {error ? <Notice tone="error" title={error} /> : null}

      <section className="art-post-part" aria-labelledby="art-post-what">
        <h4 id="art-post-what">What needs doing</h4>
        <div className="art-chips" role="group" aria-label="Trade">
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
        {attempted && missing.trade ? <p className="art-missing" role="alert">Choose a trade.</p> : null}
        <Field
          label="Title"
          value={title}
          maxLength={120}
          placeholder="For example, assemble a wardrobe"
          error={attempted && missing.title ? "Give the job a short title." : undefined}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="mt-field">
          <label htmlFor="art-post-description">Details</label>
          <textarea
            id="art-post-description"
            className="lw-textarea"
            rows={3}
            maxLength={2000}
            value={description}
            placeholder="Sizes, materials you have, when it suits you."
            onChange={(event) => setDescription(event.target.value)}
          />
          {attempted && missing.description ? (
            <p className="art-missing" role="alert">Say in a sentence or two what needs doing.</p>
          ) : null}
        </div>
        <div className="art-post-photo">
          {photo ? (
            <figure className="art-photo">
              {/* A local preview; next/image cannot read it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="The job" />
              <button type="button" className="art-photo-remove" aria-label="Remove the photo" onClick={() => setPhoto(null)}>
                <X aria-hidden="true" />
              </button>
            </figure>
          ) : (
            <label className="art-photo-add">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) setPhoto({ file, url: URL.createObjectURL(file) });
                  event.target.value = "";
                }}
              />
              <ImagePlus aria-hidden="true" />
              <span>Add a photo</span>
            </label>
          )}
          <small className="art-post-note">A photo is optional, and helps a fair price.</small>
        </div>
      </section>

      <section className="art-post-part" aria-labelledby="art-post-where">
        <h4 id="art-post-where">Where</h4>
        <LocalityPicker selected={locality} onChange={setLocality} />
        {attempted && missing.locality ? <p className="art-missing" role="alert">Choose the area.</p> : null}
        <div className="art-post-address">
          <Field label="House number" value={houseNumber} maxLength={32} onChange={(event) => setHouseNumber(event.target.value)} />
          <Field label="Street" value={street} maxLength={160} onChange={(event) => setStreet(event.target.value)} />
        </div>
        <Field
          label="Landmark"
          value={landmark}
          maxLength={200}
          placeholder="Blue gate opposite the pharmacy"
          onChange={(event) => setLandmark(event.target.value)}
        />
        <p className="art-post-private">
          <Lock aria-hidden="true" />
          Artisans you ask see the area only. The address and your phone open to the one you approve.
        </p>
      </section>

      <div className="art-submit">
        <Button type="submit" busy={Boolean(busy)} busyLabel={busy || "Posting…"}>Post the job</Button>
        {attempted && !ready ? <span className="art-missing">Some parts above still need you.</span> : null}
      </div>
    </form>
  );
}

function LocalityPicker({ selected, onChange }: { selected: Locality | null; onChange: (next: Locality | null) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Locality[]>([]);
  const asked = useRef(0);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) return;
    const turn = ++asked.current;
    const timer = window.setTimeout(() => {
      searchLocalities(needle)
        .then((rows) => { if (turn === asked.current) setMatches(rows.slice(0, 8)); })
        .catch(() => { if (turn === asked.current) setMatches([]); });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  if (selected) {
    return (
      <ul className="art-chosen" aria-label="Area">
        <li>
          <MapPin aria-hidden="true" />
          <span>{selected.name}, {selected.district_name}</span>
          <button type="button" aria-label={`Remove ${selected.name}`} onClick={() => onChange(null)}>
            <X aria-hidden="true" />
          </button>
        </li>
      </ul>
    );
  }
  const shown = query.trim().length >= 2 ? matches : [];
  return (
    <div className="art-districts">
      <Field label="Area" value={query} placeholder="Type a neighbourhood, for example Osu" onChange={(event) => setQuery(event.target.value)} />
      {shown.length ? (
        <ul className="art-matches" role="listbox" aria-label="Matching areas">
          {shown.map((row) => (
            <li key={row.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => { onChange(row); setQuery(""); }}>
                <strong>{row.name}</strong>
                <small>{row.district_name} · {row.region_name}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// --- one job ---------------------------------------------------------------------

export function DirectJobView({ id, onFind }: { id: string; onFind: (job: DirectJob) => void }) {
  const { toast } = useToast();
  const [job, setJob] = useState<DirectJob | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      getDirectJob(id)
        .then((next) => { if (live) setJob(next); })
        .catch((cause) => { if (live) setError(failure(cause, "Could not open this job.")); });
    void load();
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ requestId: string }>).detail?.requestId === id) void load();
    };
    window.addEventListener(ARTISAN_WORK_CHANGED, onChange);
    return () => { live = false; window.removeEventListener(ARTISAN_WORK_CHANGED, onChange); };
  }, [id]);

  if (error) return <PanelState tone="error" icon="warning" title={error} />;
  if (!job) return <PanelSkeleton rows={4} />;

  async function decide(quote: QuoteView, approve: boolean) {
    setBusy(quote.id);
    setActionError("");
    try {
      if (approve) await approveQuote(quote.id);
      else await declineQuote(quote.id);
      setConfirming(null);
      setJob(await getDirectJob(id));
      announce(id);
      toast({
        tone: "success",
        title: approve
          ? quote.revises ? "Revised price approved" : "Artisan chosen"
          : quote.revises ? "Revised price declined" : "Quote declined",
      });
    } catch (cause) {
      setActionError(failure(cause, "That did not go through. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setJob(await getDirectJob(id));
    announce(id);
  }

  async function cancel() {
    setBusy("cancel");
    setActionError("");
    try {
      setJob(await cancelDirectJob(id));
      setConfirming(null);
      announce(id);
      toast({ tone: "success", title: "Job cancelled" });
    } catch (cause) {
      setActionError(failure(cause, "Could not cancel the job."));
    } finally {
      setBusy(null);
    }
  }

  const { job: about, assigned, invitations, permissions } = job;
  const cancelled = about.status === "cancelled";
  const pendingRevision = invitations
    .flatMap((row) => row.quotes)
    .find((quote) => quote.revises && quote.status === "submitted");
  const waitingRows = invitations.filter((row) => row.state !== "assigned" && row.state !== "completed");

  return (
    <article className="art-job">
      <header className="art-job-head">
        <span className={`art-job-status is-${about.status}`}>{about.status_display}</span>
        <h3>{about.title}</h3>
        <p>
          {about.trade_display} · <MapPin aria-hidden="true" /> {about.area.locality}, {about.area.district}
        </p>
        <small>Posted {onDate(about.created_at)}</small>
      </header>

      {about.photo?.url ? (
        // A short-lived signed URL.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="art-job-photo" src={about.photo.url} alt="The job" />
      ) : null}
      <p className="art-bio">{about.description}</p>

      {about.address.line || about.address.landmark ? (
        <p className="art-post-private">
          <Lock aria-hidden="true" />
          <span>
            {[about.address.line, about.address.landmark].filter(Boolean).join(" · ")}
            <small>Shown only to the artisan you approve.</small>
          </span>
        </p>
      ) : null}

      {actionError ? <Notice tone="error" title={actionError} /> : null}

      <section className="mt-artisans" aria-labelledby={`art-job-${about.id}`}>
        <header className="mt-artisans-head">
          <strong id={`art-job-${about.id}`}>Artisan</strong>
          {permissions.invite ? (
            <button type="button" className="ws-action" onClick={() => onFind(job)}>
              {invitations.length ? "Ask another" : "Find an artisan"}
            </button>
          ) : null}
        </header>

        {assigned ? (
          <div className="mt-artisan is-assigned">
            <Brief artisan={assigned.artisan} />
            <div className="mt-artisan-facts">
              <span className="mt-artisan-chip is-kola">{cancelled ? "Was chosen" : job.work?.finished ? "Did the work" : "Doing the work"}</span>
              {assigned.assigned_at ? <small>Since {onDate(assigned.assigned_at)}</small> : null}
              {assigned.price_on_record ? (
                <small>Price on record <strong>{assigned.price_on_record.price_display}</strong></small>
              ) : null}
            </div>
            {pendingRevision ? (
              <QuoteCard
                quote={pendingRevision}
                title={`Revised price: ${pendingRevision.price_display}`}
                canDecide={permissions.approve}
                confirming={confirming === pendingRevision.id}
                busy={busy === pendingRevision.id}
                onAsk={() => setConfirming(pendingRevision.id)}
                onCancel={() => setConfirming(null)}
                onDecide={(approve) => void decide(pendingRevision, approve)}
              />
            ) : null}
          </div>
        ) : null}

        {waitingRows.length ? (
          <ul className="mt-artisan-list">
            {waitingRows.map((row) => {
              const waiting = row.quotes.find((quote) => quote.status === "submitted" && !quote.revises);
              const latest = waiting ?? row.quotes[row.quotes.length - 1];
              return (
                <li key={row.id} className="mt-artisan">
                  <Brief artisan={row.artisan} />
                  <div className="mt-artisan-facts">
                    <span className={`mt-artisan-chip is-${row.state}`}>{INVITATION_STATE_LABEL[row.state]}</span>
                  </div>
                  {latest ? (
                    <QuoteCard
                      quote={latest}
                      title={`${latest.price_display}${latest.status === "submitted" ? "" : ` · ${latest.status_display}`}`}
                      canDecide={permissions.approve && latest.status === "submitted" && !assigned}
                      confirming={confirming === latest.id}
                      busy={busy === latest.id}
                      onAsk={() => setConfirming(latest.id)}
                      onCancel={() => setConfirming(null)}
                      onDecide={(approve) => void decide(latest, approve)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : !assigned ? (
          <p className="mt-artisan-note">
            <Hammer aria-hidden="true" /> Ask up to {job.max_open_invitations} artisans to quote. They see the job and the area.
          </p>
        ) : null}
      </section>

      {job.work ? (
        <WorkFinish
          work={job.work}
          priceOnRecord={assigned?.price_on_record?.price_display}
          directJobId={about.id}
          canConfirm={Boolean(permissions.confirm)}
          onChanged={refresh}
        />
      ) : null}
      {permissions.report && job.work?.invitation_id ? (
        <ProblemReport target={{ kind: "job", invitationId: job.work.invitation_id }} />
      ) : null}

      {permissions.cancel ? (
        <div className="art-job-cancel">
          {confirming === "cancel" ? (
            <>
              <span>Cancel this job? Anybody asked is told.</span>
              <button type="button" className="ws-action is-danger" disabled={busy === "cancel"} onClick={() => void cancel()}>
                {busy === "cancel" ? "Cancelling…" : "Cancel the job"}
              </button>
              <button type="button" className="ws-action" disabled={busy === "cancel"} onClick={() => setConfirming(null)}>Keep it</button>
            </>
          ) : (
            <button type="button" className="art-link" onClick={() => setConfirming("cancel")}>Cancel this job</button>
          )}
        </div>
      ) : null}
    </article>
  );
}
