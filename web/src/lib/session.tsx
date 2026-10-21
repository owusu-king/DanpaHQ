"use client";

/**
 * Who is signed in, for the whole console.
 *
 * The access token lives in memory (see auth.ts) and the refresh token is an
 * httpOnly cookie, so on a fresh page load this provider is the thing that
 * turns "there is a cookie" back into "this is who you are". Every page that
 * needs a session reads it from here rather than fetching /me itself, so the
 * answer is consistent and fetched once.
 */

import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  authedFetch,
  clearAccessToken,
  endSession,
  isSessionRefusal,
  SESSION_INVALID_EVENT,
} from "./auth";
import { finishAccountWelcome } from "./registration";
import { forgetPhotoUrls } from "./photo";
import { contextBelongsToWorkspace } from "./navigation";
import type { PortfolioAccess } from "./console";

export type Workspace = "discovery" | "tenant" | "provider" | "artisan";

/**
 * Where an artisan application stands. `suspended` is an approved artisan
 * Management has paused: their experience stays open, new work does not.
 */
export type ArtisanStatus =
  | "not_started"
  | "pending"
  | "needs_more_info"
  | "approved"
  | "suspended"
  | "rejected"
  | "revoked";

export type ProviderVerificationStatus =
  | "not_started"
  | "pending"
  | "needs_more_info"
  | "approved"
  | "rejected"
  | "revoked"
  | "expired";

/**
 * What the backend says this account may reach.
 *
 * Read it; never derive it. `account_type` in particular says what someone
 * registered as, not what they are allowed to do — a provider account with a
 * pending review has `provider.workspace_access: false`, and that is the only
 * field that decides whether the workspace opens.
 */
export type Capabilities = {
  account_type: "tenant" | "provider" | null;
  registration_state:
    | "phone_required"
    | "account_type_required"
    | "profile_required"
    | "password_required"
    | "complete";
  phone_verified: boolean;
  active_workspace: Workspace;
  available_workspaces: Workspace[];
  provider: {
    exists: boolean;
    verification_status: ProviderVerificationStatus | null;
    /** Evidence submitted. True while a review is still pending. */
    onboarding_complete: boolean;
    /**
     * May enter the provider workspace: an approved provider, or a member of
     * somebody's Portfolio. Not the same question as `exists`, which is only
     * about this person's own journey — a Team member has access and has
     * declared nothing, so anything asking "is this the provider experience"
     * reads this.
     */
    workspace_access: boolean;
    /** Approved. The only state in which a property may be created for oneself. */
    can_create_property: boolean;
  };
  tenant: { workspace_access: boolean };
  /**
   * The artisan side. Applying never moves anybody: the experience appears in
   * `available_workspaces` only once `workspace_access` is true, and only
   * `can_quote` says whether new work may start.
   */
  artisan: { status: ArtisanStatus; workspace_access: boolean; can_quote: boolean };
};

export type Me = {
  id: string;
  /**
   * Null by design. `/me/` never returns the raw number — there is a test that
   * asserts "+233" appears nowhere in the payload — so anything showing a phone
   * to the person it belongs to wants `phone_display`. Typing this as `string`
   * was how the portal rail came to render an empty line.
   */
  phone: string | null;
  /** The national form, or an empty string until a Google user adds a phone. */
  phone_display: string;
  /** Optional at registration, so absent for plenty of real accounts. */
  email: string | null;
  /** True only once the address was confirmed by its code (/me/email/verify). */
  is_email_verified?: boolean;
  /** Set at registration and read-only afterwards. */
  date_of_birth?: string | null;
  display_name: string;
  first_name: string;
  last_name: string;
  preferred_name: string;
  roles: string[];
  primary_role: string | null;
  is_phone_verified: boolean;
  authentication_methods: Array<"phone" | "google">;
  google_linked: boolean;
  account_status: "active" | "restricted" | "deactivated";
  authentication_state: "authenticated";
  phone_verification_state: "verified" | "unverified";
  registration_state: Capabilities["registration_state"];
  capabilities: Capabilities;
  /** Null until a profile row exists. `avatar_url` is null when no photo is set,
   *  and also when the one on file is not servable yet — the shell shows initials
   *  in both cases, so it never has to reason about upload state. */
  profile: { avatar_url: string | null; completeness: number; bio?: string } | null;
  onboarding_state: "profile_required" | "intent_required" | "complete";
  available_contexts: string[];
  default_context: string | null;
  intents: Array<"find_property" | "current_tenant" | "manage_property">;
  contexts: Array<{
    id: string;
    type: "discovery" | "occupancy" | "organization";
    label: string;
    subtitle?: string;
    mobile_route: string;
    web_route: string;
    organization_id?: string;
    organization_type?: string;
    occupancy_id?: string;
    role?: string;
    /** Portfolio contexts only: the role's live reach, and what it waits on. */
    access?: PortfolioAccess;
  }>;
  default_context_id: string | null;
  permissions: string[];
  entry_routes: { mobile: string; web: string };
  provider_readiness: ProviderReadiness | null;
};

