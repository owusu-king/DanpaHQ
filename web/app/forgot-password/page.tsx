"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { AuthLink, AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Notice } from "@/components/Notice";
import { useToast } from "@/components/toast/Toaster";
import { apiFetch, ApiFailure } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import { fieldErrorsFrom, isNoAccount, summaryErrorFrom } from "@/lib/formErrors";
import { useSession, type Me } from "@/lib/session";
import { resolveWebEntry } from "@/lib/navigation";
import { getWebDeviceContext } from "@/lib/device";

/**
 * Recovering a forgotten password.
 *
 * Three steps, and the middle one deliberately does not sign anyone in: proving
 * the number returns a token that authorises exactly one password change and
 * nothing else. If a swapped SIM gets this far, it reaches a password change
 * the real owner is told about by SMS — not a silent read of the account.
 */
const MIN_PASSWORD_LENGTH = 8;

type Step = "phone" | "code" | "password";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState("");
  // Not an error: the number is fine, it simply has no account behind it.
  const [noAccount, setNoAccount] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await apiFetch<{ challenge_id: string; phone_display: string }>(
        "/auth/password-reset/",
        {
          method: "POST",
          body: JSON.stringify({ phone: phone.trim(), ...getWebDeviceContext() }),
        },
      );
      setChallengeId(result.challenge_id);
      setPhoneDisplay(result.phone_display);
      setStep("code");
    } catch (cause) {
      // Answered before any code is sent, so this arrives without the wait it
      // used to take to find out there was nothing here to reset.
      if (isNoAccount(cause)) {
        setNoAccount(true);
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
      const result = await apiFetch<{ reset_token: string }>(
        "/auth/password-reset/verify/",
        {
          method: "POST",
          body: JSON.stringify({ challenge_id: challengeId, code: code.trim() }),
        },
      );
      setResetToken(result.reset_token);
      setStep("password");
    } catch (cause) {
      toast({ tone: "error", title: cause instanceof ApiFailure ? cause.error.message : "That code did not work." });
    } finally {
      setBusy(false);
    }
  }

  async function setNewPassword(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setFieldError("");
    try {
      const result = await apiFetch<{
        access_token: string;
        expires_in: number;
        user: Me;
      }>("/auth/password-reset/complete/", {
        method: "POST",
        body: JSON.stringify({
          reset_token: resetToken,
          new_password: password,
          ...getWebDeviceContext(),
        }),
      });
      setAccessToken(result.access_token, result.expires_in);
      await refresh();
      router.replace(resolveWebEntry(result.user) as never);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setFieldError(fields.new_password ?? fields.password ?? "");
      toast({ tone: "error", title: summaryErrorFrom(cause, fields) });
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = step === "phone" ? 0 : step === "code" ? 1 : 2;

  return (
    <AuthShell
      title="Reset your password"
      steps={RESET_STEPS}
      stepIndex={stepIndex}
      footer={<span><AuthLink href="/sign-in">Back to sign in</AuthLink></span>}
    >
      {step === "phone" ? (
        <form onSubmit={requestCode} className="mt-6 grid gap-4">
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            Enter the number on your account and we&apos;ll text you a code.
          </p>
          <Field
            label="Mobile number"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setNoAccount(false);
            }}
            inputMode="tel"
            autoComplete="tel"
            required
          />
          {noAccount ? (
            <>
              <Notice
                tone="info"
                title="No account for that number"
                body="Nothing to reset here yet. Create an account to get started, or check the number above."
              />
              <Link
                href={`/register?phone=${encodeURIComponent(phone.trim())}` as never}
                className="text-[0.9375rem] font-semibold text-brand underline-offset-4 hover:underline"
              >
                Create an account →
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

          {/* Six drawn cells over one real input — the same control the sign-up
              code screen uses, because it is the same job and a reset is the
              one somebody is doing while already locked out and impatient. */}
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
            Confirm code
          </Button>

          <button
            type="button"
            onClick={() => { setStep("phone"); setCode(""); }}
            className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Wrong number? Change it
          </button>
        </form>
      ) : null}

      {step === "password" ? (
        <form onSubmit={setNewPassword} className="mt-6 grid gap-4">
          <Field
            label="New password"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (fieldError) setFieldError("");
            }}
            error={fieldError}
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. Not all digits, and not your own number.`}
          />
          <Button type="submit" busy={busy}>
            Set password and sign in
          </Button>
          <Notice
            tone="info"
            title="Your other devices will be signed out"
            body="Setting a new password ends every other session, so anyone who had access loses it."
          />
        </form>
      ) : null}
    </AuthShell>
  );
}

const RESET_STEPS = ["Your number", "Confirm", "New password"] as const;

