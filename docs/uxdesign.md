# DanpaHQ design

**Reviewed:** 23 October 2026 · **Scope:** Web and Expo mobile. This is the single design reference, replacing the three earlier design documents. Current components/tokens define implementation; [ADR.md](adr.md) defines business authority. This file records durable rules, not historical progress or a claim that every screen has passed visual review.

## 1. Direction and foundations

Make finding a home, managing property and understanding a housing record feel clear, composed and credible. Premium comes from hierarchy, alignment, readable density and quick feedback. Remove repeated copy and competing containers before adding decoration. Preserve useful capability through progressive disclosure.

Use [shared tokens](../packages/design-tokens/tokens.json), not copied values. Web CSS and [native theme](../mobile/src/theme.ts) are generated: regenerate with `node packages/design-tokens/build.mjs`; add `--check` to check drift without writing files.

| Foundation | Current vocabulary / use |
|---|---|
| Ink / paper | `ink-900` **#211A15** text/actions; `field-50` **#FAF8F5** background; `field-0` white surfaces; `field-200` **#E6E0D7** dividers. |
| Accents | `gold-500` **#C08A2E** restrained emphasis; `kola-600` **#1B6B4F** verified/success and established workspace accents. Colour must retain meaning. |
| States | Harmattan for pending/attention, laterite for errors/destruction, lagoon for information. Combine colour with words/icons. |
| Type | Web: Bricolage Grotesque headings, Geist body/figures. Native body follows platform defaults. Tabular figures align amounts; mono is for references/codes, not every amount. |
| Geometry | 4px spacing base; 6–10px control radii, 16–24px media/larger surfaces, pills only where appropriate. Borders separate; shallow warm shadows establish real elevation. No universal 12px cap. |
| Input / touch | Compact visual fields and rows; retain accessible names and 48dp touch targets. Density comes from less padding/copy, not cramped text or tiny targets. |

## 2. Page and navigation composition

Lead with the page title, a short purpose statement and one primary action. Counts belong in summaries/filters, not as the entire description. Group related facts; align dates, amounts and actions consistently. Keep technical identifiers, evidence and history on demand. Property, Unit, agreement, tenancy and payment retain distinct meanings.

Desktop uses the established persistent navigation and useful multi-column space. Mobile adapts hierarchy, uses platform back behavior and keeps important actions reachable; do not squeeze a desktop layout into a narrow screen. Navigation selection needs a quiet fill/weight change or a complete intentional border, never an accidental partial green outline. Keyboard focus remains independently visible.

Search, filters and sort stay near results. Use compact toolbars; an aside is appropriate when choices fit and remain useful. Avoid long instructional copy, redundant headings and filter panels taller than their contents. Secondary filter/sort buttons can use the established green outline without a heavy fill.

<div style="break-after: page;"></div>

## 3. Current component patterns

