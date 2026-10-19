"use client";

/**
 * Sign-in, sign-up and password reset, as one modal over the front door
 * (owner, 2026-09-29).
 *
 * They were three bare pages — a narrow column, a large heading, a stack of
 * notices and links — that felt like a different product from the one the
 * visitor had just been looking at. Now each opens as a dialog over that
 * product: the front door stays in view behind a quiet scrim, and closing the
 * dialog returns to it. The flows inside are unchanged; only their frame is.
 *
 * Since 2026-10-16 the dialog opens over whichever page asked for it, from
 * state (`AuthDialog`), and never changes the address: closing is a callback,
 * not a navigation.
 *
 * The frame is deliberately plain: a white surface with a hairline and a soft
 * shadow, the brand mark small at the top, a title in the page's own type at a
 * modest size, and the form. No gradient, no illustration, nothing that is
 * there to decorate.
 */

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function AuthModal({
  title,
  description,
  eyebrow,
  progress,
  children,
  footer,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  /** A short line above the title — "Step 2 of 3". */
  eyebrow?: string;
  /** How far through a multi-step flow, 0–1; drawn as a hairline under the head. */
  progress?: number;
  children: ReactNode;
  /** The quiet row under the form: the other ways in and out. */
  footer?: ReactNode;
  /** Escape, the scrim and the close button all end here. */
  onClose: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // The key handler is bound once; it reads the latest close through this.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const close = () => closeRef.current();

  // Escape closes; the page behind does not scroll. A fine pointer starts in
  // the form. On a touch-first device, focus the dialog itself so iOS can paint
  // it without also having to raise and lay out the software keyboard.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea");
    const touchFirst = window.matchMedia("(pointer: coarse)").matches;
    (touchFirst ? panel.current : first)?.focus({ preventScroll: true });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) close();
      // Tab stays inside the dialog.
      if (event.key === "Tab" && panel.current) {
        const focusable = Array.from(
          panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea"),
        ).filter((element) => element.offsetParent !== null);
        if (!focusable.length) return;
        const firstItem = focusable[0]!;
        const lastItem = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
        else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
    // Mount only: one dialog, one set of listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="auth-layer">
        <div className="auth-scrim" onClick={close} aria-hidden="true" />
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="auth-panel"
        >
          <header className="auth-head">
            <div className="auth-brand">
              <span className="auth-mark" aria-hidden="true">DH</span>
              <span>Danpa HQ</span>
            </div>
            <button type="button" className="auth-close" aria-label="Close" onClick={close}>
              <X aria-hidden="true" />
            </button>
          </header>

          {progress !== undefined ? (
            <div className="auth-progress" aria-hidden="true">
              <span style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
            </div>
          ) : null}

          <div className="auth-body">
            {eyebrow ? <p className="auth-eyebrow">{eyebrow}</p> : null}
            <h1 id={titleId} className="auth-title">{title}</h1>
            {description ? <p className="auth-description">{description}</p> : null}
            <div className="auth-content">{children}</div>
          </div>

          {footer ? <footer className="auth-foot">{footer}</footer> : null}
        </div>
      </div>
    </>
  );
}

/** Tenant or property manager: which side the account is signing in to. */
export function AuthSide({
  value,
  onChange,
}: {
  /** Tenant unless the visitor asked for, or picks, the other side (owner, 2026-10-16). */
  value: "tenant" | "provider";
  onChange: (next: "tenant" | "provider") => void;
}) {
  return (
    <div className="auth-side" role="radiogroup" aria-label="Signing in as">
      {(["tenant", "provider"] as const).map((side) => (
        <button
          key={side}
          type="button"
          role="radio"
          aria-checked={value === side}
          className="auth-side-option"
          onClick={() => onChange(side)}
        >
          {side === "tenant" ? "Tenant" : "Property manager"}
        </button>
      ))}
    </div>
  );
}
