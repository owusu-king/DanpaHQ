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
  | "chat"
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
  | "heart-filled"
  | "chevron-down"
  | "headset"
  | "close"
  | "check"
  | "download"
  | "print"
  | "filters"
  | "map"
  | "city"
  | "landmark"
  | "plus"
  | "pencil"
  | "trash"
  | "upload"
  | "star"
  | "lock"
  | "archive"
  | "device"
  | "desktop"
  | "handset"
  | "shield"
  | "eye"
  | "bed"
  | "bath"
  | "sofa"
  | "water"
  | "power"
  | "wrench"
  | "video"
  | "passport"
  | "link"
  | "copy"
  // What a property has and how it is served — the creation flows draw every
  // amenity and every answer with its own glyph rather than a bare checkbox.
  | "car"
  | "wifi"
  | "pool"
  | "dumbbell"
  | "washer"
  | "snow"
  | "tap"
  | "tank"
  | "well"
  | "gate"
  | "fence"
  | "tree"
  | "none"
  | "receipt"
  | "kitchen"
  | "door"
  | "toilet"
  | "wardrobe"
  | "desk"
  | "tiles"
  | "balcony"
  | "truck";

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
  // A conversation: a bubble with lines of text. Enquiries use it.
  chat: (
    <>
      <path d="M4.25 12.5A6.5 6.5 0 1 1 7.5 16l-4 1 1-4Z" />
      <path d="M7.25 8.75h5.5M7.25 11.25h3.5" />
    </>
  ),
  headset: (
    <>
      <path d="M4 12.25V10a6 6 0 0 1 12 0v2.25" />
      <path d="M4 11.75h1.5a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3.5ZM16 11.75h-1.5a1 1 0 0 0-1 1v2.5a1 1 0 0 0 1 1h.5a1 1 0 0 0 1-1v-3.5Z" />
      <path d="M16 15.5c0 1.4-1.5 2.25-4 2.25" />
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
  /* Explore's controls were drawn with whatever was to hand: a rotated CSS
     border for a chevron, a typed "×" for close in three places, and a
     filter glyph at its own 1.25px stroke. Beside this set each one looked
     borrowed, so they are drawn here to the same 1.5px construction. */
  "chevron-down": <path d="m5.75 8 4.25 4.25L14.25 8" />,
  close: <path d="m5.75 5.75 8.5 8.5M14.25 5.75l-8.5 8.5" />,
  check: <path d="m4.75 10.25 3.5 3.5 7-7.5" />,
  download: (
    <>
      <path d="M10 3.25v9.25M6.5 9.25 10 12.75l3.5-3.5" />
      <path d="M4 14.25v2.5h12v-2.5" />
    </>
  ),
  print: (
    <>
      <path d="M6 7V3.5h8V7M6 13.5v3h8v-3" />
      <path d="M5 14H3.5V8.5h13V14H15" />
      <path d="M6 11.5h8" />
    </>
  ),
  // Two sliders with open knobs: the line breaks around each knob instead of a
  // filled circle, so it reads correctly on a tinted pill as well as on white.
  filters: (
    <>
      <path d="M3.5 6.5h7M14.5 6.5h2M3.5 13.5h2M9.5 13.5h7" />
      <circle cx="12.5" cy="6.5" r="2" />
      <circle cx="7.5" cy="13.5" r="2" />
    </>
  ),
  /* The kinds of place a location suggestion can be. A folded map for a region
     or district, a skyline for a city or town, a flag for a landmark; a
     neighbourhood keeps the pin the cards already use for "where". */
  map: (
    <>
      <path d="M3.5 5.25 7.75 3.5l4.5 1.75 4.25-1.75v11.25l-4.25 1.75-4.5-1.75-4.25 1.75Z" />
      <path d="M7.75 3.5v11.25M12.25 5.25V16.5" />
    </>
  ),
  city: (
    <>
      <path d="M3 17h14" />
      <path d="M4.75 17V9h3.75v8M8.5 17V4.25h4.75V17M13.25 17v-6h2.5v6" />
      <path d="M10.25 7.25h1.25M10.25 10h1.25M10.25 12.75h1.25" />
    </>
  ),
  landmark: (
    <>
      <path d="M5.25 17.25V3.25" />
      <path d="M5.25 4h9.5l-1.9 3.25 1.9 3.25h-9.5" />
    </>
  ),
  plus: <path d="M10 4.25v11.5M4.25 10h11.5" />,
  pencil: (
    <>
      <path d="M13.2 3.9a1.6 1.6 0 0 1 2.3 0l.6.6a1.6 1.6 0 0 1 0 2.3L7.4 15.5l-3.4.9.9-3.4Z" />
      <path d="m11.9 5.2 2.9 2.9" />
    </>
  ),
  trash: (
    <>
      <path d="M3.75 5.75h12.5" />
      <path d="M8 5.75V4.1a.85.85 0 0 1 .85-.85h2.3a.85.85 0 0 1 .85.85v1.65" />
      <path d="M5.25 5.75 6 16a1.1 1.1 0 0 0 1.1 1h5.8A1.1 1.1 0 0 0 14 16l.75-10.25" />
    </>
  ),
  upload: (
    <>
      <path d="M10 12.75V3.5" />
      <path d="m6.5 6.75 3.5-3.5 3.5 3.5" />
      <path d="M3.75 12.5v2.75a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V12.5" />
    </>
  ),
  star: <path d="m10 3 2.1 4.3 4.7.7-3.4 3.3.8 4.7L10 13.8 5.8 16l.8-4.7L3.2 8l4.7-.7Z" />,
  lock: (
    <>
      <rect x="4.25" y="8.75" width="11.5" height="8" rx="1.75" />
      <path d="M6.75 8.75V6.5a3.25 3.25 0 0 1 6.5 0v2.25M10 12v1.75" />
    </>
  ),
  device: (
    <>
      <rect x="5.75" y="2.75" width="8.5" height="14.5" rx="1.75" />
      <path d="M9 14.75h2" />
    </>
  ),
  desktop: (
    <>
      <rect x="2.75" y="3.75" width="14.5" height="10" rx="1.5" />
      <path d="M7.5 17h5M10 13.75V17" />
    </>
  ),
  handset: <path d="M6.2 3.25 4.4 4.1a1.6 1.6 0 0 0-.8 1.9c1.5 4.6 5.2 8.3 9.8 9.8a1.6 1.6 0 0 0 1.9-.8l.85-1.8-3.1-1.9-1.4 1.2a8.6 8.6 0 0 1-3.8-3.8l1.2-1.4Z" />,
  // The facts a tenant compares a rental on, drawn in the same line weight.
  bed: (
    <>
      <path d="M2.75 15.75V5.25M2.75 12.5h14.5M17.25 15.75V10.5a2 2 0 0 0-2-2H8.75v4" />
      <circle cx="5.75" cy="9.75" r="1.5" />
    </>
  ),
  bath: (
    <>
      <path d="M3 10.25h14V12a3.75 3.75 0 0 1-3.75 3.75h-6.5A3.75 3.75 0 0 1 3 12Z" />
      <path d="M5.25 10.25V5a1.75 1.75 0 0 1 3.35-.7M6.5 15.75 5.75 17.25M13.5 15.75l.75 1.5" />
    </>
  ),
  sofa: (
    <>
      <path d="M4.75 9V6.75a1.75 1.75 0 0 1 1.75-1.75h7a1.75 1.75 0 0 1 1.75 1.75V9" />
      <path d="M3.5 9A1.5 1.5 0 0 1 5 10.5v1.25h10V10.5A1.5 1.5 0 1 1 18 10.5V15H2v-4.5A1.5 1.5 0 0 1 3.5 9ZM4.25 15v1.75M15.75 15v1.75" />
    </>
  ),
  water: <path d="M10 2.75S5 8.35 5 12a5 5 0 0 0 10 0c0-3.65-5-9.25-5-9.25Z" />,
  power: <path d="M11 2.75 4.75 11.25H10l-1 6 6.25-8.5H10Z" />,
  // Maintenance: a spanner, drawn in the same weight as the rest of the rail.
  wrench: (
    <path d="M12.6 3.2a4 4 0 0 0-4.9 5.2L3.4 12.7a1.6 1.6 0 0 0 0 2.3l1.6 1.6a1.6 1.6 0 0 0 2.3 0l4.3-4.3a4 4 0 0 0 5.2-4.9l-2.3 2.3-2.2-.5-.5-2.2Z" />
  ),
  video: (
    <>
      <rect x="2.75" y="5.25" width="10.5" height="9.5" rx="1.75" />
      <path d="m13.25 8.75 4-2.25v7l-4-2.25" />
    </>
  ),
  eye: (
    <>
      <path d="M2.25 10S5 4.75 10 4.75 17.75 10 17.75 10 15 15.25 10 15.25 2.25 10 2.25 10Z" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M10 2.75 4.5 5v5c0 3.4 2.3 6.2 5.5 7.25 3.2-1.05 5.5-3.85 5.5-7.25V5Z" />
      <path d="M10 7v3.5M10 13h.01" />
    </>
  ),
  archive: (
    <>
      <rect x="3.25" y="3.75" width="13.5" height="3.5" rx="1" />
      <path d="M4.5 7.25v8a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-8M8.25 10.5h3.5" />
    </>
  ),
  /* A booklet with a home on its cover: the Housing Passport. */
  passport: (
    <>
      <rect x="4.25" y="2.75" width="11.5" height="14.5" rx="1.5" />
      <path d="M7.25 9.5 10 7.25l2.75 2.25v2.75h-5.5Z" />
      <path d="M7.5 14.25h5" />
    </>
  ),
  link: (
    <>
      <path d="M8.5 11.5a3 3 0 0 0 4.25 0l2.5-2.5a3 3 0 0 0-4.25-4.25L10 5.75" />
      <path d="M11.5 8.5a3 3 0 0 0-4.25 0l-2.5 2.5a3 3 0 0 0 4.25 4.25l1-1" />
    </>
  ),
  copy: (
    <>
      <rect x="7.25" y="7.25" width="9" height="9" rx="1.5" />
      <path d="M12.75 7.25V5.25a1.5 1.5 0 0 0-1.5-1.5h-6a1.5 1.5 0 0 0-1.5 1.5v6a1.5 1.5 0 0 0 1.5 1.5h2" />
    </>
  ),
  car: (
    <>
      <path d="M3.75 14.25v-3.5l1.5-3.9a1.5 1.5 0 0 1 1.4-.95h6.7a1.5 1.5 0 0 1 1.4.95l1.5 3.9v3.5Z" />
      <path d="M3.75 10.75h12.5M5.5 14.25v1.5M14.5 14.25v1.5M6.5 12.5h.01M13.5 12.5h.01" />
    </>
  ),
  wifi: <path d="M2.75 8a10.5 10.5 0 0 1 14.5 0M5.25 10.75a7 7 0 0 1 9.5 0M7.75 13.4a3.4 3.4 0 0 1 4.5 0M10 16h.01" />,
  pool: (
    <path d="M2.75 15.25c1.2 0 1.2-.9 2.4-.9s1.2.9 2.4.9 1.2-.9 2.45-.9 1.2.9 2.4.9 1.2-.9 2.4-.9 1.2.9 2.45.9M6.75 12.5V5a1.75 1.75 0 0 1 3.4-.6M12.5 12.5V5a1.75 1.75 0 0 1 3.4-.6M6.75 8h5.75M6.75 10.5h5.75" />
  ),
  dumbbell: (
    <>
      <path d="M6.5 10h7M3.25 8v4M16.75 8v4" />
      <rect x="4.75" y="6.25" width="1.75" height="7.5" rx=".6" />
      <rect x="13.5" y="6.25" width="1.75" height="7.5" rx=".6" />
    </>
  ),
  washer: (
    <>
      <rect x="3.75" y="2.75" width="12.5" height="14.5" rx="1.75" />
      <circle cx="10" cy="11" r="3.5" />
      <path d="M6.5 5.5h.01M9 5.5h1.5" />
    </>
  ),
  snow: <path d="M10 2.75v14.5M3.7 6.4l12.6 7.2M3.7 13.6l12.6-7.2M8 3.75l2 1.5 2-1.5M8 16.25l2-1.5 2 1.5" />,
  tap: (
    <>
      <path d="M3.25 7.75h7.5a3.5 3.5 0 0 1 3.5 3.5v.5M3.25 5.75v4M7 7.75V5.25M5.5 5.25h3" />
      <path d="M14.25 14.25s-1.25 1.5-1.25 2.25a1.25 1.25 0 0 0 2.5 0c0-.75-1.25-2.25-1.25-2.25Z" />
    </>
  ),
  tank: (
    <>
      <path d="M5.25 5.25h9.5v9.5a2 2 0 0 1-2 2h-5.5a2 2 0 0 1-2-2Z" />
      <path d="M5.25 5.25c0-1.4 2.1-2.5 4.75-2.5s4.75 1.1 4.75 2.5M5.25 9.5h9.5M5.25 13h9.5" />
    </>
  ),
  well: (
    <>
      <path d="M4.25 9.25h11.5v6a1.5 1.5 0 0 1-1.5 1.5h-8.5a1.5 1.5 0 0 1-1.5-1.5Z" />
      <path d="M4.25 9.25 5.5 3.5h9l1.25 5.75M10 3.5v3.25M8.75 6.75h2.5v2.5h-2.5Z" />
    </>
  ),
  gate: <path d="M2.75 16.75V7.25h2.5v9.5M14.75 16.75V7.25h2.5v9.5M5.25 9.25h9.5M5.25 14.25h9.5M8.25 9.25v5M11.75 9.25v5" />,
  fence: (
    <path d="M4.25 16.75V6l1.25-2 1.25 2v10.75M8.75 16.75V6L10 4l1.25 2v10.75M13.25 16.75V6l1.25-2 1.25 2v10.75M2.75 8.75h14.5M2.75 13.5h14.5" />
  ),
  tree: (
    <path d="M10 17.25v-4.5M10 2.75a4.25 4.25 0 0 0-4.1 5.35A3.25 3.25 0 0 0 7.25 14.5h5.5a3.25 3.25 0 0 0 1.35-6.4A4.25 4.25 0 0 0 10 2.75Z" />
  ),
  none: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="m4.9 4.9 10.2 10.2" />
    </>
  ),
  receipt: (
    <>
      <path d="M5.25 2.75h9.5v14.5l-2.4-1.5-2.35 1.5-2.4-1.5-2.35 1.5Z" />
      <path d="M7.75 6.75h4.5M7.75 9.75h4.5M7.75 12.75h2.5" />
    </>
  ),
  kitchen: (
    <path d="M4.25 9.25h11.5v4.5a3 3 0 0 1-3 3h-5.5a3 3 0 0 1-3-3ZM2.75 9.25h14.5M7.5 6.5c0-1 .75-1 .75-2M11.75 6.5c0-1 .75-1 .75-2" />
  ),
  door: <path d="M5.25 17.25V3.75a1 1 0 0 1 1-1h7.5a1 1 0 0 1 1 1v13.5M3.25 17.25h13.5M12 10.25h.01" />,
  toilet: (
    <path d="M5.25 2.75h5v6h-5ZM3.75 8.75h10.5a1 1 0 0 1 1 1 5.25 5.25 0 0 1-5.25 5.25l.5 2.25H6.5l.5-2.6A5.25 5.25 0 0 1 3.75 9.5Z" />
  ),
  wardrobe: (
    <>
      <rect x="4.25" y="2.75" width="11.5" height="13.5" rx="1" />
      <path d="M10 2.75v13.5M8.25 9h.01M11.75 9h.01M5.5 16.25v1M14.5 16.25v1" />
    </>
  ),
  desk: <path d="M2.75 7.75h14.5M4.25 7.75v9.5M15.75 7.75v9.5M10.5 7.75v5.5h5.25M12.25 10.5h1.75" />,
  tiles: (
    <>
      <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="1" />
      <path d="M10 3.25v13.5M3.25 10h13.5" />
    </>
  ),
  balcony: (
    <path d="M2.75 10.25h14.5M3.75 10.25v6.5M16.25 10.25v6.5M6.75 10.25v6.5M10 10.25v6.5M13.25 10.25v6.5M2.75 16.75h14.5M5.75 10.25V4.75a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v5.5" />
  ),
  truck: (
    <>
      <path d="M2.75 5.25h9v8.5h-9ZM11.75 8.25h3l2.5 2.75v2.75h-5.5" />
      <circle cx="5.75" cy="14.75" r="1.5" />
      <circle cx="14" cy="14.75" r="1.5" />
    </>
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
