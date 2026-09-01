import { apiFetch } from "@/api";

/**
 * The profile photo: setting it, and turning it into something `<Image>` can load.
 *
 * Two separate problems, and it is worth being clear which is which.
 *
 * **Setting it** is two steps. The bytes go to storage through the same
 * `uploadImage` every other file uses — so a photo gets the same virus scan, the
 * same size limits, and the reachable-origin fix a phone needs — and only then
 * is the resulting file id linked to the profile. The server checks the file
 * belongs to the signed-in person before linking it; a file id is guessable like
 * any identifier, and without that check somebody could point their picture at
 * another account's upload.
 *
 * **Displaying it** needs a resolve step. `profile.avatar_url` is a path to the
 * files download endpoint, and that endpoint returns JSON — `{ url, expires_in }`
 * — rather than bytes, so object storage stays private. An `<Image source>`
 * cannot point at it: the endpoint answers with JSON, and the API authenticates
 * with a bearer token that an image request would never carry.
 *
 * So the URL is resolved once and cached, which matters here more than on the
 * web: this runs on a metered connection, and re-resolving on every render would
 * be a request per screen.
 */

export type ProfilePhoto = {
  avatar_url: string | null;
  completeness: number;
};

/** Attach a photo. Pass null to remove the one there. */
export function setProfilePhoto(fileId: string | null) {
  return apiFetch<ProfilePhoto>("/me/profile/", {
    method: "PATCH",
    body: { avatar_file_id: fileId },
  });
}

type Resolved = { url: string; expires_in: number };

const cache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Resolutions currently in flight.
 *
 * Separate from `cache` because the two answer different questions: one holds a
 * URL we have, this holds a request we are waiting on. Without it, every place
 * showing the photo at once issues its own request — they all miss a cache that
 * is only written after the first returns. On a metered connection that is the
 * person's data being spent several times over for one picture.
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
 * Never throws. A photo that will not load is not an error worth surfacing — the
 * caller falls back to initials, which is a perfectly good answer, and better
 * than a broken image on a slow connection.
 */
export function resolvePhotoUrl(endpointPath: string | null): Promise<string | null> {
  if (!endpointPath) return Promise.resolve(null);

  const hit = cache.get(endpointPath);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.url);

  const pending = inFlight.get(endpointPath);
  if (pending) return pending;

  const request = (async () => {
    try {
      // `apiFetch` takes a path relative to the API root, and `avatar_url`
      // arrives already prefixed with it.
      const path = endpointPath.replace(/^\/api\/v1/, "");
      const resolved = await apiFetch<Resolved>(path);
      if (!resolved?.url) return null;

      // Expire early. A URL that dies mid-fetch shows a broken image, and 30
      // seconds of slack is cheaper than that.
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
