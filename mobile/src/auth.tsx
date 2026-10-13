/**
 * Authentication state, shared across the app.
 *
 * Holds the tokens, refreshes them before they expire, and hides the whole
 * mechanism from screens. Two behaviours matter on this market's networks:
 *
 * - **Refresh is single-flight.** Several screens waking at once must not each
 *   rotate the refresh token; the second rotation would look like token reuse to
 *   the server and sign the user out. One in-flight promise is shared.
 * - **Sign-out is local-first.** If the network is gone, clearing the device is
 *   still the right thing to do immediately; telling the server is best-effort.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch, ApiFailure, setAuthTokenProvider } from "@/api";
import { forgetPhotoUrls } from "@/photo";
import { contextBelongsToWorkspace } from "@/navigation";
import { clearPendingOnboardingIntent } from "@/onboardingIntent";
import { clearRegistrationDraft, finishAccountWelcome } from "@/registrationDraft";
import { useRouter } from "expo-router";
import { clearServiceDetails } from "@/serviceAccounts";
import { clearPrivateDocuments } from "@/privateDocuments";
// The shape a Portfolio context carries. Type-only, so this stays a one-way
// dependency: the API module knows nothing about the session that reads it.
import type { PortfolioAccess } from "@/organizations";
import { secure } from "@/secure";

const REFRESH_KEY = "auth.refresh_token";
const DEVICE_KEY = "device.fingerprint";
const CONTEXT_KEY = "account.active_context";
const ME_SNAPSHOT_KEY = "auth.me_snapshot";
const VISITED_KEY = "installation.visited";

/** Only these responses mean the refresh credential itself was refused.
 * Throttling, timeouts and unrelated client errors must never erase a session. */
function isRefreshRefusal(cause: unknown): cause is ApiFailure {
  return cause instanceof ApiFailure && [400, 401, 403, 422].includes(cause.status);
}

export type TrustState = "verified" | "pending" | "unverified" | "expired";

export type TrustEntry = {
  state: TrustState;
  decided_at: string | null;
  expires_at: string | null;
  method: string;
};

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
 * Read it; never derive it. `account_type` says what someone registered as, not
 * what they are allowed to do — a provider account with a pending review has
 * `provider.workspace_access: false`, and that field alone decides whether the
 * provider tabs open.
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
    /**
     * May enter the provider workspace: an approved provider, or a member of
     * somebody's Portfolio. Not the same question as `exists`, which is only
     * about this person's own journey.
     */
    workspace_access: boolean;
    /** Approved. The only state in which a property may be created for oneself. */
    can_create_property: boolean;
  };
  tenant: { workspace_access: boolean };
};

export type Me = {
  id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  preferred_name: string;
  phone_display: string;
  is_phone_verified: boolean;
  /** On the account only once its code was confirmed — or given at sign-up, unconfirmed. */
  email?: string | null;
  is_email_verified?: boolean;
  /** Set at registration; read-only afterwards. */
  date_of_birth?: string | null;
  roles: string[];
  primary_role: string;
  data_saver: boolean;
  /** `avatar_url` is null when no photo is set, and also when the one on
   *  file is not servable yet — the screen shows initials in both cases. */
  profile: {
    completeness: number;
    bio: string;
    avatar_url: string | null;
  } | null;
  trust: Record<string, TrustEntry>;
  account_status: "active" | "restricted" | "deactivated";
  authentication_state: "authenticated";
  phone_verification_state: "verified" | "unverified";
  registration_state: Capabilities["registration_state"];
  capabilities: Capabilities;
  onboarding_state: "profile_required" | "intent_required" | "complete";
  available_contexts: string[];
  default_context: string | null;
  intents: ("find_property" | "current_tenant" | "manage_property")[];
  contexts: {
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
  }[];
  default_context_id: string | null;
  permissions: string[];
  entry_routes: { mobile: string; web: string };
  provider_readiness: ProviderReadiness | null;
};

/**
 * Contexts this person may currently be switched into.
 *
 * Scoped to the workspace they are in. A stored context from another experience
 * — most often a stale `"discovery"` — used to remain "valid" and get restored
 * on every sign-in, which is how a provider ended up pointed at the tenant tabs.
 */
