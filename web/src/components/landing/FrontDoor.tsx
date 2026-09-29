import type { Route } from "next";
import Link from "next/link";
import { BadgeCheck, Receipt, ShieldCheck } from "lucide-react";

import { Reveal } from "@/components/motion/Reveal";

const CHECKS = [
  { icon: ShieldCheck, text: "Owners and agents verified" },
  { icon: BadgeCheck, text: "Every property reviewed" },
  { icon: Receipt, text: "A receipt for every payment" },
] as const;

/**
 * The front door itself: one question, asked plainly — are you looking for a
 * place, or managing one? (owner, 2026-09-29.)
 *
 * Its own component because it is also what the sign-in modal opens over: the
 * modal belongs to this page rather than replacing it with a screen of its own.
 * Each way in carries its side through sign-in (`workspace`).
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
            <Link href={"/sign-in?workspace=tenant" as Route} className="lp-door-action is-primary">
              Tenant
            </Link>
            <Link href={"/sign-in?workspace=provider" as Route} className="lp-door-action">
              Manage Property
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
