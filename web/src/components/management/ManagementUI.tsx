"use client";

import { useCallback, useEffect, useState } from "react";

import { ManagementFailure, managementFetch } from "@/lib/management";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="management-page-header">
      <div>
        <span className="management-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="management-header-actions">{actions}</div> : null}
    </div>
  );
}

export function Status({ value }: { value: string | boolean | null | undefined }) {
  const label = typeof value === "boolean" ? (value ? "Active" : "Inactive") : (value || "Unknown");
  const tone = ["active", "accepted", "approved", "resolved", "verified", "true"].includes(String(value))
    ? "positive"
    : ["rejected", "suspended", "dismissed", "inactive", "false"].includes(String(value))
      ? "negative"
      : ["pending_review", "pending", "open", "investigating", "in_review", "needs_more_info", "flagged"].includes(String(value))
        ? "warning"
        : "neutral";
  return <span className={`management-status ${tone}`}>{String(label).replaceAll("_", " ")}</span>;
}

export function Panel({ children, title, meta }: { children: React.ReactNode; title?: string; meta?: string }) {
  return (
    <section className="management-panel">
      {title ? <div className="management-panel-title"><h2>{title}</h2>{meta ? <span>{meta}</span> : null}</div> : null}
      {children}
    </section>
  );
}

export function DataTable({ children, label }: { children: React.ReactNode; label: string }) {
  return <div className="management-table-wrap"><table aria-label={label}>{children}</table></div>;
}

export function Empty({ message }: { message: string }) {
  return <div className="management-empty">{message}</div>;
}

export function Feedback({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return <div role={error ? "alert" : "status"} className={`management-feedback ${error ? "error" : "success"}`}>{error || success}</div>;
}

export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await managementFetch<T>(path));
    } catch (cause) {
      setError(cause instanceof ManagementFailure ? cause.message : "Could not load this workspace.");
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load };
}

export function ResourceState({ loading, error }: { loading: boolean; error: string }) {
  if (loading) return <div className="management-loading-row">Loading current records…</div>;
  if (error) return <Feedback error={error} />;
  return null;
}
