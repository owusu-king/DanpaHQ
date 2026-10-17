"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "quiet" | "accent" | "destructive";
type Size = "sm" | "md" | "lg";

/**
 * Every button in the product.
 *
 * The variants used to be inline `style` objects, which meant none of them
 * could express `:hover`, `:active` or `:focus-visible` — the component even
 * declared a background transition that had no state to transition to. Nothing
 * moved when you used it. That is most of why the interface felt like a
 * rendering of an app rather than one, so the styling now lives in
 * foundation.css where the states can actually exist.
 *
 * `primary` uses the product's deep kola green. Secondary, quiet and destructive
 * actions stay visually distinct so a screen still has one obvious next step.
 */
export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  busyLabel = "Working…",
  block = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /**
   * Buttons that start a network call own their own busy state. On a slow
   * connection an un-disabled button is a double submission, which for a rent
   * payment is a double debit.
   */
  busy?: boolean;
  busyLabel?: string;
  block?: boolean;
  children: ReactNode;
}) {
  const classes = [
    "btn",
    `btn-${variant}`,
    size !== "md" ? `btn-${size}` : "",
    block ? "btn-block" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy}
      className={classes}
    >
      {busy ? busyLabel : children}
    </button>
  );
}
