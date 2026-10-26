"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Toasts, built here rather than pulled in.
 *
 * What this has to get right is not the animation. It is that a toast is the
 * only feedback some actions give, and on the screens this product runs on it
 * is competing with a slow connection: a save that silently succeeds and a save
 * that silently failed look identical, and the person taps again.
 *
 * So: every toast is announced. The live region is polite for confirmations and
 * assertive for failures, because "we could not reach the service" is worth
 * interrupting for and "Saved" is not. Failures also do not auto-dismiss —
 * a message you must read within four seconds is a message for somebody who was
 * already looking.
 */

type ToastTone = "success" | "error" | "info";

type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds until it leaves. `null` keeps it until dismissed. */
  duration: number | null;
};

type ToastInput = {
  tone?: ToastTone;
  title: string;
  description?: string;
  duration?: number | null;
};

type ToastApi = {
  toast: (input: ToastInput) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * The toast api.
 *
 * Returns a no-op outside a provider rather than throwing. A component that
 * wants to confirm a save should not crash the screen it is confirming on
 * because it was rendered somewhere the provider does not reach.
 */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  return context ?? NO_OP;
}

const NO_OP: ToastApi = { toast: () => -1, dismiss: () => {} };

const TONE: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: "text-brand" },
  error: { icon: TriangleAlert, className: "text-destructive" },
  info: { icon: Info, className: "text-muted-foreground" },
};

/** How long each tone stays, when the caller does not say. */
const DEFAULT_DURATION: Record<ToastTone, number | null> = {
  success: 4000,
  info: 5000,
  // Read at the reader's pace, not on a timer.
  error: null,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    const tone = input.tone ?? "info";
    setToasts((current) => [
      // Newest first, and never more than three. A stack that grows without
      // limit covers the thing it is reporting on.
      { id, tone, title: input.title, description: input.description,
        duration: input.duration === undefined ? DEFAULT_DURATION[tone] : input.duration },
      ...current,
    ].slice(0, 3));
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      // Not a live region itself: each toast announces its own text with the
      // urgency its tone deserves.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end sm:p-6"
    >
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <ToastRow key={item.id} toast={item} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const still = useReducedMotion();
  const { icon: Icon, className } = TONE[toast.tone];

  useEffect(() => {
    if (toast.duration === null) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <motion.div
      layout={!still}
      role="status"
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      initial={still ? { opacity: 1 } : { opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={still ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
      transition={still ? { duration: 0 } : { duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-auto flex w-full max-w-[24rem] items-start gap-3 rounded-2xl border border-border bg-popover/95 p-4 text-popover-foreground shadow-[0_16px_44px_-16px_oklch(0.17_0.014_165/0.34)] backdrop-blur-xl"
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", className)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-tight">{toast.title}</p>
        {toast.description ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-m-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <X className="size-4" />
      </button>
    </motion.div>
  );
}