export type ProviderReadiness = {
  identity: { state: "verified" | "pending" | "unverified" | "expired" };
  identity_verification_id: string | null;
  identity_status: string;
  identity_decision_note: string;
  status: string;
  next_step: "identity" | "property" | "review" | "more_info" | "approved";
  application_id: string | null;
  property_id: string | null;
  decision_note: string;
  onboarding_stage: "identity" | "property" | "review" | "more_info" | "unit" | "listing" | "listing_review" | "listing_changes" | "live";
  unit_id: string | null;
  listing_id: string | null;
  listing_status: string;
  listing_review_note: string;
};

/**
 * `unavailable` is the state this provider used to be missing.
 *
 * Without it every failure collapsed into `signed_out`, so "the server said no"
 * and "we could not reach the server" produced the same answer — and the second
 * one is not a logout. It means we do not yet know, which is a different thing
 * to tell someone.
 */
type SessionState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "unavailable" }
  /** `stale` marks an identity we hold but could not re-confirm just now. */
  | { status: "signed_in"; me: Me; stale?: boolean };

type SessionValue = {
  state: SessionState;
  /**
   * Re-read `/me/`, optionally selecting a context the caller has just earned.
   *
   * The parameter exists for exactly one moment: accepting a Portfolio
   * invitation. The context is new in this response, so a caller cannot select
   * it beforehand — `setActiveContext` would reject an id the previous `/me/`
   * did not contain, and the person would land back in whatever they were in.
   */
  refresh: (preferredContext?: string) => Promise<void>;
  signOut: () => Promise<void>;
  activeContext: string | null;
  setActiveContext: (context: string) => void;
};

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Did the server refuse us, or could we simply not reach it?
 *
 * Only the backend's explicit authentication contracts are a logout. A
 * malformed request, timeout, dropped connection or 502 says the session was
 * not confirmed; none of those proves that it ended.
 */
export function isRefusal(cause: unknown): boolean {
  return isSessionRefusal(cause);
}

/**
 * What `/me/` failing means for the session.
 *
 * Pure and exported so the rule can be tested directly, because it is the rule
 * that was wrong: every failure used to collapse into `signed_out`, so a
 * restart, a deploy or a moment of bad signal dumped people out of their
 * portal. Mobile has drawn this line since Phase 1 — "a temporary network
 * failure is not a logout" — and this is the web saying the same thing.
 */
export function stateAfterFailure(cause: unknown, current: SessionState): SessionState {
  if (isRefusal(cause)) return { status: "signed_out" };

  // Keep whoever is already here and mark the copy stale; the next successful
  // call replaces it. With nobody here yet there is nothing to keep, and saying
  // so beats claiming they are signed out.
  return current.status === "signed_in"
    ? { ...current, stale: true }
    : { status: "unavailable" };
}

/**
 * Contexts this person may currently be switched into.
 *
 * Scoped to the workspace they are in. A stored context from another experience
 * — most often a stale `"discovery"` — used to remain "valid" and get restored
 * on every load, which is how a provider ended up pointed at the tenant pages.
 */
function validContextIds(me: Me): string[] {
  const workspace = me.capabilities.active_workspace;
  return [
    ...me.available_contexts,
    ...me.contexts.map((context) => context.id),
  ].filter((id) => contextBelongsToWorkspace(id, workspace));
}

/** Set while signed in, so a refresh on a shared page can hold its public
 *  layout back until the session answers (see the script in app/layout). */
export const SESSION_HINT_KEY = "session.hint";

/**
 * Public pages do not probe an absent HttpOnly cookie. A prior successful
 * session leaves a non-secret hint so public chrome can still restore it;
 * protected routes always make one attempt because authentication is required.
 */