| Area | Pattern to preserve |
|---|---|
| Provider dashboard | Thin segmented portfolio rings at rest; hover/focus emphasizes the measured sector without moving the layout. Keep labels/values readable and empty totals honest. Avoid decorative callout lines. |
| Property cards | Compact content, contained image at lower right, verification icon at upper right. Use a green verified shield and a distinct unverified symbol with accessible meaning. Avoid an extra status row, duplicated “For sale”, hover translation or oversized empty space; outline feedback is sufficient. |
| Record collections | Use the shared payment-style hierarchy for maintenance, applications and agreements: identifying fact, meaningful status/context, aligned amount/date/action. Tables are for comparison; structured rows are for scanning. |
| Enquiries | Slim counterpart/date row plus property context; no last-message preview or redundant conversation search. Selling/Buying text is green and inline only where both roles are meaningful; omit Buying for a tenant-only context. Keep thread headers and composer simple. |
| Settings | Profile, Security and Preferences use compact grouped controls and consistent action buttons. Remove redundant explanations; “Preferred name” can be a placeholder, but an accessible label is still required. Enabled phone channels use compact adjacent inputs on wide layouts; wrap cleanly on mobile. |
| Artisans | Desktop is an addressable page with a compact trade aside/search toolbar. Mobile uses one sheet with Find/Requests/Records navigation and full bottom clearance. Profiles can stay within it; application/job work replaces or leaves it rather than stacking another modal. |
| Billing / trust | Show the plan/price/usage once, with review before commitment. The server determines prices, entitlements and verified states. Show what was checked and the basis/date where useful; never imply guaranteed housing, payment protection or a trust score. |
| Property / Unit setup | Reuse creation modals for continuing setup and permitted edits. Close creation only with X; backdrop/Escape must not discard work. Creation finishes directly without a confirmation page/modal or implicit submission. Explicit verification, re-check/withdrawal and marking sold use small confirmations. Required/optional evidence labels follow backend slots; sale title documents are required, other documents optional. |
| Detail records | Show each status once; keep verification, public/private and availability distinct. Compact draft details, group amenities and use readable Unit names. Related Units wrap into responsive columns. Keep verified fields/pins locked; sale edits reuse creation controls and server-provided editable fields. |
| Public listing | Up to five distinct images: one large left, four right; fewer images never duplicate photos. Phones retain the full viewer behind the lead image. Keep the ask bar compact and Save/Share at the row's right. Apply and viewing actions share a row; use a light-green move-in summary and readable feature/utility chips rather than repeated detail cards. Provider name/role and View Profile share a row; checks stay in the profile view. |
| Location / maps | Equal-width name/locality/district fields beside a prominent map on desktop, stacked on phones. Suggestions show locality/district/region without clipped rows. Selecting a reference can position the pre-verification pin; manual text is explicitly unverified. Keep credits visible. Clear Filters resets map narrowing; only intentional map-area searches retain `bbox`. A chosen location focuses its known area; ambiguous names require a choice and unknown coordinates remain unmapped. |
| Guest discovery / chat | Explore and listing details are public. Apply/viewing/protected navigation prompt with a dismissible sign-in modal while preserving the current page. Chat opens without shifting the viewport; Continue chat resumes the tab's property-specific conversation. Never imply live AI when it is unavailable. |
| Provider workspace | Keep sidebar sections with compact Management-like navigation density. Mobile dashboard shortcuts scroll horizontally above Recent activity. Passport uses a restrained green cover, compact checks, grouped credential/documents, actual activity figures and review history; do not invent reputation. Financial report dialogs scroll their body while keeping the footer visible. |

## 4. Surfaces, feedback and responsive behavior

Use inline editing for small changes, a dialog for a bounded decision, a sheet for a focused mobile task and a page for extended navigation/work. Reuse existing primitives. One active overlay: dismissal, Escape/system Back, focus return and scroll containment must work. Do not let “Become an artisan” or another launcher float above the current sheet.

Keep the application shell stable while content loads. Use proportionate skeletons; do not paint the wrong signed-in/out shell before session resolution. A skip link is a keyboard shortcut, not a loading screen. Opening a dialog should give immediate feedback while its data loads. Avoid sidebar scrollbar flashes and layout jumps.

Every collection/form needs loading, empty, error/retry and success states. Preserve entered data and useful content on recoverable failure; disable duplicate submission and confirm meaningful completion briefly. Empty copy explains the next useful action. Errors say what failed and how to recover, without apologies or internal exceptions.

Motion serves continuity and state: use token durations (80/140/220/320ms), avoid gratuitous movement and honor reduced motion. Native sheets/modals need their own safe-area context. Include keyboard, system-bar and bottom-navigation clearance so the last row and action remain reachable.

## 5. Copy, accessibility and review

Use familiar housing language, short labels and specific actions. Remove repeated headings, helper paragraphs and decorative badges. Important safety, financial or legal information stays concise and available. UI simplification never removes backend authorization, lifecycle checks or evidence.

Review keyboard order/focus, semantic labels and control states, screen-reader names, text scaling, contrast and non-colour cues. Target 7:1 body contrast where practical, never below 4.5:1 for normal text. Check small phones, desktop, long names, missing images, large amounts and all data states; test native safe areas/gestures on devices. Visual density must not cause clipping or horizontal page overflow.

For a refinement, inspect the current journey, reuse its primitives, change the smallest coherent area and verify the affected states. Run relevant token/lint/type/contract checks and visual review; changes to navigation, authentication, financial actions or shared primitives need broader verification. Update this file when the durable design decision changes; keep test counts and temporary handoffs out of it.
