# Design system — Daylight & Ledger

## Where it comes from

Two artefacts from the world this product lives in.

**Adinkra cloth.** Printed by pressing a carved stamp into dye and repeating it
on a registered grid. That is where the ink colour comes from — a near-black with
a green cast rather than a neutral black — and where the structure comes from:
alignment and repetition, not decoration.

**The mobile-money SMS receipt.** The most trusted commercial document in the
country is a plain monospaced text message you screenshot and keep. It is
unglamorous, tabular, and completely credible. Every amount in this product is
set in tabular mono for that reason.

The name: *daylight* because the product has to be legible in the sun on a cheap
screen, *ledger* because its job is to make a record you can hold up later.

## Palette

| Token | Value | Role |
|---|---|---|
| `ink-900` | `#101A17` | Text and headings. Adinkra dye, not neutral black. |
| `ink-500` | `#5C6B66` | Secondary text. |
| `field-50` | `#F7F6F1` | App background. Warm paper — cooler and lighter than the cream that reads as a template. |
| `field-200` | `#DFDCD1` | Hairline borders. The workhorse. |
| `kola-600` | `#0B5D4E` | Brand, primary action, **and the verified state**. |
| `harmattan-500/600` | `#D9A31E` / `#8A6408` | Pending and needs-attention only. |
| `laterite-600` | `#A93B23` | Errors and destructive actions. |
| `lagoon-600` | `#2F5E8C` | Information and outbound links. |

Brand green doubles as the verified colour deliberately. Trust is the product's
promise, so the brand colour is the colour of a check that passed.

## Type

- **Display** — Bricolage Grotesque, 24px and up only. Irregular widths give the
  product a face where a face is affordable.
- **Body** — Public Sans. Open apertures survive low-DPI panels and bright sun.
- **Money and codes** — IBM Plex Mono, tabular figures. Amounts, reference codes,
  digital addresses, receipt dates.

Two files on the critical path. The display face uses `font-display: optional`
because nothing below a heading depends on it.

## Constraints, and why

**Hairline borders, not shadows.** Soft shadows smear on the LCD panels this
product runs on and cost a repaint on scroll. Elevation exists for exactly two
things: bottom sheets and dialogs.

**Nothing rounder than 12px.** Heavy rounding is the loudest tell of a template,
and it makes dense record rows read as toys.

**48dp touch targets.** Android's minimum, not iOS's 44. Enforced in review.

**Motion is transform and opacity only, 80–320ms, halved under reduced motion.**
A 2019 Android device should not be compositing layout to show a transition.

**Contrast targets 7:1 for body text**, never below 4.5:1.

## The signature: the Stamp

Verification renders as a print mark, not a badge. Square corners, a hairline
rule down one side, and the date carried in the mark.

Every stamp states **what** was checked and **when**. A "Verified" chip with no
date invites someone to believe a two-year-old check still holds, and that is
precisely the false confidence this product exists to remove. "Not checked" is
shown as plainly as "Verified" — an absent stamp would let the interface imply
something it has not earned.

States: `verified`, `pending`, `unverified`, `expired`.

## Words

- Say what happened and what to do next. Errors do not apologise and are never
  vague.
- An action keeps its name through the whole flow: the button that says "Pay
  rent" produces a receipt that says "Rent paid".
- Name things the way a tenant would: "advance", "chamber and hall",
  "self-contained", "prepaid meter" — not "lease term configuration".
- Empty screens are invitations, not apologies.


---

# Phase 1 additions

## The onboarding sequence

Four minimum steps, in this order: **number → code → name → what are you here
to do**. Identity evidence is deliberately not part of basic account creation.

- **No email or password.** First and last name follow phone verification; legal
  identity evidence appears only when a trust-sensitive capability requires it.
- **Explicit Get Started and Log In.** Both use enumeration-resistant challenge
  responses. Log In never creates an unknown account.
- **The +233 is shown, not typed.** People type `0241234567`.
- **We say what happens next before it happens.** "We'll text you a six-digit
  code" turns waiting for an SMS from a mystery into an expectation.

## The code screen

The screen where sign-ups are lost, so it gets the most attention:

- **One hidden input behind six drawn cells.** Six real inputs break autofill,
  break paste and fight the backspace key. The cells are presentation only.
- **Autofill is wired per platform**, because the mechanisms genuinely differ
  (ADR 0014). On a cheap phone, leaving the app to read a code and coming back is
  exactly where people give up.
