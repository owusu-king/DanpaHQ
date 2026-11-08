"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Check } from "@/components/Check";
import { apiFetch } from "@/lib/api";
export type AcceptedProviderTerms = { version: string; digest: string };
type Policy = AcceptedProviderTerms & { text: string; available: boolean };
export function ProviderTermsConsent({ value, onChange, presentation = "inline", reading = false, onReadingChange }: {
  value: AcceptedProviderTerms | null; onChange: (value: AcceptedProviderTerms | null) => void;
  presentation?: "inline" | "page"; reading?: boolean; onReadingChange?: (reading: boolean) => void;
}) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState("");
  const [viewed, setViewed] = useState("");
  const reader = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeReading = useCallback(() => {
    onReadingChange?.(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }, [onReadingChange]);
  const load = useCallback(() => apiFetch<Policy>("/provider-registration-policy/").then((next) => {
    setPolicy(next); setViewed(""); onChange(null);
    setError(next.available ? "" : "Provider terms are being updated.");
  }).catch(() => { setPolicy(null); onChange(null); setError("Could not load provider terms."); }), [onChange]);
  useEffect(() => { void load(); }, [load]);
  const key = policy ? `${policy.version}:${policy.digest}` : "";
  const ready = Boolean(key && viewed === key);
  useEffect(() => {
    const node = reader.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (node.clientHeight > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 8) setViewed(key);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [key, reading]);
  useEffect(() => {
    if (presentation !== "page" || !reading) return;
    reader.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeReading(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [presentation, reading, key, closeReading]);
  function checkEnd() {
    const node = reader.current;
    if (node && node.clientHeight > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 8) setViewed(key);
  }
  if (presentation === "page" && reading && policy?.available) return <section className="provider-agreement-page" aria-labelledby="provider-agreement-title">
    <header className="provider-agreement-head"><div><h1 id="provider-agreement-title">Provider agreement</h1><p>Terms and Conditions · Version {policy.version}</p></div><Button variant="quiet" size="sm" aria-label="Close agreement" onClick={closeReading}>Close</Button></header>
    <div key={key} ref={reader} role="region" aria-label="Provider agreement text" tabIndex={0} className="provider-consent-reader" onScroll={checkEnd}>{policy.text}</div>
    <footer className="provider-agreement-foot"><p role="status">{ready ? "Agreement viewed. You can now accept it." : "Scroll to the end to enable acceptance."}</p><div><button type="button" className="auth-inline" onClick={() => void load()}>Refresh terms</button><Button size="sm" aria-label="Continue to application" disabled={!ready} onClick={closeReading}>Continue</Button></div></footer>
  </section>;
  return <div className="provider-consent">
    {presentation === "page" && reading ? <Button variant="quiet" onClick={closeReading}>Back to application</Button> : null}
    {policy?.available ? <>
      {presentation === "page" ? <button ref={trigger} type="button" className="provider-agreement-open" onClick={() => onReadingChange?.(true)}><span>Read Provider Terms and Conditions<small>Version {policy.version}</small></span><span aria-hidden="true">↗</span></button> : <div className="provider-consent-document">
        <p className="provider-consent-version">Terms and Conditions · Version {policy.version}</p>
        <div key={key} ref={reader} role="region" aria-label="Provider agreement text" tabIndex={0} className="provider-consent-reader" onScroll={checkEnd}>{policy.text}</div><button type="button" className="auth-inline" onClick={() => void load()}>Refresh terms</button>
      </div>}
      {!ready ? <p className="provider-consent-hint" role="status">Read to the end of the agreement to enable acceptance.</p> : null}
      <Check label="I accept the Provider Terms and Conditions." disabled={!ready} checked={ready && value?.digest === policy.digest && value.version === policy.version} onChange={(checked) => onChange(checked && ready ? { version: policy.version, digest: policy.digest } : null)} />
    </> : !error ? <p role="status">Loading provider agreement…</p> : null}
    {error ? <><p role="alert">{error}</p><button type="button" className="auth-inline" onClick={() => void load()}>Try again</button></> : null}
  </div>;
}
