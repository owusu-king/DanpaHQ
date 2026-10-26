import Link from "next/link";
import { useEffect } from "react";

import { Icon, type IconName } from "@/components/portal/icons";
import { getProviderStanding } from "@/lib/console";
import { useSession, type Me } from "@/lib/session";

/**
 * The provider's Home while their review is open (owner, 2026-10-25): a calm
 * waiting room, not a notice.
 *
 * One centred composition on the dashboard's ground. A seal says where things
 * stand at a glance — a slow light travels its ring while the review is with
 * the team, and it holds still once something is asked of them. Under it, the
 * one sentence that matters and the three steps of the journey, so "where am I
 * and what happens next" is answered without reading a paragraph. Two quiet
 * doors close it: the verification itself, and renting meanwhile.
 *
 * Every review state gets the same page, worded for that state. A status this
 * build does not know still reads as "not started" rather than an empty panel.
 */

type Tone = "waiting" | "action" | "stopped";
type StepState = "done" | "current" | "blocked" | "todo";

type Review = {
  tone: Tone;
  /** The seal's glyph. */
  icon: IconName;
  /** A word or two for the pill. */
  status: string;
  title: string;
  body: string;
  /** Where each of the three steps stands. */
  steps: [StepState, StepState, StepState];
  /** The verification link's wording in this state. */
  act: string;
};

const REVIEWS: Record<string, Review> = {
  // Not a review status: an application cannot be sent until the phone is confirmed.
  phone: {
    tone: "action",
    icon: "handset",
    status: "Phone not verified",
    title: "Verify your phone to continue",
    body: "A code sent to your phone confirms it is yours. Then you can send your application for review.",
    steps: ["current", "todo", "todo"],
    act: "Verify your phone",
  },
  not_started: {
    tone: "action",
    icon: "passport",
    status: "Not started",
    title: "Send one document to begin",
    body: "One identity document starts your review. It confirms who you are and that you may let property here.",
    steps: ["current", "todo", "todo"],
    act: "Start verification",
  },
  pending: {
    tone: "waiting",
    icon: "clock",
    status: "In review",
    title: "Your review is under way",
    body: "Our team is checking what you sent. There is nothing more to do: we will tell you the moment it is decided.",
    steps: ["done", "current", "todo"],
    act: "See your verification",
  },
  needs_more_info: {
    tone: "action",
    icon: "info",
    status: "Something needed",
    title: "We need one more thing",
    body: "Your verification says what is missing. Send it and the review carries on from where it stopped.",
    steps: ["done", "blocked", "todo"],
    act: "Send what is missing",
  },
  rejected: {
    tone: "stopped",
    icon: "warning",
    status: "Not approved",
    title: "Your review was not approved",
    body: "The note on your verification says why. Put it right and send it again.",
    steps: ["done", "blocked", "todo"],
    act: "Read the note",
  },
  revoked: {
    tone: "stopped",
    icon: "warning",
    status: "Withdrawn",
    title: "Your approval was withdrawn",
    body: "The note on your verification says what happened and what to do next.",
    steps: ["done", "blocked", "todo"],
    act: "Read the note",
  },
  expired: {
    tone: "action",
    icon: "passport",
    status: "Expired",
    title: "Your approval has expired",
    body: "Send a current document and your property tools open again once it is checked.",
    steps: ["done", "blocked", "todo"],
    act: "Renew verification",
  },
};

const STEPS = [
  { title: "Documents sent", line: "Your identity, once" },
  // No promise of a time: the review takes what it takes, and a number here would be one.
  { title: "Review", line: "Checked by our team" },
  { title: "Property tools open", line: "Properties, Units, tenants" },
];

const STEP_WORD: Record<StepState, string> = {
  done: "done",
  current: "in progress",
  blocked: "waiting on you",
  todo: "next",
};

