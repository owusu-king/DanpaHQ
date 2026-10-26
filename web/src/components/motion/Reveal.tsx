"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import type { ReactNode } from "react";

/**
 * Scroll-triggered entrance, as a wrapper rather than a page-wide opt-in.
 *
 * The page stays a Server Component; only these wrappers ship JavaScript. That
 * matters here more than usual — the landing page is the one screen a stranger
 * loads cold, over a Ghanaian mobile connection, before they have any reason to
 * care about this product.
 *
 * `once` because a section that re-animates every time it scrolls back into
 * view stops reading as arrival and starts reading as a fault. The viewport
 * margin fires the transition slightly before the element's edge, so content is
 * already settled by the time it is properly on screen.
 *
 * Under `prefers-reduced-motion` nothing moves and nothing fades: the variants
 * collapse to the resting state and the element is simply present. Honouring
 * the setting by shortening the duration would still animate, which is the
 * thing the setting exists to prevent.
 */
export function Reveal({
  children,
  delay = 0,
  y = 20,
  className,
}: {
  children: ReactNode;
  delay?: number;
  /** Distance travelled on entry. Set 0 for a pure fade. */
  y?: number;
  className?: string;
}) {
  const still = useReducedMotion();

  const variants: Variants = {
    hidden: still ? { opacity: 1 } : { opacity: 0, y },
    shown: {
      opacity: 1,
      y: 0,
      transition: still
        ? { duration: 0 }
        : { duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] },
    },
  };

  return (
    <motion.div
      data-reveal=""
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The same entrance, applied down a list so items arrive in sequence.
 *
 * Stagger is delegated to the parent rather than each child carrying its own
 * `delay`, so inserting or reordering an item cannot leave a gap in the rhythm.
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.08,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  as?: "div" | "ul" | "ol";
}) {
  const still = useReducedMotion();
  const Motion = motion[Tag];

  return (
    <Motion
      data-reveal=""
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: still ? 0 : stagger } },
      }}
    >
      {children}
    </Motion>
  );
}

/** One item inside a `RevealGroup`. Timing comes from the parent. */
export function RevealItem({
  children,
  className,
  y = 20,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  y?: number;
  as?: "div" | "li";
}) {
  const still = useReducedMotion();
  const Motion = motion[Tag];

  return (
    <Motion
      data-reveal=""
      className={className}
      variants={{
        hidden: still ? { opacity: 1 } : { opacity: 0, y },
        shown: {
          opacity: 1,
          y: 0,
          transition: still ? { duration: 0 } : { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
        },
      }}
    >
      {children}
    </Motion>
  );
}
