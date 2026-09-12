/**
 * Mobile API client.
 *
 * The differences from the web client are all about the network this app runs
 * on. A tenant in Accra may be on a 3G connection that resolves DNS in four
 * seconds and then stalls, so:
 *
 * - Timeouts are longer than the web's but still finite.
 * - GETs retry with backoff. A protected mutation retries only when its caller
 *   supplies one stable idempotency key for the whole logical request.
 * - The request id is stable across retries of the same logical request, so a
 *   support agent can follow all three attempts in one search.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Where the API lives, which depends on what you are running the app on.
 *
 * An Android emulator reaches the host machine at 10.0.2.2; an iOS simulator
 * shares the host's localhost; a real phone needs the machine's LAN address and
 * has no way to guess it. So: an explicit EXPO_PUBLIC_API_URL wins, then
 * whatever app.json says, then a per-platform default that works for the
 * emulator and simulator cases.
 *
 *     EXPO_PUBLIC_API_URL=http://192.168.1.42:8000/api/v1 npx expo start
 *
 * None of those defaults may survive into a release build. A shipped app that
 * silently falls back to `localhost` is an app that cannot work on any handset
 * and is talking plain HTTP while it fails, so a release with no configured API
 * refuses to start rather than shipping broken and insecure. That matches how
 * the backend treats a missing production secret.
 */
function resolveBaseUrl(): string {
  const configured =
    process.env.EXPO_PUBLIC_API_URL ??
    (Constants.expoConfig?.extra?.apiUrl as string | undefined);

  if (!__DEV__) {
    if (!configured) {
      throw new Error(
        "EXPO_PUBLIC_API_URL is not set. A release build must be given the " +
          "production API URL; it must never fall back to a development address.",
      );
    }
    if (!configured.startsWith("https://")) {
      throw new Error(
        `EXPO_PUBLIC_API_URL must be https:// in a release build (got ${configured}).`,
      );
    }
    return configured;
  }

  if (configured) return configured;

  // The machine serving the JS bundle is the machine running the API, so ask
  // Expo where that is. This is what makes a real phone on Expo Go work with no
  // configuration at all - "localhost" on a handset is the handset, and the
  // failure looks like "we could not reach the service", which tells the user
  // nothing about what is wrong.
  const hostUri =
    (Constants.expoConfig?.hostUri as string | undefined) ??
    (Constants.expoGoConfig?.debuggerHost as string | undefined);
  const host = hostUri?.split(":")[0];
  if (host && host !== "localhost" && host !== "127.0.0.1") {
    return `http://${host}:8000/api/v1`;
  }

  // Emulators, where the host loopback has a special address.
  return Platform.OS === "android"
    ? "http://10.0.2.2:8000/api/v1" 
    : "http://localhost:8000/api/v1";
}

//  for android

/** Shown on the sign-in screen so a connection failure is diagnosable. */
export function apiBaseUrl(): string {
  return BASE_URL;
}

const BASE_URL = resolveBaseUrl();

const TIMEOUT_MS = 20_000;

/** Set by AuthProvider. Kept as a callback rather than a stored string so the
 *  client always gets a fresh (or freshly refreshed) token. */
type AuthTokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

let authTokenProvider: AuthTokenProvider | null = null;

export function setAuthTokenProvider(provider: AuthTokenProvider | null) {
  authTokenProvider = provider;
}
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export type ApiError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
  requestId: string;
};

export class ApiFailure extends Error {
  constructor(
    readonly error: ApiError,
    readonly status: number,
  ) {
    super(error.message);
  }
}

function newRequestId(): string {
  return `mob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Opt one backend-protected mutation into safe retry. */
export function idempotentMutation() {
  return { idempotencyKey: newRequestId(), maxAttempts: 3 } as const;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The Portfolio a provider list is about. */
export type PortfolioScope = { organization?: string };

/**
 * That Portfolio, as a query string.
 *
 * The scope travels in the request and the backend decides it from the
 * membership behind it, so a screen can neither widen it nor forget to apply it
 * once the answer arrives. Every provider list that hangs off Properties uses
 * this one builder, so they cannot drift into scoping themselves differently.
 */
export function scopeQuery(scope?: PortfolioScope, extra?: Record<string, string>): string {
  const query = new URLSearchParams(extra);
  if (scope?.organization) query.set("organization", scope.organization);
  const value = query.toString();
  return value ? `?${value}` : "";
}

export async function apiFetch<T>(
  path: string,
  options: {
    // PUT is here for the amenity checklist, which replaces a whole set
    // rather than editing part of one. PATCH would misdescribe it, and
    // "send what is now true" is what stops a half-saved checklist when a
    // phone drops signal mid-request.
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    token?: string;
    /** Skip the bearer token entirely - used by the sign-in endpoints. */
    anonymous?: boolean;
    idempotencyKey?: string;
    maxAttempts?: number;
  } = {},
): Promise<T> {
  const { method = "GET", body, idempotencyKey } = options;
  let token = options.token ?? (options.anonymous ? null : await authTokenProvider?.());
  const maxAttempts = options.maxAttempts ?? (method === "GET" ? 3 : 1);
  const requestId = newRequestId();
  let retriedAfterUnauthorized = false;

  let lastError: ApiFailure | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": requestId,
          "X-Client": "mobile",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const payload = response.status === 204 ? null : await response.json().catch(() => null);

      if (response.ok) return payload as T;

      const envelope = (payload as { error?: Partial<ApiError> } | null)?.error;
      lastError = new ApiFailure(
        {
          code: envelope?.code ?? "request_failed",
          message: envelope?.message ?? "That did not work. Try again.",
          details: envelope?.details ?? {},
          requestId,
        },
        response.status,
      );

      // Match the web client: a bearer token can expire or be invalidated
      // between getToken() and the server reading the request. Refresh once and
      // replay with the new token instead of surfacing a false authorization
      // failure. A 401 is produced before the domain view runs, so replaying
      // the request does not duplicate a mutation.
      if (
        response.status === 401
        && !options.anonymous
        && options.token === undefined
        && !retriedAfterUnauthorized
        && authTokenProvider
      ) {
        retriedAfterUnauthorized = true;
        const refreshed = await authTokenProvider(true);
        if (refreshed) {
          token = refreshed;
          attempt -= 1;
          continue;
        }
      }

      if (!RETRYABLE_STATUS.has(response.status)) throw lastError;
    } catch (cause) {
      if (cause instanceof ApiFailure && !RETRYABLE_STATUS.has(cause.status)) throw cause;
      lastError =
        cause instanceof ApiFailure
          ? cause
          : new ApiFailure(
              {
                code: "network_error",
                message: "We could not reach the service. Check your connection.",
                details: {},
                requestId,
              },
              0,
            );
    } finally {
      clearTimeout(timer);
    }

    if (attempt < maxAttempts) await sleep(2 ** attempt * 400);
  }

  throw lastError;
}

/** Authenticated binary response for immutable documents. */
export async function apiFetchBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const send = async (token: string | null) => fetch(`${BASE_URL}${path}`, {
    headers: {
      "X-Request-ID": newRequestId(),
      "X-Client": "mobile",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  let token = await authTokenProvider?.();
  let response = await send(token ?? null);
  if (response.status === 401 && authTokenProvider) {
    token = await authTokenProvider(true);
    response = await send(token ?? null);
  }
  if (!response.ok) {
    throw new ApiFailure(
      { code: "document_unavailable", message: "The final document is not available.", details: {}, requestId: "" },
      response.status,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
