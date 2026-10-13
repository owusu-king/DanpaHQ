import { AlertTriangle, Check } from "lucide-react";

/**
 * The way to operating as a provider, as four stops on one line.
 *
 * Drawn the same on the welcome and on the provider's home, so the step that
 * was "next" a minute ago is recognisably the same step now: done (kola,
 * ticked), the one in hand (lagoon ring), waiting on Rooomly (gold, breathing),
 * needing attention (laterite), or still ahead.
 */
export type TrackState = "done" | "next" | "waiting" | "attention" | "later";

export type TrackStop = { label: string; detail?: string; state: TrackState };

const SPOKEN: Record<TrackState, string> = {
  done: "done",
  next: "to do now",
  waiting: "in progress",
  attention: "needs attention",
  later: "not yet",
};

export function VerificationTrack({ stops }: { stops: TrackStop[] }) {
  return (
    <ol className="vtrack">
      {stops.map((stop) => (
        <li key={stop.label} className={`is-${stop.state}`}>
          <span className="vtrack-dot" aria-hidden="true">
            {stop.state === "done" ? <Check /> : stop.state === "attention" ? <AlertTriangle /> : null}
          </span>
          <span className="vtrack-text">
            <strong>
              {stop.label}
              <span className="sr-only">, {SPOKEN[stop.state]}</span>
            </strong>
            {stop.detail ? <small>{stop.detail}</small> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Where a provider stands, as stops. Read from the backend's status, never derived. */
export function providerStops(status: string): TrackStop[] {
  const sent = status === "pending" || status === "approved";
  const refused = ["needs_more_info", "rejected", "revoked", "expired"].includes(status);
  return [
    { state: "done", label: "Account created" },
    {
      state: sent ? "done" : refused ? "attention" : "next",
      label: sent ? "ID document sent" : "Send one ID document",
      detail: sent ? undefined : refused ? "See the note above" : "Ghana Card, passport or driver's licence",
    },
    {
      state: status === "approved" ? "done" : status === "pending" ? "waiting" : "later",
      label: status === "pending" ? "Under review" : "We review it",
      detail: status === "pending" ? "We will let you know the outcome" : "You can look around while you wait",
    },
    {
      state: status === "approved" ? "done" : "later",
      label: "Provider tools unlock",
      detail: status === "approved" ? undefined : "Properties, tenants, rent and listings",
    },
  ];
}
