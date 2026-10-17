"use client";

/**
 * Sign-in, sign-up, password reset and the welcome, as one dialog over
 * whichever page asked for it — held in state, never in the address
 * (owner, 2026-10-16).
 *
 * They used to be pages (`/sign-in`, `/register` …) drawn as a modal over a copy
 * of the front door, so pressing Sign in changed the address, and closing had
 * to guess whether "back" was right. Now "Sign in" opens the dialog where the
 * person is, the flows switch between each other inside it, and closing leaves
 * them exactly where they were. A flow that finishes `land`s: the dialog shuts
 * and the person goes to their dashboard, or to what they were in the middle of.
 *
 * The old addresses stay as ways in from outside — an email, a bookmark, a
 * session that ended — through `AuthEntry`, which opens the dialog once and
 * leaves the address on the front door, the way every other modal's link does.
 */

import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";

import { authHref, type AuthParams, type AuthView } from "@/components/auth/authTypes";
import { ForgotPasswordFlow } from "@/components/auth/flows/ForgotPasswordFlow";
import { RegisterFlow } from "@/components/auth/flows/RegisterFlow";
import { SignInFlow } from "@/components/auth/flows/SignInFlow";
import { WelcomeFlow } from "@/components/auth/flows/WelcomeFlow";
import { FrontDoor } from "@/components/landing/FrontDoor";
import { resolveWebEntry } from "@/lib/navigation";
import { safeInternalPath } from "@/lib/safeRedirect";
import { useSession } from "@/lib/session";

type AuthDialogValue = {
  open: (view: AuthView, params?: AuthParams) => void;
  close: () => void;
};

const AuthDialogContext = createContext<AuthDialogValue | null>(null);

const FLOWS = {
  "sign-in": SignInFlow,
  register: RegisterFlow,
  "forgot-password": ForgotPasswordFlow,
  welcome: WelcomeFlow,
} as const;

export function AuthDialogProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // `key` remounts the flow on every switch, so each screen starts clean.
  const [current, setCurrent] = useState<{ view: AuthView; params: AuthParams; key: number } | null>(null);

  const open = useCallback((view: AuthView, params: AuthParams = {}) => {
    setCurrent((previous) => ({ view, params, key: (previous?.key ?? 0) + 1 }));
  }, []);
  const close = useCallback(() => setCurrent(null), []);
  const land = useCallback((route: string) => {
    setCurrent(null);
    router.replace(route as never);
  }, [router]);

  // Back or Forward with the dialog up is the person leaving; the dialog goes
  // with the page it was over rather than hanging over the next one.
  useEffect(() => {
    if (!current) return;
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [current, close]);

  const value = useMemo(() => ({ open, close }), [open, close]);
  const Flow = current ? FLOWS[current.view] : null;

  return (
    <AuthDialogContext.Provider value={value}>
      {children}
      {Flow && current ? (
        <Flow key={current.key} params={current.params} go={open} close={close} land={land} />
      ) : null}
    </AuthDialogContext.Provider>
  );
}

/**
 * Open the auth dialog from anywhere in the app. Outside the provider (the
 * operations console has its own sign-in) it falls back to the address.
 */
export function useAuthDialog(): AuthDialogValue {
  const value = useContext(AuthDialogContext);
  return value ?? {
    open: (view, params) => window.location.assign(authHref(view, params)),
    close: () => undefined,
  };
}

/**
 * A link that opens the auth dialog in place. A plain click opens it; a
 * modified click (a new tab, a new window) still follows the address.
 */
export function AuthLink({
  view,
  params,
  onClick,
  children,
  ...rest
}: {
  view: AuthView;
  params?: AuthParams;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { open } = useAuthDialog();
  return (
    <a
      {...rest}
      href={authHref(view, params)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        open(view, params);
      }}
    >
      {children}
    </a>
  );
}

/**
 * The old auth addresses, kept as ways in from outside. Signed out, the dialog
 * opens over the front door and the address moves to `/`. Signed in, there is
 * nothing to sign in to: on to the dashboard, or to `next`.
 */
export function AuthEntry({ view }: { view: AuthView }) {
  const router = useRouter();
  const search = useSearchParams();
  const { state } = useSession();
  const { open } = useAuthDialog();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || state.status === "loading") return;
    handled.current = true;
    const workspace = search.get("workspace");
    const params: AuthParams = {
      workspace: workspace === "tenant" || workspace === "provider" ? workspace : undefined,
      next: safeInternalPath(search.get("next")),
      phone: search.get("phone") ?? undefined,
    };

    if (state.status === "signed_in") {
      const me = state.me;
      // An account left unfinished finishes itself in the sign-up; the front
      // door would only send it straight back here.
      if (view === "register" && me.registration_state !== "complete") {
        open("register", params);
        return;
      }
      // An old welcome link shows the welcome once, over the dashboard.
      if (view === "welcome") open("welcome", params);
      router.replace((params.next ?? resolveWebEntry(me)) as never);
      return;
    }

    // There is nothing to welcome a signed-out visitor to.
    open(view === "welcome" ? "sign-in" : view, params);
    router.replace("/");
  }, [open, router, search, state, view]);

  // The page the dialog opens over, until the address moves to the front door.
  return <FrontDoor />;
}
