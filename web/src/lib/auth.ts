/**
 * Web session handling.
 *
 * The web console is used by landlords, agents and the review team — people at a
 * desk, often for a whole shift. That changes the trade-offs from mobile:
 *
 * - Tokens live in memory, not localStorage. An XSS bug that can read
 *   localStorage owns every session forever; one that has to wait for a
 *   refresh in memory is a much smaller window. The refresh token goes in an
 *   httpOnly cookie set by the API in production.
 * - Refresh is single-flight for the same reason as mobile: a second concurrent
 *   rotation looks like token reuse and would sign the reviewer out mid-decision.
 */

import { apiBaseUrl, apiFetch, ApiFailure, type ApiRequestInit } from "./api";
import { getWebDeviceContext } from "./device";

let accessToken: string | null = null;
let expiresAt = 0;
let inFlight: Promise<string> | null = null;
let generation = 0;
let loggedOut = false;
export const SESSION_LOGOUT_KEY = "session.logged_out";

/** Lets the session provider react when a later token rotation proves the
 * session has ended. The access-token module has no React dependency, and the
 * provider remains the one place that owns visible authentication state. */
export const SESSION_INVALID_EVENT = "danpahq:session-invalid";

function sessionEnded(): boolean {
  try { return loggedOut || window.localStorage.getItem(SESSION_LOGOUT_KEY) === "1"; }
  catch { return loggedOut; }
}

function endedError() {
  return new ApiFailure({ code: "signed_out", message: "Sign in to continue.", details: {}, requestId: "" }, 401);
}

/**
 * Only an explicit session response can sign someone out. A rejected bearer
 * on a protected endpoint can be stale and does not invalidate the cookie.
 */
export function isSessionRefusal(cause: unknown): boolean {
  return cause instanceof ApiFailure && cause.status === 401
    && ["signed_out", "session_ended"].includes(cause.error.code);
}

function invalidateSession() {
  loggedOut = true;
  try { window.localStorage.setItem(SESSION_LOGOUT_KEY, "1"); } catch { /* memory still protects this tab */ }
  clearAccessToken();
  window.dispatchEvent(new Event(SESSION_INVALID_EVENT));
}

/** Explicit logout survives an offline reload even if the HttpOnly cookie remains. */
export async function endSession() {
  const token = accessToken;
  generation += 1;
  loggedOut = true;
  try { window.localStorage.setItem(SESSION_LOGOUT_KEY, "1"); } catch { /* memory still protects this tab */ }
  clearAccessToken();
  // Let any cookie rotation finish before the final cookie deletion.
  await inFlight?.catch(() => undefined);
  if (token) await apiFetch("/auth/sign-out/", {
    method: "POST", body: JSON.stringify({}), headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

export function setAccessToken(token: string, expiresInSeconds: number) {
  generation += 1;
  loggedOut = false;
  try { window.localStorage.removeItem(SESSION_LOGOUT_KEY); } catch { /* storage optional */ }
  accessToken = token;
  expiresAt = Date.now() + expiresInSeconds * 1000;
}

export function clearAccessToken() {
  accessToken = null;
  expiresAt = 0;
}

/**
 * Rotate the access token, or throw the reason it could not be rotated.
 *
 * It used to flatten every failure to `null`, which threw away the one thing
 * the caller needed to know: whether the server *refused* us or whether we
 * simply could not reach it. Everything downstream then had to guess, and it
 * guessed "signed out" — so an unreachable API logged people out.
 */
async function refresh(): Promise<string> {
  if (sessionEnded()) throw endedError();
  if (inFlight) return inFlight;
  const started = generation;

  inFlight = Promise.resolve().then(async () => {
    try {
      const rotate = () => {
        if (started !== generation || sessionEnded()) throw endedError();
        return apiFetch<{ access_token: string; expires_in: number }>(
          "/auth/refresh/",
          { method: "POST", body: JSON.stringify(getWebDeviceContext()) },
        );
      };
      // The HttpOnly cookie is shared across tabs. Hold the lock until the
      // browser has received its replacement; the server still detects reuse.
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      const result = await (locks ? locks.request("danpahq:refresh", rotate) : rotate());
      if (started !== generation || sessionEnded()) {
        if (sessionEnded()) await apiFetch("/auth/sign-out/", {
          method: "POST", body: JSON.stringify({}),
          headers: { Authorization: `Bearer ${result.access_token}` },
        }).catch(() => undefined);
        throw endedError();
      }
      accessToken = result.access_token;
      expiresAt = Date.now() + result.expires_in * 1000;
      return result.access_token;
    } catch (cause) {
      // Refused: the refresh token is spent, revoked or absent. That is a real
      // sign-out and the memory copy goes with it. Unreachable, malformed and
      // unexpected responses are not, and remain available to their caller.
      if (started === generation && isSessionRefusal(cause)) {
        invalidateSession();
      }
      throw cause;
    } finally {
      inFlight = null;
    }
  });

  return inFlight;
}

/**
 * The current access token, rotating it if it is near expiry.
 *
 * Throws rather than returning null so an ended session and a failed request
 * remain distinguishable.
 */
export async function getAccessToken(): Promise<string> {
  if (sessionEnded()) throw endedError();
  // Refresh a minute early so a token cannot expire mid-request.
  if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;
  return refresh();
}

/** Rotate now, whatever the clock says. Single-flight, like every refresh. */
export async function forceRefresh(rejectedToken?: string): Promise<string> {
  if (sessionEnded()) throw endedError();
  return rejectedToken && accessToken && rejectedToken !== accessToken
    ? accessToken : refresh();
}

/**
 * An authenticated request, which fails rather than quietly becoming an
 * anonymous one.
 *
 * It used to send the request with no Authorization header whenever the refresh
 * came back empty. That turned a momentary refresh failure into a guaranteed
 * 401 — indistinguishable from "this person is signed out" — so a blip during a
 * token rotation logged people out of their portal. Now the failure from the
 * rotation itself is what propagates, carrying whether the server refused us or
 * was simply unreachable.
 *
 * One retry on a 401, after forcing a rotation. The access token can be revoked
 * or rotated by another tab between being read and being used, and a single
 * stale token should not surface as a failure the person has to act on.
 */
export async function authedFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const started = generation;
  const token = await getAccessToken();
  if (started !== generation) throw endedError();

  const send = (bearer: string) =>
    apiFetch<T>(path, {
      ...init,
      headers: { Authorization: `Bearer ${bearer}`, ...init.headers },
    });

  try {
    return await send(token);
  } catch (cause) {
    if (!(cause instanceof ApiFailure) || cause.status !== 401 || started !== generation) throw cause;
    return send(await forceRefresh(token));
  }
}

/** Authenticated binary download for immutable documents. */
export async function authedBlob(path: string): Promise<Blob> {
  const send = (bearer: string) => fetch(`${apiBaseUrl()}${path}`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${bearer}`, "X-Client": "web" },
  });
  const token = await getAccessToken();
  let response = await send(token);
  if (response.status === 401) response = await send(await forceRefresh(token));
  if (!response.ok) {
    throw new ApiFailure(
      { code: "document_unavailable", message: "The final document is not available.", details: {}, requestId: "" },
      response.status,
    );
  }
  return response.blob();
}
