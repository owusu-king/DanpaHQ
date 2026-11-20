"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useEffect } from "react";

import { cn } from "@/lib/utils";
import type { Toast, ToastTone } from "./Toaster";

/**
 * The animated toast stack.
 *
 * Kept apart from `Toaster` so the animation library is not in the bundle
 * every route downloads before it can render. `ToastProvider` loads this once
 * the page is idle, or as soon as the first toast arrives.
 */

const TONE: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: "text-brand" },
  warning: { icon: TriangleAlert, className: "text-muted-foreground" },
  info: { icon: Info, className: "text-muted-foreground" },
};

export default function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      // Each toast announces its own text.
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
