"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthModal } from "@/components/auth/AuthModal";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { apiFetch, ApiFailure } from "@/lib/api";
import { authedFetch, setAccessToken } from "@/lib/auth";
import {
  fieldErrorsFrom,
  isAccountExists,
  summaryErrorFrom,
  type FieldErrors,
} from "@/lib/formErrors";
import { chooseWorkspace, useSession, type Me, type Workspace } from "@/lib/session";
import { resolveWebEntry } from "@/lib/navigation";
import { safeInternalPath } from "@/lib/safeRedirect";
import { getWebDeviceContext } from "@/lib/device";

/**
 * Creating an account, as its own thing.
 *
 * Three steps that either finish or leave nothing at all: prove the number, say
 * what you came here to be and who you are, set a credential. Proving the number
 * creates no account — it returns a signed ticket, and the account is created
 * when this form is submitted. Abandoning it halfway writes nothing, so someone
 * who changes their mind was never a member.
 *
 * The account type is a starting point, not a grant. Choosing "property
 * provider" here opens the provider journey; it does not open the provider
 * workspace, which waits on a review.
 */
const MIN_PASSWORD_LENGTH = 8;

type Step = "phone" | "code" | "details";

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, refresh } = useSession();
  const requested = searchParams.get("workspace");
  const preselected: Workspace | null =
    requested === "tenant" || requested === "provider" ? requested : null;
  const safeNext = safeInternalPath(searchParams.get("next"));

  function signInHref(phoneNumber = "") {
    const query = new URLSearchParams();
    if (phoneNumber) query.set("phone", phoneNumber);
    if (preselected) query.set("workspace", preselected);
    if (safeNext) query.set("next", safeNext);
    return query.size ? `/sign-in?${query.toString()}` : "/sign-in";
  }

  // Someone who proved their number and then closed the tab comes back with a
  // session and an unfinished account. Making them start at the phone step
  // again would ask for a code they have already given.
  const resuming =
    state.status === "signed_in" && state.me.registration_state !== "complete";

  const [step, setStep] = useState<Step>(resuming ? "details" : "phone");
  // Carried over from "no account for that number" on the reset screen, so the
  // number they just typed is not asked for twice.
  const [phone, setPhone] = useState(searchParams.get("phone") ?? "");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  // Proof the number was confirmed. Spent on the last step, never stored.
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  // Not an error: the number is fine, it simply already belongs to someone.
  const [accountExists, setAccountExists] = useState(false);

  const [accountType, setAccountType] = useState<"tenant" | "provider">(
    preselected === "provider" ? "provider" : "tenant",
  );
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ challenge_id: string; phone_display: string }>(
        "/auth/challenge/",
        {
          method: "POST",
          body: JSON.stringify({
            phone: phone.trim(),
            purpose: "sign_up",
            ...getWebDeviceContext(),
          }),
        },
      );
      setChallengeId(result.challenge_id);
      setPhoneDisplay(result.phone_display);
      setStep("code");
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

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
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
        body: JSON.stringify({
          challenge_id: challengeId,
          code: code.trim(),
          ...getWebDeviceContext(),
        }),
      });
      if (result.registration_ticket) {
        setTicket(result.registration_ticket);
      } else if (result.access_token) {
        // An account left unfinished before tickets existed, which still comes
        // back with a session to finish itself in.
        setAccessToken(result.access_token, result.expires_in ?? 0);
      }
      setStep("details");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That code did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function completeRegistration(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setErrors({});
    try {
      const problems: FieldErrors = {};
      if (!firstName.trim()) problems.first_name = "Enter your first name.";
      if (!lastName.trim()) problems.last_name = "Enter your last name.";
      if (!dateOfBirth) problems.date_of_birth = "Enter your date of birth.";
      if (!password) {
        problems.password = "Choose a password.";
      } else if (password.length < MIN_PASSWORD_LENGTH) {
        problems.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
      }
      if (Object.keys(problems).length > 0) {
        setErrors(problems);
        setBusy(false);
        return;
      }

      // The call that creates the account, and therefore the one that opens the
      // first session. A ticket goes unauthenticated; a resumed unfinished row
      // already has a token to send.
      const body = JSON.stringify({
        registration_ticket: ticket || undefined,
        account_type: accountType,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dateOfBirth,
        email: email.trim() || null,
        password,
        ...getWebDeviceContext(),
      });
      const created = ticket
        ? await apiFetch<{ access_token?: string; expires_in?: number; user?: Me }>(
            "/me/registration/",
            { method: "POST", body },
          )
        : await authedFetch<{ access_token?: string; expires_in?: number; user?: Me }>(
            "/me/registration/",
            { method: "POST", body },
          );
      if (created.access_token) {
        setAccessToken(created.access_token, created.expires_in ?? 0);
      }
      const me = await chooseWorkspace(
        accountType === "provider" ? "provider" : "tenant",
      );
      await refresh();
      router.replace((safeNext ?? resolveWebEntry(me)) as never);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setErrors(fields);
      setError(summaryErrorFrom(cause, fields));
    } finally {
      setBusy(false);
    }
  }

  const stepNumber = step === "phone" ? 1 : step === "code" ? 2 : 3;

  // A dialog over the front door, one step at a time (owner, 2026-09-29).
  return (
    <AuthModal
      eyebrow={`Step ${stepNumber} of 3`}
      progress={stepNumber / 3}
      title={step === "details" ? "About you" : "Create your account"}
      description={step === "phone"
        ? "We'll text a six-digit code to confirm the number is yours."
        : step === "code"
          ? <>Enter the code we sent to {phoneDisplay}.</>
          : "A few details, and a password to sign in with."}
      footer={(
        <>
          Already have an account?
          <Link href={signInHref() as never}>Sign in</Link>
        </>
      )}
    >
      {step === "phone" ? (
        <form onSubmit={requestCode} className="auth-form">
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
          />
          {error ? <Notice tone="error" title={error} /> : null}
          {accountExists ? (
            <>
              <p className="auth-note">
                <strong>This number already has an account.</strong> Sign in instead to continue.
              </p>
              <Link href={signInHref(phone.trim()) as never} className="btn btn-primary auth-submit">
                Sign in instead
              </Link>
            </>
          ) : (
            <Button type="submit" className="auth-submit" busy={busy} busyLabel="Sending…" disabled={!phone.trim()}>
              Send code
            </Button>
          )}
        </form>
      ) : null}

      {step === "code" ? (
        <form onSubmit={confirmCode} className="auth-form">
          <Field
            label="Six-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
          />
          {error ? <Notice tone="error" title={error} /> : null}
          <Button type="submit" className="auth-submit" busy={busy} busyLabel="Checking…" disabled={code.trim().length < 4}>
            Confirm number
          </Button>
          <p className="auth-note">
            <strong>We will never ask you for this code</strong> — not by call, not by message. Anyone who does is trying to take your account.
          </p>
        </form>
      ) : null}

      {step === "details" ? (
        <form onSubmit={completeRegistration} className="auth-form">
          <Select
            label="What brings you here?"
            value={accountType}
            onChange={(value) => setAccountType(value as "tenant" | "provider")}
            options={[
              ["tenant", "I'm looking for a place"],
              ["provider", "I own or manage property"],
            ]}
          />
          {accountType === "provider" ? (
            <p className="auth-note">
              Set up your account and buildings straight away. Advertising and collecting rent open once your provider verification is approved.
            </p>
          ) : null}
          <div className="auth-row">
            <Field
              label="First name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              error={errors.first_name}
              autoComplete="given-name"
            />
            <Field
              label="Last name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              error={errors.last_name}
              autoComplete="family-name"
            />
          </div>
          <Field
            label="Date of birth"
            type="date"
            value={dateOfBirth}
            onChange={(event) => setDateOfBirth(event.target.value)}
            error={errors.date_of_birth}
          />
          <Field
            label="Email (optional)"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors.email}
            autoComplete="email"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. Not all digits, and not your own number.`}
          />
          {error ? <Notice tone="error" title={error} /> : null}
          {/*
            Never disabled for a validation reason. A dead button with nothing
            explaining it leaves someone who filled the form in correctly with no
            way to find out what the form disagrees with.
          */}
          <Button type="submit" className="auth-submit" busy={busy} busyLabel="Creating…">
            Create account
          </Button>
        </form>
      ) : null}
    </AuthModal>
  );
}


export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}
