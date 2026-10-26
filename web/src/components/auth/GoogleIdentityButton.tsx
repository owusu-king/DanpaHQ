"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

type CredentialResponse = { credential?: string };
type GoogleButtonText = "signin_with" | "signup_with" | "continue_with";

type GoogleAccounts = {
  id: {
    initialize: (options: {
      client_id: string;
      callback: (response: CredentialResponse) => void;
      ux_mode: "popup";
      auto_select: boolean;
    }) => void;
    renderButton: (
      parent: HTMLElement,
      options: {
        type: "standard";
        theme: "outline";
        size: "large";
        shape: "rectangular";
        text: GoogleButtonText;
        logo_alignment: "left";
        width: number;
      },
    ) => void;
  };
};

declare global {
  interface Window { google?: { accounts: GoogleAccounts } }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const LABELS: Record<GoogleButtonText, string> = {
  signin_with: "Sign in with Google",
  signup_with: "Sign up with Google",
  continue_with: "Continue with Google",
};
// Google renders 200–400px wide; the visible face is capped to match.
const MAX_WIDTH = 400;
let activeReceiver: ((credential: string) => void) | null = null;
let initializedFor = "";

function initializeGoogle() {
  if (!CLIENT_ID || !window.google || initializedFor === CLIENT_ID) return;
  window.google.accounts.id.initialize({
    client_id: CLIENT_ID,
    ux_mode: "popup",
    auto_select: false,
    callback: (response) => {
      if (response.credential) activeReceiver?.(response.credential);
    },
  });
  initializedFor = CLIENT_ID;
}

/** Google's "G", in the colours its branding guidelines require. */
function GoogleMark() {
  return (
    <svg className="auth-google-mark" viewBox="0 0 48 48" width="18" height="18">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** A Danpa HQ button over Google's GIS button; the browser never decodes or trusts the JWT. */
export function GoogleIdentityButton({
  onCredential,
  text = "continue_with",
  busy = false,
}: {
  onCredential: (credential: string) => void | Promise<void>;
  text?: GoogleButtonText;
  busy?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const receiver = useRef(onCredential);
  const busyRef = useRef(busy);
  const [deliver] = useState(() => (credential: string) => {
    if (!busyRef.current) void receiver.current(credential);
  });
  const [ready, setReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  useEffect(() => { receiver.current = onCredential; }, [onCredential]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const render = useCallback(() => {
    if (!host.current || !window.google || !CLIENT_ID) return;
    initializeGoogle();
    activeReceiver = deliver;

    // Next Script's onReady and the mount effect can arrive together. React
    // Strict Mode also runs the effect twice in development. GIS creates an
    // iframe, so clearing and recreating it in either case is a visible flash.
    // Keep the first healthy render and only rebuild when the button's actual
    // presentation changes.
    // The width is part of the key: the transparent button must cover the face.
    const width = Math.min(MAX_WIDTH, Math.max(200, Math.round(host.current.clientWidth || 320)));
    const renderKey = `${CLIENT_ID}:${text}:${width}`;
    if (host.current.dataset.googleRenderKey === renderKey && host.current.childElementCount > 0) {
      setReady(true);
      return;
    }

    host.current.replaceChildren();
    window.google.accounts.id.renderButton(host.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "rectangular",
      text,
      logo_alignment: "left",
      width,
    });
    host.current.dataset.googleRenderKey = renderKey;
    setReady(true);
  }, [deliver, text]);

  useEffect(() => {
    activeReceiver = deliver;
    render();
    // A phone rotating or a window resizing changes the face's width; redraw
    // the transparent button so its click area still covers it.
    const shell = host.current;
    const observer = shell && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => render()) : null;
    if (shell) observer?.observe(shell);
    return () => {
      observer?.disconnect();
      if (activeReceiver === deliver) activeReceiver = null;
    };
  }, [deliver, render]);

  if (!CLIENT_ID || scriptFailed) {
    return (
      <div className="auth-google is-unavailable">
        <p className="auth-google-unavailable" role="status">
          Google sign-in is unavailable right now. Continue with your phone.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`auth-google${ready ? " is-ready" : ""}${busy ? " is-busy" : ""}`}
      aria-busy={busy || undefined}
    >
      <Script
        id="google-identity-services"
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={render}
        onError={() => setScriptFailed(true)}
      />
      {/* Our button is what people see, drawn once and never swapped. Google's
          own button sits over it, transparent, and takes the click and focus:
          the popup and the signed ID token stay entirely Google's, while its
          late-loading iframe and personalised "Continue as" swap stay unseen. */}
      <div className="auth-google-button-shell">
        <span className="auth-google-face" aria-hidden="true">
          {busy ? <span className="auth-google-spinner" /> : <GoogleMark />}
          <span>{busy ? "Checking your Google account…" : LABELS[text]}</span>
        </span>
        <div ref={host} className="auth-google-button" />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {busy ? "Checking your Google account…" : ""}
      </span>
    </div>
  );
}
