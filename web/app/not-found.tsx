import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { AuthLink } from "@/components/auth/AuthDialog";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/button";

const SECTION = "px-5 sm:px-8 lg:px-12";
const SHELL = "mx-auto w-full max-w-[76rem]";
const KICKER = "text-xs font-bold tracking-[0.11em] text-brand uppercase";

export default function NotFound() {
  return (
    <div className="lp-light bg-background text-foreground flex min-h-[calc(100dvh-4.5rem)] flex-col">
      <section
        className={cnx(
          SECTION,
          "relative flex flex-1 flex-col items-center justify-center py-16 lg:py-24"
        )}
      >
        <span aria-hidden="true" className="lp-wash" />

        <div className={cnx(SHELL, "relative text-center")}>
          <Reveal y={10}>
            <span className={KICKER}>404</span>
          </Reveal>

          <Reveal delay={0.06}>
            <h1 className="lp-headline mx-auto mt-5 max-w-[16ch] font-display text-[clamp(2.5rem,5.8vw,4.25rem)] leading-[1.02] font-extrabold tracking-[-0.04em] text-balance">
              This page does not exist
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mx-auto mt-6 max-w-[42ch] text-lg leading-relaxed text-muted-foreground">
              The link may be broken, or the page may have moved. You can still
              browse verified rentals without an account.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-14 rounded-full bg-brand px-8 text-base text-brand-foreground transition-all duration-200 hover:bg-brand/90 hover:scale-[1.02] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
              >
                <Link href="/rentals">Browse verified rentals</Link>
              </Button>

              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-14 rounded-full border-border bg-transparent px-8 text-base transition-all duration-200 hover:bg-accent hover:scale-[1.02] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-2"
              >
                <Link href="/">Back to home</Link>
              </Button>
            </div>
          </Reveal>

          <Reveal delay={0.24}>
            <p className="mt-12 text-sm text-muted-foreground">
              Looking for something specific?{" "}
              <Link
                href="/rentals"
                className="font-medium text-foreground underline-offset-4 transition-colors hover:underline"
              >
                Start a search
              </Link>
              {" "}or{" "}
              <AuthLink
                view="sign-in"
                params={{ workspace: "provider" }}
                className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-4 transition-colors hover:underline"
              >
                list a property
                <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </AuthLink>
              .
            </p>
          </Reveal>
        </div>
      </section>
    </div>
  );
}

function cnx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}