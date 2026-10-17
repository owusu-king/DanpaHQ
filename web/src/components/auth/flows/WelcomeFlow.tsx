"use client";

import { Check, KeyRound, Search, ShieldHalf, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AuthModal } from "@/components/auth/AuthModal";
import type { AuthFlowProps } from "@/components/auth/authTypes";
import { providerStops, VerificationTrack } from "@/components/auth/VerificationTrack";
import { Button } from "@/components/Button";
import { resolveWebEntry } from "@/lib/navigation";
import { accountJustCreated, finishAccountWelcome } from "@/lib/registration";
import { useSession } from "@/lib/session";

/**
 * The account exists: the last step of the journey, and the only one that looks
 * back at it.
 *
 * Shown once, straight after `/me/registration/` succeeds, in the same dialog
 * the sign-up ran in. Reached any other way — an old `/welcome` link, a second
 * visit — it has nothing to say and sends the person on to where they belong,
 * which is the rule for returning users.
 *
 * A tenant needs nothing more, so it is one line and one act. A provider needs
 * to know first that operating waits on verification, so it says so plainly,
 * shows the four steps with the first already done, and leads with the act
 * that moves them along.
 */
export function WelcomeFlow({ close, land }: AuthFlowProps) {
  const { state } = useSession();
  // Read once, after mount — the flag can live in this tab's storage, which the
  // server render cannot see — and cleared at once, so this welcome is the only
  // one. `undefined` is "not read yet"; `null` is "nothing to welcome".
  const [arrival, setArrival] = useState<ReturnType<typeof accountJustCreated> | undefined>(undefined);
  // Strict Mode runs a mount effect twice; the second run must not read the
  // flag the first one already cleared and decide there is nothing to welcome.
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const found = accountJustCreated();
    finishAccountWelcome();
    setArrival(found);
  }, []);
  const me = state.status === "signed_in" ? state.me : null;
  // The dashboard: the backend's entry route, never a remembered browsing context.
  const home = me ? resolveWebEntry(me) : "/";

  useEffect(() => {
    if (arrival === undefined || arrival) return;
    if (state.status === "signed_in") land(resolveWebEntry(state.me));
    if (state.status === "signed_out") close();
  }, [arrival, close, land, state]);

  function leave(route: string) {
    finishAccountWelcome();
    land(route);
  }

  if (!arrival) return null;

  const name = me?.preferred_name || me?.first_name || "";
  const provider = arrival.type === "provider";

  return (
    <AuthModal
      eyebrow="Account created"
      title={provider ? (name ? `Welcome, ${name}` : "Welcome to Danpa HQ") : name ? `You're in, ${name}` : "You're in"}
      description={provider ? "Your provider account is ready." : "Your tenant account is ready."}
      onClose={() => leave(arrival.next ?? home)}
    >
      <div className="auth-step" style={provider ? ({ "--hue": "var(--color-lagoon-600)" } as React.CSSProperties) : undefined}>
        <div className="auth-success" aria-hidden="true">
          <span className="auth-success-ring" />
          <span className="auth-success-disc"><Check /></span>
        </div>

        {provider ? (
          <>
            <div className="auth-verify-card">
              <div className="auth-verify-head">
                <span className="auth-verify-badge" aria-hidden="true"><ShieldHalf /></span>
                <span>
                  <strong>Verification is required</strong>
                  <small>Provider operations open once we have checked who you are. It protects your tenants, and you.</small>
                </span>
              </div>
              <VerificationTrack stops={providerStops("not_started")} />
            </div>
            <Button className="auth-submit" onClick={() => leave("/provider?send=1")}>Verify now</Button>
            <p className="auth-aside">
              <button type="button" className="auth-inline" onClick={() => leave(home)}>Look around first</button>
            </p>
          </>
        ) : (
          <>
            <ul className="auth-next">
              <li>
                <span className="auth-next-icon" aria-hidden="true"><Search /></span>
                <span><strong>Find a place</strong><small>Browse, save and ask to view homes</small></span>
              </li>
              <li>
                <span className="auth-next-icon" aria-hidden="true"><KeyRound /></span>
                <span><strong>Already renting?</strong><small>Join your home with the code from your provider</small></span>
              </li>
              <li>
                <span className="auth-next-icon" aria-hidden="true"><UserRound /></span>
                <span><strong>Your profile</strong><small>Add an email and the rest whenever you like</small></span>
              </li>
            </ul>
            <Button className="auth-submit" onClick={() => leave(arrival.next ?? home)}>
              {arrival.next ? "Continue" : "Go to Home"}
            </Button>
          </>
        )}
      </div>
    </AuthModal>
  );
}
