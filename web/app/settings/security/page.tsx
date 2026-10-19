"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PasswordSection } from "@/components/account/AccountSections";
import { GoogleLinkSection, PhoneVerificationSection } from "@/components/account/IdentitySecurity";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useToast } from "@/components/toast/Toaster";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { authedFetch } from "@/lib/auth";
import { useSession } from "@/lib/session";
import {
  endSignedInDevice,
  getAccountDeletion,
  listSignedInDevices,
  requestAccountDeletion,
  withdrawAccountDeletion,
  type AccountDeletionState,
  type SignedInDevice,
} from "@/lib/console";

/**
 * Security: the password, the devices signed in, and — set apart, in red —
 * deleting the account.
 *
 * Deletion is asked for here and decided by Management. It cannot be undone
 * and can collide with obligations to other people (a tenancy still running,
 * a Portfolio others work in), so nobody erases themselves in one press. The
 * modal says what goes, what the law keeps and what Management will check,
 * and asks for the word typed before it will send.
 */
export default function SecuritySettingsPage() {
  const router = useRouter();
  const { state } = useSession();
  const { toast } = useToast();
  const [devices, setDevices] = useState<SignedInDevice[] | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [everywhere, setEverywhere] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deletion, setDeletion] = useState<AccountDeletionState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices(await listSignedInDevices());
      setError("");
    } catch (cause) {
      setDevices([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your signed-in devices.");
    }
  }, []);

  const loadDeletion = useCallback(async () => {
    try {
      setDeletion(await getAccountDeletion());
    } catch {
      setDeletion({ request: null, blockers: [], confirmation: "DELETE" });
    }
  }, []);

  useEffect(() => { void load(); void loadDeletion(); }, [load, loadDeletion]);

  const pending = deletion?.request?.status === "pending" ? deletion.request : null;
  const declined = deletion?.request?.status === "declined" ? deletion.request : null;

  return (
    <>
      {state.status === "signed_in" && state.me.authentication_methods.includes("phone") ? (
        <SettingsCard title="Password" description="At least 8 characters, not all digits, and not your own number.">
          <PasswordSection />
        </SettingsCard>
      ) : null}

      <SettingsCard
        id="phone-verification"
        title="Phone verification"
        description="Optional for Google sign-up; required only when a feature needs a proved phone."
      >
        <PhoneVerificationSection />
      </SettingsCard>

      <SettingsCard
        title="Sign in with Google"
        description="Link Google to this account without changing its data, roles, or phone sign-in."
      >
        <GoogleLinkSection />
      </SettingsCard>

      <SettingsCard
        title="Where you’re signed in"
        description="Sign out of any device you don’t recognise."
        action={devices && devices.length > 1 ? (
          <button type="button" className="ws-action" aria-haspopup="dialog" onClick={() => setEverywhere(true)}>Sign out everywhere</button>
        ) : null}
      >
        {error ? <Notice tone="error" title={error} /> : null}
        {devices === null ? (
          <div className="prefs-skeleton" aria-busy="true" aria-label="Loading devices">
            {Array.from({ length: 3 }).map((_, index) => <span key={index} className="ws-skeleton-block" />)}
          </div>
        ) : null}

        {devices?.length ? (
          <ul className="security-devices">
            {devices.map((device) => (
              <li key={device.id} className={`security-device${device.is_current ? " is-current" : ""}`}>
                <span className="security-device-mark" aria-hidden="true"><Icon name={deviceIcon(device)} /></span>
                <span className="security-device-text">
                  <strong>
                    {device.device_label || device.client || "Unknown device"}
                    {device.is_current ? <em>This device</em> : null}
                  </strong>
                  <small>{device.is_current ? "Active now" : `Last active ${relative(device.last_used_at ?? device.issued_at)}`}</small>
                </span>
                {!device.is_current ? (
                  <Button
                    variant="quiet"
                    size="sm"
                    busy={ending === device.id}
                    busyLabel="Signing out…"
                    disabled={ending !== null}
                    onClick={async () => {
                      setEnding(device.id);
                      setError("");
                      try {
                        await endSignedInDevice(device.id);
                        await load();
                      } catch (cause) {
                        setError(cause instanceof ApiFailure ? cause.error.message : "Could not sign out that device.");
                      } finally {
                        setEnding(null);
                      }
                    }}
                  >Sign out</Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </SettingsCard>

      <SettingsCard
        className="is-danger"
        title="Danger zone"
        description="Actions here cannot be undone."
      >
        {pending ? (
          <div className="danger-pending" role="status">
            <span className="danger-pending-mark" aria-hidden="true"><Icon name="clock" /></span>
            <span className="danger-pending-text">
              <strong>Deletion requested {relative(pending.requested_at)}</strong>
              <small>Management is reviewing it and will confirm by text. Until then your account works as normal.</small>
            </span>
            <Button
              variant="secondary"
              size="sm"
              busy={withdrawing}
              busyLabel="Withdrawing…"
              onClick={async () => {
                setWithdrawing(true);
                try {
                  await withdrawAccountDeletion();
                  toast({ tone: "success", title: "Request withdrawn", description: "Your account stays as it is." });
                  await loadDeletion();
                } catch (cause) {
                  toast({ tone: "error", title: "Couldn’t withdraw it", description: cause instanceof ApiFailure ? cause.error.message : "Try again." });
                } finally {
                  setWithdrawing(false);
                }
              }}
            >Withdraw request</Button>
          </div>
        ) : (
          <div className="danger-row">
            <span className="danger-row-text">
              <strong>Delete my account and data</strong>
              <small>Your name, number, email, photo and identity details are erased once Management confirms.</small>
            </span>
            <button type="button" className="danger-button" aria-haspopup="dialog" disabled={!deletion} onClick={() => setDeleting(true)}>
              <Icon name="trash" />Delete account…
            </button>
          </div>
        )}
        {declined && !pending ? (
          <p className="danger-declined">
            <strong>Your last request was not completed.</strong> {declined.decision_note}
          </p>
        ) : null}
      </SettingsCard>

      <ModalSheet
        open={everywhere}
        onClose={() => setEverywhere(false)}
        icon="device"
        size="sm"
        title="Sign out everywhere?"
        footer={(close) => (
          <>
            <button type="button" className="ws-action" onClick={close}>Stay signed in</button>
            <button
              type="button"
              className="ws-action is-primary"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                try {
                  await authedFetch("/auth/sign-out/", { method: "POST", body: JSON.stringify({ everywhere: true }) });
                  router.replace("/sign-in");
                } catch (cause) {
                  setError(cause instanceof ApiFailure ? cause.error.message : "Could not sign out everywhere.");
                  setSigningOut(false);
                  close();
                }
              }}
            >{signingOut ? "Signing out…" : "Sign out everywhere"}</button>
          </>
        )}
      >
        <p className="sheet-copy">Every session ends, including this one, so you will sign in again here. Use it if a phone was lost or someone else knows your password.</p>
      </ModalSheet>

      {deletion ? (
        <DeleteAccountSheet
          open={deleting}
          state={deletion}
          onClose={() => setDeleting(false)}
          onRequested={async () => {
            toast({ tone: "success", title: "Request sent to Management", description: "You’ll get a text when it has been reviewed." });
            await loadDeletion();
          }}
        />
      ) : null}
    </>
  );
}

function DeleteAccountSheet({
  open,
  state,
  onClose,
  onRequested,
}: {
  open: boolean;
  state: AccountDeletionState;
  onClose: () => void;
  onRequested: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = typed.trim() === state.confirmation;

  useEffect(() => {
    if (!open) return;
    setReason("");
    setTyped("");
    setError("");
  }, [open]);

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      icon="warning"
      size="sm"
      className="danger-sheet"
      title="Delete your account?"
      meta="Management reviews every request before anything is erased."
      closeLabel="Keep my account"
      footer={(close) => (
        <>
          <button type="button" className="ws-action" onClick={close}>Keep my account</button>
          <button
            type="button"
            className="danger-button is-solid"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await requestAccountDeletion({ reason, confirmation: typed.trim() });
                close();
                await onRequested();
              } catch (cause) {
                setError(cause instanceof ApiFailure ? cause.error.message : "The request did not send. Try again.");
              } finally {
                setBusy(false);
              }
            }}
          >{busy ? "Sending…" : "Request deletion"}</button>
        </>
      )}
    >
      <div className="danger-sheet-body">
        <div className="danger-callout" role="note">
          <Icon name="warning" />
          <p><strong>This cannot be undone.</strong> Once Management confirms, your name, phone number, email, photo and identity details are erased, and you are signed out on every device.</p>
        </div>

        <dl className="danger-facts">
          <div>
            <dt>What is kept</dt>
            <dd>Signed agreements, payment receipts and audit records the law requires, with your name removed from the account.</dd>
          </div>
          {state.blockers.length ? (
            <div>
              <dt>Management will check first</dt>
              <dd>
                <ul>{state.blockers.map((line) => <li key={line}>{line}</li>)}</ul>
              </dd>
            </div>
          ) : null}
        </dl>

        <label className="danger-field">
          <span>Why are you leaving? <small>Optional</small></span>
          <textarea rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>

        <label className="danger-field">
          <span>Type <b>{state.confirmation}</b> to confirm</span>
          <input
            value={typed}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={typed.length > 0 && !ready ? true : undefined}
            onChange={(event) => setTyped(event.target.value.toUpperCase())}
          />
        </label>

        {error ? <p className="danger-error" role="alert">{error}</p> : null}
      </div>
    </ModalSheet>
  );
}

function deviceIcon(device: SignedInDevice) {
  const text = `${device.device_label} ${device.client}`.toLowerCase();
  return /android|iphone|ios|pixel|mobile|app/.test(text) ? "device" as const : "desktop" as const;
}

function relative(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `on ${new Date(value).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}`;
}
