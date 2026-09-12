"use client";

/**
 * The portal's icon set, drawn inline.
 *
 * No icon dependency: the portal needs eleven glyphs and a package would cost
 * more bytes than the whole shell. They share one construction — 20px box,
 * 1.5px stroke, round caps, `currentColor` — so a row of them reads as a set
 * rather than as clip art collected from different places.
 *
 * Every icon is `aria-hidden`. In collapsed mode the label is still in the DOM
 * for assistive technology; the icon is decoration on top of it, never the only
 * thing carrying the meaning.
 */

import { useEffect, useState } from "react";

import { resolvePhotoUrl } from "@/lib/photo";

export type IconName =
  | "home"
  | "explore"
  | "saved"
  | "applications"
  | "viewings"
  | "properties"
  | "portfolio"
  | "units"
  | "leases"
  | "payments"
  | "verification"
  | "updates"
  | "account"
  | "users"
  | "listings"
  | "reports"
  | "support"
  | "audit"
  | "logout"
  | "panel"
  | "pin"
  | "bookmark"
  | "share"
  | "shop"
  | "details"
  | "photos"
  | "amenities"
  | "clock"
  | "info"
  | "warning"
  | "heart"
  | "heart-filled";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3.5 8.5 10 3l6.5 5.5V16a1 1 0 0 1-1 1h-3v-5h-5v5h-3a1 1 0 0 1-1-1Z" />,
  explore: (
    <>
      <circle cx="9" cy="9" r="5.25" />
      <path d="m13 13 4 4" />
    </>
  ),
  saved: (
    <path d="M10 16.5S3.5 12.6 3.5 8.2A3.2 3.2 0 0 1 10 6.4a3.2 3.2 0 0 1 6.5 1.8c0 4.4-6.5 8.3-6.5 8.3Z" />
  ),
  applications: (
    <>
      <path d="M5 2.75h6.5L15.5 7v10.25H5Z" />
      <path d="M11.25 2.75V7h4" />
      <path d="M7.5 11h5M7.5 13.75h3" />
    </>
  ),
  viewings: (
    <>
      <rect x="3.25" y="4.5" width="13.5" height="12.75" rx="1.25" />
      <path d="M3.25 8.25h13.5M6.75 2.75v3M13.25 2.75v3" />
    </>
  ),
  properties: (
    <>
      <path d="M3.25 17.25V6.5l5-2.75V17.25" />
      <path d="M8.25 8.5h7a1.5 1.5 0 0 1 1.5 1.5v7.25H8.25" />
      <path d="M11 11.75h3M11 14.5h3" />
    </>
  ),
  // Stacked workspaces, not a building: `properties` is already a building, and
  // switching Portfolio is not navigating to Properties. One square in front,
  // the others behind it — the thing you are in, and the ones you could be in.
  portfolio: (
    <>
      <rect x="2.75" y="7.75" width="9.5" height="9.5" rx="2" />
      <path d="M5.75 7.75V6.75a2 2 0 0 1 2-2h5.5a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2h-1" />
    </>
  ),
  units: (
    <>
      <path d="M4.75 17.25V4.5a1 1 0 0 1 1-1h8.5a1 1 0 0 1 1 1v12.75M3 17.25h14M12 10.75h.01" />
    </>
  ),
  details: (
    <>
      <path d="M4 5.25h12M4 10h12M4 14.75h12" />
      <circle cx="7" cy="5.25" r="1.25" fill="var(--color-field-0)" />
      <circle cx="13" cy="10" r="1.25" fill="var(--color-field-0)" />
      <circle cx="8.5" cy="14.75" r="1.25" fill="var(--color-field-0)" />
    </>
  ),
  photos: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <circle cx="7" cy="8" r="1.25" />
      <path d="m4.5 14 3.5-3 2.25 2 2.25-2.25L15.5 14" />
    </>
  ),
  amenities: (
    <>
      <path d="M10 17V9" />
      <path d="M10 10c-3.5 0-5.75-1.75-5.75-5.25C7.75 4.75 10 6.5 10 10Z" />
      <path d="M10 12.25c3.5 0 5.75-1.75 5.75-5.25C12.25 7 10 8.75 10 12.25Z" />
    </>
  ),
  leases: (
    <>
      <path d="M5 2.75h6.5L15.5 7v10.25H5Z" />
      <path d="M11.25 2.75V7h4" />
      <path d="m7.75 12 1.75 1.75 3.25-3.5" />
    </>
  ),
  payments: (
    <>
      <rect x="2.75" y="5" width="14.5" height="10.5" rx="1.5" />
      <path d="M2.75 8.5h14.5M6 12h2.5" />
    </>
  ),
  shop: (
    <>
      <path d="M4 8.25h12v7.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
      <path d="M3.25 8.25 4.6 4.4a1 1 0 0 1 .95-.65h8.9a1 1 0 0 1 .95.65l1.35 3.85" />
      <path d="M8.25 16.75v-4h3.5v4" />
    </>
  ),
  // A bookmark, not a heart. A heart is a favourite — an opinion about a
  // place. Saving is putting something aside to come back to, which is what a
  // tenant comparing four rentals is actually doing.
  bookmark: (
    <path d="M6 3.75h8a.75.75 0 0 1 .75.75v11.75L10 13.4l-4.75 2.85V4.5A.75.75 0 0 1 6 3.75Z" />
  ),
  share: (
    <>
      <path d="M10 12.75v-9.5" />
      <path d="m6.75 6.5 3.25-3.25 3.25 3.25" />
      <path d="M5.5 9.25H4.25v7.25h11.5V9.25H14.5" />
    </>
  ),
  pin: (
    <>
      <path d="M10 17.5s5.25-4.4 5.25-8.25a5.25 5.25 0 1 0-10.5 0C4.75 13.1 10 17.5 10 17.5Z" />
      <circle cx="10" cy="9" r="1.9" />
    </>
  ),
  verification: (
    <>
      <path d="M10 2.75 4.5 5v5c0 3.4 2.3 6.2 5.5 7.25 3.2-1.05 5.5-3.85 5.5-7.25V5Z" />
      <path d="m7.75 9.75 1.75 1.75 3-3.25" />
    </>
  ),
  updates: (
    <>
      <path d="M5.25 8.25a4.75 4.75 0 0 1 9.5 0c0 3.5 1.25 4.75 1.25 4.75H4s1.25-1.25 1.25-4.75Z" />
      <path d="M8.25 15.5a1.9 1.9 0 0 0 3.5 0" />
    </>
  ),
  account: (
    <>
      <circle cx="10" cy="7.25" r="3" />
      <path d="M4.5 16.5a5.5 5.5 0 0 1 11 0" />
    </>
  ),
  users: (
    <>
      <circle cx="7.25" cy="7" r="2.5" />
      <circle cx="13.5" cy="8" r="2" />
      <path d="M2.75 16a4.5 4.5 0 0 1 9 0M11.5 12.5a3.75 3.75 0 0 1 5.75 3.15" />
    </>
  ),
  listings: (
    <>
      <path d="M3.5 5.25h13M3.5 10h13M3.5 14.75h13" />
      <circle cx="5" cy="5.25" r=".75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="10" r=".75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="14.75" r=".75" fill="currentColor" stroke="none" />
    </>
  ),
  reports: (
    <>
      <path d="M4 17V9.75h3V17M8.5 17V5.5h3V17M13 17V2.75h3V17M2.75 17.25h14.5" />
    </>
  ),
  support: (
    <>
      <path d="M4.25 12.5A6.5 6.5 0 1 1 7.5 16l-4 1 1-4Z" />
      <path d="M7.75 7.5a2.25 2.25 0 1 1 3.4 1.94c-.9.52-1.15.86-1.15 1.56M10 13.75h.01" />
    </>
  ),
  audit: (
    <>
      <path d="M4.25 3.25h8.5l3 3v10.5H4.25Z" />
      <path d="M12.5 3.25V6.5h3M7 10h6M7 13h4" />
    </>
  ),
  logout: (
    <>
      <path d="M8.5 4H4.75v12H8.5M11.5 6.5 15 10l-3.5 3.5M7.5 10H15" />
    </>
  ),
  /*
    The collapse control. A rule with a chevron leaving it, which says which way
    the sidebar is about to move; the CSS flips it when collapsed so the same
    glyph reads "expand". It was a panel outline before, which in a 32px square
    under the logo looked like a stray button rather than a direction.
  */
  panel: (
    <>
      <path d="M4.5 4.5v11" />
      <path d="M15.5 10H8.5" />
      <path d="m11 6.5-3 3.5 3 3.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M10 6.25V10l2.5 1.75" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M10 9.25v4" />
      <path d="M10 6.75h.01" />
    </>
  ),
  warning: (
    <>
      <path d="M10 3.5 17 16H3l7-12.5Z" />
      <path d="M10 8.5v3" />
      <path d="M10 13.75h.01" />
    </>
  ),
  /* Saving a listing is the one control in the product that was drawn with a
     text glyph — a literal heart character, which inherits the reader's emoji
     font and lands next to a set of matched 1.5px line icons looking like it
     wandered in from somewhere else. */
  heart: (
    <path d="M10 16.25S3.75 12.4 3.75 8.15A3.1 3.1 0 0 1 10 6.4a3.1 3.1 0 0 1 6.25 1.75c0 4.25-6.25 8.1-6.25 8.1Z" />
  ),
  "heart-filled": (
    <path
      d="M10 16.25S3.75 12.4 3.75 8.15A3.1 3.1 0 0 1 10 6.4a3.1 3.1 0 0 1 6.25 1.75c0 4.25-6.25 8.1-6.25 8.1Z"
      fill="currentColor"
    />
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="portal-icon"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The signed-in person, as a mark.
 *
 *  A photo when they have set one, their initials when they have not. Never a
 *  generic silhouette: initials say more than an outline of a stranger does, and
 *  they mean the mark is recognisable before anyone uploads anything.
 *
 *  `photoUrl` is optional so every caller keeps working without one, and a photo
 *  that fails to load falls back to the initials rather than a broken image —
 *  on a slow Ghanaian connection that is the common case, not the edge case. */
export function Avatar({
  name,
  size = 28,
  photoUrl,
}: {
  name: string;
  size?: number;
  /** The files download *endpoint* for the photo, not an image URL. Resolved
   *  here — see `lib/photo.ts` for why it cannot be an `<img src>` directly. */
  photoUrl?: string | null;
}) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    setResolved(null);
    if (!photoUrl) return;

    resolvePhotoUrl(photoUrl).then((url) => {
      // Guarded because the person may have navigated, or changed their photo,
      // before this resolves — writing a stale URL would flash the old picture.
      if (live) setResolved(url);
    });
    return () => {
      live = false;
    };
  }, [photoUrl]);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

  if (resolved && !failed) {
    return (
      // A plain <img>, deliberately. `next/image` would need the storage host in
      // `remotePatterns` — MinIO locally, S3 in production — and it caches by
      // src, so a signed URL that changes every few minutes would be
      // re-optimised every few minutes. For a 96px avatar that is more work and
      // more cost than serving the bytes directly.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="portal-avatar portal-avatar-photo"
        src={resolved}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className="portal-avatar"
      style={{ width: size, height: size, fontSize: size <= 28 ? "0.6875rem" : "0.8125rem" }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
