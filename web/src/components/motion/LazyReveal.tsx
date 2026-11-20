"use client";

import dynamic from "next/dynamic";

/**
 * `Reveal`, with the animation library in its own chunk.
 *
 * The root `not-found` boundary is part of every route's bundle, so importing
 * `Reveal` there put the whole animation library in front of every page. This
 * loads it only where the boundary actually renders.
 */
export const LazyReveal = dynamic(() => import("./Reveal").then((module) => module.Reveal));
