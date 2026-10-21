"use client";

/**
 * One modal, several views: a sheet that navigates instead of stacking.
 *
 * A record opens its receipt, a tenancy its payments or agreement. Those used
 * to open as a second dialog over the first. Now the sheet itself moves to the
 * deeper view — the header gains a Back action and the new view slides in —
 * and Back returns to the exact view that was left.
 *
 * "Exact": every view in the trail stays mounted, only hidden, so a half-typed
 * dispute reason or an opened disclosure survives the trip; and the sheet's
 * scroll position is saved on the way in and restored on the way back.
 *
 * `useModalViews` holds the trail beyond the root view (the root is whatever
 * the modal was opened on, from props). `ModalViews` renders root + trail,
 * showing the last and animating it in the direction travelled.
 */

import { Children, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type ViewDirection = "none" | "forward" | "back";

/** `initial` is the trail an opening starts on — a link that names a deeper view. */
export function useModalViews<V>(open: boolean, recordKey: unknown, initial?: V[]) {
  const [views, setViews] = useState<V[]>([]);
  const [direction, setDirection] = useState<ViewDirection>("none");
  const [seen, setSeen] = useState({ open, recordKey });
  // Each opening, and each different record, starts at the root — adjusted in
  // the same render, so the old trail never flashes. Closing keeps the trail,
  // so the sheet leaves showing what it showed.
  if (seen.open !== open || (open && seen.recordKey !== recordKey)) {
    setSeen({ open, recordKey });
    if (open) {
      setViews(initial ?? []);
      setDirection("none");
    }
  }
  return {
    views,
    top: views.length ? views[views.length - 1]! : null,
    depth: views.length,
    direction,
    push(view: V) {
      setDirection("forward");
      setViews((current) => [...current, view]);
    },
    back() {
      setDirection("back");
      setViews((current) => current.slice(0, -1));
    },
  };
}

export function ModalViews({ depth, direction, children }: { depth: number; direction: ViewDirection; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const scrolls = useRef<number[]>([]);
  const shown = useRef(depth);

  // Each view's scroll, kept as it happens. Reading it at the moment of
  // leaving is too late: the view is hidden in the same commit that shows the
  // next one, and by then the sheet has clamped to the new, shorter content.
  useEffect(() => {
    const body = root.current?.closest(".doc-modal-body");
    if (!body) return;
    const remember = () => { scrolls.current[shown.current] = body.scrollTop; };
    body.addEventListener("scroll", remember, { passive: true });
    return () => body.removeEventListener("scroll", remember);
  }, []);

  // A deeper view starts at its top; the way back restores where it was.
  useLayoutEffect(() => {
    const body = root.current?.closest(".doc-modal-body");
    const from = shown.current;
    shown.current = depth;
    if (!body || from === depth) return;
    if (depth > from) {
      body.scrollTop = 0;
    } else {
      // The sheet is still gliding from the deeper view's height, and while it
      // is taller than this view there is nothing to scroll: the browser
      // clamps to 0. Hold the position each frame until the glide settles.
      const target = scrolls.current[depth] ?? 0;
      body.scrollTop = target;
      const sheet = body.closest("dialog");
      let frame = 0;
      const started = performance.now();
      const hold = () => {
        body.scrollTop = target;
        const gliding = sheet?.classList.contains("is-gliding");
        if ((gliding || performance.now() - started < 120) && performance.now() - started < 900) frame = requestAnimationFrame(hold);
      };
      frame = requestAnimationFrame(hold);
      return () => cancelAnimationFrame(frame);
    }
  }, [depth]);

  const views = Children.toArray(children);
  return (
    <div ref={root} className="doc-modal-views" data-direction={direction}>
      {views.map((view, index) => (
        <section
          key={index}
          className="doc-modal-view"
          hidden={index !== views.length - 1}
          aria-hidden={index !== views.length - 1 || undefined}
        >
          {view}
        </section>
      ))}
    </div>
  );
}
