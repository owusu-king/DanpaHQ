"use client";

/**
 * Two glass tiles that move between a list's links instead of every link
 * painting its own background: one under the current link, sliding when it
 * changes, and one following the pointer (or keyboard focus).
 *
 * Positions are written as custom properties on the container
 * (`--current-x/y/w/h`, `--hover-x/y/w/h`) with `data-current` / `data-hover`
 * set while each is placed, straight from the DOM, so following the pointer
 * never re-renders anything. `data-glide` is set after the first placement,
 * so arriving never animates the current tile in from the corner. The CSS
 * that draws the tiles belongs to each list (the rail, the Settings index).
 */

import { useLayoutEffect, type RefObject, type SyntheticEvent, type FocusEvent } from "react";

export function useGlide(
  container: RefObject<HTMLElement | null>,
  { link, current, layoutKey }: { link: string; current: string; layoutKey: string },
) {
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    let ready = 0;
    const measure = () => {
      // Geometry changes must snap before paint. Animating stale coordinates
      // through a narrower/shorter menu can create temporary scroll overflow.
      root.removeAttribute("data-glide");
      placeTile(root, "current", root.querySelector<HTMLElement>(current));
      placeTile(root, "hover", root.querySelector<HTMLElement>(`${link}:hover, ${link}:focus-visible`));
      cancelAnimationFrame(ready);
      ready = requestAnimationFrame(() => {
        ready = requestAnimationFrame(() => root.setAttribute("data-glide", ""));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => { cancelAnimationFrame(ready); observer.disconnect(); };
  }, [container, current, link, layoutKey]);

  function follow(event: SyntheticEvent) {
    const root = container.current;
    const target = (event.target as HTMLElement).closest<HTMLElement>(link);
    if (root && target) placeTile(root, "hover", target);
  }

  function rest(event: SyntheticEvent) {
    const root = container.current;
    if (!root) return;
    // Focus can leave the document for a window or browser control. A type
    // assertion cannot make that EventTarget safe to pass to Node.contains.
    const next = (event as FocusEvent).relatedTarget;
    const NodeType = root.ownerDocument.defaultView?.Node;
    if (NodeType && next instanceof NodeType && root.contains(next)) return;
    placeTile(root, "hover", null);
  }

  return { follow, rest };
}

function placeTile(root: HTMLElement, prefix: "current" | "hover", target: HTMLElement | null) {
  if (!target) {
    root.removeAttribute(`data-${prefix}`);
    for (const axis of ["x", "y", "w", "h"]) root.style.removeProperty(`--${prefix}-${axis}`);
    return;
  }
  const box = root.getBoundingClientRect();
  const at = target.getBoundingClientRect();
  root.style.setProperty(`--${prefix}-y`, `${at.top - box.top + root.scrollTop - root.clientTop}px`);
  root.style.setProperty(`--${prefix}-x`, `${at.left - box.left + root.scrollLeft - root.clientLeft}px`);
  root.style.setProperty(`--${prefix}-w`, `${at.width}px`);
  root.style.setProperty(`--${prefix}-h`, `${at.height}px`);
  root.setAttribute(`data-${prefix}`, "");
}
