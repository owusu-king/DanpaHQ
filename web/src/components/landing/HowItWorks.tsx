"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { GuideMedia } from "./GuideMedia";
import { apiFetch } from "@/lib/api";
import type { GuideCollection } from "@/lib/videoGuides";

export function HowItWorks() {
  const search = useSearchParams();
  const [attempt, setAttempt] = useState(0);
  const [resource, setResource] = useState<{ loading: boolean; error: string; data: GuideCollection | null }>({ loading: true, error: "", data: null });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    apiFetch<GuideCollection>("/how-it-works/", { signal: controller.signal }).then(data => {
      if (active) setResource({ loading: false, error: "", data });
    }).catch(() => { if (active) setResource({ loading: false, error: "The guides couldn’t be loaded. Please try again.", data: null }); });
    return () => { active = false; controller.abort(); };
  }, [attempt]);
  function retry() { setResource({ loading: true, error: "", data: null }); setAttempt(value => value + 1); }
  const guides = resource.data?.guides ?? [];
  const selected = Math.max(0, guides.findIndex(item => item.id === search.get("guide")));
  const guide = guides[selected];
  const next = guides[selected + 1];
  return <div className="hiw-page">
    <EntityPath items={[{ label: "Home", href: "/" }, { label: "How it works" }]} />
    <h1 className="sr-only">How it works</h1>
    {resource.loading ? <p role="status">Loading guides…</p> : resource.error ? <div role="alert"><p>{resource.error}</p><button className="btn btn-secondary" type="button" onClick={retry}>Try again</button></div> : !guide ? <p role="status">New guides will appear here soon.</p> : <div className="hiw-layout">
      <section className="hiw-viewer" aria-labelledby="hiw-video-title">
        <GuideMedia key={`${guide.id}:${guide.src}`} guide={guide} number={selected + 1} onRetry={retry} />
        <div className="hiw-caption" aria-live="polite" aria-atomic="true"><h2 id="hiw-video-title">{guide.title}</h2><p>{guide.description}</p></div>
        <div className="hiw-viewer-foot">{next ? <Link href={`/how-it-works?guide=${next.id}` as never} scroll={false}>Next guide <ArrowRight aria-hidden="true" /></Link> : <Link href="/rentals">Explore properties <ArrowRight aria-hidden="true" /></Link>}</div>
      </section>
      <nav className="hiw-playlist" aria-label="Video guides">
        <div className="hiw-playlist-head"><h2>Explore the essentials</h2><p>Watch guide</p></div>
        <ol>{guides.map((item, index) => <li key={item.id}><Link href={`/how-it-works?guide=${item.id}` as never} scroll={false} aria-current={index === selected ? "page" : undefined}><span className="hiw-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.title}</strong>{!item.src && item.unavailable ? <small>Unavailable</small> : null}</span></Link></li>)}</ol>
      </nav>
    </div>}
  </div>;
}
