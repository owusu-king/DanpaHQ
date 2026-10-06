"use client";

import { ArrowLeft, Check, ChevronDown, LockKeyhole, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Check as Checkbox, Radio } from "@/components/Check";
import { ApiFailure } from "@/lib/api";
import {
  cancelSubscriptionCheckout,
  changePlanWithoutPayment,
  getPlanChangeQuote,
  getSubscriptionCheckout,
  refreshSubscriptionCheckout,
  retrySubscriptionCheckout,
  startSubscriptionCheckout,
  type BillingInterval,
  type KeepActive,
  type PlanCatalogue,
  type PlanChangeQuote,
  type PlanCode,
  type PortfolioBilling,
  type ResourceChoice,
  type SubscriptionCheckout,
} from "@/lib/billing";
import {
  catalogueSaving,
  comparison,
  countLabel,
  currentPlanOf,
  downgradeRows,
  formatAmount,
  formatDate,
  formatPrice,
  initialKeep,
  intervalLabel,
  isFreePlan,
  keepComplete,
  keepPropertyNote,
  keptPropertyIds,
  periodRange,
  periodWord,
  planByCode,
  planOptions,
  priceNote,
  propertiesNeedChoosing,
  propertyConsequence,
  propertyPlaces,
  unitConsequence,
  unitPlaces,
  unitsFor,
  unitsNeedChoosing,
  unitsOfKept,
  type PlanOption,
} from "@/lib/billingPresentation";
import { paymentMethodLabel, paystackAccessCode, type DigitalPaymentMethod } from "@/lib/payments";
import { openPaystackPopup } from "@/lib/paystackPopup";
import { aimModalFrom, glideModalHeight, holdModalInWorkspace } from "@/lib/modalOrigin";

export type PlanChangeStart =
  | { step: "compare" }
  | { step: "review"; plan: PlanCode; interval: BillingInterval }
  | { step: "payment"; checkout: SubscriptionCheckout };

type Step =
  | { name: "compare" }
  | { name: "review"; plan: PlanCode; interval: BillingInterval }
  | { name: "payment"; checkout: SubscriptionCheckout }
  | { name: "failed"; checkout: SubscriptionCheckout }
  | { name: "done"; tone: "positive" | "neutral"; title: string; body: string };

type Busy = null | "pay" | "downgrade" | "check" | "cancel" | "retry";

type Props = {
  open: boolean;
  start: PlanChangeStart;
  organizationId: string;
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  onClose: () => void;
  /** Hand the server's new state back to the page, or ask it to read it again. */
  onChanged: (next?: PortfolioBilling) => Promise<void>;
};

/**
 * Change plan: compare, review, pay or confirm, and see the result.
 *
 * A native modal dialog on wide screens and a bottom sheet on small ones. It
 * never activates a plan itself. A paid change opens a server-priced checkout,
 * hands the payer to the provider's own window, and then waits for the server
 * to say what happened — the provider's "success" callback is only a prompt to
 * ask. A downgrade is reviewed against the server's projection of the limits
 * the Portfolio would sit above, and says plainly that nothing is deleted.
 */
export function PlanChangeDialog(props: Props) {
  return props.open ? <PlanChangeFlow {...props} /> : null;
}

