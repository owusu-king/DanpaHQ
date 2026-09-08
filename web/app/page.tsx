import type { Route } from "next";
import Link from "next/link";
import { ArrowUpRight, Building2, FileCheck2, KeyRound, Receipt, ShieldCheck } from "lucide-react";

import { EntryRedirect } from "@/components/EntryRedirect";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/* What each level of checking actually means. This is where somebody decides
   whether to trust the word "verified" at all, so all three are named rather
   than collapsed into one reassuring badge. */
const CHECKS = [
  { icon: ShieldCheck, title: "Phone verified", body: "The person controls the registered phone number." },
  { icon: FileCheck2, title: "Identity verified", body: "A reviewer or approved provider confirmed who the person is." },
  { icon: Building2, title: "Property verified", body: "The person's authority for that exact property was reviewed." },
] as const;

const STEPS = [
  {
    art: "/img/illus-search.svg",
    title: "Browse freely",
    body: "Search by place, price and property type. Open a shared listing link straight away — no account, no wall.",
  },
  {
    art: "/img/illus-verify.svg",
    title: "See exactly what was checked",
    body: "Every mark names the thing it covers and the day it was decided. A check with no date tells you nothing.",
  },
  {
    art: "/img/illus-keys.svg",
    title: "Move in on a record",
    body: "Viewings, applications and the agreement all live on one record for the unit you are renting.",
  },
  {
    art: "/img/illus-receipt.svg",
    title: "Pay and keep the proof",
    body: "Rent goes through the record, and every payment leaves a receipt both sides can hold up later.",
  },
] as const;

const PROVIDER_POINTS = [
  "List a property once its ownership or agency authority is reviewed.",
  "Take viewings, applications and rent through one record per unit.",
  "Every payment leaves a receipt both sides can hold up later.",
] as const;

const FAQ = [
  {
    q: "Do I need an account to look around?",
    a: "No. Search, filters and every listing page are open. An account is only needed when you want to save a place, contact a provider, apply, or list a property of your own.",
  },
  {
    q: "What does “verified” actually cover?",
    a: "Whatever the mark says, and nothing more. Phone means the number was proved. Identity means a reviewer or approved provider confirmed the person. Property means their authority over that exact address was reviewed. Each one carries the date it was decided.",
  },
  {
    q: "Are my documents shown to anyone?",
    a: "No. Identity and ownership evidence is used for review only. It never appears on a listing, and it is never shown publicly.",
  },
  {
    q: "How do I list a property?",
    a: "Start the provider flow and submit the property for review. Once its ownership or agency authority is approved, every listing you publish from it carries that authority.",
  },
] as const;

const SECTION = "px-5 sm:px-8 lg:px-12";
const SHELL = "mx-auto w-full max-w-[76rem]";
const KICKER = "text-xs font-bold tracking-[0.11em] text-brand uppercase";
const H2 = "font-display text-[clamp(2rem,4vw,3.25rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance";

