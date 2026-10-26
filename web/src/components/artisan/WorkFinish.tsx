"use client";

/**
 * How artisan work finishes, on a repair, a posted job, and the artisan's own job.
 *
 * Three pieces, one look everywhere:
 *
 * - **WorkFinish** shows each time the artisan said "done" — what they wrote,
 *   photographs, and receipts for the side the money belongs to — and offers
 *   the next step the backend allows: confirm or reopen a posted job, record
 *   payment, write the one review. On a repair the tenant confirms in the
 *   maintenance section above, as before.
 * - **WorkDoneForm** is the artisan's "the work is done", with photos.
 * - **ProblemReport** is Report a problem, on a job or a profile, with evidence.
 *
 * Recording payment moves no money and says so; a review is words and whether
 * the payer would hire them again, never a score.
 */

import { CheckCircle2, Flag, ImagePlus, Receipt, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/Button";
import { Switch } from "@/components/Check";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { useToast } from "@/components/toast/Toaster";
import { ApiFailure } from "@/lib/api";
import {
  ABOUT_ARTISAN,
  ABOUT_CUSTOMER,
  MAX_DONE_PHOTOS,
  MAX_EVIDENCE_FILES,
  MAX_RECEIPTS,
  PAID_NOTE,
  confirmDirectJob,
  recordPaid,
  reopenDirectJob,
  reportArtisan,
  reportJobProblem,
  reportWorkDone,
  reviewJob,
  type ArtisanInvitation,
  type WorkFinish as Finish,
  type WorkReport,
} from "@/lib/artisan";
import { uploadFile } from "@/lib/console";
import { onDate } from "@/lib/time";

function failure(cause: unknown, fallback: string) {
  if (cause instanceof ApiFailure) return cause.error.message;
  return cause instanceof Error ? cause.message : fallback;
}

// --- reading the finish --------------------------------------------------------------

export function WorkFinish({
  work,
  priceOnRecord,
  directJobId,
  canConfirm = false,
  onChanged,
}: {
  work: Finish;
  /** Shown when recording payment, so the payer sees what they are recording. */
  priceOnRecord?: string;
  /** Set on a posted job: its poster confirms or reopens here. */
  directJobId?: string;
  canConfirm?: boolean;
  onChanged: () => void | Promise<void>;
}) {
  if (!work.reports.length && !work.finished) return null;
  const reports = [...work.reports].reverse();

  return (
    <section className="art-finish" aria-label="The finished work">
      <header className="art-finish-head">
        <strong>The work</strong>
        {work.finished ? (
          <span className="art-finish-chip is-done"><CheckCircle2 aria-hidden="true" />Confirmed done</span>
        ) : (
          <span className="art-finish-chip">Reported done</span>
        )}
        {work.paid_at ? <span className="art-finish-chip is-paid">Paid · recorded {onDate(work.paid_at)}</span> : null}
      </header>

      {reports.map((report, index) => (
        <ReportCard key={report.id} report={report} latest={index === 0} />
      ))}

      {canConfirm && directJobId ? <ConfirmOrReopen jobId={directJobId} onChanged={onChanged} /> : null}
      {work.may_record_paid && work.invitation_id ? (
        <RecordPaid invitationId={work.invitation_id} price={priceOnRecord} onChanged={onChanged} />
      ) : null}
      {work.review ? <ReviewCard review={work.review} /> : null}
      {work.may_review && work.invitation_id ? (
        <ReviewForm invitationId={work.invitation_id} onChanged={onChanged} />
      ) : null}
    </section>
  );
}

function ReportCard({ report, latest }: { report: WorkReport; latest: boolean }) {
  return (
    <article className={`art-done${latest ? "" : " is-earlier"}`}>
      <p className="art-done-when">
        Reported done {onDate(report.at)}
        {report.confirmed_at ? ` · confirmed ${onDate(report.confirmed_at)}` : ""}
      </p>
      {report.note ? <p className="art-done-note">{report.note}</p> : null}
      {report.photos.length ? (
        <div className="art-done-photos">
          {report.photos.map((photo, index) =>
            photo.url ? (
              // A short-lived signed URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={photo.id} src={photo.url} alt={`Finished work, photo ${index + 1}`} loading="lazy" />
            ) : null,
          )}
        </div>
      ) : null}
      {report.receipts.length ? (
        <ul className="art-done-receipts" aria-label="Receipts">
          {report.receipts.map((receipt) => (
            <li key={receipt.id}>
              <Receipt aria-hidden="true" />
              {receipt.url ? <a href={receipt.url} target="_blank" rel="noreferrer">{receipt.name}</a> : receipt.name}
            </li>
          ))}
        </ul>
      ) : null}
      {report.reopened_at ? (
        <p className="art-done-reopened">
          <RotateCcw aria-hidden="true" /> Reopened {onDate(report.reopened_at)}: {report.reopen_reason}
        </p>
      ) : null}
    </article>
  );
}

function ConfirmOrReopen({ jobId, onChanged }: { jobId: string; onChanged: () => void | Promise<void> }) {
  const { toast } = useToast();
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
      toast({ tone: "success", title: done });
    } catch (cause) {
      setError(failure(cause, "That did not go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="art-finish-step">
      {error ? <Notice tone="error" title={error} /> : null}
      {reopening ? (
        <>
          <div className="mt-field">
            <label htmlFor={`art-reopen-${jobId}`}>What is still not right?</label>
            <textarea
              id={`art-reopen-${jobId}`}
              className="lw-textarea"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="mt-quote-actions">
            <button
              type="button"
              className="ws-action is-primary"
              disabled={busy || reason.trim().length < 5}
              onClick={() => void run(() => reopenDirectJob(jobId, reason.trim()), "Sent back to the artisan")}
            >
              {busy ? "Sending…" : "Send it back"}
            </button>
            <button type="button" className="ws-action" disabled={busy} onClick={() => setReopening(false)}>Not now</button>
          </div>
        </>
      ) : (
        <>
          <p className="art-finish-ask">Is the work done the way you agreed?</p>
          <div className="mt-quote-actions">
            <button
              type="button"
              className="ws-action is-primary"
              disabled={busy}
              onClick={() => void run(() => confirmDirectJob(jobId), "Confirmed done")}
            >
              {busy ? "Confirming…" : "Yes, it's done"}
            </button>
            <button type="button" className="ws-action" disabled={busy} onClick={() => setReopening(true)}>
              Something&apos;s not right
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RecordPaid({
  invitationId,
  price,
  onChanged,
}: {
  invitationId: string;
  price?: string;
  onChanged: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function record() {
    setBusy(true);
    setError("");
    try {
      await recordPaid(invitationId);
      await onChanged();
      toast({ tone: "success", title: "Payment recorded" });
    } catch (cause) {
      setError(failure(cause, "Could not record the payment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="art-finish-step">
      {error ? <Notice tone="error" title={error} /> : null}
      {asking ? (
        <>
          <p className="mt-quote-tip">{PAID_NOTE}</p>
          <div className="mt-quote-actions">
            <button type="button" className="ws-action is-primary" disabled={busy} onClick={() => void record()}>
              {busy ? "Recording…" : `I paid${price ? ` ${price}` : ""}`}
            </button>
            <button type="button" className="ws-action" disabled={busy} onClick={() => setAsking(false)}>Not yet</button>
          </div>
        </>
      ) : (
        <button type="button" className="ws-action" onClick={() => setAsking(true)}>Record payment</button>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: NonNullable<Finish["review"]> }) {
  return (
    <blockquote className="art-review">
      <p>{review.text}</p>
      <footer>
        {review.author} · {onDate(review.at)} · {review.would_hire_again ? "Would hire again" : "Would not hire again"}
      </footer>
    </blockquote>
  );
}

function ReviewForm({ invitationId, onChanged }: { invitationId: string; onChanged: () => void | Promise<void> }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [again, setAgain] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await reviewJob(invitationId, { text: text.trim(), would_hire_again: again });
      await onChanged();
      toast({ tone: "success", title: "Review added" });
    } catch (cause) {
      setError(failure(cause, "Could not save the review."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="art-finish-step art-review-form" onSubmit={submit}>
      <strong>How did it go?</strong>
      {error ? <Notice tone="error" title={error} /> : null}
      <textarea
        aria-label="Your review"
        className="lw-textarea"
        rows={3}
        maxLength={1000}
        value={text}
        placeholder="On time? Tidy? Did it hold? A sentence or two helps the next customer."
        onChange={(event) => setText(event.target.value)}
      />
      <label className="art-toggle">
        <span><strong>I would hire them again</strong></span>
        <Switch checked={again} onChange={setAgain} label="I would hire them again" />
      </label>
      <div className="mt-quote-actions">
        <button type="submit" className="ws-action is-primary" disabled={busy || text.trim().length < 10}>
          {busy ? "Saving…" : "Add review"}
        </button>
      </div>
    </form>
  );
}

// --- the artisan's "done" -------------------------------------------------------------

type Picked = { key: string; file: File; url: string };

function useFiles() {
  const [files, setFiles] = useState<Picked[]>([]);
  const held = useRef<Picked[]>([]);
  useEffect(() => {
    held.current = files;
  }, [files]);
  // Previews are freed when one is removed and when the form goes, not on
  // every change — that would free the ones still on screen.
  useEffect(() => () => held.current.forEach((row) => URL.revokeObjectURL(row.url)), []);
  return {
    files,
    add(list: FileList | null, max: number) {
      const room = Math.max(0, max - files.length);
      const next = Array.from(list ?? []).slice(0, room).map((file, index) => ({
        key: `${file.name}-${file.size}-${files.length + index}-${file.lastModified}`,
        file,
        url: URL.createObjectURL(file),
      }));
      setFiles((current) => [...current, ...next]);
    },
    remove(key: string) {
      const gone = files.find((row) => row.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      setFiles((current) => current.filter((row) => row.key !== key));
    },
  };
}

export function WorkDoneForm({
  invitation,
  onDone,
}: {
  invitation: ArtisanInvitation;
  onDone: (next: ArtisanInvitation) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const photos = useFiles();
  const receipts = useFiles();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button type="button" className="ws-action is-primary art-done-open" onClick={() => setOpen(true)}>
        <CheckCircle2 aria-hidden="true" /> The work is done
      </button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!photos.files.length) {
      setError("Add at least one photo of the finished work.");
      return;
    }
    setError("");
    try {
      setBusy("Uploading photos…");
      const photoIds = [];
      for (const row of photos.files) photoIds.push((await uploadFile(row.file, "artisan_done_photo")).id);
      const receiptIds = [];
      for (const row of receipts.files) receiptIds.push((await uploadFile(row.file, "artisan_receipt")).id);
      setBusy("Sending…");
      const next = await reportWorkDone(invitation.id, { note: note.trim(), photo_file_ids: photoIds, receipt_file_ids: receiptIds });
      await onDone(next);
      toast({ tone: "success", title: "Sent for confirmation" });
    } catch (cause) {
      setError(failure(cause, "Could not send it."));
    } finally {
      setBusy("");
    }
  }

  const confirmer = invitation.request.kind === "direct_job" ? "The customer" : "The tenant";
  return (
    <form className="art-quote-form art-done-form" onSubmit={submit}>
      <h3>The work is done</h3>
      <p className="art-bio is-quiet">{confirmer} confirms it, or tells you what is still not right.</p>
      {error ? <Notice tone="error" title={error} /> : null}
      <div className="mt-field">
        <label htmlFor={`art-done-${invitation.id}`}>What you did <span className="art-optional">optional</span></label>
        <textarea
          id={`art-done-${invitation.id}`}
          className="lw-textarea"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Replaced the washer and resealed the trap."
        />
      </div>
      <FilePicker
        label="Photos of the finished work"
        accept="image/jpeg,image/png,image/webp,image/heic"
        picked={photos.files}
        max={MAX_DONE_PHOTOS}
        onAdd={(list) => photos.add(list, MAX_DONE_PHOTOS)}
        onRemove={photos.remove}
      />
      <FilePicker
        label="Receipts"
        optional
        accept="image/jpeg,image/png,image/heic,application/pdf"
        picked={receipts.files}
        max={MAX_RECEIPTS}
        onAdd={(list) => receipts.add(list, MAX_RECEIPTS)}
        onRemove={receipts.remove}
      />
      <div className="mt-quote-actions">
        <Button type="submit" busy={Boolean(busy)} busyLabel={busy || "Sending…"}>Send for confirmation</Button>
        <button type="button" className="ws-action" disabled={Boolean(busy)} onClick={() => setOpen(false)}>Not yet</button>
      </div>
    </form>
  );
}

function FilePicker({
  label,
  optional = false,
  accept,
  picked,
  max,
  onAdd,
  onRemove,
}: {
  label: string;
  optional?: boolean;
  accept: string;
  picked: Picked[];
  max: number;
  onAdd: (list: FileList | null) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="art-pick">
      <span className="art-pick-label">
        {label} {optional ? <span className="art-optional">optional</span> : null}
      </span>
      <div className="art-photos">
        {picked.map((row, index) => (
          <figure key={row.key} className="art-photo">
            {row.file.type.startsWith("image/") ? (
              // A local preview.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.url} alt={`${label} ${index + 1}`} />
            ) : (
              <span className="art-photo-file"><Receipt aria-hidden="true" />{row.file.name}</span>
            )}
            <button type="button" className="art-photo-remove" aria-label={`Remove ${row.file.name}`} onClick={() => onRemove(row.key)}>
              <X aria-hidden="true" />
            </button>
          </figure>
        ))}
        {picked.length < max ? (
          <label className="art-photo-add">
            <input
              type="file"
              accept={accept}
              multiple
              className="sr-only"
              onChange={(event) => {
                onAdd(event.target.files);
                event.target.value = "";
              }}
            />
            <ImagePlus aria-hidden="true" />
            <span>Add</span>
          </label>
        ) : null}
      </div>
    </div>
  );
}

// --- Report a problem ----------------------------------------------------------------

export function ProblemReport({
  target,
  side = "customer",
}: {
  target: { kind: "job"; invitationId: string } | { kind: "artisan"; artisanId: string };
  side?: "customer" | "artisan";
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const evidence = useFiles();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const choices = side === "artisan" ? ABOUT_CUSTOMER : ABOUT_ARTISAN;

  if (sent) {
    return (
      <p className="art-asked" role="status">
        Sent to Danpa HQ&apos;s team with what you attached and the job as it stands. They may contact you.
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" className="art-link art-report-open" onClick={() => setOpen(true)}>
        <Flag aria-hidden="true" /> Report a problem
      </button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      setBusy("Uploading…");
      const fileIds = [];
      for (const row of evidence.files) fileIds.push((await uploadFile(row.file, "report_evidence")).id);
      setBusy("Sending…");
      const input = { category, summary: summary.trim(), details: details.trim(), file_ids: fileIds };
      if (target.kind === "job") await reportJobProblem(target.invitationId, input);
      else await reportArtisan(target.artisanId, input);
      setSent(true);
    } catch (cause) {
      setError(failure(cause, "Could not send the report."));
    } finally {
      setBusy("");
    }
  }

  return (
    <form className="art-report" onSubmit={submit}>
      <h4><Flag aria-hidden="true" /> Report a problem</h4>
      <p className="art-bio is-quiet">
        Danpa HQ&apos;s team reviews every report and can suspend an artisan. It does not settle payments between you.
      </p>
      {error ? <Notice tone="error" title={error} /> : null}
      <div className="art-chips" role="group" aria-label="What went wrong">
        {choices.map((option) => (
          <button
            key={option.value}
            type="button"
            className="art-chip"
            aria-pressed={category === option.value}
            onClick={() => setCategory(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <Field label="In a few words" value={summary} maxLength={180} onChange={(event) => setSummary(event.target.value)} />
      <div className="mt-field">
        <label htmlFor="art-report-details">What happened <span className="art-optional">optional</span></label>
        <textarea id="art-report-details" className="lw-textarea" rows={3} maxLength={3000} value={details} onChange={(event) => setDetails(event.target.value)} />
      </div>
      <FilePicker
        label="Photos or documents"
        optional
        accept="image/jpeg,image/png,image/heic,application/pdf"
        picked={evidence.files}
        max={MAX_EVIDENCE_FILES}
        onAdd={(list) => evidence.add(list, MAX_EVIDENCE_FILES)}
        onRemove={evidence.remove}
      />
      <div className="mt-quote-actions">
        <Button type="submit" busy={Boolean(busy)} busyLabel={busy || "Sending…"} disabled={!category || summary.trim().length < 5}>
          Send report
        </Button>
        <button type="button" className="ws-action" disabled={Boolean(busy)} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