function PlanChangeFlow({ start, organizationId, billing, catalogue, onClose, onChanged }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // True while the provider's checkout window is in front. A modal dialog sits
  // in the top layer, above any z-index, so it steps aside rather than hiding
  // the window somebody is paying in.
  const handedOff = useRef(false);

  const [step, setStep] = useState<Step>(() =>
    start.step === "compare"
      ? { name: "compare" }
      : start.step === "review"
        ? { name: "review", plan: start.plan, interval: start.interval }
        : { name: "payment", checkout: start.checkout },
  );
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(
    start.step === "review" ? start.interval : (billing.subscription?.billing_interval ?? "monthly"),
  );
  const [method, setMethod] = useState<DigitalPaymentMethod>(billing.checkout.methods[0] ?? "mobile_money");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [popup, setPopup] = useState<"idle" | "closed">("idle");
  const [slow, setSlow] = useState(false);
  const [quote, setQuote] = useState<{ key: string; value: PlanChangeQuote } | null>(null);
  const [quoteError, setQuoteError] = useState<{ key: string; message: string } | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);

  const go = useCallback((next: Step) => {
    setError("");
    setStep(next);
  }, []);

  // Open as a modal, and give focus back to whatever opened it.
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = dialog ? holdModalInWorkspace(dialog) : undefined;
    if (dialog && !dialog.open) {
      dialog.showModal();
      aimModalFrom(dialog, opener);
    }
    // Each step is a different height; the sheet glides between them.
    const stopGliding = dialog ? glideModalHeight(dialog) : undefined;
    return () => {
      release?.();
      stopGliding?.();
      if (dialog?.open) dialog.close();
      opener?.focus({ preventScroll: true });
    };
  }, []);

  // Each step announces itself by moving focus to its heading.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step.name]);

  const requestClose = useCallback(() => {
    if (busy === null) onClose();
  }, [busy, onClose]);

  // --- following a payment --------------------------------------------------

  const settle = useCallback(
    (next: SubscriptionCheckout) => {
      if (next.status === "succeeded") {
        const renewal = next.invoice.kind === "renewal";
        setError("");
        setStep({
          name: "done",
          tone: "positive",
          title: renewal ? `${next.invoice.plan.name} renewed` : `You're on ${next.invoice.plan.name}`,
          body: [
            `${formatAmount(next.amount_minor, next.currency)} paid.`,
            next.invoice.period_end ? `Paid until ${formatDate(next.invoice.period_end)}.` : "",
          ]
            .filter(Boolean)
            .join(" "),
        });
        void onChanged();
        return;
      }
      if (next.status === "failed" || next.status === "expired" || next.status === "cancelled") {
        setStep((current) => (current.name === "payment" ? { name: "failed", checkout: next } : current));
        void onChanged();
        return;
      }
      setStep((current) =>
        current.name === "payment" && current.checkout.id === next.id ? { name: "payment", checkout: next } : current,
      );
    },
    [onChanged],
  );

  const check = useCallback(
    async (id: string, askProvider: boolean) => {
      try {
        const next = askProvider
          ? await refreshSubscriptionCheckout(organizationId, id)
          : await getSubscriptionCheckout(organizationId, id);
        settle(next);
        return next;
      } catch {
        // A missed poll is not news. The next one tries again.
        return null;
      }
    },
    [organizationId, settle],
  );

  const pendingId = step.name === "payment" ? step.checkout.id : null;
  useEffect(() => {
    if (!pendingId) return;
    setSlow(false);
    let ticks = 0;
    void check(pendingId, true);
    const timer = window.setInterval(() => {
      ticks += 1;
      // Rooomly's own record every few seconds; the provider itself less often.
      void check(pendingId, ticks % 5 === 0);
      if (ticks === 30) setSlow(true);
      if (ticks >= 120) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [pendingId, check]);

  const handOff = useCallback(
    async (checkout: SubscriptionCheckout) => {
      if (!paystackAccessCode(checkout)) return;
      const dialog = dialogRef.current;
      const resume = () => {
        if (dialog && !dialog.open) dialog.showModal();
        handedOff.current = false;
        headingRef.current?.focus({ preventScroll: true });
      };
      handedOff.current = true;
      dialog?.close();
      setPopup("idle");
      try {
        const opened = await openPaystackPopup(checkout, {
          // The provider's callback is not proof of payment. It only means
          // "ask now" instead of waiting for the next poll.
          onSuccess: () => {
            resume();
            void check(checkout.id, true);
          },
          onCancel: () => {
            resume();
            setPopup("closed");
          },
          onError: (message) => {
            resume();
            setPopup("closed");
            setError(message);
          },
        });
        if (!opened) resume();
      } catch {
        resume();
        setPopup("closed");
        setError("Secure checkout could not open. Check your connection and try again.");
      }
    },
    [check],
  );

  // --- acting ---------------------------------------------------------------

  async function pay(offer: PlanChangeQuote) {
    setBusy("pay");
    setError("");
    try {
      const checkout = await startSubscriptionCheckout(organizationId, {
        plan_code: offer.plan.code,
        billing_interval: offer.billing_interval,
        payment_method: method,
      });
      setStep({ name: "payment", checkout });
      void onChanged();
      await handOff(checkout);
    } catch (cause) {
      setError(messageOf(cause, "Checkout could not start. Nothing has been charged."));
      if (cause instanceof ApiFailure && cause.error.details?.reason === "checkout_in_progress") void onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function retry(checkout: SubscriptionCheckout) {
    setBusy("retry");
    setError("");
    const reprice = { name: "review", plan: checkout.invoice.plan.code, interval: checkout.invoice.billing_interval } as const;
    try {
      if (checkout.status !== "failed") {
        setStep(reprice);
        return;
      }
      const next = await retrySubscriptionCheckout(organizationId, checkout.id);
      if (next.status === "succeeded") {
        // The provider had already taken it: applied, not charged again.
        settle(next);
        return;
      }
      setStep({ name: "payment", checkout: next });
      await handOff(next);
    } catch (cause) {
      const reason = cause instanceof ApiFailure ? cause.error.details?.reason : undefined;
      if (reason === "payment_confirming" || reason === "paid_needs_review") {
        // The provider has, or may have, the money. Pricing the change again
        // would invite a second payment, so this stays put and says why.
        setError(messageOf(cause, "This payment is still being checked. Don't pay again."));
        void onChanged();
        return;
      }
      // A checkout that can no longer be retried is priced again from scratch.
      setStep(reprice);
      setError(messageOf(cause, "That payment could not be retried. Check the price and try again."));
    } finally {
      setBusy(null);
    }
  }

  async function checkNow(id: string) {
    setBusy("check");
    const next = await check(id, true);
    setError(next ? "" : "We could not reach Rooomly. Check your connection and try again.");
    setBusy(null);
  }

  async function cancelPayment(checkout: SubscriptionCheckout) {
    setBusy("cancel");
    setError("");
    try {
      const next = await cancelSubscriptionCheckout(organizationId, checkout.id);
      if (next.status === "succeeded") {
        settle(next);
        return;
      }
      await onChanged();
      go({ name: "compare" });
    } catch (cause) {
      setError(messageOf(cause, "The payment could not be cancelled. Try again in a moment."));
    } finally {
      setBusy(null);
    }
  }

  // What the person chose to keep fully active on the review in front of them,
  // keyed to that review so another plan's review starts from its own selection.
  const [keep, setKeep] = useState<{ key: string; value: KeepActive } | null>(null);

  async function downgrade(offer: PlanChangeQuote, keepActive: KeepActive) {
    setBusy("downgrade");
    setError("");
    try {
      // Sent only when the move goes above the plan's allowance. Everything else
      // leaves nothing to choose, and the server's fallback is never overridden
      // by a selection nobody made.
      const next = await changePlanWithoutPayment(
        organizationId,
        offer.plan.code,
        offer.resource_choice?.required ? keepActive : undefined,
      );
      await onChanged(next);
      const later = offer.effective === "period_end";
      setStep({
        name: "done",
        tone: "neutral",
        title: later ? `${offer.plan.name} starts on ${formatDate(offer.effective_at)}` : `You're on ${offer.plan.name}`,
        body: later
          ? `${offer.current_plan.name} stays on until then, and you can keep it any time before that. Your records stay safe.`
          : offer.resource_choice?.required
            ? "Your records stay safe. What you kept is fully active; everything else keeps its records and running tenancies."
            : "Your records stay safe.",
      });
    } catch (cause) {
      setError(messageOf(cause, "The plan could not be changed. Nothing has changed."));
    } finally {
      setBusy(null);
    }
  }

  // --- the review's price ---------------------------------------------------

  useEffect(() => {
    if (step.name !== "review") return;
    const key = `${step.plan}:${step.interval}`;
    let cancelled = false;
    getPlanChangeQuote(organizationId, step.plan, step.interval)
      .then((value) => {
        if (cancelled) return;
        setQuote({ key, value });
        setQuoteError(null);
      })
      .catch((cause) => {
        if (!cancelled) setQuoteError({ key, message: messageOf(cause, "This change could not be priced. Try again.") });
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, step, quoteAttempt]);

  const reviewKey = step.name === "review" ? `${step.plan}:${step.interval}` : null;
  const offer = quote && quote.key === reviewKey ? quote.value : null;
  const offerError = quoteError && quoteError.key === reviewKey ? quoteError.message : "";
  const current = currentPlanOf(billing, catalogue);

  // --- composition ----------------------------------------------------------

  let title = "Change plan";
  let subtitle: string | null = `You're on ${current.name}`;
  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (step.name === "compare") {
    body = (
      <CompareStep
        billing={billing}
        catalogue={catalogue}
        interval={billingInterval}
        onInterval={setBillingInterval}
        onChoose={(option) => go({ name: "review", plan: option.plan.code, interval: billingInterval })}
      />
    );
  } else if (step.name === "review") {
    const fallbackName = planByCode(catalogue, step.plan)?.name ?? "this plan";
    subtitle = null;
    if (!offer) {
      title = fallbackName;
      body = offerError ? (
        <div className="billing-review">
          <p className="billing-error" role="alert">{offerError}</p>
        </div>
      ) : (
        <ReviewSkeleton />
      );
      footer = offerError ? (
        <>
          <Button variant="secondary" onClick={() => go({ name: "compare" })}>Back to plans</Button>
          <Button onClick={() => setQuoteAttempt((value) => value + 1)}>Try again</Button>
        </>
      ) : null;
    } else if (offer.blocked) {
      title = fallbackName;
      const resumable = offer.blocked.code === "checkout_in_progress" ? billing.checkout.open : null;
      body = (
        <div className="billing-review">
          <div className="billing-notice" data-tone="warning">
            <p>{offer.blocked.message}</p>
          </div>
        </div>
      );
      footer = (
        <>
          <Button variant="secondary" onClick={() => go({ name: "compare" })}>Back to plans</Button>
          {resumable ? <Button onClick={() => go({ name: "payment", checkout: resumable })}>Check payment</Button> : null}
        </>
      );
    } else if (offer.direction === "downgrade") {
      title = `Switch to ${offer.plan.name}?`;
      const reviewing = reviewKey ?? "";
      const kept = keep && keep.key === reviewing ? keep.value : initialKeep(offer.resource_choice);
      // Confirmable once the choice is whole: exactly as many kept as the plan
      // runs. The review opens whole, so this only waits out a swap in progress.
      const complete = keepComplete(offer.resource_choice, kept);
      body = (
        <DowngradeReview
          offer={offer}
          billing={billing}
          catalogue={catalogue}
          error={error}
          keep={kept}
          onKeep={(value) => setKeep({ key: reviewing, value })}
        />
      );
      footer = (
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
            Keep {offer.current_plan.name}
          </Button>
          <Button
            busy={busy === "downgrade"}
            busyLabel="Confirming…"
            disabled={!complete || (busy !== null && busy !== "downgrade")}
            onClick={() => void downgrade(offer, kept)}
          >
            Confirm downgrade
          </Button>
        </>
      );
    } else {
      title = offer.direction === "renewal" ? `Renew ${offer.plan.name}` : `Upgrade to ${offer.plan.name}`;
      body = (
        <PaidReview
          offer={offer}
          billing={billing}
          catalogue={catalogue}
          method={method}
          onMethod={setMethod}
          error={error}
        />
      );
      footer = billing.checkout.available ? (
        <>
          <Button variant="secondary" onClick={() => go({ name: "compare" })} disabled={busy !== null}>
            Back
          </Button>
          <Button busy={busy === "pay"} busyLabel="Opening secure checkout…" onClick={() => void pay(offer)}>
            Pay {formatAmount(offer.amount_minor, offer.currency)}
          </Button>
        </>
      ) : (
        <Button variant="secondary" onClick={() => go({ name: "compare" })}>Back to plans</Button>
      );
    }
  } else if (step.name === "payment") {
    const checkout = step.checkout;
    title = "Confirming payment";
    subtitle = `${checkout.invoice.plan.name} · ${formatAmount(checkout.amount_minor, checkout.currency)}`;
    body = (
      <div className="billing-status" aria-live="polite">
        <span className="billing-spinner" aria-hidden="true" />
        <p className="billing-status-title">
          {popup === "closed" ? "The checkout window was closed" : "Waiting for the payment to be confirmed"}
        </p>
        <p className="billing-status-body">
          {popup === "closed"
            ? "If you approved the payment, it will be confirmed here shortly. Your plan has not changed yet."
            : slow
              ? "This is taking longer than usual. You can close this window — your plan changes as soon as the payment is confirmed."
              : "Finish paying in the secure checkout window. This updates on its own."}
        </p>
        {error ? <p className="billing-error" role="alert">{error}</p> : null}
      </div>
    );
    footer = (
      <>
        <Button variant="quiet" busy={busy === "cancel"} busyLabel="Cancelling…" disabled={busy !== null && busy !== "cancel"} onClick={() => void cancelPayment(checkout)}>
          Cancel payment
        </Button>
        <Button variant="secondary" busy={busy === "check"} busyLabel="Checking…" disabled={busy !== null && busy !== "check"} onClick={() => void checkNow(checkout.id)}>
          Check again
        </Button>
        {paystackAccessCode(checkout) ? (
          <Button variant={popup === "closed" ? "primary" : "secondary"} disabled={busy !== null} onClick={() => void handOff(checkout)}>
            Continue payment
          </Button>
        ) : null}
      </>
    );
  } else if (step.name === "failed") {
    const checkout = step.checkout;
    title = checkout.status === "expired" ? "Checkout expired" : "Payment not completed";
    subtitle = null;
    body = (
      <div className="billing-status">
        <span className="billing-result-mark" data-tone="critical" aria-hidden="true">
          <X size={28} />
        </span>
        <p className="billing-status-title">You&apos;re still on {current.name}</p>
        <p className="billing-status-body">
          {checkout.status === "expired"
            ? "The payment window closed before a payment was confirmed. Start again to see the current price."
            : checkout.failure_message || "The payment was not completed, so nothing changed."}
        </p>
        {error ? <p className="billing-error" role="alert">{error}</p> : null}
      </div>
    );
    footer = (
      <>
        <Button variant="secondary" disabled={busy !== null} onClick={() => go({ name: "compare" })}>
          Choose another plan
        </Button>
        <Button busy={busy === "retry"} busyLabel="Starting…" onClick={() => void retry(checkout)}>
          Try again
        </Button>
      </>
    );
  } else {
    title = step.title;
    subtitle = null;
    body = (
      <div className="billing-status">
        <span className="billing-result-mark" data-tone={step.tone} aria-hidden="true">
          <svg className="billing-check" width="30" height="30" viewBox="0 0 24 24" fill="none">
            <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="billing-status-body" role="status">{step.body}</p>
      </div>
    );
    footer = <Button onClick={onClose}>Done</Button>;
  }

  return (
    <dialog
      ref={dialogRef}
      className="billing-dialog"
      aria-labelledby="billing-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event) => {
        // Escape goes through the same guard as the close button, whichever
        // element inside the dialog has focus — including while a payment is
        // starting, when it must not dismiss anything.
        if (event.key === "Escape") {
          event.preventDefault();
          requestClose();
        }
      }}
      onClose={() => {
        // `close` is dispatched after the fact, so by the time it arrives the
        // dialog may already be open again — reopened after handing off to the
        // provider, or remounted by React's development double-render. Only a
        // dialog that is still closed was actually closed.
        if (!handedOff.current && !dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
    >
      <div className="billing-dialog-panel" data-step={step.name}>
        <header className="billing-dialog-head">
          {step.name === "review" ? (
            <button
              type="button"
              className="billing-dialog-icon"
              onClick={() => go({ name: "compare" })}
              disabled={busy !== null}
              aria-label="Back to all plans"
            >
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
          ) : null}
          <div className="billing-dialog-titles">
            <h2 id="billing-dialog-title" ref={headingRef} tabIndex={-1}>
              {title}
            </h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="billing-dialog-icon"
            onClick={requestClose}
            disabled={busy !== null}
            aria-label="Close"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="billing-dialog-body" key={step.name === "review" ? `review:${reviewKey}` : step.name}>
          {body}
        </div>
        {footer ? <footer className="billing-dialog-foot">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

function CompareStep({
  billing,
  catalogue,
  interval,
  onInterval,
  onChoose,
}: {
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  interval: BillingInterval;
  onInterval: (interval: BillingInterval) => void;
  onChoose: (option: PlanOption) => void;
}) {
  const [everything, setEverything] = useState(false);
  const options = planOptions(catalogue, billing, interval);
  const saving = catalogueSaving(catalogue);
  const currentCode = currentPlanOf(billing, catalogue).code;

  return (
    <div className="billing-compare">
      <div className="billing-cycle" role="radiogroup" aria-label="Billing cycle" data-interval={interval}>
        {/* One raised thumb that slides between the two, rather than each
            option painting its own. */}
        <span className="billing-cycle-thumb" aria-hidden="true" />
        {(["monthly", "annual"] as const).map((value) => (
          <label key={value} className="billing-cycle-option">
            <input
              type="radio"
              name="billing-cycle"
              className="control-input"
              checked={interval === value}
              onChange={() => onInterval(value)}
            />
            <span>{intervalLabel(value)}</span>
            {value === "annual" && saving ? <small>{saving}</small> : null}
          </label>
        ))}
      </div>

      <ul className="billing-options">
        {options.map((option) => (
          <PlanCard key={option.plan.code} option={option} interval={interval} onChoose={() => onChoose(option)} />
        ))}
      </ul>

      <button
        type="button"
        className="billing-compare-toggle"
        aria-expanded={everything}
        aria-controls="billing-matrix"
        onClick={() => setEverything((value) => !value)}
      >
        {everything ? "Hide the full comparison" : "Compare every feature"}
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {everything ? <ComparisonTable catalogue={catalogue} currentCode={currentCode} /> : null}
    </div>
  );
}

function PlanCard({ option, interval, onChoose }: { option: PlanOption; interval: BillingInterval; onChoose: () => void }) {
  const { plan } = option;
  const free = isFreePlan(plan);
  const nameId = `billing-option-${plan.code.toLowerCase()}`;
  return (
    <li
      className="billing-option"
      data-current={option.isCurrent}
      data-recommended={option.recommended || undefined}
      aria-labelledby={nameId}
    >
      <div className="billing-option-intro">
        <div className="billing-option-head">
          <h3 id={nameId} className="billing-option-name">
            {plan.name}
          </h3>
          {option.isCurrent ? (
            <span className="billing-option-flag" data-kind="current">
              <Check size={14} aria-hidden="true" />
              Current plan
            </span>
          ) : option.recommended ? (
            <span className="billing-option-flag" data-kind="recommended">
              Recommended
            </span>
          ) : null}
        </div>
        <p className="billing-option-tagline">{plan.description}</p>
        <p className="billing-option-price">
          {free ? (
            <strong>{formatPrice(0, plan.currency)}</strong>
          ) : option.price !== null ? (
            <strong>
              {formatPrice(option.price, plan.currency)}
              <span> / {periodWord(interval)}</span>
            </strong>
          ) : (
            <strong className="billing-option-unoffered">Not offered</strong>
          )}
          {/* Always rendered and always one line: switching cycle changes these
              words, never the height of every card and the dialog around them. */}
          <small>{priceNote(plan, interval)}</small>
        </p>
      </div>

      <div className="billing-option-detail">
        <ul className="billing-option-limits">
          {option.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
        {option.highlights.length ? (
          <div className="billing-option-features">
            {option.inherits ? <p>{option.inherits}</p> : null}
            <ul>
              {option.highlights.map((highlight) => (
                <li key={highlight}>
                  <Check size={16} aria-hidden="true" />
                  {highlight}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* No empty slot for a plan with nothing to do: stacked on a phone, it
          reads as a missing button. */}
      {option.unavailable ? (
        <div className="billing-option-action">
          <p className="billing-option-note">{option.unavailable}</p>
        </div>
      ) : option.action ? (
        <div className="billing-option-action">
          <Button variant={option.action.kind === "upgrade" ? "primary" : "secondary"} block onClick={onChoose}>
            {option.action.label}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ComparisonTable({ catalogue, currentCode }: { catalogue: PlanCatalogue; currentCode: string }) {
  // The roles repeat what the elements already are. A phone lays this table out
  // as a grid, and the roles keep it a table to assistive technology once its
  // display is no longer a table's.
  return (
    <div className="billing-matrix-scroll" id="billing-matrix">
      <table className="billing-matrix" role="table">
        <caption className="sr-only">Everything each plan includes</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              <span className="sr-only">Capability</span>
            </th>
            {catalogue.plans.map((plan) => (
              <th key={plan.code} scope="col" role="columnheader" data-current={plan.code === currentCode}>
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        {comparison(catalogue).map((group) => (
          <tbody key={group.group} role="rowgroup">
            <tr className="billing-matrix-group" role="row">
              <th scope="rowgroup" role="rowheader" colSpan={catalogue.plans.length + 1}>
                {group.group}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.meta.key} role="row">
                <th scope="row" role="rowheader">
                  {row.meta.name}
                </th>
                {row.values.map((value) => (
                  <td key={value.code} role="cell" data-current={value.code === currentCode}>
                    {row.meta.value_type === "boolean" ? (
                      value.included ? (
                        <>
                          <Check size={16} aria-hidden="true" />
                          <span className="sr-only">Included</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">Not included</span>
                        </>
                      )
                    ) : (
                      value.text
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function PaidReview({
  offer,
  billing,
  catalogue,
  method,
  onMethod,
  error,
}: {
  offer: PlanChangeQuote;
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  method: DigitalPaymentMethod;
  onMethod: (method: DigitalPaymentMethod) => void;
  error: string;
}) {
  const target = planOptions(catalogue, billing, offer.billing_interval).find((option) => option.plan.code === offer.plan.code);
  return (
    <div className="billing-review">
      <dl className="billing-summary">
        <div>
          <dt>
            {offer.plan.name} · {intervalLabel(offer.billing_interval)}
          </dt>
          <dd>{formatAmount(offer.list_price_minor, offer.currency)}</dd>
        </div>
        {offer.credit_minor > 0 ? (
          <div className="billing-summary-credit">
            <dt>Credit for unused {offer.current_plan.name} time</dt>
            <dd>−{formatAmount(offer.credit_minor, offer.currency)}</dd>
          </div>
        ) : null}
        <div className="billing-summary-total">
          <dt>Due today</dt>
          <dd>{formatAmount(offer.amount_minor, offer.currency)}</dd>
        </div>
      </dl>

      <p className="billing-review-note">
        Covers {periodRange(offer.period_start, offer.period_end)}. Renew by {formatDate(offer.period_end)} to keep{" "}
        {offer.plan.name}.
      </p>

      {offer.direction === "upgrade" && target ? (
        <ul className="billing-gains" aria-label={`${offer.plan.name} includes`}>
          {target.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      ) : null}

      {billing.checkout.available ? (
        <fieldset className="billing-methods">
          <legend>Pay with</legend>
          {billing.checkout.methods.map((value) => (
            <Radio
              key={value}
              name="billing-payment-method"
              checked={method === value}
              onChange={(checked) => {
                if (checked) onMethod(value);
              }}
              label={paymentMethodLabel(value)}
            />
          ))}
        </fieldset>
      ) : (
        <div className="billing-notice" data-tone="warning">
          <p>Online payments aren&apos;t available right now. Nothing has been charged — try again later.</p>
        </div>
      )}

      {error ? <p className="billing-error" role="alert">{error}</p> : null}

      <p className="billing-trust">
        <LockKeyhole size={14} aria-hidden="true" />
        Paid in the provider&apos;s secure window. Your plan changes only once the payment is confirmed.
      </p>
    </div>
  );
}

function DowngradeReview({
  offer,
  billing,
  catalogue,
  error,
  keep,
  onKeep,
}: {
  offer: PlanChangeQuote;
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  error: string;
  keep: KeepActive;
  onKeep: (value: KeepActive) => void;
}) {
  const choice = offer.resource_choice;
  const rows = downgradeRows(offer, billing, catalogue);
  const target = planByCode(catalogue, offer.plan.code);
  const renewsAt = target && !isFreePlan(target) ? formatPrice(offer.list_price_minor, offer.currency) : null;
  // The chooser speaks for the limits it settles. Any other limit above the
  // plan — team members, say — is not a choice: what exists stays, more waits.
  const elsewhere = choice?.required ? rows.filter((row) => row.over && !choice.covers.includes(row.key)) : [];

  return (
    <div className="billing-review">
      {choice?.required ? (
        <KeepChooser plan={offer.plan.name} choice={choice} keep={keep} onKeep={onKeep} />
      ) : (
        <DowngradeTable offer={offer} rows={rows} />
      )}

      {elsewhere.map((row) => (
        <p key={row.key} className="billing-keep-consequence">
          {`${offer.plan.name} includes ${row.included}, and this Portfolio has ${row.used}. Everything already here stays; adding more waits until there is room.`}
        </p>
      ))}

      <div className="billing-reassure">
        <p className="billing-reassure-title">Your records stay safe</p>
        <p>
          Downgrading never deletes your properties, units, tenants, agreements, payments, or history. Resources above your new plan limits may have restricted management capabilities. Existing tenancies can continue to completion, but starting new rental activity on restricted properties requires available plan capacity or an upgrade.
        </p>
      </div>

      <p className="billing-review-note">
        {offer.effective === "period_end"
          ? `You keep ${offer.current_plan.name} until ${formatDate(offer.effective_at)}, which is already paid for. ${offer.plan.name} starts then${renewsAt ? ` at ${renewsAt} / ${periodWord(offer.billing_interval)}` : ""}${choice?.required ? ", and your choice takes effect with it" : ""}.`
          : `${offer.plan.name} starts straight away.`}
      </p>

      {error ? <p className="billing-error" role="alert">{error}</p> : null}
    </div>
  );
}

function DowngradeTable({ offer, rows }: { offer: PlanChangeQuote; rows: ReturnType<typeof downgradeRows> }) {
  // Roles restate the elements: a phone lays this table out as a grid.
  return (
    <table className="billing-downgrade" role="table">
      <caption className="sr-only">This Portfolio compared with what {offer.plan.name} includes</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">
            <span className="sr-only">Limit</span>
          </th>
          <th scope="col" role="columnheader">
            Your Portfolio has
          </th>
          <th scope="col" role="columnheader">
            {offer.plan.name} includes
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => (
          <tr key={row.key} role="row" data-over={row.over}>
            <th scope="row" role="rowheader">
              {row.name}
            </th>
            <td role="cell">{row.used}</td>
            <td role="cell">
              {row.included}
              {row.over ? <span className="billing-over">Above limit</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * What stays fully active: the properties first, then — when the ones kept hold
 * more than the plan runs — their units. It opens on the server's own selection,
 * so the documented fallback is shown, ticked, rather than applied unseen.
 */
function KeepChooser({
  plan,
  choice,
  keep,
  onKeep,
}: {
  plan: string;
  choice: ResourceChoice;
  keep: KeepActive;
  onKeep: (value: KeepActive) => void;
}) {
  const places = propertyPlaces(choice);
  const pickingProperties = propertiesNeedChoosing(choice);
  const kept = keptPropertyIds(choice, keep);
  const units = unitsOfKept(choice, kept);
  const unitRoom = unitPlaces(choice, kept);

  // Changing the properties carries the units along: ticked ones that still
  // apply stay ticked, and any room left fills in the server's order.
  const keepProperties = (property_ids: string[]) =>
    onKeep({
      property_ids,
      unit_ids: unitsFor(choice, keptPropertyIds(choice, { property_ids, unit_ids: [] }), keep.unit_ids),
    });

  return (
    <>
      {pickingProperties ? (
        <KeepSet
          name="billing-keep-property"
          using={`You're using ${countLabel(choice.properties.length, "Properties")}`}
          includes={`${plan} includes ${places}`}
          question={
            places === 1
              ? "Choose the property you want to keep fully active."
              : `Choose the ${places} properties you want to keep fully active.`
          }
          places={places}
          options={choice.properties.map((property) => ({
            id: property.id,
            label: property.title,
            note: keepPropertyNote(property),
          }))}
          chosen={keep.property_ids}
          onChoose={keepProperties}
          consequence={propertyConsequence(choice)}
        />
      ) : null}
      {unitsNeedChoosing(choice, kept) ? (
        <KeepSet
          name="billing-keep-unit"
          using={
            pickingProperties
              ? `${kept.length === 1 ? "The property you keep has" : "The properties you keep have"} ${countLabel(units.length, "Units")}`
              : `You're using ${countLabel(units.length, "Units")}`
          }
          includes={`${plan} includes ${unitRoom}`}
          question={
            unitRoom === 1
              ? "Choose the unit you want to keep fully active."
              : `Choose the ${unitRoom} units you want to keep fully active.`
          }
          places={unitRoom}
          options={units.map((unit) => ({
            id: unit.id,
            label: unit.label,
            note: [kept.length > 1 ? unit.propertyTitle : "", unit.running ? "Tenancy in progress" : "No tenancy in progress"]
              .filter(Boolean)
              .join(" · "),
          }))}
          chosen={keep.unit_ids}
          onChoose={(unit_ids) => onKeep({ ...keep, unit_ids })}
          consequence={unitConsequence(choice, kept)}
        />
      ) : null}
    </>
  );
}

/** One question in the chooser: what the plan includes, the options, and what happens to the rest. */
function KeepSet({
  name,
  using,
  includes,
  question,
  places,
  options,
  chosen,
  onChoose,
  consequence,
}: {
  name: string;
  using: string;
  includes: string;
  question: string;
  places: number;
  options: Array<{ id: string; label: string; note: string }>;
  chosen: string[];
  onChoose: (ids: string[]) => void;
  consequence: string;
}) {
  // At the limit, the rest wait: a swap starts by unticking one.
  const atLimit = chosen.length >= places;
  return (
    <section className="billing-keep">
      <div className="billing-keep-usage">
        <p className="billing-keep-using">{using}</p>
        <p className="billing-keep-includes">{includes}</p>
      </div>
      {places > 0 ? (
        <fieldset className="billing-keep-set">
          <legend className="billing-keep-title">{question}</legend>
          {places > 1 ? (
            <p className="billing-keep-hint" aria-live="polite">
              {chosen.length} of {places} chosen
            </p>
          ) : null}
          <ul className="billing-keep-list">
            {options.map((option) => {
              const checked = chosen.includes(option.id);
              return (
                <li key={option.id}>
                  {places === 1 ? (
                    <Radio
                      name={name}
                      checked={checked}
                      onChange={(on) => {
                        if (on) onChoose([option.id]);
                      }}
                      label={option.label}
                      note={option.note}
                    />
                  ) : (
                    <Checkbox
                      checked={checked}
                      disabled={!checked && atLimit}
                      onChange={(on) => onChoose(on ? [...chosen, option.id] : chosen.filter((id) => id !== option.id))}
                      label={option.label}
                      note={option.note}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
      {consequence ? <p className="billing-keep-consequence">{consequence}</p> : null}
    </section>
  );
}

function ReviewSkeleton() {
  return (
    <div className="billing-review" aria-hidden="true">
      <span className="skeleton billing-skeleton-block" />
      <span className="skeleton billing-skeleton-line" />
      <span className="skeleton billing-skeleton-line billing-skeleton-short" />
    </div>
  );
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiFailure ? cause.error.message : fallback;
}
