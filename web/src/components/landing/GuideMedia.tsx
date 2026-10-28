"use client";
import { useState } from "react";
import { Play } from "lucide-react";
import type { VideoGuide } from "@/lib/videoGuides";

export function GuideMedia({ guide, number, onRetry }: { guide: VideoGuide; number?: number; onRetry?: () => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (guide.src && !failed) {
    if (guide.kind === "youtube" || guide.kind === "vimeo") return <iframe className="guide-media" src={guide.src} title={guide.title} allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />;
    return <video key={attempt} className="guide-media" controls playsInline preload="metadata" poster={guide.thumbnail ?? undefined} crossOrigin={guide.captions ? "anonymous" : undefined} aria-label={guide.title} onError={() => setFailed(true)}><source src={guide.src} onError={() => setFailed(true)} />{guide.captions ? <track default kind="captions" srcLang="en" src={guide.captions} label="English" /> : null}</video>;
  }
  const unavailable = failed || guide.unavailable;
  return <div className="hiw-stage guide-media">
    <div className="hiw-stage-top"><span>DANPA HQ</span>{number ? <span>GUIDE {String(number).padStart(2, "0")}</span> : null}</div>
    <svg className="hiw-linework" viewBox="0 0 800 450" fill="none" aria-hidden="true"><path d="M535 450V150l90-52 90 52v300M565 450V202h120v248M0 370h800M20 450V270l90-52 90 52v180M55 450V310h110v140M345 450V240h100v210" /></svg>
    <div className="hiw-stage-message"><span className="hiw-play-mark" aria-hidden="true"><Play /></span><p role={unavailable ? "alert" : undefined}>{unavailable ? "This video is temporarily unavailable." : "Video coming soon"}</p>{unavailable ? <button type="button" className="hiw-media-retry" onClick={() => { if (onRetry) onRetry(); else { setFailed(false); setAttempt(value => value + 1); } }}>Try again</button> : null}</div>
  </div>;
}
