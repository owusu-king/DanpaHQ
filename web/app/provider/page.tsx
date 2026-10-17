"use client";

import {
  AlertCircle,
  BookOpen,
  Building2,
  Car,
  ChevronRight,
  CircleCheck,
  CreditCard,
  FileBadge,
  Bell,
  ImagePlus,
  Lock,
  Megaphone,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { providerStops, VerificationTrack } from "@/components/auth/VerificationTrack";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
import {
  getProviderReadiness,
  getProviderStanding,
  submitProviderVerification,
  uploadFile,
  type ProviderReadiness,
  type ProviderStanding,
} from "@/lib/console";
import { chooseWorkspace, useSession } from "@/lib/session";

/**
 * Provider standing — and, until it is approved, the provider's home.
 *
 * The backend sends a provider whose verification is not yet approved here
 * (`entry_routes.web`), so this page has to be somewhere a person can live for
 * a few days rather than a form they bounce off: where they stand, in one
 * heading and one pill; the same four stops the welcome showed; sending
 * evidence as one card; what is locked shown with a lock rather than hidden;
 * and somewhere to go meanwhile.
 *
 * Deliberately not the same screen as claiming a property. This answers a
 * question about the person and is decided once; whether they control any
 * particular address is a separate review against separate evidence, and now
 * happens inside property creation (ADR 0024).
 *
 * Every state here is read from the backend. A client that decided for itself
 * whether the workspace was open is the thing this architecture removed.
 */
const DOCUMENT_TYPES = [
  { value: "ghana_card_front", label: "Ghana Card", Icon: CreditCard },
  { value: "passport", label: "Passport", Icon: BookOpen },
  { value: "drivers_licence", label: "Driver's licence", Icon: Car },
  { value: "ghana_card_back", label: "Ghana Card (back)", Icon: CreditCard },
  { value: "business_certificate", label: "Business certificate", Icon: FileBadge },
  { value: "agency_licence", label: "Agency licence", Icon: FileBadge },
] as const;

const LOCKED_TOOLS = [
  { label: "Properties", Icon: Building2 },
  { label: "Tenants", Icon: Users },
  { label: "Rent & payments", Icon: Wallet },
  { label: "Listings", Icon: Megaphone },
] as const;

type Status = ProviderStanding["verification_status"] | "not_started";

const LOOK: Record<string, { title: string; line: string; pill: string; tone: string }> = {
  approved: { title: "You're verified", line: "Provider tools are open.", pill: "Approved", tone: "is-approved" },
  pending: {
    title: "Verification under review",
    line: "Your document is with our team. There is nothing more to send — we will let you know the outcome.",
    pill: "Under review",
    tone: "is-waiting",
  },
  needs_more_info: { title: "One more thing needed", line: "The review is paused until we have it.", pill: "Action needed", tone: "is-attention" },
  rejected: { title: "Not approved yet", line: "Read the note, put it right, and send again.", pill: "Not approved", tone: "is-attention" },
  revoked: { title: "Approval withdrawn", line: "Provider tools are closed until this is resolved.", pill: "Withdrawn", tone: "is-attention" },
  expired: { title: "Verification expired", line: "Send a current document to reopen provider tools.", pill: "Expired", tone: "is-attention" },
  not_started: {
    title: "Verify to start operating",
    line: "Provider verification is required before provider operations can be activated. One ID document opens properties, tenants, rent and listings.",
    pill: "Not verified",
    tone: "",
  },
};

function ProviderStandingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, refresh } = useSession();

  const [standing, setStanding] = useState<ProviderStanding | null>(null);
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [documentType, setDocumentType] = useState<string>("ghana_card_front");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justSent, setJustSent] = useState(false);
  const evidence = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  const load = useCallback(async () => {
    try {
      const [next, ready] = await Promise.all([
        getProviderStanding(),
        getProviderReadiness().catch(() => null),
      ]);
      setStanding(next);
      setReadiness(ready);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your status.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Arriving from the welcome's "Verify now": bring the evidence card into view, once.
  useEffect(() => {
    if (!standing || scrolled.current || searchParams.get("send") !== "1") return;
    scrolled.current = true;
    evidence.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [searchParams, standing]);

  // A picked image is shown as itself; the object URL is released with it.
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const stored = await uploadFile(file, "identity_document");
      await submitProviderVerification([{ file_id: stored.id, evidence_type: documentType }]);
      setFile(null);
      setJustSent(true);
      await load();
      await refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : cause instanceof Error
            ? cause.message
            : "Could not send that document.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function switchToTenant() {
    await chooseWorkspace("tenant");
    await refresh();
    router.replace("/rentals");
  }

  const capabilities = state.status === "signed_in" ? state.me.capabilities : null;
  const status: Status = standing?.verification_status ?? "not_started";
  const look = LOOK[status] ?? LOOK.not_started!;
  const approved = status === "approved";
  const pending = status === "pending";
  const canSend = standing !== null && !approved && !pending;
  const canSwitchToTenant = capabilities?.available_workspaces.includes("tenant") ?? false;
  const note = readiness?.identity_decision_note ?? "";

  return (
    <div className="pv">
      <header className="pv-hero">
        {standing ? (
          <span className={`pv-pill ${look.tone}`}>
            {pending ? <span className="pv-pulse" aria-hidden="true" /> : approved ? <ShieldCheck aria-hidden="true" /> : status === "not_started" ? <ShieldCheck aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
            {look.pill}
          </span>
        ) : null}
        <h1>{standing ? look.title : "Provider verification"}</h1>
        <p>{standing ? look.line : "Checking where your verification stands…"}</p>
      </header>

      {error ? <Notice tone="error" title={error} /> : null}

      {standing ? (
        <div className="pv-grid">
          <section className="pv-card" aria-labelledby="pv-where">
            <h2 id="pv-where">Where you are</h2>
            {justSent && pending ? (
              <div className="pv-sent" role="status">
                <div className="auth-success" aria-hidden="true">
                  <span className="auth-success-ring" />
                  <span className="auth-success-disc"><CircleCheck /></span>
                </div>
                <strong>Verification submitted</strong>
                <small>It is under review. We will tell you the outcome — you can keep exploring meanwhile.</small>
              </div>
            ) : null}
            {note && ["needs_more_info", "rejected", "revoked"].includes(status) ? (
              <Notice tone={status === "needs_more_info" ? "warning" : "error"} title="From the review" body={note} />
            ) : null}
            <VerificationTrack stops={providerStops(status)} />
            {approved ? (
              <Link href={"/properties" as Route} className="btn btn-primary">Open your properties</Link>
            ) : null}
          </section>

          {canSend ? (
            <section className="pv-card" ref={evidence} aria-labelledby="pv-send" style={{ scrollMarginTop: "6rem" }}>
              <h2 id="pv-send">Send one ID document</h2>
              <p>A clear photo or scan of a current government ID. It confirms who you are, once, for every property you manage.</p>
              <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-4)" }}>
                <div className="pv-types" role="radiogroup" aria-label="Document type">
                  {DOCUMENT_TYPES.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={documentType === value}
                      className="pv-type"
                      onClick={() => setDocumentType(value)}
                    >
                      <Icon aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>

                <label
                  className={`pv-drop${file ? " is-filled" : ""}${over ? " is-over" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setOver(false);
                    const dropped = event.dataTransfer.files?.[0];
                    if (dropped) setFile(dropped);
                  }}
                >
                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    className="sr-only"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                  {file ? (
                    <>
                      {/* A local blob: preview, which next/image cannot optimise or fetch. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {preview ? <img src={preview} alt="" /> : <span className="pv-drop-icon" aria-hidden="true"><FileBadge /></span>}
                      <span className="pv-drop-text">
                        <strong>{file.name}</strong>
                        <small>Click to choose a different file</small>
                      </span>
                      <CircleCheck className="pv-drop-ok" aria-hidden="true" />
                    </>
                  ) : (
                    <>
                      <span className="pv-drop-icon" aria-hidden="true"><ImagePlus /></span>
                      <span className="pv-drop-text">
                        <strong>Choose a photo or scan</strong>
                        <small>Or drop it here · all four corners in view · JPEG, PNG or PDF</small>
                      </span>
                    </>
                  )}
                </label>

                <Button type="submit" busy={busy} busyLabel="Sending…" disabled={!file}>
                  {file ? "Send for review" : "Choose a file to send"}
                </Button>
                <p className="auth-aside">Seen only by Danpa HQ&apos;s review team.</p>
              </form>
            </section>
          ) : (
            <section className="pv-card" aria-labelledby="pv-meanwhile">
              <h2 id="pv-meanwhile">Meanwhile</h2>
              <Meanwhile />
            </section>
          )}
        </div>
      ) : null}

      {standing && !approved ? (
        <section className="pv-locked" aria-labelledby="pv-locked">
          <h2 id="pv-locked"><Lock aria-hidden="true" /> Unlocks after verification</h2>
          <div className="pv-tools">
            {LOCKED_TOOLS.map(({ label, Icon }) => (
              <div key={label} className="pv-tool" aria-label={`${label}, locked until verification is approved`}>
                <span className="pv-tool-icon" aria-hidden="true">
                  <Icon />
                  <span className="pv-tool-lock"><Lock /></span>
                </span>
                {label}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {standing && canSend ? (
        <section className="pv-card" aria-labelledby="pv-meanwhile-2">
          <h2 id="pv-meanwhile-2">Meanwhile</h2>
          <Meanwhile />
        </section>
      ) : null}

      {canSwitchToTenant ? (
        <section className="pv-card">
          <p style={{ margin: 0, color: "var(--color-ink-500)", fontSize: ".875rem", maxWidth: "60ch" }}>
            You also rent as a tenant. Switching is only a change of view — it does not cancel this
            review, remove anything, or sign you out.
          </p>
          <div>
            <Button variant="secondary" onClick={switchToTenant}>Switch to tenant experience</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Somewhere to go while the review happens. */
function Meanwhile() {
  return (
    <ul className="pv-links">
      {[
        { href: "/rentals", label: "Explore homes", Icon: Search },
        { href: "/settings", label: "Your profile", Icon: UserRound },
        { href: "/updates", label: "Updates", Icon: Bell },
      ].map(({ href, label, Icon }) => (
        <li key={href}>
          <Link href={href as Route}>
            <span className="pv-links-icon" aria-hidden="true"><Icon /></span>
            <strong>{label}</strong>
            <ChevronRight aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ProviderStandingPage() {
  return (
    <Suspense fallback={null}>
      <ProviderStandingContent />
    </Suspense>
  );
}
