/**
 * Turning a file endpoint into something an `<img>` can actually load.
 *
 * `profile.avatar_url` is a path to the files download endpoint, and that
 * endpoint returns JSON — `{ url, expires_in }` — rather than bytes. Object
 * storage stays private, and reads go straight from storage to the browser
 * without passing through Django.
 *
 * Which means an `<img src>` cannot point at it. Two things stop that working:
 * the endpoint answers with JSON, and the API authenticates with a bearer token
 * that an `<img>` request would never send.
 *
 * So the URL is resolved once and cached. The cache matters more than it looks:
 * the avatar renders in the rail on every screen, and re-resolving per render
 * would be a request per navigation on a connection where that is expensive.
 */

import { authedFetch } from "./auth";

type Resolved = { url: string; expires_in: number };

type Entry = { url: string; expiresAt: number };

const cache = new Map<string, Entry>();

/**
 * Resolutions currently in flight.
 *
 * Separate from `cache` because the two answer different questions: one holds a
 * URL we have, this holds a request we are waiting on. Without it the avatar
 * caused a small stampede — it renders in the rail, in the account popover and
 * on the account page, all three mount together, and all three missed a cache
 * that is only written *after* the first request returns. Four requests for one
 * photo, every navigation.
 */
const inFlight = new Map<string, Promise<string | null>>();

/** Cleared on sign-out: a cached photo URL outliving the session is a leak. */
export function forgetPhotoUrls() {
  cache.clear();
  inFlight.clear();
}

/**
 * A loadable URL for a file endpoint path, or null if it cannot be resolved.
 *
 * Never throws. A missing photo is not an error worth surfacing — the caller
 * falls back to initials, which is a perfectly good answer.
 */
export function resolvePhotoUrl(endpointPath: string | null): Promise<string | null> {
  if (!endpointPath) return Promise.resolve(null);

  const hit = cache.get(endpointPath);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.url);

  const pending = inFlight.get(endpointPath);
  if (pending) return pending;

  const request = (async () => {
    try {
      // `authedFetch` takes a path relative to the API root, and `avatar_url`
      // arrives already prefixed with it.
      const path = endpointPath.replace(/^\/api\/v1/, "");
      const resolved = await authedFetch<Resolved>(path);
      if (!resolved?.url) return null;

      // Expire the cache entry early. A URL that dies while the browser is
      // fetching it shows a broken image, and 30 seconds of slack is cheaper
      // than that.
      const lifetime = Math.max((resolved.expires_in ?? 300) - 30, 30) * 1000;
      cache.set(endpointPath, { url: resolved.url, expiresAt: Date.now() + lifetime });
      return resolved.url;
    } catch {
      return null;
    } finally {
      // Always cleared, including on failure, so a transient error does not
      // wedge the photo as permanently unresolvable.
      inFlight.delete(endpointPath);
    }
  })();

  inFlight.set(endpointPath, request);
  return request;
}