export function shouldRestoreSession(requireSession: boolean, hint: string | null): boolean {
  return requireSession || hint === "1";
}

function rememberSignedIn(signedIn: boolean) {
  try {
    if (signedIn) {
      window.localStorage.setItem(SESSION_HINT_KEY, "1");
    }
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage can be unavailable (private mode); the hint is only a nicety.
  }
  if (!signedIn) document.documentElement.removeAttribute("data-session-hint");
}

export function SessionProvider({
  children,
  requireSession = false,
}: {
  children: React.ReactNode;
  requireSession?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [activeContext, setActiveContextState] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async (preferredContext?: string) => {
    const started = generation.current;
    try {
      const me = await authedFetch<Me>("/me/");
      if (started !== generation.current) return;
      const stored = window.localStorage.getItem("account.active_context");
      const available = validContextIds(me);
      const context = preferredContext && available.includes(preferredContext)
        ? preferredContext
        : stored && available.includes(stored)
          ? stored
          : me.default_context_id ?? me.default_context;
      setActiveContextState(context);
      if (context) window.localStorage.setItem("account.active_context", context);
      setState({ status: "signed_in", me });
      rememberSignedIn(true);
    } catch (cause) {
      if (started !== generation.current) return;
      if (isRefusal(cause)) clearAccessToken();
      setState((current) => stateAfterFailure(cause, current));
      if (isRefusal(cause)) rememberSignedIn(false);
    }
  }, []);

  const setActiveContext = useCallback((context: string) => {
    if (state.status !== "signed_in" || !validContextIds(state.me).includes(context)) return;
    window.localStorage.setItem("account.active_context", context);
    setActiveContextState(context);
  }, [state]);

  useEffect(() => {
    const invalidated = () => {
      generation.current += 1;
      clearAccessToken();
      setActiveContextState(null);
      rememberSignedIn(false);
      setState({ status: "signed_out" });
    };
    window.addEventListener(SESSION_INVALID_EVENT, invalidated);
    return () => window.removeEventListener(SESSION_INVALID_EVENT, invalidated);
  }, []);

  useEffect(() => {
    let hint: string | null = null;
    try { hint = window.localStorage.getItem(SESSION_HINT_KEY); } catch { /* storage is optional */ }
    if (!shouldRestoreSession(requireSession, hint)) {
      setState({ status: "signed_out" });
      return;
    }
    void refresh();
  }, [refresh, requireSession]);

  const signOut = useCallback(async () => {
      generation.current += 1;
      const ending = endSession();
      setState({ status: "loading" });
      // A resolved photo URL outliving the session is a leak, and on a shared
      // machine the next person would load the last one's picture.
      forgetPhotoUrls();
      finishAccountWelcome();
      setActiveContextState(null);
      try {
        window.localStorage.removeItem("account.active_context");
        window.localStorage.removeItem("danpahq:recent-places:v2");
        window.sessionStorage.removeItem("danpahq:visited-listings");
        window.sessionStorage.removeItem("rentals:return-scroll");
      } catch { /* Session credentials are already cleared in memory. */ }
      rememberSignedIn(false);
      await ending;
      // Signing out leaves for the front door, and only the front door: no
      // sign-in dialog over it (owner, 2026-10-21) — somebody who just left
      // did not ask to come back in. One transition, so the page being left
      // never flashes its "Sign in to continue" gate on the way out.
      startTransition(() => {
        setState({ status: "signed_out" });
        router.replace("/");
        router.refresh();
      });
  }, [router]);

  const value = useMemo(
    () => ({ state, refresh, signOut, activeContext, setActiveContext }),
    [state, refresh, signOut, activeContext, setActiveContext],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used inside SessionProvider.");
  }
  return value;
}

/** After the sign-in screen gets a token, tell the rest of the app. */
export async function loadMe(): Promise<Me> {
  return authedFetch<Me>("/me/");
}

/**
 * Move between the tenant, provider and artisan experiences.
 *
 * Navigation only. The backend guarantees this touches no verification, revokes
 * no capability, and never creates a second account — so the switcher can be
 * offered freely wherever `available_workspaces` allows it.
 */
export async function chooseWorkspace(workspace: Workspace): Promise<Me> {
  return authedFetch<Me>("/me/workspace/", {
    method: "POST",
    body: JSON.stringify({ workspace }),
  });
}
