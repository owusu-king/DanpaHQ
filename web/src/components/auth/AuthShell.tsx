"use client";

import Link from "next/link";
import { Building2, CheckCircle2, ShieldCheck, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The shell every account screen sits in: sign in, register, reset.
 *
 * These were three centred columns on white, each with its own spacing and its
 * own idea of how big a heading is — which on a wide screen is a form floating
 * in a void, and across the three is a product that looks assembled by
 * different people. One shell, so moving between them is the same room.
 *
 * The left panel is not decoration. All three ask for something before the
 * visitor has been shown anything, so the reasons to give it belong beside the
 * fields rather than on a page they have already left.
 */
export function AuthShell({
  title,
  lede,
  steps,
  stepIndex = 0,
  children,
  footer,
}: {
  title: string;
  lede?: ReactNode;
  /** Omit for a single-screen form; the progress rail is hidden. */
  steps?: readonly string[];
  stepIndex?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main id="main" className="lp-light grid min-h-dvh bg-background lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-tint/70 p-12 lg:flex">
        <span aria-hidden="true" className="lp-wash top-0 h-[32rem]" />

        <Brand className="relative" />

        <div className="relative max-w-md">
          <h2 className="font-display text-[clamp(1.75rem,2.6vw,2.5rem)] leading-[1.08] font-extrabold tracking-[-0.03em] text-balance">
            An account here is a record, not a mailing list.
          </h2>
          <ul className="mt-8 grid gap-5">
            {WHY.map(({ icon: Icon, title: heading, body }) => (
              <li key={heading} className="flex gap-3.5">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-background text-brand">
                  <Icon className="size-4.5" />
                </span>
                <span>
                  <strong className="block text-[0.9375rem] font-semibold tracking-tight">{heading}</strong>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs leading-relaxed text-muted-foreground">
          Identity and ownership evidence is used for review only. It never appears on a
          listing and is never shown publicly.
        </p>
      </aside>

      <div className="flex flex-col px-5 py-8 sm:px-8 lg:px-16 lg:py-12">
        {/* Shown only where the panel beside it is gone. */}
        <Brand className="mb-10 self-start lg:hidden" />

        <div className="mx-auto w-full max-w-[27rem] lg:my-auto">
          {/* Three steps, drawn. "Step 2 of 3" as a line of text says where you
              are but not how much is left, and the step people abandon is the
              one before the end. */}
          {steps ? (
            <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
              {steps.map((label, index) => (
                <li key={label} className="flex flex-1 flex-col gap-2">
                  <span
                    className={cn(
                      "h-1 rounded-full transition-colors duration-300",
                      index <= stepIndex ? "bg-brand" : "bg-border",
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs font-medium",
                      index === stepIndex ? "text-foreground" : "text-muted-foreground",
                    )}
                    aria-current={index === stepIndex ? "step" : undefined}
                  >
                    {label}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          <h1 className="font-display text-[clamp(1.875rem,3vw,2.5rem)] leading-[1.06] font-extrabold tracking-[-0.03em] text-balance">
            {title}
          </h1>

          {lede ? (
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted-foreground">{lede}</p>
          ) : null}

          {children}

          {footer ? <div className="mt-8 grid gap-2 text-sm text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
    </main>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "flex items-center gap-2.5 font-display text-lg font-extrabold tracking-[-0.03em] text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-brand font-display text-[0.6875rem] font-extrabold text-brand-foreground"
      >
        GR
      </span>
      Ghana Rental
    </Link>
  );
}

/** A link in the shell's footer, styled once. */
export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href as never}
      className="font-semibold text-foreground underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

const WHY = [
  {
    icon: ShieldCheck,
    title: "Every check is named and dated",
    body: "Phone, identity, property authority — you see which was done, and when.",
  },
  {
    icon: UserRound,
    title: "Save, apply and pay in one place",
    body: "Viewings, applications and rent all sit on the record for your unit.",
  },
  {
    icon: Building2,
    title: "Or list a property you manage",
    body: "Prove authority once, and every listing you publish carries it.",
  },
  {
    icon: CheckCircle2,
    title: "Receipts you can hold up later",
    body: "Every payment leaves a record both sides can point at.",
  },
] as const;
