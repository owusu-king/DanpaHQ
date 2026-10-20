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

/** Google's own GIS-rendered button; the browser never decodes or trusts the JWT. */
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
    const renderKey = `${CLIENT_ID}:${text}`;
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
      width: Math.min(400, Math.max(240, Math.round(host.current.clientWidth || 320))),
    });
    host.current.dataset.googleRenderKey = renderKey;
    setReady(true);
  }, [deliver, text]);

  useEffect(() => {
    activeReceiver = deliver;
    render();
    return () => {
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
      <div className="auth-google-button-shell">
        <div ref={host} className="auth-google-button" />
        <div className="auth-google-placeholder" aria-hidden="true">
          <span className="auth-google-placeholder-mark" />
          <span>Loading secure sign-in…</span>
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {busy ? "Checking your Google account…" : ""}
      </span>
    </div>
  );
}
