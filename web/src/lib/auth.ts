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

export function setAccessToken(token: string, expiresInSeconds: number) {
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
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const result = await apiFetch<{ access_token: string; expires_in: number }>(
        "/auth/refresh/",
        { method: "POST", body: JSON.stringify(getWebDeviceContext()) },
      );
      setAccessToken(result.access_token, result.expires_in);
      return result.access_token;
    } catch (cause) {
      // Refused: the refresh token is spent, revoked or absent. That is a real
      // sign-out and the memory copy goes with it. Unreachable is not, and the
      // token is left alone so a later attempt can still use it.
      if (cause instanceof ApiFailure && cause.status >= 400 && cause.status < 500) {
        clearAccessToken();
      }
      throw cause;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * The current access token, rotating it if it is near expiry.
 *
 * Throws rather than returning null, so the *reason* survives: a 4xx from the
 * refresh means signed out, an unreachable service means we do not know, and
 * those two must not arrive looking the same.
 */
export async function getAccessToken(): Promise<string> {
  // Refresh a minute early so a token cannot expire mid-request.
  if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;
  return refresh();
}

/** Rotate now, whatever the clock says. Single-flight, like every refresh. */
export async function forceRefresh(): Promise<string> {
  return refresh();
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
  const token = await getAccessToken();

  const send = (bearer: string) =>
    apiFetch<T>(path, {
      ...init,
      headers: { Authorization: `Bearer ${bearer}`, ...init.headers },
    });

  try {
    return await send(token);
  } catch (cause) {
    if (!(cause instanceof ApiFailure) || cause.status !== 401) throw cause;
    try {
      return await send(await forceRefresh());
    } catch {
      // The rotation failed too. The original 401 is the honest thing to
      // report: the request was refused, and re-credentialing did not help.
      throw cause;
    }
  }
}

/** Authenticated binary download for immutable documents. */
export async function authedBlob(path: string): Promise<Blob> {
  const send = (bearer: string) => fetch(`${apiBaseUrl()}${path}`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${bearer}`, "X-Client": "web" },
  });
  let response = await send(await getAccessToken());
  if (response.status === 401) response = await send(await forceRefresh());
  if (!response.ok) {
    throw new ApiFailure(
      { code: "document_unavailable", message: "The final document is not available.", details: {}, requestId: "" },
      response.status,
    );
  }
  return response.blob();
}
