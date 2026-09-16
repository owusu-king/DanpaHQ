"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { ArrowLeft } from "lucide-react";

import { AuthLink, AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/components/toast/Toaster";
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
  const { toast } = useToast();
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
      toast({ tone: "error", title: cause instanceof ApiFailure ? cause.error.message : "Could not send the code." });
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
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
      toast({ tone: "error", title: cause instanceof ApiFailure ? cause.error.message : "That code did not work." });
    } finally {
      setBusy(false);
    }
  }

  async function completeRegistration(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
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
      toast({ tone: "error", title: summaryErrorFrom(cause, fields) });
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = step === "phone" ? 0 : step === "code" ? 1 : 2;

  return (
    <AuthShell
      title={
        step === "phone"
          ? "Create your account"
          : step === "code"
            ? "Confirm your number"
            : "A few details"
      }
      steps={STEPS}
      stepIndex={stepIndex}
      footer={
        <>
          <span>
            Already have an account? <AuthLink href={signInHref()}>Sign in</AuthLink>
          </span>
          {/* Only from the code step. Going back from the details step would
              discard a proved number, and from the first there is nowhere to go
              that the brand link does not already cover. */}
          {step === "code" ? (
            <button
              type="button"
              onClick={() => { setStep("phone"); setCode(""); }}
              className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Wrong number? Change it
            </button>
          ) : null}
        </>
      }
    >
      {step === "phone" ? (
        <form onSubmit={requestCode} className="mt-6 grid gap-4">
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            We&apos;ll text a six-digit code to confirm the number is yours. Nothing is
            created until you finish.
          </p>
          <Field
            label="Mobile number"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setAccountExists(false);
            }}
            inputMode="tel"
            autoComplete="tel"
            placeholder="024 123 4567"
          />
          {accountExists ? (
            <>
              <Notice
                tone="info"
                title="You already have an account"
                body="This mobile number is already registered. Sign in instead to continue."
              />
              <Link
                href={signInHref(phone.trim()) as never}
                className="text-[0.9375rem] font-semibold text-brand underline-offset-4 hover:underline"
              >
                Sign in instead →
              </Link>
            </>
          ) : (
            <Button type="submit" busy={busy} disabled={!phone.trim()}>
              Send code
            </Button>
          )}
        </form>
      ) : null}

      {step === "code" ? (
        <form onSubmit={confirmCode} className="mt-6 grid gap-5">
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            Enter the code we sent to{" "}
            <strong className="font-semibold text-foreground">{phoneDisplay}</strong>.
          </p>

          {/*
            Six drawn cells over one real input.

            Six separate inputs break autofill, break paste and fight the
            backspace key — and this is the screen where sign-ups are lost, so
            it is the last place to spend somebody's patience. The cells are
            presentation; `autoComplete="one-time-code"` is what lets the phone
            offer the code straight from the notification.
          */}
          <div className="grid gap-2">
            <span className="text-sm font-medium text-muted-foreground">Six-digit code</span>
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              autoFocus
              autoComplete="one-time-code"
              containerClassName="justify-start"
            >
              <InputOTPGroup className="gap-2">
                {[0, 1, 2, 3, 4, 5].map((slot) => (
                  <InputOTPSlot
                    key={slot}
                    index={slot}
                    className="size-13 rounded-[13px] border border-input text-lg font-semibold tabular-nums first:rounded-l-[13px] last:rounded-r-[13px]"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          <Button type="submit" busy={busy} disabled={code.trim().length < 4}>
            Confirm number
          </Button>
          <Notice
            tone="info"
            title="We will never ask you for this code"
            body="Not by call, not by message. Anyone who does is trying to take your account."
          />
        </form>
      ) : null}

      {step === "details" ? (
        <form onSubmit={completeRegistration} className="mt-6 grid gap-4">
          <Select
            label="What brings you here?"
            value={accountType}
            onChange={(value) => setAccountType(value as "tenant" | "provider")}
            options={[
              ["tenant", "I'm looking for a place to rent"],
              ["provider", "I own or manage property"],
            ]}
          />
          {accountType === "provider" ? (
            <Notice
              tone="info"
              title="Provider access is reviewed separately"
              body="You can set up your account and your buildings straight away. Advertising and collecting rent wait until your provider verification is approved."
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
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
          {/*
            Never disabled for a validation reason. A dead button with nothing
            explaining it leaves someone who filled the form in correctly with
            no way to find out what the form disagrees with.
          */}
          <Button type="submit" busy={busy}>
            Create account
          </Button>
        </form>
      ) : null}
    </AuthShell>
  );
}

const STEPS = ["Your number", "Confirm", "Details"] as const;


export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}