function validContextIds(me: Me): string[] {
  const workspace = me.capabilities.active_workspace;
  return [
    ...me.available_contexts,
    ...me.contexts.map((context) => context.id),
  ].filter((id) => contextBelongsToWorkspace(id, workspace));
}

export type ProviderReadiness = {
  identity: TrustEntry;
  identity_verification_id: string | null;
  identity_status: string;
  identity_decision_note: string;
  status: string;
  next_step: "identity" | "property" | "review" | "more_info" | "approved";
  application_id: string | null;
  property_id: string | null;
  decision_note: string;
  onboarding_stage: "identity" | "property" | "review" | "more_info" | "approved" | "unit" | "listing" | "listing_review" | "listing_changes" | "live";
  unit_id: string | null;
  listing_id: string | null;
  listing_status: string;
  listing_review_note: string;
};

type AuthState =
  | { status: "loading" }
  | { status: "signed_out"; firstVisit?: boolean }
  | { status: "signed_in"; me: Me };

type AuthContextValue = {
  state: AuthState;
  signIn: (
    tokens: { access_token: string; refresh_token: string; expires_in?: number; user: Me },
    preferredContext?: string | null,
  ) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshMe: (preferredContext?: string) => Promise<void>;
  deviceFingerprint: string;
  activeContext: string | null;
  setActiveContext: (context: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Stable per install, stored in the Keychain/Keystore. Identifies an
 *  installation for the device list and the new-device alert - not a person. */
async function loadDeviceFingerprint(): Promise<string> {
  const existing = await secure.get(DEVICE_KEY);
  if (existing) return existing;
  const created = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await secure.set(DEVICE_KEY, created);
  return created;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [deviceFingerprint, setDeviceFingerprint] = useState("");
  const [activeContext, setActiveContextState] = useState<string | null>(null);

  const accessToken = useRef<string | null>(null);
  const expiresAt = useRef<number>(0);
  const refreshInFlight = useRef<Promise<string | null> | null>(null);
  const generation = useRef(0);
  const signedOut = useRef(false);
  const persistence = useRef<Promise<void>>(Promise.resolve());
  const persistSession = useCallback((entries: [string, string][]) => {
    const started = generation.current;
    const write = persistence.current.catch(() => undefined).then(async () => {
      for (const [key, value] of entries) {
        if (started !== generation.current) return;
        await secure.set(key, value);
      }
    });
    persistence.current = write;
    return write;
  }, []);

  const clearLocal = useCallback(async () => {
    generation.current += 1;
    signedOut.current = true;
    accessToken.current = null;
    expiresAt.current = 0;
    setActiveContextState(null);
    clearRegistrationDraft();
    finishAccountWelcome();
    forgetPhotoUrls();
    // A filesystem problem must not keep session credentials on the device.
    try { clearPrivateDocuments(); } catch { /* cleanup can retry on next logout */ }
    setState({ status: "loading" });
    // Wait for a secure write already in progress, then remove its result.
    // A response from the previous session must never survive this cleanup.
    await refreshInFlight.current?.catch(() => undefined);
    await persistence.current.catch(() => undefined);
    await secure.clear(REFRESH_KEY);
    await secure.clear(ME_SNAPSHOT_KEY);
    await secure.clear(CONTEXT_KEY);
    await clearServiceDetails();
    await clearPendingOnboardingIntent();
    setState({ status: "signed_out" });
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (signedOut.current) return null;
    if (refreshInFlight.current) return refreshInFlight.current;
    const started = generation.current;

    refreshInFlight.current = (async () => {
      try {
        // Inside the try, so the `finally` below releases the latch however
        // this ends. Read outside it, the two ways out that skip the try — no
        // stored token, and a keychain that refuses to be read — left
        // `refreshInFlight` holding a settled promise for the rest of the
        // process. Every later call then returned that same dead promise, so
        // `getToken()` answered `null` forever, every protected request went
        // out with no Authorization header, and the API answered each one with
        // "Sign in to continue." while the app still held the session in memory
        // and went on showing the profile.
        //
        // The common way in is an ordinary launch: opening the app signed out
        // takes the `!refreshToken` path, which wedged the latch before anybody
        // had signed in. Signing in then works for as long as the access token
        // is fresh, because `signIn` sets it directly — and breaks the first
        // time it needs renewing, which is why it looked sporadic.
        const refreshToken = await secure.get(REFRESH_KEY);
        if (!refreshToken) return null;

        const result = await apiFetch<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
        }>("/auth/refresh/", {
          method: "POST",
          // The refresh token is the credential for this endpoint. Asking the
          // API client to add an access token would call getToken(), which calls
          // this function again and makes the single-flight promise wait on
          // itself forever.
          anonymous: true,
          body: { refresh_token: refreshToken },
        });

        // Persist the rotated credential before publishing the access token.
        // If secure storage fails, no request should proceed as though the
        // rotation were safely committed on the handset.
        if (started !== generation.current) return null;
        await persistSession([[REFRESH_KEY, result.refresh_token]]);
        if (started !== generation.current) return null;
        accessToken.current = result.access_token;
        expiresAt.current = Date.now() + result.expires_in * 1000;
        return result.access_token;
      } catch (cause) {
        // A refused refresh means the session is genuinely over - revoked,
        // expired, or reuse-detected. Anything else (offline, or a keychain
        // that would not answer) leaves the stored token alone so the app
        // recovers when the connection or the device does.
        if (isRefreshRefusal(cause)) {
          // Do not make clearLocal wait on the refresh that is calling it.
          refreshInFlight.current = null;
          if (started === generation.current) await clearLocal();
        }
        // Do not turn an unavailable refresh into "no token". The caller would
        // then send a protected request anonymously, receive a 401, and treat a
        // network interruption as a real logout. Preserve the actual failure;
        // refused sessions have already been cleared above.
        throw cause;
      } finally {
        refreshInFlight.current = null;
      }
    })();

    return refreshInFlight.current;
  }, [clearLocal, persistSession]);

  const getToken = useCallback(async () => {
    // Refresh a minute early: a token that expires mid-request produces a
    // spurious sign-out on a slow connection.
    if (accessToken.current && Date.now() < expiresAt.current - 60_000) {
      return accessToken.current;
    }
    return refreshAccessToken();
  }, [refreshAccessToken]);

  useEffect(() => {
    setAuthTokenProvider((forceRefresh = false) => (
      forceRefresh ? refreshAccessToken() : getToken()
    ));
    return () => setAuthTokenProvider(null);
  }, [getToken, refreshAccessToken]);

  const refreshMe = useCallback(async (preferredContext?: string) => {
    const started = generation.current;
    try {
      const me = await apiFetch<Me>("/me/");
      const storedContext = await secure.get(CONTEXT_KEY);
      if (started !== generation.current || signedOut.current) return;
      const available = validContextIds(me);
      const context = preferredContext && available.includes(preferredContext)
        ? preferredContext
        : storedContext && available.includes(storedContext)
          ? storedContext
          : me.default_context_id ?? me.default_context;
      setActiveContextState(context);
      await persistSession([
        ...(context ? [[CONTEXT_KEY, context] as [string, string]] : []),
        [ME_SNAPSHOT_KEY, JSON.stringify(me)],
      ]);
      if (started !== generation.current || signedOut.current) return;
      setState({ status: "signed_in", me });
    } catch (cause) {
      if (started !== generation.current || signedOut.current) return;
      // 403 is an authorization decision, not proof that authentication ended.
      // A stale access-token 401 has already received one forced refresh in the
      // API client; only a remaining 401 is a session-level refusal here.
      if (cause instanceof ApiFailure && cause.status === 401) {
        await clearLocal();
        return;
      }
      // A temporary network failure is not a logout. Restore the last
      // securely-stored identity snapshot; protected API calls still enforce
      // the live server session when connectivity returns.
      const snapshot = await secure.get(ME_SNAPSHOT_KEY);
      if (snapshot) {
        const me = JSON.parse(snapshot) as Me;
        const storedContext = await secure.get(CONTEXT_KEY);
        if (started !== generation.current || signedOut.current) return;
        setActiveContextState(
          storedContext && validContextIds(me).includes(storedContext)
            ? storedContext
            : me.default_context_id ?? me.default_context,
        );
        setState({ status: "signed_in", me });
      }
    }
  }, [clearLocal, persistSession]);

  useEffect(() => {
    (async () => {
      setDeviceFingerprint(await loadDeviceFingerprint());
      const visited = await secure.get(VISITED_KEY);
      await secure.set(VISITED_KEY, "1");
      const started = generation.current;
      try {
        const token = await refreshAccessToken();
        if (started !== generation.current) return;
        if (!token) {
          setState({ status: "signed_out", firstVisit: !visited });
          return;
        }
        await refreshMe();
      } catch {
        // A refused refresh cleared these values already. A temporary network
        // failure did not, so restore the last known identity and let the next
        // request retry refresh instead of pinning startup on a blank/loading
        // state.
        const refreshToken = await secure.get(REFRESH_KEY);
        const snapshot = await secure.get(ME_SNAPSHOT_KEY);
        if (started !== generation.current) return;
        if (refreshToken && snapshot) {
          const me = JSON.parse(snapshot) as Me;
          const storedContext = await secure.get(CONTEXT_KEY);
          setActiveContextState(
            storedContext && validContextIds(me).includes(storedContext)
              ? storedContext
              : me.default_context_id ?? me.default_context,
          );
          setState({ status: "signed_in", me });
        } else {
          setState({ status: "signed_out" });
        }
      }
    })();
  }, [refreshAccessToken, refreshMe]);

  const signIn = useCallback<AuthContextValue["signIn"]>(async (tokens, preferredContext) => {
    generation.current += 1;
    signedOut.current = false;
    accessToken.current = tokens.access_token;
    expiresAt.current = Date.now() + (tokens.expires_in ?? 15 * 60) * 1000;
    await persistSession([[REFRESH_KEY, tokens.refresh_token], [ME_SNAPSHOT_KEY, JSON.stringify(tokens.user)]]);
    const storedContext = await secure.get(CONTEXT_KEY);
    const available = validContextIds(tokens.user);
    const context = preferredContext && available.includes(preferredContext)
      ? preferredContext
      : storedContext && available.includes(storedContext)
        ? storedContext
        : tokens.user.default_context_id ?? tokens.user.default_context;
    setActiveContextState(context);
    if (context) await persistSession([[CONTEXT_KEY, context]]);
    setState({ status: "signed_in", me: tokens.user });
    return context;
  }, [persistSession]);

  const setActiveContext = useCallback(async (context: string) => {
    if (state.status !== "signed_in" || !validContextIds(state.me).includes(context)) {
      throw new Error("That context is not available to this account.");
    }
    await persistSession([[CONTEXT_KEY, context]]);
    setActiveContextState(context);
  }, [state, persistSession]);

  const signOut = useCallback(async () => {
    const token = accessToken.current;
    if (token) void apiFetch("/auth/sign-out/", { method: "POST", token, anonymous: true }).catch(() => undefined);
    // A resolved photo URL outliving the session is a leak, and on a shared
    // handset the next person would load the last one's picture.
    forgetPhotoUrls();
    await clearLocal();
    // Only when something is pushed: from a tab with nothing above it there is
    // no stack to pop, and a bare dismissAll reports POP_TO_TOP as unhandled.
    if (router.canDismiss()) router.dismissAll();
    router.replace("/(auth)/sign-in");
  }, [clearLocal, router]);

  const value = useMemo(
    () => ({ state, signIn, signOut, refreshMe, deviceFingerprint, activeContext, setActiveContext }),
    [state, signIn, signOut, refreshMe, deviceFingerprint, activeContext, setActiveContext],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function useMe(): Me {
  const { state } = useAuth();
  if (state.status !== "signed_in") throw new Error("useMe requires a signed-in user");
  return state.me;
}
