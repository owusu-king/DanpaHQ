"use client";

import { ArrowLeft, Building2, Check, Home } from "lucide-react";
import { useState } from "react";

import { AuthModal } from "@/components/auth/AuthModal";
import { authHref, type AuthFlowProps, type AuthParams } from "@/components/auth/authTypes";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { apiFetch, ApiFailure } from "@/lib/api";
import { authedFetch, setAccessToken } from "@/lib/auth";
import { getWebDeviceContext } from "@/lib/device";
import {
  fieldErrorsFrom,
  isAccountExists,
  summaryErrorFrom,
  type FieldErrors,
} from "@/lib/formErrors";
import { markAccountJustCreated, type AccountType } from "@/lib/registration";
import { safeInternalPath } from "@/lib/safeRedirect";
import { chooseWorkspace, useSession, type Me } from "@/lib/session";

/**
 * Creating an account: Get Started → how will you use Danpa HQ → who you are →
 * your number → in (owner, 2026-10-07).
 *
 * The role is asked first and only once — it is the account type, so the
 * details step never asks it again. Name, date of birth and a password come
 * next and are held here, in this component, while the number is proved. The
 * backend rule is unchanged: proving the number returns a signed ticket and
 * creates nothing, and the account exists only once `/me/registration/` is
 * called with that ticket — which happens the moment the code is right.
 * Closing the dialog anywhere before then leaves nothing behind.
 *
 * It is one view of the auth dialog, opened over whatever page asked for it;
 * the address never changes. The account made, the welcome follows in the
 * same dialog.
 *
 * If the server refuses a detail only it can judge (an email in use, a password
 * it considers common) the person goes back to the details with the reason on
 * the field and the ticket kept, so fixing it creates the account without a
 * second text.
 */
const MIN_PASSWORD_LENGTH = 8;

type Step = "role" | "details" | "phone" | "code";

const SIDES: Record<AccountType, {
  title: string;
  body: string;
  Icon: typeof Home;
}> = {
  tenant: {
    title: "Tenant",
    body: "Rent or find a place.",
    Icon: Home,
  },
  provider: {
    title: "Provider",
    body: "Own or manage property.",
    Icon: Building2,
  },
};

