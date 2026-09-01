"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "quiet" | "destructive";

const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: {
    background: "var(--color-kola-600)",
    color: "var(--color-field-0)",
    border: "var(--border-hairline) solid var(--color-kola-600)",
  },
  secondary: {
    background: "var(--color-field-0)",
    color: "var(--color-ink-900)",
    border: "var(--border-hairline) solid var(--color-field-300)",
  },
  quiet: {
    background: "transparent",
    color: "var(--color-kola-600)",
    border: "var(--border-hairline) solid transparent",
  },
  destructive: {
    background: "var(--color-field-0)",
    color: "var(--color-laterite-600)",
    border: "var(--border-hairline) solid var(--color-laterite-600)",
  },
};

export function Button({
  variant = "primary",
  busy = false,
  busyLabel = "Working…",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /**
   * Buttons that start a network call own their own busy state. On a slow
   * connection an un-disabled button is a double submission, which for a rent
   * payment is a double debit.
   */
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy}
      className={`type-body-strong ${props.className ?? ""}`}
      style={{
        minHeight: "var(--target-min)",
        padding: "0 var(--space-5)",
        borderRadius: "var(--radius-md)",
        cursor: props.disabled || busy ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.5 : 1,
        transition: `background var(--motion-duration-fast) var(--motion-easing-standard)`,
        ...VARIANTS[variant],
        ...props.style,
      }}
    >
      {busy ? busyLabel : children}
    </button>
  );
}
