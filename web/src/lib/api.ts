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
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

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
  const { timeoutMs = DEFAULT_TIMEOUT_MS, idempotencyKey, maxAttempts, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const attempts = maxAttempts ?? (method === "GET" ? 3 : 1);
  const id = requestId();
  let lastError: ApiFailure | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

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

      const body = response.status === 204 ? null : await response.json().catch(() => null);

      if (response.ok) return body as T;

      // The wire envelope is snake_case; ApiError is the camelCase shape the
      // rest of the app uses. Naming the wire type separately is what stops the
      // two drifting into each other.
      const envelope = (body as { error?: ApiErrorEnvelope } | null)?.error;
      lastError = new ApiFailure(
        {
          code: envelope?.code ?? "request_failed",
          message: envelope?.message ?? "That request did not work. Try again.",
          details: envelope?.details ?? {},
          requestId: envelope?.request_id ?? id,
        },
        response.status,
      );

      if (!RETRYABLE_STATUS.has(response.status)) throw lastError;
    } catch (cause) {
      if (cause instanceof ApiFailure && !RETRYABLE_STATUS.has(cause.status)) throw cause;
      if (!(cause instanceof ApiFailure)) {
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        lastError = new ApiFailure(
          {
            code: offline ? "offline" : "network_error",
            message: offline
              ? "You are offline. We will retry when your connection is back."
              : "We could not reach the service. Check your connection and try again.",
            details: {},
            requestId: id,
          },
          UNREACHABLE,
        );
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts) await sleep(2 ** attempt * 400);
  }

  throw lastError ?? new ApiFailure(
    {
      code: "network_error",
      message: "We could not reach the service. Check your connection and try again.",
      details: {},
      requestId: id,
    },
    UNREACHABLE,
  );
}
