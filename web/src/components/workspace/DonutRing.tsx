/**
 * A ring that shows parts of a whole: one segment per value, drawn round from
 * twelve o'clock on first appearance, with whatever sits in its middle.
 *
 * Segments take a tone rather than a colour so the ring speaks the same
 * language as the status dots beside it. An empty whole draws only the track,
 * never a full ring of nothing.
 */

import type { ReactNode } from "react";

export type RingTone = "kola" | "harmattan" | "lagoon" | "laterite" | "gold" | "slate" | "muted";

export function DonutRing({
  segments,
  size = 88,
  stroke = 9,
  label,
  children,
}: {
  segments: { value: number; tone: RingTone }[];
  size?: number;
  stroke?: number;
  /** What the ring says, for someone who cannot see it. */
  label: string;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const shown = segments.filter((segment) => segment.value > 0);
  // A hair of paper between segments, and none when one segment is the whole.
  const gap = shown.length > 1 ? Math.min(4, circumference * 0.012) : 0;

  let offset = 0;
  const arcs = total > 0 ? shown.map((segment, index) => {
    const length = (segment.value / total) * circumference;
    const arc = { tone: segment.tone, length: Math.max(0, length - gap), offset, index };
    offset += length;
    return arc;
  }) : [];

  return (
    <span className="donut" role="img" aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
        <circle className="donut-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        {arcs.map((arc) => (
          <circle
            key={`${arc.tone}-${arc.index}`}
            className={`donut-arc is-${arc.tone}`}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap={shown.length > 1 ? "butt" : "round"}
            strokeDasharray={`${arc.length} ${circumference - arc.length}`}
            strokeDashoffset={-arc.offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ "--donut-c": circumference, "--donut-i": arc.index } as React.CSSProperties}
          />
        ))}
      </svg>
      {children ? <span className="donut-middle">{children}</span> : null}
    </span>
  );
}