export function RegisterFlow({ params, go: show, close, land }: AuthFlowProps) {
  const { state, refresh } = useSession();
  const preselected: AccountType | null = params.workspace ?? null;
  const safeNext = safeInternalPath(params.next ?? null);

  // An account left unfinished before tickets existed arrives signed in, and
  // finishes itself from the details step.
  const resuming = state.status === "signed_in" && state.me.registration_state !== "complete";

  const [step, setStep] = useState<Step>(resuming || preselected ? "details" : "role");
  const [chosenType, setAccountType] = useState<AccountType | null>(preselected);
  // A resumed account already has a type on file; it is the default until changed.
  const accountType: AccountType | null = chosenType
    ?? (resuming && state.status === "signed_in" ? state.me.capabilities.account_type ?? "tenant" : null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Carried over from "no account for that number" on the reset screen.
  const [phone, setPhone] = useState(params.phone ?? "");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  // Proof the number was confirmed: once held, the details create the account.
  const [ticket, setTicket] = useState("");

  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [accountExists, setAccountExists] = useState(false);
  // Bumped on each refused press, so the form nudges.
  const [refusals, setRefusals] = useState(0);

  const createsHere = Boolean(ticket) || resuming;

  function signInParams(phoneNumber = ""): AuthParams {
    return { phone: phoneNumber || undefined, workspace: accountType ?? undefined, next: safeNext };
  }

  /** A link that switches the dialog to sign-in, and still works opened elsewhere. */
  function signInLink(phoneNumber = "") {
    return {
      href: authHref("sign-in", signInParams(phoneNumber)),
      onClick: (event: React.MouseEvent) => {
        event.preventDefault();
        show("sign-in", signInParams(phoneNumber));
      },
    };
  }

  function go(next: Step) {
    setError("");
    setStep(next);
  }

  /** Clear a field's error the moment the person starts fixing it. */
  function edit(fields: string[], set: (value: string) => void) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      set(event.target.value);
      setError("");
      setErrors((current) => {
        if (!fields.some((field) => current[field])) return current;
        const next = { ...current };
        for (const field of fields) delete next[field];
        return next;
      });
    };
  }

  function localProblems(): FieldErrors {
    const found: FieldErrors = {};
    if (!firstName.trim()) found.first_name = "Enter your first name.";
    if (!lastName.trim()) found.last_name = "Enter your last name.";
    if (!dateOfBirth) found.date_of_birth = "Enter your date of birth.";
    if (!password) {
      found.password = "Choose a password.";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      found.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password && confirm !== password) {
      found.confirm_password = confirm ? "The two passwords do not match." : "Type the password again.";
    }
    return found;
  }

  /** The one call that makes a member — with the ticket, or as a resumed account. */
  async function createAccount(proof: string) {
    if (!accountType) return;
    setCreating(true);
    setBusy(true);
    setError("");
    setErrors({});
    try {
      const body = JSON.stringify({
        registration_ticket: proof || undefined,
        account_type: accountType,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dateOfBirth,
        email: email.trim() || null,
        password,
        ...getWebDeviceContext(),
      });
      const created = proof
        ? await apiFetch<{ access_token?: string; expires_in?: number; user?: Me }>(
            "/me/registration/",
            { method: "POST", body },
          )
        : await authedFetch<{ access_token?: string; expires_in?: number; user?: Me }>(
            "/me/registration/",
            { method: "POST", body },
          );
      if (created.access_token) setAccessToken(created.access_token, created.expires_in ?? 0);
      // A missed preference must never strand somebody who just joined.
      await chooseWorkspace(accountType).catch(() => null);
      markAccountJustCreated(accountType, safeNext ?? null);
      await refresh();
      show("welcome", { next: safeNext });
    } catch (cause) {
      // Back to the details, with the reason on the field. The ticket is kept:
      // the code is spent, but the proof lasts half an hour.
      const fields = fieldErrorsFrom(cause);
      setErrors(fields);
      setError(summaryErrorFrom(cause, fields));
      setRefusals((count) => count + 1);
      setStep("details");
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  function submitDetails(event: React.FormEvent) {
    event.preventDefault();
    const problems = localProblems();
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      setError("");
      setRefusals((count) => count + 1);
      return;
    }
    if (createsHere) {
      void createAccount(ticket);
      return;
    }
    // Nothing is created yet: on to the number.
    go("phone");
  }

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ challenge_id: string; phone_display: string }>(
        "/auth/challenge/",
        {
          method: "POST",
          body: JSON.stringify({ phone: phone.trim(), purpose: "sign_up", ...getWebDeviceContext() }),
        },
      );
      setChallengeId(result.challenge_id);
      setPhoneDisplay(result.phone_display);
      setCode("");
      go("code");
    } catch (cause) {
      if (isAccountExists(cause)) {
        setAccountExists(true);
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(value: string) {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{
        registration_required?: boolean;
        registration_ticket?: string;
        access_token?: string;
        expires_in?: number;
      }>("/auth/verify/", {
        method: "POST",
        body: JSON.stringify({ challenge_id: challengeId, code: value.trim(), ...getWebDeviceContext() }),
      });
      if (result.registration_ticket) {
        setTicket(result.registration_ticket);
        setBusy(false);
        await createAccount(result.registration_ticket);
        return;
      }
      if (result.access_token) {
        // An account left unfinished before tickets: it comes back with a
        // session, and finishing it is the details step.
        setAccessToken(result.access_token, result.expires_in ?? 0);
        await refresh();
        await createAccount("");
        return;
      }
      setError("This page is out of date. Reload it and try again.");
    } catch (cause) {
      setCode("");
      setError(cause instanceof ApiFailure ? cause.error.message : "That code did not work.");
      setRefusals((count) => count + 1);
    } finally {
      setBusy(false);
    }
  }

  const stepNumber = step === "details" ? 1 : step === "phone" ? 2 : 3;
  const side = accountType ? SIDES[accountType] : null;

  const heading = {
    role: {
      title: "How will you use Danpa HQ?",
      description: "Choose one to start. You can add the other side later.",
    },
    details: createsHere
      ? { title: "Almost there", description: "Your number is confirmed. Check the details below to finish." }
      : { title: "Tell us about you", description: "Just the essentials. Everything else can wait for your profile." },
    phone: {
      title: "Confirm your number",
      description: "It is how you sign in and how we reach you. We'll text a six-digit code.",
    },
    code: {
      title: "Enter the code",
      description: <>We sent six digits to {phoneDisplay || "your number"}.</>,
    },
  }[step];

  return (
    <AuthModal
      // Back on the details with a proved number is the last step, not the first.
      eyebrow={step === "role" ? "Get started" : step === "details" && createsHere ? "Last step" : `Step ${stepNumber} of 3`}
      progress={step === "role" ? undefined : step === "details" && createsHere ? 1 : stepNumber / 3}
      title={heading.title}
      description={heading.description}
      onClose={close}
      footer={(
        <>
          Already have an account?
          <a {...signInLink()}>Sign in</a>
        </>
      )}
    >
      {/* Keyed by step, so each question arrives with the same short rise. */}
      <div key={step} className="auth-step">
        {step === "role" ? (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (accountType) go("details");
            }}
          >
            <div className="auth-roles" role="radiogroup" aria-label="How you will use Danpa HQ">
              {(Object.keys(SIDES) as AccountType[]).map((key) => {
                const option = SIDES[key];
                const on = accountType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`auth-role is-${key}`}
                    onClick={() => setAccountType(key)}
                  >
                    <span className="auth-role-top">
                      <span className="auth-role-tile" aria-hidden="true"><option.Icon /></span>
                      <span className="auth-role-copy">
                        <strong>{option.title}</strong>
                        <span className="auth-role-body">{option.body}</span>
                      </span>
                      <span className="auth-role-tick" aria-hidden="true"><Check /></span>
                    </span>
                  </button>
                );
              })}
            </div>
            <Button type="submit" className="auth-submit" disabled={!accountType}>
              {side ? `Continue as ${side.title.toLowerCase()}` : "Choose one to continue"}
            </Button>
            <p className="auth-aside">
              Just browsing?{" "}
              <a
                href="/rentals"
                className="auth-link"
                onClick={(event) => {
                  event.preventDefault();
                  land("/rentals");
                }}
              >
                Explore homes
              </a>
            </p>
          </form>
        ) : null}

        {step === "details" ? (
          <form onSubmit={submitDetails} className="auth-form" noValidate>
            {side && accountType ? (
              <div className={`auth-account is-${accountType}`}>
                <span className="auth-account-tile" aria-hidden="true"><side.Icon /></span>
                <span className="auth-account-text">
                  <small>Creating a</small>
                  <strong>{side.title} account</strong>
                </span>
                <button
                  type="button"
                  className="auth-account-change"
                  onClick={() => {
                    // Before the number is proved, the question is one step back.
                    // After, going back would lose the proof, so it switches here.
                    if (createsHere) setAccountType(accountType === "provider" ? "tenant" : "provider");
                    else go("role");
                  }}
                >
                  {createsHere ? `Switch to ${accountType === "provider" ? "tenant" : "provider"}` : "Change"}
                </button>
              </div>
            ) : null}

            <div key={refusals} className={refusals ? "auth-shake" : undefined}>
              <div className="auth-form">
                <div className="auth-row">
                  <Field
                    label="First name"
                    value={firstName}
                    onChange={edit(["first_name"], setFirstName)}
                    error={errors.first_name}
                    autoComplete="given-name"
                  />
                  <Field
                    label="Last name"
                    value={lastName}
                    onChange={edit(["last_name"], setLastName)}
                    error={errors.last_name}
                    autoComplete="family-name"
                  />
                </div>
                <Field
                  label="Date of birth"
                  type="date"
                  value={dateOfBirth}
                  onChange={edit(["date_of_birth"], setDateOfBirth)}
                  error={errors.date_of_birth}
                  autoComplete="bday"
                  hint="Tenancy agreements need an adult on them."
                />
                <div className="auth-row">
                  <Field
                    label="Password"
                    type="password"
                    value={password}
                    onChange={edit(["password", "confirm_password"], setPassword)}
                    error={errors.password}
                    autoComplete="new-password"
                  />
                  <Field
                    label="Confirm password"
                    type="password"
                    value={confirm}
                    onChange={edit(["confirm_password"], setConfirm)}
                    error={errors.confirm_password}
                    autoComplete="new-password"
                  />
                </div>
                <ul className="auth-checks" aria-live="polite">
                  <li className={password.length >= MIN_PASSWORD_LENGTH ? "is-met" : undefined}>
                    <Check aria-hidden="true" />{MIN_PASSWORD_LENGTH}+ characters
                  </li>
                  <li className={confirm && confirm === password ? "is-met" : undefined}>
                    <Check aria-hidden="true" />Passwords match
                  </li>
                </ul>
                <Field
                  label="Email (optional)"
                  type="email"
                  value={email}
                  onChange={edit(["email"], setEmail)}
                  error={errors.email}
                  autoComplete="email"
                  hint="For receipts and account recovery. You can add it later."
                />
              </div>
            </div>

            {accountType === "provider" ? (
              <p className="auth-note">
                <strong>Verification comes after this.</strong> Your account is created first. You then send one ID document, and provider tools open once it is approved.
              </p>
            ) : null}
            {error ? <Notice tone="error" title={error} /> : null}
            {/* Never disabled for a validation reason: pressing always continues
                or says which field to fix. */}
            <Button type="submit" className="auth-submit" busy={busy} busyLabel="Creating your account…">
              {createsHere ? "Create account" : "Continue"}
            </Button>
            {!createsHere ? (
              <p className="auth-aside">Next, we confirm your phone number. Nothing is created until then.</p>
            ) : null}
          </form>
        ) : null}

        {step === "phone" ? (
          <form onSubmit={requestCode} className="auth-form">
            <button type="button" className="auth-back" onClick={() => go("details")}>
              <ArrowLeft aria-hidden="true" /> Your details
            </button>
            <Field
              label="Mobile number"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setAccountExists(false);
                if (error) setError("");
              }}
              inputMode="tel"
              autoComplete="tel"
              placeholder="024 123 4567"
              autoFocus
            />
            {error ? <Notice tone="error" title={error} /> : null}
            {accountExists ? (
              <>
                <p className="auth-note">
                  <strong>This number already has an account.</strong> Sign in instead to continue.
                </p>
                <a {...signInLink(phone.trim())} className="btn btn-primary auth-submit">
                  Sign in instead
                </a>
              </>
            ) : (
              <Button type="submit" className="auth-submit" busy={busy} busyLabel="Sending…" disabled={!phone.trim()}>
                Send code
              </Button>
            )}
            <p className="auth-aside">We will never ask you for your code. Standard SMS rates apply.</p>
          </form>
        ) : null}

        {step === "code" ? (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim().length === 6) void confirmCode(code);
            }}
          >
            <button type="button" className="auth-back" onClick={() => go("phone")} disabled={creating}>
              <ArrowLeft aria-hidden="true" /> Wrong number? Change it
            </button>
            <div key={refusals} className={refusals ? "auth-shake" : undefined}>
              <Field
                label="Six-digit code"
                value={code}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(digits);
                  if (error) setError("");
                  // It submits itself on the sixth digit.
                  if (digits.length === 6 && !busy) void confirmCode(digits);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="auth-code"
                autoFocus
                disabled={creating}
              />
            </div>
            {creating ? (
              <div className="auth-creating" role="status">
                <span className="auth-spinner" aria-hidden="true" />
                <span>
                  <strong>Number confirmed</strong>
                  <small>Creating your account…</small>
                </span>
              </div>
            ) : null}
            {error ? <Notice tone="error" title={error} /> : null}
            {!creating ? (
              <>
                <Button type="submit" className="auth-submit" busy={busy} busyLabel="Checking…" disabled={code.length < 6}>
                  Confirm number
                </Button>
                <p className="auth-aside">
                  Nothing arrived?{" "}
                  <button type="button" className="auth-inline" onClick={() => void requestCode()} disabled={busy}>
                    Send a new code
                  </button>
                </p>
              </>
            ) : null}
          </form>
        ) : null}
      </div>
    </AuthModal>
  );
}
