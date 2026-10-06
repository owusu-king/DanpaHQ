"use client";

/**
 * Time to a viewing, counted down.
 *
 * Only where it helps somebody get there: a confirmed appointment that is
 * close. A week away is a date, not a countdown; within a week the days and
 * hours matter; within the hour the minutes and seconds do, and the clock
 * ticks every second only then. Past the start it says so and stops.
 *
 * The clock is read in an effect, never during render, so the first render on
 * the server and on the client agree; until then nothing is drawn.
 */

import { useEffect, useState } from "react";

/** How close an appointment must be before it is counted down, not dated. */
export const COUNTDOWN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Now, kept fresh: every second within the hour, every half-minute otherwise. */
export function useNow(target: string | null): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!target) return;
    const at = new Date(target).getTime();
    let timer = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const left = at - current;
      // Fine-grained only when a second can matter; the tab stays quiet otherwise.
      timer = window.setTimeout(tick, left > 0 && left <= HOUR ? 1000 : 30_000);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [target]);
  return now;
}

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number; total: number };

export function partsUntil(target: string, now: number): CountdownParts {
  const total = Math.max(0, new Date(target).getTime() - now);
  return {
    total,
    days: Math.floor(total / 86_400_000),
    hours: Math.floor((total % 86_400_000) / HOUR),
    minutes: Math.floor((total % HOUR) / 60_000),
    seconds: Math.floor((total % 60_000) / 1000),
  };
}

/** Whether this appointment is close enough, and still ahead, to count down. */
export function countsDown(target: string | null, now: number | null): boolean {
  if (!target || now === null) return false;
  const left = new Date(target).getTime() - now;
  return left > 0 && left <= COUNTDOWN_WINDOW_MS;
}

/** "in 2 days", "in 3h 20m", "in 12 min", "starting now" — for a card's corner. */
export function shortCountdown(target: string, now: number): string {
  const { total, days, hours, minutes } = partsUntil(target, now);
  if (total <= 0) return "starting now";
  if (days >= 2) return `in ${days} days`;
  if (days === 1) return `in 1 day ${hours}h`;
  if (hours >= 1) return `in ${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes >= 1) return `in ${minutes} min`;
  return "in under a minute";
}

/** A short, ticking countdown for a card; nothing at all when it is not close. */
export function SoonChip({ target }: { target: string | null }) {
  const now = useNow(target);
  if (!target || now === null || !countsDown(target, now)) return null;
  const urgent = new Date(target).getTime() - now <= 2 * HOUR;
  return (
    <span className="viewing-soon" data-urgent={urgent || undefined}>
      <i aria-hidden="true" />
      {shortCountdown(target, now)}
    </span>
  );
}

/**
 * The large countdown: days, hours, minutes — and seconds within the hour.
 * Digits are tabular and each unit is its own cell, so ticking never shifts
 * the line. The full sentence is in the accessible name, updated politely.
 */
export function Countdown({ target, label = "Starts" }: { target: string; label?: string }) {
  const now = useNow(target);
  if (now === null) return null;
  const parts = partsUntil(target, now);
  if (parts.total <= 0) {
    return <p className="viewing-countdown is-now" role="status">Starting now</p>;
  }
  const cells: { value: number; unit: string }[] = parts.days
    ? [{ value: parts.days, unit: parts.days === 1 ? "day" : "days" }, { value: parts.hours, unit: "hrs" }, { value: parts.minutes, unit: "min" }]
    : parts.hours
      ? [{ value: parts.hours, unit: "hrs" }, { value: parts.minutes, unit: "min" }]
      : [{ value: parts.minutes, unit: "min" }, { value: parts.seconds, unit: "sec" }];
  const spoken = `${label} ${shortCountdown(target, now)}`;
  return (
    <p className="viewing-countdown" data-final={parts.days === 0 && parts.hours === 0 ? "" : undefined} aria-label={spoken}>
      {cells.map((cell) => (
        <span key={cell.unit} className="viewing-countdown-cell" aria-hidden="true">
          <strong>{String(cell.value).padStart(2, "0")}</strong>
          <small>{cell.unit}</small>
        </span>
      ))}
    </p>
  );
}
