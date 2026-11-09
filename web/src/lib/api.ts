/**
 * The single way this app talks to the backend.
 *
 * Three things every call gets for free, because doing them per-call is how
 * they get forgotten: a request id that ties the browser to the server logs,
 * a timeout (a hung fetch on a weak connection is worse than a fast failure),
 * and parsing of the one error envelope the API returns.
 */

import { API_BASE_URL } from "@/lib/apiBase";

export type ApiError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
  requestId: string;
};

/** The envelope exactly as the API sends it. */
type ApiErrorEnvelope = {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
  request_id?: string;
};

export class ApiFailure extends Error {
  constructor(
    readonly error: ApiError,
    readonly status: number,
  ) {
    super(error.message);
    this.name = "ApiFailure";
  }
}

const BASE_URL = API_BASE_URL;
export function apiBaseUrl() { return BASE_URL; }
const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Worth trying again: the request was fine, the service was momentarily not.
 *
 * The same set mobile uses. A 4xx is deliberately absent — the server has
 * answered, and asking again will get the same answer.
 */
const RETRYABLE_STATUS = new Set([502, 503, 504]);

function fallbackError(status: number) {
  if (status === 408 || status === 504) return { code: "request_timeout", message: "The request timed out. Try again." };
  if (status === 502 || status === 503) return { code: "service_unavailable", message: "Danpa HQ is temporarily unavailable. Try again shortly." };
  if (status >= 500) return { code: "server_error", message: "Danpa HQ couldn’t complete this request. Try again shortly." };
  if (status === 429) return { code: "rate_limited", message: "Too many requests. Wait a moment and try again." };
  if (status === 401) return { code: "not_authenticated", message: "Sign in to continue." };
  if (status === 403) return { code: "permission_denied", message: "Your account can’t perform this action." };
  return { code: "request_failed", message: "That request did not work. Try again." };
}

/** Network failure. Not a status, so it needs its own name. */
const UNREACHABLE = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function requestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Reads retry by default. A mutation retries only when its caller supplies one
 * stable idempotency key for the whole logical request.
 *
 * The web client used to fire once and give up, which mobile never did. That
 * asymmetry is how a single blip on `/me/` turned into a sign-out: one failed
 * read was indistinguishable from "this person is not signed in". Retrying GETs
 * removes most of those blips before anything upstream has to decide what they
 * meant.
 *
 * A retried GET keeps its request id, so all three attempts are one search in
 * the server logs.
 */
export type ApiRequestInit = RequestInit & {
  timeoutMs?: number;
  idempotencyKey?: string;
  maxAttempts?: number;
};

/** Opt one protected mutation into safe retry with a fresh logical-request key. */
export function idempotentMutation(): Pick<ApiRequestInit, "idempotencyKey" | "maxAttempts"> {
  return { idempotencyKey: requestId(), maxAttempts: 3 };
}

export async function apiFetch<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, idempotencyKey, maxAttempts, signal: caller, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const attempts = maxAttempts ?? (method === "GET" ? 3 : 1);
  const id = requestId();
  let lastError: ApiFailure | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // The caller's signal used to be replaced by the timeout's, so a search
    // superseded by the next keystroke or map move ran — and retried — to the
    // end anyway. Now it is followed, and an abort is final: no retry.
    if (caller?.aborted) throw aborted(id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const follow = () => controller.abort();
    caller?.addEventListener("abort", follow, { once: true });

    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        ...rest,
        signal: controller.signal,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": id,
          "X-Client": "web",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...rest.headers,
        },
      });

      if (response.status === 204) return null as T;
      const body = await response.json().catch((cause: unknown) => {
        if (controller.signal.aborted) throw cause;
        if (response.ok) throw new ApiFailure({
          code: "invalid_response", message: "Danpa HQ returned an unexpected response. Try again.", details: {}, requestId: id,
        }, response.status);
        return null;
      });
      if (response.ok) return body as T;

      // The wire envelope is snake_case; ApiError is the camelCase shape the
      // rest of the app uses. Naming the wire type separately is what stops the
      // two drifting into each other.
      const envelope = (body as { error?: ApiErrorEnvelope } | null)?.error;
      const fallback = fallbackError(response.status);
      lastError = new ApiFailure(
        {
          code: envelope?.code ?? fallback.code,
          message: envelope?.message ?? fallback.message,
          details: envelope?.details ?? {},
          requestId: envelope?.request_id ?? id,
        },
        response.status,
      );

      if (!RETRYABLE_STATUS.has(response.status)) throw lastError;
    } catch (cause) {
      if (caller?.aborted) throw aborted(id);
      if (cause instanceof ApiFailure && !RETRYABLE_STATUS.has(cause.status)) throw cause;
      if (!(cause instanceof ApiFailure)) {
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        lastError = new ApiFailure(
          {
            code: offline ? "offline" : controller.signal.aborted ? "request_timeout" : "network_error",
            message: offline
              ? "You’re offline. Reconnect and try again."
              : controller.signal.aborted ? "The request timed out. Try again." : "Couldn’t connect to Danpa HQ. Try again shortly.",
            details: {},
            requestId: id,
          },
          UNREACHABLE,
        );
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", follow);
    }

    if (attempt < attempts) await sleep(2 ** attempt * 400);
  }

  throw lastError ?? new ApiFailure(
    {
      code: "network_error",
      message: "Couldn’t connect to Danpa HQ. Try again shortly.",
      details: {},
      requestId: id,
    },
    UNREACHABLE,
  );
}

/** A request its caller withdrew. Not a failure to show anyone: check `isAborted`. */
function aborted(id: string) {
  return new ApiFailure(
    { code: "aborted", message: "The request was replaced by a newer one.", details: {}, requestId: id },
    UNREACHABLE,
  );
}

export function isAborted(cause: unknown): boolean {
  return cause instanceof ApiFailure && cause.error.code === "aborted";
}
