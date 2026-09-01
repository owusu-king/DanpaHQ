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

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, ApiFailure } from "./api";
import { authedFetch, clearAccessToken } from "./auth";
import { forgetPhotoUrls } from "./photo";
import { contextBelongsToWorkspace } from "./navigation";

export type Workspace = "discovery" | "tenant" | "provider";

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
    /** May enter the provider workspace — pending reviews included. */
    workspace_access: boolean;
    /** Approved. The only state in which a property may be created. */
    can_create_property: boolean;
  };
  tenant: { workspace_access: boolean };
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
  /** The national form, `024 123 4567`. This is the one to display. */
  phone_display: string;
  /** Optional at registration, so absent for plenty of real accounts. */
  email: string | null;
  display_name: string;
  first_name: string;
  last_name: string;
  preferred_name: string;
  roles: string[];
  primary_role: string | null;
  is_phone_verified: boolean;
  account_status: "active" | "restricted" | "deactivated";
  authentication_state: "authenticated";
  phone_verification_state: "verified" | "unverified";
  registration_state: Capabilities["registration_state"];
  capabilities: Capabilities;
  /** Null until a profile row exists. `avatar_url` is null when no photo is set,
   *  and also when the one on file is not servable yet — the shell shows initials
   *  in both cases, so it never has to reason about upload state. */
  profile: { avatar_url: string | null; completeness: number } | null;
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
    occupancy_id?: string;
    role?: string;
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
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  activeContext: string | null;
  setActiveContext: (context: string) => void;
};

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Did the server refuse us, or could we simply not reach it?
 *
 * Only the first is a logout. A 4xx is an answer; anything else — a timeout, a
 * dropped connection, a 502 from a restarting service — is the absence of one.
 */
export function isRefusal(cause: unknown): boolean {
  return cause instanceof ApiFailure && cause.status >= 400 && cause.status < 500;
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

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [activeContext, setActiveContextState] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await authedFetch<Me>("/me/");
      const stored = window.localStorage.getItem("account.active_context");
      const context = stored && validContextIds(me).includes(stored)
        ? stored
        : me.default_context_id ?? me.default_context;
      setActiveContextState(context);
      if (context) window.localStorage.setItem("account.active_context", context);
      setState({ status: "signed_in", me });
    } catch (cause) {
      if (isRefusal(cause)) clearAccessToken();
      setState((current) => stateAfterFailure(cause, current));
    }
  }, []);

  const setActiveContext = useCallback((context: string) => {
    if (state.status !== "signed_in" || !validContextIds(state.me).includes(context)) return;
    window.localStorage.setItem("account.active_context", context);
    setActiveContextState(context);
  }, [state]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      // Ends the session server-side and clears the refresh cookie. If it fails
      // we still drop the local token: a sign-out that visibly does nothing is
      // worse than one that is only local.
      await authedFetch("/auth/sign-out/", { method: "POST", body: JSON.stringify({}) });
    } catch {
      // Deliberately ignored - see above.
    } finally {
      clearAccessToken();
      // A resolved photo URL outliving the session is a leak, and on a shared
      // machine the next person would load the last one's picture.
      forgetPhotoUrls();
      setState({ status: "signed_out" });
      router.replace("/");
      router.refresh();
    }
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
  return apiFetch<Me>("/me/");
}

/**
 * Move between the tenant and provider experiences.
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
