"use client";

/**
 * The workspace's modal: a small glass sheet over the page that asked for it.
 *
 * Everything a modal here has to get right lives once, in this component:
 * it sits in the content area with the rail and top bar left undimmed, grows
 * out of the control that opened it as one surface, holds the page behind it
 * still, and plays its exit before it unmounts — the "Change plan" dialog's
 * behaviour, which every modal follows. A press on the dimmed area closes
 * it, as do Escape and the close button; the rail and top bar stay inert. Callers supply the header's words and the
 * body; `footer` and function children receive `close`, so a Cancel button
 * leaves the same way Escape does.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/portal/icons";
import { aimModalFrom, glideModalHeight, holdModalInWorkspace, isBackdropClick } from "@/lib/modalOrigin";

const CLOSE_MS = 240;

export function ModalSheet({
  open,
  onClose,
  icon,
  title,
  meta,
  size = "md",
  closeLabel = "Close",
  className,
  bodyBusy,
  titleId,
  onBack,
  backLabel = "Back",
  viewKey,
  headerAction,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  icon: IconName;
  title: ReactNode;
  meta?: ReactNode;
  /** `sm` fits a short form; `md` a document. */
  size?: "sm" | "md";
  closeLabel?: string;
  className?: string;
  bodyBusy?: boolean;
  /** A stable id for the title, when two sheets are mounted at once and something names it. */
  titleId?: string;
  /** Set while a deeper view is showing (ModalViews): the header offers Back. */
  onBack?: () => void;
  backLabel?: string;
  /** Changes with the view, so the header's words cross-fade rather than swap. */
  viewKey?: string;
  /** A quiet link beside the close button — a way somewhere related, never the main act. */
  headerAction?: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  footer?: (close: () => void) => ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const generatedId = useId();
  const labelId = titleId ?? generatedId;
  // Read inside the opening effect without making it re-run on every render.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  // Modals live in page state, so Back to a page normally finds it remounted
  // with every sheet shut. The browser can instead hand the whole page back
  // from its back-forward cache, frozen as it was left — sheet and all, with no
  // navigation for React to see. Back never returns to an open sheet, so one
  // restored that way closes.
  useEffect(() => {
    if (!open) return;
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      dialogRef.current?.close();
      closeRef.current();
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      // Cleared as it closes, so the next opening starts clean.
      setClosing(false);
      return;
    }
    // Placement and gliding are set up on every run, not only the one that
    // opens: a sheet mounted already open runs this twice in development, and
    // the second run would otherwise find it open and leave both torn down.
    const release = holdModalInWorkspace(dialog);
    if (!dialog.open) {
      const invoker = document.activeElement;
      // A leftover exit class would hold the sheet at the end of its exit
      // animation for the first frame of the next opening: a blink.
      dialog.classList.remove("is-closing");
      setClosing(false);
      dialog.showModal();
      aimModalFrom(dialog, invoker);
    }
    const stopGliding = glideModalHeight(dialog);
    return () => {
      release();
      stopGliding();
    };
  }, [open]);

  const requestClose = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    setClosing(true);
    window.setTimeout(onClose, CLOSE_MS);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={`doc-modal is-${size}${closing ? " is-closing" : ""}${className ? ` ${className}` : ""}`}
      aria-labelledby={labelId}
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onClick={(event) => { if (isBackdropClick(dialogRef.current, event)) requestClose(); }}
    >
      {open ? <>
        <header className="doc-modal-head">
          {onBack ? (
            <button type="button" className="doc-modal-back" aria-label={backLabel} title={backLabel} onClick={onBack}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ) : (
            <span className="doc-modal-mark" aria-hidden="true"><Icon name={icon} /></span>
          )}
          <div className="doc-modal-title" key={viewKey}>
            <h2 id={labelId}>{title}</h2>
            {meta ? <p>{meta}</p> : null}
          </div>
          {headerAction ? <div className="doc-modal-head-action">{headerAction}</div> : null}
          <button type="button" className="doc-modal-close" aria-label={closeLabel} onClick={requestClose}><Icon name="close" /></button>
        </header>
        <div className="doc-modal-body" aria-busy={bodyBusy || undefined}>
          {typeof children === "function" ? children(requestClose) : children}
        </div>
        {footer ? <footer className="doc-modal-foot">{footer(requestClose)}</footer> : null}
      </> : null}
    </dialog>
  );
}