- **It submits itself on the sixth digit.** A "Continue" tap after the last digit
  is a step for nothing.
- **The resend timer counts down visibly and matches what the server enforces**,
  so the button never lies about being available.
- **"Wrong number? Change it" is one tap.** Mistyping the number is the commonest
  reason a code never arrives.
- **The attempt countdown is spoken aloud** — "2 tries left". Someone typing on a
  cracked screen in the sun deserves to know; an attacker learns nothing they
  could not measure.

## Trust in the interface

The Stamp carries the whole trust vocabulary, and the rules are the same on both
platforms and the web:

1. **Always what, always when.** A "Verified" chip with no date invites belief in
   a two-year-old check.
2. **"Not checked" is drawn, not omitted.** An absent stamp lets the interface
   imply a check that never happened — the exact false confidence this product
   exists to remove.
3. **Four states, never two.** `verified`, `pending`, `unverified`, `expired`.
4. **No trust score.** A single number hides which check passed and would be
   gamed the moment it mattered.
5. **The rejection note is shown verbatim.** It is written to say what to fix;
   hiding it leaves someone stuck.

## Security copy

Security messages are written for someone who is worried, not for an auditor:

- **Say what is happening, why, and for how long.** "Payouts are paused for about
  70 more hours because the number on this account changed recently. You can use
  everything else as normal."
- **Never make the user feel accused.** A hold is protection, not suspicion.
- **Repeat the one rule that matters** — we will never ask for your code — on the
  first screen, in every OTP message, and on the security screen. Repetition is
  the point.

## Reviewer interface principles

The review console is a work tool, and its design is about throughput without
carelessness:

- **Queue and case side by side.** Navigating back and forth loses the
  reviewer's place and their pace.
- **Approve and reject carry equal visual weight.** A prominent green Approve is
  a nudge, and this is the one decision that must not be nudged.
- **Waiting time is shown and turns red past a day.** Somebody is on the other
  end of every row, unable to rent until it moves.
- **Empty evidence is called out**, not left as an absence to be overlooked.

## Platform manners

Colour, type and spacing are identical on Android and iOS — they come from the
same generated tokens. Interaction is not. The full table of differences and
their reasons is in ADR 0014; the principle is that a user should not be able to
tell the app shares a codebase.

---

# Guided setup

Two records are built over several sittings rather than one form: a property and
a rentable space. Both are guided, and they are guided differently on purpose.

**A space is a wizard.** Its steps genuinely are sequential — the space has to
exist before an amenity can attach to it or a photograph has anywhere to go — so
it moves forward one step at a time.

**A property is a checklist.** The record exists from the moment it is created,
and its documents, photographs and amenities are three independent piles of work
on it. Every step is reachable in any order, because a provider holding the
indenture in an office should be able to do that one and photograph the building
on Saturday.

The order is still not arbitrary. **Details precedes Photos because it decides
what Photos asks for**: a borehole or sachet supply makes the water source a
required view, and a family compound or estate adds the compound.

Rules both follow:

- **Every step writes to the server as it completes.** Nothing is held in a
  component that a reload would lose, which is what makes "save for later" a
  link rather than a feature.
- **Status, not just position.** Each step says done, started, or untouched, and
  says it in its own words — "3 of 5 added", "With our team" — rather than a bare
  tick nobody can check.
- **Returning lands on the first thing outstanding**, not at the top. Somebody
  coming back to a half-finished record is coming back *to* the unfinished part.
- **Optional steps never count against progress.** A compound may genuinely share
  nothing, and a required step somebody cannot truthfully complete is a step they
  learn to lie to.
- **The record's own page is the journey while setup is outstanding**, and
  becomes the management view once it is not. The setup card does not linger as a
  dismissed banner; it stops being the subject.

## Both platforms, different manners

Property setup exists on web and mobile with the same five steps, derived from
the same server fields by `propertySetup.ts` — mirrored between the two the way
`verification.ts` already is, and guarded by a test that fails if the copies
drift. A provider who starts on their phone and finishes on a laptop must not be
told two different things about what is finished.

The divergence is interaction, per ADR 0014:

| | Web | Mobile |
|---|---|---|
| Step list | sticky sidebar beside the panel | above the panel, scrolls with it |
| Choosing a value | `<select>` | `Choice` pills, every option visible |
| Layout | two columns, wrapping to one under ~37rem | one column throughout |

Colour, type and spacing are identical — they come from the shared tokens.
