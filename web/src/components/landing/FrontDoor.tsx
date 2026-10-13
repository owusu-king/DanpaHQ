import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Receipt, ShieldCheck } from "lucide-react";

import { Reveal } from "@/components/motion/Reveal";

const CHECKS = [
  { icon: ShieldCheck, text: "Owners and agents verified" },
  { icon: BadgeCheck, text: "Every property reviewed" },
  { icon: Receipt, text: "A receipt for every payment" },
] as const;

/**
 * The front door itself (owner, 2026-09-29): a headline, a line of reassurance,
 * and one way in. Get Started asks how somebody will use Rooomly — tenant or
 * provider — as the first step of sign-up (owner, 2026-10-07); Sign in is for
 * those who have answered it already.
 *
 * Its own component because it is also what the sign-in modal opens over: the
 * modal belongs to this page rather than replacing it with a screen of its own.
 * The side chosen inside sign-up becomes the account type.
 */
export function FrontDoor() {
  return (
    /* A div, not a <main>: AppShell already wraps public routes in one. The
       wash is pulled up behind the floating header, as Explore does. */
    <div className="lp-light lp-door -mt-20 bg-background pt-20 text-foreground">
      <span aria-hidden="true" className="lp-wash" />

      <section className="lp-door-stage" aria-labelledby="lp-door-title">
        <Reveal y={12}>
          <p className="lp-door-eyebrow">Verified across Ghana</p>
        </Reveal>

        <Reveal delay={0.05}>
          <h1 id="lp-door-title" className="lp-door-title">
            Homes you can trust.
            <span> Property you can manage.</span>
          </h1>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="lp-door-lead">
            Rent or buy from verified owners, or run your properties, tenants and rent in one place.
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="lp-door-actions">
            {/* Get Started opens the question "How will you use Rooomly?" (owner,
                2026-10-07); the answer rides into sign-up as the account type. */}
            <Link href={"/register" as Route} className="lp-door-action is-primary">
              Get Started
              <ArrowRight aria-hidden="true" className="lp-door-arrow" />
            </Link>
            <Link href={"/sign-in" as Route} className="lp-door-action">
              Sign in
            </Link>
          </div>
        </Reveal>

        <Reveal delay={0.2}>
          <ul className="lp-door-checks" aria-label="What is checked">
            {CHECKS.map(({ icon: Icon, text }) => (
              <li key={text}>
                <Icon aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </Reveal>
      </section>
    </div>
  );
}
