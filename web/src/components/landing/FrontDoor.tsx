import { ArrowRight, CircleHelp, Hammer, ShieldCheck } from "lucide-react";

import { AuthLink } from "@/components/auth/AuthDialog";

const CHECKS = [
  { icon: ShieldCheck, text: "Trusted and secured", href: null },
  { icon: CircleHelp, text: "How it works", href: "#how-it-works" },
] as const;

/**
 * The front door itself (owner, 2026-09-29): a headline, a line of reassurance,
 * and one way in. Get Started asks how somebody will use Danpa HQ — tenant or
 * provider — as the first step of sign-up (owner, 2026-10-07); Sign in is for
 * those who have answered it already.
 *
 * Both open the auth dialog over this page, in place (owner, 2026-10-16). Its
 * own component because an old auth address (`/sign-in` from an email) also
 * shows it behind the dialog. The side chosen inside sign-up becomes the
 * account type.
 */
export function FrontDoor() {
  return (
    /* A div, not a <main>: AppShell already wraps public routes in one. The
       wash is pulled up behind the floating header, as Explore does. */
    <div className="lp-light lp-door -mt-20 bg-background pt-20 text-foreground">
      <span aria-hidden="true" className="lp-wash" />

      <section className="lp-door-stage" aria-labelledby="lp-door-title">
        <div className="lp-door-intro">
          <p className="lp-door-eyebrow">Verified across Ghana</p>

          <h1 id="lp-door-title" className="lp-door-title">
            Homes you can trust.
            <span> Property you can manage.</span>
          </h1>

          <p className="lp-door-lead">
            Rent or buy from verified owners, or run your properties, tenants and rent in one place.
          </p>

          <div className="lp-door-actions">
            {/* Get Started opens the question "How will you use Danpa HQ?" (owner,
                2026-10-07); the answer rides into sign-up as the account type. */}
            <AuthLink view="register" className="lp-door-action is-primary">
              Get Started
              <ArrowRight aria-hidden="true" className="lp-door-arrow" />
            </AuthLink>
            <AuthLink view="sign-in" className="lp-door-action">
              Sign in
            </AuthLink>
          </div>

        </div>

        <section className="lp-door-trust" aria-label="Artisans and assurances">
          <ul className="lp-door-checks" aria-label="Artisans and assurances">
            <li className="lp-door-check-entry">
              <Hammer aria-hidden="true" />
              <AuthLink view="register" params={{ next: "/artisan" }} className="lp-door-artisan">
                Become an artisan
              </AuthLink>
            </li>
            {CHECKS.map(({ icon: Icon, text, href }) => (
              <li key={text}>
                <Icon aria-hidden="true" />
                {href ? <a href={href} className="lp-door-artisan">{text}</a> : <span>{text}</span>}
              </li>
            ))}
          </ul>
        </section>
      </section>
    </div>
  );
}
