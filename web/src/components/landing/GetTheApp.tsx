"use client";

import { Popover } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * "Get the mobile app", the front door's offer in the bar.
 *
 * The store addresses are build-time settings, so the same build can go live
 * before either listing does. Until one is set its badge says "Coming soon"
 * and is not a link: a badge that opens a missing store page is worse than an
 * honest wait.
 */
const STORES = [
  {
    id: "app-store",
    href: process.env.NEXT_PUBLIC_APP_STORE_URL ?? "",
    kicker: "Download on the",
    name: "App Store",
    Glyph: AppleGlyph,
  },
  {
    id: "google-play",
    href: process.env.NEXT_PUBLIC_PLAY_STORE_URL ?? "",
    kicker: "Get it on",
    name: "Google Play",
    Glyph: PlayMark,
  },
] as const;

export function GetTheAppButton({ className }: { className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-10 items-center gap-2.5 rounded-full bg-brand pl-4 pr-5 text-sm font-semibold text-brand-foreground",
            "transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            className,
          )}
        >
          <span className="flex items-center gap-1.5" aria-hidden="true">
            <AppleGlyph className="size-[18px] -translate-y-px" />
            <span className="h-3.5 w-px bg-brand-foreground/35" />
            <PlayGlyph className="size-[15px]" />
          </span>
          Get the mobile app
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          collisionPadding={16}
          className="z-[60] w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-background p-5 text-foreground shadow-[0_18px_44px_-18px_oklch(0.17_0.014_165/0.35)] outline-none"
        >
          <AppOffer />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The offer itself, also used inside the phone drawer. */
export function AppOffer({ compact = false }: { compact?: boolean }) {
  return (
    <div className="grid gap-4">
      {compact ? null : (
        <div className="grid gap-1">
          <p className="font-display text-base font-semibold tracking-[-0.01em]">Danpa HQ on your phone</p>
        </div>
      )}
      <div className={cn("grid gap-2.5", compact ? "grid-cols-1" : "grid-cols-2")}>
        {STORES.map((store) => <StoreBadge key={store.id} {...store} />)}
      </div>
    </div>
  );
}

function StoreBadge({
  href,
  kicker,
  name,
  Glyph,
}: {
  href: string;
  kicker: string;
  name: string;
  Glyph: (props: { className?: string }) => React.ReactNode;
}) {
  const body = (
    <>
      <Glyph className="size-5 shrink-0" />
      <span className="grid whitespace-nowrap text-left leading-none">
        <span className="text-[0.625rem] font-medium tracking-[0.02em] opacity-80">{href ? kicker : "Coming soon to"}</span>
        <span className="mt-1 text-[0.9375rem] font-semibold tracking-[-0.01em]">{name}</span>
      </span>
    </>
  );
  const shape = "flex h-12 items-center gap-2.5 rounded-xl px-3.5";
  if (!href) {
    return (
      <span className={cn(shape, "border border-border bg-muted text-muted-foreground")} aria-label={`${name}: coming soon`}>
        {body}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(shape, "bg-[var(--color-ink-950)] text-white transition-colors hover:bg-[var(--color-ink-800)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2")}
    >
      {body}
    </a>
  );
}

function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      <path d="M16.37 12.75c-.02-2.24 1.83-3.32 1.91-3.37-1.04-1.52-2.66-1.73-3.24-1.75-1.38-.14-2.69.81-3.39.81-.7 0-1.78-.79-2.92-.77-1.5.02-2.89.87-3.66 2.21-1.56 2.71-.4 6.72 1.12 8.92.74 1.08 1.63 2.29 2.79 2.24 1.12-.04 1.54-.72 2.9-.72 1.35 0 1.73.72 2.92.7 1.2-.02 1.97-1.1 2.71-2.18.85-1.25 1.2-2.46 1.22-2.52-.03-.01-2.34-.9-2.36-3.57ZM14.15 6.18c.62-.75 1.03-1.78.92-2.82-.89.04-1.97.59-2.6 1.34-.57.66-1.07 1.71-.94 2.73.99.08 2-.5 2.62-1.25Z" />
    </svg>
  );
}

/** The four-colour mark, as the store shows it: recognised before it is read. */
function PlayMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path fill="#2196F3" d="M4.2 2.4c-.2.24-.32.58-.32 1.02v17.16c0 .44.12.78.32 1.02l.06.06L13.88 12v-.22L4.26 2.34l-.06.06Z" />
      <path fill="#FFC107" d="m17.08 15.2-3.2-3.2v-.22l3.2-3.2.07.04 3.8 2.16c1.08.62 1.08 1.62 0 2.24l-3.8 2.16-.07.02Z" />
      <path fill="#F44336" d="m17.15 15.16-3.27-3.27L4.2 21.6c.36.38.95.42 1.62.05l11.33-6.49Z" />
      <path fill="#4CAF50" d="M17.15 8.62 5.82 2.15c-.67-.38-1.26-.33-1.62.05l9.68 9.69 3.27-3.27Z" />
    </svg>
  );
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      <path d="M4.2 2.4c-.2.24-.32.58-.32 1.02v17.16c0 .44.12.78.32 1.02l.06.06L13.88 12v-.22L4.26 2.34l-.06.06Z" />
      <path d="m17.08 15.2-3.2-3.2v-.22l3.2-3.2.07.04 3.8 2.16c1.08.62 1.08 1.62 0 2.24l-3.8 2.16-.07.02Z" />
      <path d="m17.15 15.16-3.27-3.27L4.2 21.6c.36.38.95.42 1.62.05l11.33-6.49Z" />
      <path d="M17.15 8.62 5.82 2.15c-.67-.38-1.26-.33-1.62.05l9.68 9.69 3.27-3.27Z" />
    </svg>
  );
}