export function ProviderReview({ me }: { me: Me }) {
  const { refresh } = useSession();
  const provider = me.capabilities.provider;
  const status = provider.verification_status ?? "not_started";
  const review = !me.is_phone_verified
    ? REVIEWS.phone!
    : REVIEWS[status] ?? REVIEWS.not_started!;

  // The check `/provider` used to make: every 30 seconds, ask where the review
  // stands, and only when it has moved reload the session — which turns this
  // page into the Portfolio once approved, or rewords it if something is asked.
  useEffect(() => {
    let live = true;
    const timer = setInterval(() => {
      getProviderStanding()
        .then((standing) => {
          if (!live) return;
          if (standing.workspace_access || standing.verification_status !== status) void refresh();
        })
        .catch(() => { /* A missed check is tried again on the next tick. */ });
    }, 30000);
    return () => { live = false; clearInterval(timer); };
  }, [refresh, status]);
  const name = me.preferred_name?.trim() || me.first_name?.trim();
  // What the team wrote back, when they asked for something or said no.
  const note = review.tone === "waiting" ? "" : me.provider_readiness?.decision_note || me.provider_readiness?.identity_decision_note || "";

  return (
    <div className="review-wait" data-tone={review.tone}>
      <section className="review-hero" aria-labelledby="review-title">
        <div className="review-seal" aria-hidden="true">
          <svg className="review-seal-ring" viewBox="0 0 120 120">
            <circle className="review-seal-track" cx="60" cy="60" r="54" />
            <circle className="review-seal-arc" cx="60" cy="60" r="54" pathLength="100" />
          </svg>
          <span className="review-seal-core"><Icon name={review.icon} /></span>
        </div>

        <p className="review-eyebrow">Provider review</p>
        <h1 id="review-title" className="review-title">{review.title}</h1>
        <p className="review-body">
          {name ? `${name}, ` : ""}
          {name ? review.body.charAt(0).toLowerCase() + review.body.slice(1) : review.body}
        </p>
        <p className="review-status" role="status">
          <span className="review-status-dot" />
          {review.status}
        </p>

        {note ? (
          <blockquote className="review-note">
            <span>From our review team</span>
            {note}
          </blockquote>
        ) : null}
      </section>

      <ol className="review-steps" aria-label="Your path to property tools">
        {STEPS.map((step, index) => {
          const state = review.steps[index]!;
          return (
            <li key={step.title} className="review-step" data-state={state}>
              <span className="review-step-mark" aria-hidden="true">
                {state === "done" ? <Icon name="check" /> : <span>{index + 1}</span>}
              </span>
              <span className="review-step-text">
                <strong>{step.title}</strong>
                <small>{step.line}</small>
              </span>
              <span className="sr-only">, {STEP_WORD[state]}</span>
            </li>
          );
        })}
      </ol>

      <nav className="review-doors" aria-label="While you wait">
        {/* While it waits there is nothing to send, so the first door is where
            the decision will arrive; otherwise it is the step to take. */}
        {review.tone === "waiting" ? (
          <Link href="/updates" className="review-door is-primary">
            <span className="review-door-icon"><Icon name="updates" /></span>
            <span className="review-door-text">
              <strong>Updates</strong>
              <small>The decision arrives here</small>
            </span>
            <span className="review-door-go" aria-hidden="true">→</span>
          </Link>
        ) : (
          <Link href="/provider" className="review-door is-primary">
            <span className="review-door-icon"><Icon name="verification" /></span>
            <span className="review-door-text">
              <strong>{review.act}</strong>
              <small>{review.icon === "handset" ? "A code to your phone, then your application" : "Your application and its documents"}</small>
            </span>
            <span className="review-door-go" aria-hidden="true">→</span>
          </Link>
        )}
        <Link href="/rentals" className="review-door">
          <span className="review-door-icon"><Icon name="explore" /></span>
          <span className="review-door-text">
            <strong>Explore rentals</strong>
            <small>Browse homes while you wait</small>
          </span>
          <span className="review-door-go" aria-hidden="true">→</span>
        </Link>
      </nav>
    </div>
  );
}