export default function Page() {
  return (
    <>
      <EntryRedirect />
      {/* A div, not a <main>. AppShell already wraps every public route in
          `<main id="main">`, so a second one here would nest one landmark
          inside another — invalid HTML, and two "main" landmarks for a screen
          reader. `lp-light` supplies the green blooms the white fades up out
          of. */}
      <div className="lp-light bg-background text-foreground">
        {/* --- hero ------------------------------------------------------- */}
        <section className={cnx(SECTION, "relative pt-10 pb-4 lg:pt-16")}>
          <span aria-hidden="true" className="lp-wash" />

          <div className={cnx(SHELL, "relative text-center")}>
            <Reveal y={12}>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
                Verified rentals across Ghana
              </span>
            </Reveal>

            <Reveal delay={0.06}>
              <h1 className="lp-headline mx-auto mt-7 max-w-[16ch] font-display text-[clamp(2.75rem,6.2vw,4.75rem)] leading-[1.02] font-extrabold tracking-[-0.04em] text-balance">
                Find a place you can actually trust
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="mx-auto mt-6 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
                Verified rentals from verified owners and authorized agents — with every
                check named and dated.
              </p>
            </Reveal>

            {/*
              Two journeys, and only one of them needs an account. "Find a
              property" goes straight to search as an anonymous visitor — no
              session, no tenant role, no workspace. Listing carries the chosen
              workspace through sign-in so the backend can put the person in the
              experience they asked for.
            */}
            <Reveal delay={0.18}>
              <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-14 rounded-full bg-brand px-8 text-base text-brand-foreground hover:bg-brand/90"
                >
                  <Link href="/rentals">Find a property</Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  className="h-14 rounded-full bg-secondary px-8 text-base text-secondary-foreground hover:bg-secondary/90"
                >
                  <Link href={"/sign-in?workspace=provider" as Route}>List your property</Link>
                </Button>
              </div>
            </Reveal>
          </div>

          {/* The product, staged.
              The phone is the subject and stays sharp; what sits behind it is
              pushed back with blur and opacity so the composition has depth
              rather than being one flat picture in a box. */}
          <Reveal delay={0.22} y={32}>
            <div className={cnx(SHELL, "lp-stage")}>
              <div aria-hidden="true" className="lp-stage-aside lp-stage-aside-left">
                <p className="text-xs text-muted-foreground">Monthly rent</p>
                <p className="mt-1 font-display text-2xl font-extrabold tracking-tight tabular-nums">
                  GH₵ 2,400
                </p>
                <p className="mt-3 text-xs text-muted-foreground">East Legon · 2 bed</p>
              </div>

              <div aria-hidden="true" className="lp-stage-aside lp-stage-aside-right">
                <p className="text-xs text-muted-foreground">Rent paid</p>
                <p className="mt-1 font-display text-2xl font-extrabold tracking-tight tabular-nums">
                  GH₵ 14,400
                </p>
                <p className="mt-3 text-xs text-muted-foreground">Receipt issued · 1 Sep 2026</p>
              </div>

              <div className="lp-phone">
                <span aria-hidden="true" className="lp-phone-island" />
                <div className="lp-phone-screen">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/img/app-screen.svg" alt="The app showing a verified listing in East Legon" />
                </div>
              </div>

              <div className="lp-stage-proof">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground">
                  <ShieldCheck className="size-5" />
                </span>
                <span className="min-w-0">
                  <strong className="block text-sm font-bold tracking-tight">
                    Property ownership verified
                  </strong>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    Reviewed 12 August 2026
                  </span>
                </span>
              </div>
            </div>
          </Reveal>

          {/* The apps. Real destinations are required before these ship — see
              STORE_LINKS below. */}
          <Reveal delay={0.28}>
            <div className={cnx(SHELL, "text-center")}>
              <p className="text-sm text-muted-foreground">Take it with you</p>
              <div className="lp-stores mt-4">
                <a className="lp-store" href={STORE_LINKS.ios}>
                  <AppleMark />
                  <span>
                    <small>Download on the</small>
                    <strong>App Store</strong>
                  </span>
                </a>
                <a className="lp-store" href={STORE_LINKS.android}>
                  <PlayMark />
                  <span>
                    <small>Get it on</small>
                    <strong>Google Play</strong>
                  </span>
                </a>
              </div>
            </div>
          </Reveal>
        </section>
        {/* --- verification ----------------------------------------------- */}
        <section id="trust" className={cnx(SECTION, "bg-brand-tint/60 py-20 lg:py-28")}>
          <div className={SHELL}>
            <Reveal>
              <div className="max-w-2xl">
                <span className={KICKER}>Trust &amp; verification</span>
                <h2 className={cnx(H2, "mt-3")}>
                  &ldquo;Verified&rdquo; should mean something specific.
                </h2>
                <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                  So we never use it on its own. Every mark names what was checked, and when.
                </p>
              </div>
            </Reveal>

            <RevealGroup as="ul" className="lp-rail mt-12 lg:mt-16">
              {CHECKS.map(({ icon: Icon, title, body }) => (
                <RevealItem as="li" key={title}>
                  <span aria-hidden="true" className="lp-rail-mark" />
                  <h3 className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
                    <Icon className="size-5 shrink-0 text-brand" />
                    {title}
                  </h3>
                  <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* --- how it works ----------------------------------------------- */}
        <section id="how-it-works" className={cnx(SECTION, "py-20 lg:py-28")}>
          <div className={SHELL}>
            <Reveal>
              <div className="max-w-2xl">
                <span className={KICKER}>How it works</span>
                <h2 className={cnx(H2, "mt-3")}>Start with the home, not a registration form.</h2>
              </div>
            </Reveal>

            <RevealGroup as="ol" className="lp-steps mt-16 lg:mt-24">
              {STEPS.map((step, index) => (
                <RevealItem as="li" key={step.title}>
                  <div className="lp-step-art">
                    <span className="lp-step-n">{String(index + 1).padStart(2, "0")}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={step.art} alt="" />
                  </div>
                  <h3 className="mt-6 font-display text-xl font-bold tracking-tight">
                    {step.title}
                  </h3>
                  <p className="mt-2.5 max-w-[46ch] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* --- for providers ---------------------------------------------- */}
        <section className={cnx(SECTION, "py-20 lg:py-28")}>
          <div className={cnx(SHELL, "grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-20")}>
            <Reveal y={28}>
              <div className="overflow-hidden rounded-[28px] border border-border shadow-[0_30px_80px_-24px_oklch(0_0_0/0.75)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/img/interior.svg" alt="" className="aspect-4/3 w-full object-cover" />
              </div>
            </Reveal>

            <Reveal delay={0.08}>
              <div>
                <span className={KICKER}>For owners and agents</span>
                <h2 className={cnx(H2, "mt-3 mb-5")}>Prove it once. Let it work for you.</h2>
                <p className="leading-relaxed text-muted-foreground">
                  Tenants skip listings they cannot place. A reviewed property carries its
                  authority on every listing you publish from it.
                </p>
                <ul className="mt-7 grid gap-3.5">
                  {PROVIDER_POINTS.map((point) => (
                    <li key={point} className="flex items-start gap-3">
                      <KeyRound className="mt-0.5 size-5 shrink-0 text-brand" />
                      <span className="leading-relaxed">{point}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  size="lg"
                  className="mt-8 h-14 rounded-full bg-brand px-8 text-base text-brand-foreground hover:bg-brand/90"
                >
                  <Link href={"/sign-in?workspace=provider" as Route}>List your property</Link>
                </Button>
              </div>
            </Reveal>
          </div>
        </section>

        {/* --- questions --------------------------------------------------- */}
        <section className={cnx(SECTION, "py-20 lg:py-28")}>
          <div className={cnx(SHELL, "grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20")}>
            <Reveal>
              <div>
                <span className={KICKER}>Questions</span>
                <h2 className={cnx(H2, "mt-3")}>The things worth knowing first.</h2>
              </div>
            </Reveal>

            <Reveal delay={0.08}>
              <Accordion type="single" collapsible className="w-full">
                {FAQ.map((item) => (
                  <AccordionItem key={item.q} value={item.q} className="border-border">
                    <AccordionTrigger className="py-5 text-left font-display text-base font-bold tracking-tight hover:no-underline">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-[0.9375rem] leading-relaxed text-muted-foreground">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Reveal>
          </div>
        </section>

        {/* --- closing ----------------------------------------------------- */}
        <section id="help" className={cnx(SECTION, "relative py-20 text-center lg:py-28")}>
          <span aria-hidden="true" className="lp-wash top-auto bottom-[-12rem] h-[30rem]" />
          <div className={cnx(SHELL, "relative")}>
            <Reveal>
              <h2 className={cnx(H2, "mx-auto max-w-[20ch]")}>
                Somewhere to live, without the guesswork.
              </h2>
              <p className="mx-auto mt-5 max-w-[44ch] text-lg leading-relaxed text-muted-foreground">
                Browse without an account. Sign in only when you want to save, contact,
                apply or list.
              </p>
              <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-14 rounded-full bg-brand px-8 text-base text-brand-foreground hover:bg-brand/90"
                >
                  <Link href="/rentals">Browse verified rentals</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="h-14 rounded-full border-border bg-transparent px-8 text-base hover:bg-accent"
                >
                  <Link href="/register">
                    Create an account
                    <ArrowUpRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="mx-auto mt-16 max-w-2xl border-t border-border pt-10">
                <h3 className="flex items-center justify-center gap-2 font-display text-base font-bold tracking-tight">
                  <Receipt className="size-4.5 text-brand" />
                  Never send money because a badge looks reassuring.
                </h3>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                  Read the exact badge, inspect the listing, arrange a recorded viewing, and
                  report anything that does not match. Private identity and ownership
                  documents are never shown publicly.
                </p>
              </div>
            </Reveal>
          </div>
        </section>
      </div>
  
    </>
  );
}


/* Where the store buttons point.
 *
 * Placeholders. The Expo app in `mobile/` is real but these are not its
 * listings, and a download button that goes nowhere is worse than no button —
 * so these must be replaced with the actual store URLs before this page ships,
 * or the section removed. Kept in one named constant so that is a single edit
 * rather than a hunt through the markup. */
const STORE_LINKS = {
  ios: "#app-store-listing-pending",
  android: "#play-store-listing-pending",
} as const;

/* The two store glyphs, drawn rather than imported.
 *
 * Deliberately simple marks in the page's own style, not reproductions of
 * Apple's and Google's official badge artwork — those are trademarked assets
 * with their own usage rules, and they have to be downloaded from the
 * respective developer resources rather than redrawn. Swap these when the
 * listings are live. */
function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M16.4 12.7c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.8.8-3.6 2.1-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.7 2.2 1.1 0 1.5-.7 2.8-.7s1.6.7 2.8.7c1.2 0 1.9-1 2.6-2.1.8-1.2 1.2-2.4 1.2-2.5-.1 0-2.2-.9-2.2-3.2Z" />
      <path d="M14.2 6.2c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.7-1.1 1.7-.9 2.7 1 .1 2-.5 2.6-1.3Z" />
    </svg>
  );
}

function PlayMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M4.2 2.6c-.3.3-.5.8-.5 1.4v16c0 .6.2 1.1.5 1.4l.1.1 9-9v-.2l-9-8.7Z" opacity="0.85" />
      <path d="m16.4 15.6-3.1-3.1v-.2l3.1-3.1.1.1 3.7 2.1c1 .6 1 1.6 0 2.2l-3.8 2Z" />
      <path d="M16.5 15.5 13.3 12.4 4.2 21.4c.4.4 1 .4 1.7 0l10.6-5.9Z" opacity="0.6" />
      <path d="M16.5 8.5 5.9 2.6c-.7-.4-1.3-.4-1.7 0l9.1 9.8 3.2-3.9Z" opacity="0.45" />
    </svg>
  );
}

/** Local join, so the repeated layout strings above stay readable. */
function cnx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}
