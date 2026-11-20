"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
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

import { ErrorDialog, type ErrorAction, type ErrorMessage } from "./ErrorDialog";

/**
 * Toasts, built here rather than pulled in.
 *
 * What this has to get right is not the animation. It is that a toast is the
 * only feedback some actions give, and on the screens this product runs on it
 * is competing with a slow connection: a save that silently succeeds and a save
 * that silently failed look identical, and the person taps again.
 *
 * Confirmations stay in a polite live region; operation failures are presented
 * separately and stay open until the person can read and act on them.
 */

export type ToastTone = "success" | "warning" | "info";

export type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds until it leaves. `null` keeps it until dismissed. */
  duration: number | null;
};

type ToastInput = {
  tone?: ToastTone | "error";
  title: string;
  description?: string;
  duration?: number | null;
  action?: ErrorAction;
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

/** How long each tone stays, when the caller does not say. */
const DEFAULT_DURATION: Record<ToastTone, number | null> = {
  success: 4000,
  info: 5000,
  warning: 6500,
};

/** The animated stack, outside the bundle every route loads first. */
const ToastViewport = dynamic(() => import("./ToastViewport"), { ssr: false });

/**
 * Whether to mount the toast stack yet: once the page is idle, or as soon as
 * there is something to show, whichever comes first.
 */
function useViewportReady(pending: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    if (pending) {
      setReady(true);
      return;
    }
    const idle = window.requestIdleCallback;
    if (idle) {
      const handle = idle(() => setReady(true), { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(() => setReady(true), 2000);
    return () => window.clearTimeout(timer);
  }, [pending, ready]);
  return ready;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [feedbackPath, setFeedbackPath] = useState(pathname);
  const [errors, setErrors] = useState<ErrorMessage[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  if (feedbackPath !== pathname) {
    setFeedbackPath(pathname);
    setErrors([]);
  }

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
    setErrors((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    const tone = input.tone ?? "info";
    if (tone === "error") {
      const detail = input.description ?? input.title;
      // The viewing endpoint returns this requirement as a 404. Recognize
      // its existing copy until the API exposes a dedicated error code.
      const needsPhone = /^confirm your phone number (?:first\.?$|before\b)/i.test(detail);
      const error: ErrorMessage = {
        id,
        title: needsPhone ? "Verify your phone number" : input.description ? input.title : "Action couldn’t be completed",
        description: detail,
        action: input.action ?? (needsPhone ? {
          label: "Verify phone number",
          onSelect: () => router.push("/settings/security#phone-verification"),
        } : undefined),
      };
      setErrors((current) => [...current, error]);
      return id;
    }
    setToasts((current) => [
      // Newest first, and never more than three. A stack that grows without
      // limit covers the thing it is reporting on.
      { id, tone, title: input.title, description: input.description,
        duration: input.duration === undefined ? DEFAULT_DURATION[tone] : input.duration },
      ...current,
    ].slice(0, 3));
    return id;
  }, [router]);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  const viewportReady = useViewportReady(toasts.length > 0);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {viewportReady ? <ToastViewport toasts={toasts} onDismiss={dismiss} /> : null}
      {errors[0] ? <ErrorDialog key={errors[0].id} error={errors[0]} onDismiss={dismiss} /> : null}
    </ToastContext.Provider>
  );
}
