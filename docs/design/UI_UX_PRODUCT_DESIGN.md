# Danpa HQ UI/UX Product Design

**Status:** Active source of truth  
**Established:** 2026-08-24  
**Current program:** Provider Dashboard web visual architecture — awaiting user review  
**Visual system:** [Daylight & Ledger](./design-system.md)  
**Update rule:** Update this document after every major journey or durable design decision.

## Purpose

This document governs Danpa HQ's deliberate, product-wide UI/UX refinement. It
exists so design work can continue coherently across sessions without relying on
conversation history.

It is not a proposal to replace the existing product, design system, domain
architecture or frontend foundations. Danpa HQ already has working permissions,
verification, state machines, APIs, audit history, Next.js and Expo clients. The
program composes those capabilities into experiences that are easier to
understand and operate.

Before changing a journey, read this document, inspect the live implementation
and relevant domain documentation, and update the journey record when the work is
complete. Live backend rules remain authoritative.

> **Core boundary:** Backend complexity must not leak unnecessarily into the
> interface. Backend states, permissions and lifecycle distinctions remain
> authoritative; the UI presents the minimum information and actions a person
> needs at the appropriate moment. Simplifying presentation must never simplify
> or bypass business rules.

---

## 1. Product Design Vision

Danpa HQ should make Ghanaian renting and property operations feel clear,
credible and manageable. A provider should spend attention on properties,
spaces, tenants, agreements and rent—not on decoding Danpa HQ. A tenant should
spend attention on finding and securing a suitable home—not on learning a
workflow engine.

A great Danpa HQ screen feels obvious without being simplistic:

- The page's purpose is evident before the user reads the whole page.
- The most important current information is visually dominant.
- The next useful action is easy to identify.
- Supporting detail is available without competing with the task.
- Advanced, historical and exceptional information is discoverable on demand.
- Trust comes from accurate records, restrained presentation and predictable
  behavior—not decoration.
- Web feels efficient and capable; mobile feels native, focused and lightweight.
- Both platforms speak one product language without forcing identical layouts.

Danpa HQ's recognizable identity remains **Daylight & Ledger**: daylight-readable,
structured like a ledger, grounded in Ghanaian context, and credible enough to
keep as a record.

## 2. UX Problems Being Solved

Danpa HQ has accumulated valuable functionality faster than it has accumulated
composition. The refinement program addresses:

- pages that become long vertical stacks of unrelated sections;
- repeated property, verification and lifecycle information across parent and
  child screens;
- too many notices competing with normal operational content;
- several actions receiving equal prominence;
- internal state-machine distinctions appearing as excessive badges or copy;
- capabilities living where they were implemented rather than where users look;
- small actions being expanded into unnecessary pages;
- important portfolio operations being buried in a Property hierarchy;
- desktop information architecture being squeezed onto mobile;
- explanatory paragraphs compensating for weak hierarchy;
- inconsistent loading, empty, error and success handling;
- weak continuity when moving from a Property to its Unit, tenant, lease or rent
  record;
- navigation labels and groupings that can drift toward backend terminology;
- responsive layouts that technically fit but do not adapt the interaction.

Refinement must retain useful capability. The default response to density is to
organize, prioritize and disclose progressively—not delete.

## 3. Design Principles

### 3.1 Start with the user's goal

Before touching a page, write down:

```text
Why this page exists
↓
User goal
↓
Primary information
↓
Primary action
↓
Secondary actions
↓
Supporting information
↓
Advanced/on-demand information
```

If this hierarchy cannot be stated plainly, the screen is not ready to design.

### 3.2 Compose before decorating

Premium means clarity, restraint, hierarchy, consistency and low cognitive
effort. It does not mean more containers, gradients, whitespace or visual
effects.

### 3.3 Preserve truth, summarize complexity

The server owns authority, permissions, lifecycle rules and action eligibility.
Clients consume server capabilities and may summarize several technical states
into a useful operational state. The underlying distinctions remain accessible
where they matter.

### 3.4 One journey at a time

Audit, design, implement and polish one coherent journey before moving to the
next. Do not make superficial changes across dozens of pages to create the
appearance of progress.

### 3.5 Parent summarizes; child owns detail

A parent entity helps users recognize and navigate its children. A child owns
its detailed operations. Repeat information only when it materially changes the
decision being made.

### 3.6 Familiar language, domain-grade integrity

Use words tenants and providers understand. Do not expose internal terms such as
“Organization workspace” when “Portfolio” or “Property business” is accurate.
Plain language must not conceal consequences in legal, financial, destructive,
security or privacy-sensitive actions.

### 3.7 Design for real conditions

Interfaces must work on small and low-end Android devices, intermittent
connections, bright outdoor screens, long Ghanaian names and addresses, and
without precise pointer input.

### 3.8 Consistency through language, not sameness

Reuse tokens, behavior, terminology and interaction principles. Do not force
every domain into the same cards, grids or page template.

## 4. Information Architecture

Information architecture follows user mental models and task frequency rather
than Django apps, tables or bounded contexts.

### Provider model

```text
Home
├─ Properties
│  └─ Property
│     └─ Unit / Bed
├─ Tenants
│  └─ Tenant / Tenancy
│     └─ Lease
│        └─ Rent
├─ Viewings
├─ Tenancy requests
├─ Leases
├─ Updates
└─ Settings
   ├─ Account
   ├─ Portfolio / Property business
   ├─ Team
   ├─ Preferences
   └─ Archive
```

Properties owns inventory and the physical hierarchy. Tenants owns private
access, active tenancies and recurring tenant operations. Tenancy requests owns
provider review and the transition into an agreement. Related records cross-link
without duplicating ownership.

### Tenant model

```text
Home
├─ Explore
│  └─ Listing
├─ Saved
├─ Viewings
│  └─ Viewing / Check-in
├─ Applications / Tenancy requests
├─ Agreements
├─ Home / Tenancy
│  └─ Lease / Rent
├─ Updates
└─ Settings
```

### Information ownership rules

- **Properties** owns Property recognition, physical details and Unit inventory.
- **Property** summarizes its Units and owns Property-level lifecycle/detail.
- **Unit** owns space characteristics, media, availability and publication
  actions.
- **Tenants** owns portfolio-level private access, active occupancies and tenant
  operations.
- **Tenancy requests** owns public applications and private/viewing-origin
  requests from review through agreement preparation.
- **Lease** owns agreement terms, acceptance and agreement history.
- **Rent** owns obligations and payment records when that domain is implemented.
- **Viewings** owns scheduling, check-in, attendance resolution and completion.
- **Settings** owns identity, preferences, administration and archive access.

Contextual summaries and links are encouraged. Duplicate operational controls
are not.

## 5. Navigation Philosophy

Navigation must be simple, predictable and fast. It answers three questions:

1. Where am I?
2. What am I managing?
3. How do I return or move to the next related record?

Before adding an item, ask:

> How often does the user need this, where would they naturally look for it,
> and does it deserve primary navigation?

### Rules

- Primary navigation contains frequent destinations and major user goals.
- Related administration belongs in Settings secondary navigation.
- Rare actions belong in context or overflow menus, not global navigation.
- Capability-driven navigation remains authoritative; hiding a link is only a
  courtesy and never an authorization boundary.
- Workspace and Portfolio context must remain visible and distinguishable.
- Navigation labels use product language, not backend model names.
- Avoid duplicate paths that make users wonder which version is canonical.
- Preserve context across Property → Unit → Tenant/Lease transitions.
- Use breadcrumbs on web when they materially clarify a nested entity path.
- Browser back/forward must remain correct; overlays cannot corrupt route state.
- Mobile uses natural stack navigation, tabs for frequent peer destinations,
  and sheets for contextual actions. It does not reproduce the desktop rail.

### Navigation evaluation journeys

Test navigation as complete journeys, not isolated links:

- Properties → Property → Unit
- Viewings → Viewing → Check-in
- Tenants → Tenant → Lease → Rent
- Explore → Listing → Viewing → Tenancy request
- Settings → Portfolio → Team

The current capability and entry-route rules in
`docs/architecture/navigation.md` remain binding until deliberately revised.

## 6. Progressive Disclosure Rules

Every screen separates information into three layers:

### Primary — what matters immediately

- Entity identity and current operational state.
- The information needed for the page's main task.
- One primary action, when an action is available.
- A blocking problem only when it prevents that task.

### Secondary — what supports the task

- Related records, concise supporting facts and contextual navigation.
- Secondary actions that are common but not the main next step.
- A short explanation where consequences are unfamiliar.

### On demand — what must remain discoverable

- Verification evidence and detailed lifecycle history.
- Audit/history timelines.
- Rare configuration.
- Destructive or exceptional actions.
- Technical identifiers and raw state detail.

Do not render all three layers at equal prominence. Use detail pages, disclosure
sections, drawers, dialogs, sheets and overflow menus deliberately. On-demand
content must still be keyboard- and screen-reader-accessible and have a stable
way to be linked when appropriate.

## 7. Page / Modal / Drawer / Bottom-Sheet Decision Rules

| Surface | Use when | Do not use when |
|---|---|---|
| Inline | A tiny change benefits from keeping surrounding context visible | The change has broad consequences or many fields |
| Dialog (web) | A focused confirmation, short form, simple choice or destructive confirmation | Users need to compare extensive context, leave and resume, or navigate several steps |
| Drawer / side panel (web) | Inspecting secondary detail while retaining list or record context | The task is primary, legally significant or too deep for a narrow surface |
| Bottom sheet (mobile) | Contextual actions, short choices, filters or concise confirmation | Keyboard-heavy, multi-step, legal or long-form work |
| Dedicated page/screen | Substantial information, several decisions, legal/financial consequences, multi-step/resumable workflows | The action is a single small choice that interrupts navigation unnecessarily |

Dialogs and sheets must manage focus, dismissal, escape/back behavior, pending
state and failure recovery. Destructive actions require explicit confirmation
and must name the affected entity and consequence.

## 8. Action Hierarchy

Each screen should normally provide:

```text
Primary action
↓
Secondary action(s)
↓
More / overflow
```

### Rules

- One visually dominant action per task region.
- Primary action reflects the most useful currently permitted next step.
- Secondary actions use lower visual weight.
- Rare actions move to an overflow menu or on-demand detail.
- Destructive actions never compete visually with constructive primary actions.
- Do not show controls that the backend says are unavailable.
- When a blocked action is important to understand, show the next corrective
  step—not a permanently disabled mystery button.
- Keep action names stable from initiation through confirmation and result.
- Group actions by object. A Property action must not visually look like it acts
  on a Unit.
- Mobile primary actions may be sticky when the task is long and the action
  remains unambiguous.

## 9. Status Presentation Rules

The interface presents operational meaning, not a dump of state-machine fields.

For example, several authoritative backend facts may reasonably become:

```text
Verified · Available
```

while “Verification details” exposes the evidence and lifecycle distinctions.

### Rules

- Show only states relevant to the current decision.
- Prefer plain text or the existing Stamp over collections of pills.
- Use the Stamp for trust verification where **what** and **when** matter.
- Do not use a badge for every boolean or enum.
- Never invent a status in the client that contradicts server capabilities.
- Use one compact state summary near the entity identity.
- Put detailed verification, moderation and lifecycle history on demand.
- Use color as reinforcement, never as the only signal.
- Reserve warning and error presentation for conditions requiring attention.
- Do not repeat the same status explanation in the header, notice and section.

## 10. Content & Product-Copy Rules

- Say what happened and what the user can do next.
- Use short operational labels during routine management.
- Remove paragraphs that merely restate a visible state.
- Use sentence case and consistent product terminology.
- Prefer “Property,” “Unit,” “Portfolio,” “Team,” “Agreement” or other
  user-facing terms already established by the product.
- Avoid internal terminology unless it is genuinely useful to an expert user.
- Use Ghanaian housing language accurately: chamber and hall, self-contained,
  advance, prepaid meter and relevant address conventions.
- Longer copy is appropriate for legal agreements, money, security, privacy,
  destructive actions, unusual consequences and unfamiliar workflows.
- Errors identify the problem and recovery path. They do not apologize vaguely.
- Empty states invite a meaningful next action without marketing prose.
- Confirmation copy names the entity and outcome.
- Never imply certainty the product has not verified.
- Avoid blame in disputed viewing, tenancy or trust situations.

### 10.1 Low reading density — a permanent rule

Danpa HQ must not feel like reading software. The target is **glance → understand
→ act**, not read → read more → understand the system → find the action.

Treat every visible word as having a cost. Before keeping any subtitle,
paragraph, Notice, helper text or description, ask:

> Would removing this leave the user meaningfully less able to understand or
> safely perform the task?

If no, remove it. Do not shorten it, and do not replace it with a card.
Whitespace beats unnecessary information; hierarchy and interaction design carry
the meaning instead.

**A row that names its destination needs nothing under it.** `Rent ›` is
complete. `Rent — view and manage all of your rental payments and outstanding
tenant obligations` is the failure this rule exists to prevent.

**Say the state, not the consequence of the state.** `Room 4 · Occupied` beats a
paragraph explaining that some management actions are unavailable during a
tenancy — the interface shows that by not offering them.

**Longer copy is earned, not default.** It is justified for money, legal or
lease consequences, security and privacy, destructive or irreversible actions,
unusual errors, and unfamiliar workflows where misunderstanding creates real
risk. Even there, write it short. Everything else is passive noise:

- permanent informational Notices
- explanatory paragraphs and repetitive subtitles
- helper text describing what an obvious button does
- duplicated status, duplicated entity information
- backend terminology surfaced for its own sake

**Density belongs to depth.** A collection shows enough to recognize, find and
compare. A detail page explains the entity and its actions. Evidence,
verification history, audit trails and advanced settings live deeper, or behind
deliberate disclosure. The further in someone goes, the more detail they have
asked for.

This rule is enforced where it is cheap to: the mobile Home contract test parses
every literal caption on the screen and fails any that is explanatory rather than
a fact, allowing only the money qualifiers and the empty-state invitation.

### 10.2 Operational intelligence — Glance → Understand → Act

An operational surface may use richer visual language when the visual answers a
real question faster than prose or a flat row. Danpa HQ is not required to look
like a paper record everywhere; Daylight & Ledger is a foundation for credible
operational intelligence, not a ban on visual meaning.

Use this sequence:

```text
Glance    → What is the current position?
Understand → Why does it matter, and what changed the meaning?
Act       → Where do I resolve or continue it?
```

#### Metrics and widgets

- A KPI, metric, gauge or widget must answer a named provider or tenant question.
  It is not earned merely because a number exists.
- Prefer a few differently composed operational regions over an endless grid of
  identical stat cards. Visual sameness falsely says every signal has equal
  urgency and meaning.
- Pair each actionable metric with the workflow that owns its resolution. A
  count without a destination is useful only when it is genuinely descriptive,
  such as a portfolio occupancy ratio.
- Qualify scope and time in the same region as the number. `Confirmed received ·
  all time` is true; `collected this month` is prohibited until the backend owns
  that period aggregation.
- Empty metrics do not automatically render as zero tiles. A new Portfolio gets
  a beginning; an established Portfolio gets a concise success or quiet state.

#### Data visualization

- Use a ring, bar, pipeline, timeline or chart only when its geometry makes a
  relationship materially easier to understand than a number alone.
- Rings are appropriate for one bounded part-to-whole relationship such as
  occupied Units out of active Units. They are not decorative progress circles.
- Progress bars are appropriate for readiness against a known denominator.
  They must state the numerator and denominator in text.
- Pipelines are appropriate for a small ordered lifecycle such as Draft → Sent
  → Active. They summarize; the owning list remains the place to inspect records.
- Time-series charts require authoritative historical buckets. Never draw a
  trend from current totals, recent-record samples or client-side inference.
- Interactive charts expose the same period values to pointer and keyboard:
  restrained crosshair, active point, precise tooltip and textual totals. A
  chart-library default is not a finished Danpa HQ visualization.
- Every visual has a textual equivalent for accessibility, and color is always
  reinforced by label, icon, value or position.

#### Semantic color and hierarchy

- Brand kola remains the structural foundation and the verified/success color.
  Deep kola or ink surfaces may create a high-trust focal region when contrast
  remains compliant.
- Harmattan means pending or needs attention. Laterite means overdue, failed,
  destructive or other genuine financial/operational risk. Lagoon means
  informational or scheduled context. Do not rotate colors for variety.
- Money uses the mono amount face and stronger numeric hierarchy. Portfolio
  identity and major operational statements may use the display face. Labels
  remain compact; body typography carries explanation only when needed.
- Icons reinforce a stable concept and must come from the established icon
  language. They never replace an accessible name or become oversized artwork.

#### Interaction and motion

- Every interactive widget provides immediate hover, focus and pressed feedback.
  The affordance should indicate destination or state change without turning the
  whole surface into a button when only one part is actionable.
- Use the shared 80–320ms scale. Metric and gauge transitions may reveal a new
  authoritative value with transform or opacity; they must not count through
  invented intermediate business states.
- Motion explains arrival, selection, expansion or updated value. Continuous,
  ambient and decorative dashboard animation is prohibited.
- Reduced motion removes reveals and transforms while retaining the final value,
  hierarchy and interaction feedback.

#### States and responsive composition

- Loading skeletons match the final dashboard geometry so rings, finance blocks
  and action regions do not jump into place.
- An all-clear state should feel positive and compact, not occupy the same visual
  weight as an urgent queue.
- Desktop may place related signals side by side and expose part-to-whole or
  lifecycle relationships. Mobile reorders the questions into a single thumb-
  scannable narrative; it does not shrink the desktop grid.
- Platform parity means the same facts, semantics, destinations and priorities,
  not the same number of columns or card geometry.

## 11. Desktop Design Principles

- Use the existing authenticated Portal shell and capability-derived navigation.
- Treat desktop as a work surface: dense enough for scanning, restrained enough
  for comprehension.
- Use lists and tables when comparing repeated operational records; do not turn
  every row into a large card.
- Page headers orient. They do not market a section users already entered.
- Use a clear content measure and alignment grid, but allow wider tables and
  media regions when the task requires them.
- Prefer hairline rules and section rhythm over shadows and nested cards.
- Keep the primary action visible near the page/entity header when appropriate.
- Use breadcrumbs or compact contextual links for nested records.
- Preserve list position and filters when inspecting detail in a suitable drawer
  or returning from a page.
- Settings may use a persistent secondary navigation because its modules are
  peer destinations within one product area.
- Hover states supplement focus and pressed states; they never carry unique
  information.
- Use available width to show relationships—occupancy beside inventory,
  attention beside financial position, or lifecycle stages in sequence—rather
  than stretching phone cards into wide empty rectangles.
- Dark or tinted focal regions are permitted when they create purposeful
  hierarchy, retain Daylight & Ledger contrast and do not become a generic
  gradient dashboard treatment.

### 11.1 Provider global header

The Provider header is workspace chrome, not a second page heading. A page name
already visible in navigation or content must not be repeated in the global
bar. Its stable reading order is:

```text
Portfolio context → centred Portfolio search → Updates → Account
```

- Use equal flexible outer tracks so search is geometrically centred, not merely
  placed after the left control.
- Portfolio context may show the active name on wide screens and collapse to a
  labelled icon at tablet widths. Its popover remains the place to switch scope.
- Updates and Account use distinct, equal 44px targets with visible hover,
  pressed and keyboard-focus states. Unread meaning is never communicated by
  color alone.
- A quiet Kola-tinted ground, semantic focus ring and restrained icon wells may
  establish hierarchy; the bar must not become a row of pale floating pills.
- Search yields before navigation and identity at constrained widths. Do not
  compress it into an unusable token field.
- Keep provider identity in this shared header on every Provider page. Do not
  duplicate the same account control in the rail.
- This rule changes global chrome only. Individual content headers still own
  page context, breadcrumbs and contextual actions where the task needs them.

## 12. Mobile Design Principles

- Design the mobile task independently; do not squeeze the desktop result.
- Keep frequent destinations thumb-reachable and avoid excessive tab counts.
- Use focused screens with clear native back behavior.
- Use bottom sheets for short contextual action menus and choices.
- Use sticky primary actions only when they remain contextually unambiguous.
- Respect keyboard avoidance, autofill and interrupted/resumed workflows.
- Preserve state during temporary connection loss and clearly indicate stale
  data.
- QR scanning is camera-first; manual codes remain a reliable fallback.
- Avoid dense multi-column comparisons. Convert them into scan-friendly rows or
  staged detail.
- Meet the existing 48dp minimum touch target.
- Back and close glyphs sit inside a true centred 44×44 header control with
  additional hit slop. Never create optical placement with asymmetric padding;
  it shifts Ionicons visibly off-axis in iOS custom headers.
- Use restrained rendering and transform/opacity motion for low-end Android
  performance.
- Support small displays and large text without clipped actions or inaccessible
  content.
- The shared mobile type scale has three bounded widths: regular above 375dp,
  compact through 375dp, and narrow through 340dp. Compact scaling reduces
  display, title, amount, body and supporting text proportionally; it never uses
  a whole-screen transform, changes touch-target size, disables system font
  scaling or overrides a component's deliberate fit adjustment.
- Settings becomes a navigable list of focused screens, not a miniature desktop
  sidebar.
- On operational Home surfaces, order regions by decision value. Combine related
  Portfolio counts into one pulse or summary before introducing separate cards.
- Keep rings and gauges compact enough to share a phone row with the statement
  they explain; the number and its plain-language meaning remain visible without
  interaction.
- The shell is Danpa HQ green. The band behind the status bar and every header,
  tab or pushed, is kola (`kola-600`), with titles and the way back in white and
  header controls as translucent white wells; the create action is a solid white
  disc with a kola glyph. Pages stand on warm ivory (`field-50`); cards, sheets,
  inputs and the tab bar are paper (`field-0`), separated by hairlines. Dark ink
  and gold are not shell colours: the tokens' ink chrome and gold accent read as
  dark and brown, and the product owner chose green (2026-09-14). `field-100` is
  a quiet fill, never a page.
- The two Homes are dashboards and stand on their own ground: `kola-600` let
  down into `field-50` — 14% under the header, 10% mid-page, 6% where the list
  runs out — with a faint white sheen across the top corner and a pool of green
  low on the far side, painted once behind the scroller so content moves over a
  still ground. It is a tone, never a raw green: each step stays under 20%
  saturation, a heading on it reads at 13.9:1 and an eyebrow (`ink` at 70%) at
  5.9:1. Cards on it are white with a hairline edge and a shadow tinted
  `kola-900` (opacity 0.04, and 0.07 on the two that carry a screen); fills inside
  a card stay warm and neutral, and the shortcuts are frosted glass rather than
  more cards. Every other tab keeps the ivory page.
- The tab bar is paper under a hairline, with a 24pt glyph over an 11pt name in
  cells at least 56pt wide and 62pt tall. The tab you are on has a pale kola
  indicator (`kola-50`, 60×32) that widens behind it, its glyph fills in deep
  kola (`kola-800`), and its name turns bold; the other tabs are outlines in a
  muted kola (`kola-900` at 72%), never a brown grey. The indicator is the bar's
  quality, not clutter — removing it made the bar poorer. Glyph and name
  crossfade on the native driver, a press springs the glyph and its indicator,
  and iOS lifts the shelf with a whisper of shadow while Android keeps the
  hairline.
- A page's name is said once, by its header. The body opens with content or one
  line of context, never an eyebrow and a title repeating the header. A page
  that names itself — Home's greeting — carries Danpa HQ's wordmark in the header
  instead of a second title. On the provider side Portfolio scope remains in the
  labelled switcher; never stack the Portfolio name above the page title. Tab
  titles use a compact bold scale (20px normally, 18px at 360px and below), a
  56/52px row, and both top and horizontal safe-area insets. Android
  edge-to-edge headers use the larger of the safe-area inset and the native
  status-bar height, so older compact devices never place controls beneath the
  clock, network or battery indicators. This contract applies equally to tab
  headers and pushed Stack screens; a page must not add a second display title
  immediately below either header.
- A bottom sheet can always be swiped away. Its handle and title row drag it,
  its body drags it from the top of its scroll, and a release past a quarter of
  its height, past 160pt or on a downward flick closes it; anything less springs
  home. It stays below the status bar, keeps its actions above the home
  indicator, and closes from the back button, the scrim, its close button and
  VoiceOver's escape.
- A filter sheet or panel asks each question in one row, with its answer on the
  same line, in the same order on the phone and the web. A range is two thumbs on
  one track that snap to the same stops, never cross, say what they mean ("From
  GH₵1,000", "Any price") and search once the dragging settles. A list is a
  dropdown with its answer ticked that closes on a choice and is never open beside
  another. On the phone it opens in place; on the web it floats from its button,
  below it when it fits and above when there is more room, because the panel
  scrolls and would clip it. A few short answers are a segmented control, and on
  or off is a switch. A set answer tints its field in kola, and choosing changes
  colour, never size. Where a web panel has room for two 17rem columns, the rows
  pair up two to a line under the full-width rent range. Explore's phone sheet
  opens 588pt tall on a 390×844 screen; the web panel is 640×403px in a 1280×860
  window, and a one-column sheet 611px tall at 390px, with nothing to scroll.
- A launch, a sign-in and a sign-out show Danpa HQ's name on the green chrome until
  authentication, role and route are all resolved. Never a spinner, and never
  the signed-out or another workspace's version of a screen first.

## 13. Responsive Design Principles

Responsiveness is an information and interaction decision, not only CSS
wrapping.

- Start from task priority, then decide what changes at each width.
- Preserve the same meaning and capabilities across platforms while adapting
  composition and interaction.
- Collapse secondary columns before shrinking readable content.
- Convert dense desktop tables to purposeful mobile rows; retain key comparison
  fields and disclose the rest.
- Move contextual action groups into a sheet or overflow on small screens.
- Avoid horizontal scrolling for ordinary content. Allow it only for inherently
  tabular comparisons when a better transformation would destroy meaning.
- Test at minimum small mobile, large mobile, tablet, narrow desktop and wide
  desktop—not just framework breakpoints.
- Test long names, addresses, currency values, translations/expanded copy and
  the largest supported text size.
- Ensure focus order follows the visual order after responsive rearrangement.
- Do not hide required information simply to make a layout fit.

The existing shared breakpoints and token source remain authoritative; journey
work may introduce component-specific behavior using those tokens.

## 14. Settings Architecture

Settings is a product area, not one large page and not a collection of unrelated
links in primary navigation.

### Web

Use a Settings shell with grouped secondary navigation and a focused content
panel. Proposed information architecture, subject to validation against live
capabilities:

```text
Settings
├─ Account
│  ├─ Profile
│  ├─ Security and signed-in devices
│  ├─ Notifications
│  └─ Privacy
├─ Portfolio / Property business
│  ├─ Portfolio details
│  ├─ Activities and preferences
│  ├─ Team
│  └─ Property assignments
├─ Records
│  └─ Archive
└─ Billing                         (future; only when Payment Core exists)
```

Only show modules the current account can access. Team may remain reachable from
an operational context if frequent use proves it deserves that path, but there
must be one canonical ownership and no contradictory duplicate settings.

**Built — 2026-08-24.** The implemented IA is Account (Profile, Security,
Notifications, Verification) and Portfolio (Team, Archive), the second shown to
providers only. Privacy and Billing are absent because nothing backs them. The
mobile hierarchy is the same index as focused native screens.

Portfolio and Team briefly became primary rail destinations during their own
refinements. Both moved to Settings on user review, and the Portfolio page was
then removed outright: Team is the surface a provider actually needs, and a
personal Portfolio's name and activities are not something they set. See UX-015
and UX-016.

Settings content should use section rules and forms rather than a dashboard of
cards. Save behavior must be clear: immediate for isolated toggles when safe,
explicit for grouped forms, and always recoverable on failure.

### Mobile

Translate the same hierarchy into focused native-style screens:

```text
Settings
→ Account
→ Security
→ Notifications
→ Portfolio
→ Team
→ Privacy
→ Archive
```

Each row communicates destination and relevant current value where useful. A
screen owns one coherent concern. Native back navigation returns to the correct
Settings level. Do not place a permanent settings sidebar on mobile.

### Plan and billing

Built. Web at `/settings/billing` beside Team, mobile under More → Plan &
billing, and a management console section at `/management/billing`.

**Redesigned with subscription checkout — 11 September 2026.** The page
answers seven questions without study, in this order: what plan, what it costs,
how long it is paid for, how much of it is in use, what it includes, how to
change it, and what has been paid to Danpa HQ. Glance → Understand → Act.

**One plan surface, two zones, one attention strip.** The plan's name, tagline,
price and a single standing line lead; the three live meters sit beside them on
wide screens and under them on narrow ones. An attention strip appears inside
the same surface only when a person is needed — renewal due, past due, a payment
pending, a change about to happen — and it carries at most one action. When that
action matters most, `Change plan` steps down to a secondary button. Free, Pro
and Business are never a permanent pricing grid on the page, and the numbers are
never scattered into KPI cards.

**Standing is derived once, from server state.** `billingPresentation.standingOf`
turns the subscription into one badge, one line and at most one strip, so the
header, a notice and a section never repeat each other. Free has no badge and
says *No billing required*. An administrative grant says *Included by Danpa HQ ·
no charge*. A paid plan says *Paid until {date}* — never "Renews", because
Danpa HQ subscriptions are prepaid and nothing is charged automatically. Grace is
*Renewal due* (warning); past due is critical and says the lower limits apply,
that anything above them is restricted — never removed — and that renewing lets
it be reactivated; a scheduled downgrade or cancellation is neutral, says records
stay safe, and offers *Keep {plan}*; a pending payment is info and offers *Check
payment*. With none of those, restrictions take the strip (warning, no action):
*7 properties are above Free's limits*.

**Tone is spent sparingly.** Positive for an active plan; neutral for ending,
changing and ended; info for a pending payment; warning for grace and for meters
at 80% or full; critical only for past due and a meter above its limit. A meter
above its limit — team members after a downgrade — is a legitimate state, not an
error, and the usage note says nothing has been removed. Status is always a
word; colour only reinforces it.

**Nothing moves that the person did not move.** Content that changes height — a
cycle switch, a disclosed table, the next step — must not shift what is around
it. The page reserves its scrollbar's width (`scrollbar-gutter: stable` on
`html`), so a dialog locking the page's scroll, or a page growing past one
screen, does not jolt everything centred sideways on Windows; the dialog body
reserves its own, so a step that grows past the fold does not also narrow and
reflow. The dialog is anchored to the top of the viewport rather than
re-centred, so only its bottom edge moves. Every plan card keeps its second price
line in both cycles — the annual equivalent or the yearly alternative — so
switching cycle changes words, not the height of every card. A long chooser list
scrolls inside a fixed height on wide screens, gutter reserved; on a phone it
extends the sheet instead of nesting a scroll.

**Change plan is one dialog that becomes a bottom sheet.** Compare → review →
pay or confirm → result, in a native modal `<dialog>`: focus moves to each
step's heading and returns to the opener; Escape and the backdrop close it
except while a payment is starting. Escape is handled on the dialog itself as
well as through the browser's cancel request, so a close request the browser
declines to raise still takes the same guard. Under 640px it is a full-width
sheet with a sticky footer above the safe area, whose two actions share a line
when their labels fit and stack when they do not; under 960px the plan cards
become wide rows rather than squeezed columns. A plan with nothing to do has no
empty button slot — stacked on a phone, one reads as a missing button. Each plan
shows its price for the chosen cycle,
its three headline limits and up to four server-chosen highlights (`GET /plans/`
`highlights`, only ever capabilities the plan grants), with *Everything in
{previous}, plus* where the rung below has capabilities of its own. *Current
plan* is an ink edge and a named flag and is never offered as a purchase. A
quiet *Recommended* appears only on a rung above the current one. *Compare every
feature* discloses the full matrix. On a phone that matrix is not a table
scrolling sideways to show one plan at a time: each capability takes its own
line, its three answers sit under plan names pinned while the list scrolls, and
explicit table roles keep it a table to assistive technology once it is laid out
as a grid.

**A paid change is a server-confirmed payment.** Review shows the list price,
any credit for unused paid time, the amount due today, the period it covers and
the payment method — all from `GET billing/quote/`. *Pay {amount}* opens a
server-priced checkout; the modal steps out of the top layer so the provider's
own window is usable, and comes back to a *Confirming payment* step that polls
Danpa HQ's record and periodically asks the provider. The provider's success
callback only triggers that check. Succeeded, failed, expired and pending are
distinct steps, a failed payment says *You're still on {plan}*, and the page
re-reads billing from the server after every outcome.

**A downgrade is a review, not a warning — and above the allowance, a choice.**
Within the lower plan's limits it compares what the Portfolio runs with what that
plan includes, using the server's projection — overrides included — and says when
the change happens: at the end of the period already paid for, or straight away.
When the move would take the Portfolio above the allowance, the review leads with
the server's facts in the approved words — *You're using 8 properties* / *Free
includes 1* — and asks *Choose the property you want to keep fully active.* One
place is a set of radios; several are checkboxes that stop at the limit, with *2
of 3 chosen* beside them. When the properties kept hold more units than the plan
runs, the same question follows for their units. Under each list the consequence
is one sentence: *7 other properties will remain accessible. Existing tenancies
can continue, but new rental activity on those properties will be restricted.* A
limit the choice does not settle — team members — gets its own plain line: what
is there stays, adding more waits.

The review opens on the server's own selection — the saved choice, or the
documented fallback — so leaving it alone is shown, not implied. *Confirm
downgrade* waits for a whole choice, exactly as many as the plan runs, so the
screen never says one thing while the server fills a place another way; and a
choice is sent only when one was asked for. *Your records stay safe* always
closes the review: *Downgrading never deletes your properties, units, tenants,
agreements, payments, or history. Resources above your new plan limits may have
restricted management capabilities. Existing tenancies can continue to
completion, but starting new rental activity on restricted properties requires
available plan capacity or an upgrade.* The earlier promise that everything
stayed lettable was not true and is gone; contract tests on both clients hold
the approved words. *Keep {plan}* and *Confirm downgrade* keep their names from
review to result. On a phone each limit names itself on its own line, with what
the Portfolio has beside what the lower plan includes, so no count breaks
mid-phrase.

**Above the allowance, the page shows what is restricted and the way back.**
Meters count what runs in full and say beside the number how many more are
restricted (*1 / 1 · Limit reached · 7 restricted*): a bar reading 8 of 1 would
describe the old plan, not this one. A section, *Above your plan's limits*, lists
each restricted property or unit with its state as a word — *Winding down*
(warning; existing tenancies continue, no new rental activity) or *Read-only*
(neutral; records stay available) — and offers *Reactivate* only where the server
reports room; otherwise it says how room is made: upgrade, or archive something
fully active. Reactivating is always the provider's act, never automatic. A
restricted property's and unit's own pages carry a notice in the server's words
and stop offering *Add Unit*; the API refuses regardless.

**Records are quiet, distinct and real.** Plan, subscription, invoice and payment
stay separate concepts. Billing terms — cycle, next payment, last paid with,
billing email — exist only for a paid subscription; a Free or complimentary plan
shows none of them. Payments are invoice rows: description, period, number,
amount, status and the frozen receipt PDF, listed only when the payment reached
the provider. Plan history is a collapsed list of plain sentences. Staff reasons
written in the console never reach the customer.

**Nothing on these screens decides anything.** Prices, limits, highlights, the
ladder, who may change the plan (`viewer.can_change_plan`), which live count each
limit is measured against (`usage_for_limit`) and every standing come from the
server. No billing component contains a plan code, and the contract test fails
if one does. Every limit is re-checked on the server when something is created,
and a plan moves only when the server has confirmed the payment with the
provider. Accountants read the page and its invoices; only owners and
administrators are offered changes; anyone else sees who manages billing rather
than an error to retry.

**Unlimited is the word "Unlimited".** Never a large number. The first person to
read "999999 properties" on a billing screen learns something false about the
product, and contract tests on both clients fail if that number appears.

**On a phone, changing plan is a short journey of focused screens.** More → Plan
& billing shows the same plan surface, the restricted section and the quiet
records, stacked, and reads the server again whenever it comes back into view.
*Change plan* opens the plans — billing cycle as two pills, one card per plan
whose second price line is always present, the full matrix behind *Compare
every feature* — a plan opens its review, and a paid review hands over to the
shared secure checkout sheet on a *Payment* screen that polls the server and
ends in *You're on {plan}*, *Payment not completed* or *Checkout expired*. The
back gesture always means one step; *Done* returns to Plan & billing. The
downgrade chooser is the web's, for a thumb: whole rows to press and a mark that
keeps one size ticked or not. The rules deciding what a choice keeps and when it
can be confirmed are the same text in both clients, held by a contract test.

**Subscription billing is not rent.** It shares the Payments Core — the provider
adapter, the Paystack popup on the web and checkout sheet on mobile, webhook,
ledger and receipt pipeline — and nothing else: separate endpoints, separate
events, a separate receipt document, and no rent record is ever touched.

The console adds what support actually needs: plan beside live usage in one row,
because the first billing question is always "why can't this customer add a
property". Changing a plan there requires a reason and is recorded against the
staff member who did it — an administrative grant, never a sale.

**Refinement — 2026-09-15, product owner review (mobile).** The brief: a premium
Plan & billing page with the same functionality and less text, and no billing
history, payments or other long list laid out at once — the latest few first,
*View all* for the rest, and complete histories in a scrolling sheet.

- **The plan leads, in one glass surface.** Its rung as a glyph (from the ladder,
  never a plan code), its name, the standing badge, the price and one line of
  when. Anything that needs a person — renewal due, past due, a payment pending,
  a change about to happen, restrictions — is a tinted strip straight under that
  line with its one action, and *Change plan* is a kola pill that steps down to
  a quiet one when the strip's action leads. Usage is the same surface's quieter
  second zone: each limit's count, a thin bar only where there is a limit, and its
  note. The plan's description, the shouted CURRENT PLAN label and the full-width
  buttons are gone.
- **Latest first, the rest one tap away.** Payments show the three most recent,
  newest first whatever order they arrive in; plan history its two latest events;
  *Above your plan's limits* its first three places. Each panel ends in *View all
  7 payments*, *View all 8 events* or *View all 5 restricted*, which opens every
  one in the shared bottom sheet — it scrolls, swipes away and returns to the same
  place on the page. The payments sheet leads with a count and what was paid
  (*7 payments · GH₵534.00 paid*) when every payment is in one currency.
- **Each row stays whole and short.** A payment is three lines: what it paid for
  against the amount; when and what it covered against its status as a word; and
  the invoice number beside its receipt. A failed payment still says why. A
  restricted place keeps its state as a word, its one-line consequence, and
  *Reactivate* only where the server reports room — in the sheet as on the page.
- **Billing terms are a few facts.** Cycle, next payment (with *Pay early* where
  it is allowed), last paid with and billing email, each a named line in one
  panel, for a paid subscription only.
- **Parts.** The page's glass pieces live in `BillingSurfaces.tsx`; the plans,
  review and payment screens keep `BillingParts`, so this refinement moves
  nothing on them.
- **Unchanged:** the server read on every return to the page, the kept screen on
  a failed refresh, the keep-plan and reactivate feedback, the forbidden and
  no-Portfolio states, and every rule about who may change the plan, what is
  restricted and what a payment means.

**Verified:** mobile typecheck and lint are clean. 203 of 205 mobile contract
tests pass; the two failures are the Explore header button's, from header work in
progress. The fifteen existing billing tests pass unchanged; six new tests hold
the progressive disclosure, and a mirror caught 34 of 34 mutations. Checked in
headless Chrome on Expo web with a mocked Portfolio at 390×844 — paid (every
receipt, both sheets), renewal due, restricted above Free's limits (Reactivate
only on the units with room) and Free — and at 320×640 with no truncated text.
No native device was used.

## 15. Entity/Page Hierarchy

### Provider Property management

```text
Properties list
└─ Property detail
   ├─ Units list
   │  └─ Unit detail
   │     ├─ Listing/publication
   │     ├─ Current tenant/occupancy summary
   │     └─ Detailed space configuration
   └─ Property details / verification / history
```

- The Properties list supports recognition, scanning and opening a Property.
- Property detail emphasizes the Property identity and spaces inside it.
- Unit detail emphasizes the space's operational state and next useful action.
- Property verification is summarized at the Property level and only repeated
  on a Unit when it actively blocks a Unit action.
- Tenant, lease and rent detail live in their first-class areas; Unit may show a
  concise current relationship and link there.

### Cross-entity continuity

Related links must include enough context to answer what will open. Back
navigation returns to the originating collection or parent where practical.
Web breadcrumbs and mobile screen titles should reflect the actual hierarchy,
not route implementation names such as `spaces` when the UI says `Units`.

## 16. Shared Interaction Patterns

### Existing foundations to retain

- Shared design tokens generated from `packages/design-tokens/tokens.json`.
- Web `PortalShell`, `PageHeader`, `Section`, `Empty` and `LoadingRows`.
- Shared Button, Field, Select, Notice and Stamp patterns.
- Mobile `Type`, `Surface`, `Button`, `Field`, `Choice`, `Notice` and Stamp.
- Capability-derived web navigation and backend-provided entry routes.
- Existing property setup checklist and Unit setup wizard distinction.

### Patterns to establish during refinement

Create these only when the first real journey proves their API:

- **Entity header:** identity, compact operational status, primary action and
  overflow without giant display treatment.
- **Context path:** breadcrumb on web and native parent/back context on mobile.
- **Operational list row:** optional thumbnail, identity, two or three key facts,
  concise state and row-level action.
- **Status summary:** combines relevant backend facts without losing access to
  detailed evidence.
- **Contextual action menu:** rare/advanced actions, with destructive actions
  visually separated.
- **Detail section:** rule-and-heading structure with optional disclosure, not a
  default card.
- **Verification disclosure:** compact Stamp/summary leading to evidence and
  history.
- **Confirmation pattern:** names object, consequence and recovery.
- **Responsive action pattern:** header actions on web, sheet/sticky action on
  mobile where appropriate.
- **State collection:** consistent loading, empty, stale, offline, error and
  success behavior.

Do not create abstractions before a concrete screen demonstrates shared needs.
Extract after a pattern is validated, then use it consistently.

## 17. Accessibility Requirements

- Meet WCAG 2.2 AA at minimum; retain the Daylight & Ledger target of 7:1 body
  contrast where practical and never go below 4.5:1 for normal text.
- All functionality is keyboard accessible on web.
- Focus is visible, ordered logically and restored after dialogs/drawers close.
- Interactive targets are at least 48×48 CSS px/dp unless an equivalent grouped
  target provides the hit area.
- Icon-only actions have accurate accessible names and tooltips where useful.
- Headings reflect hierarchy; do not style arbitrary text to imitate headings.
- Form fields have persistent labels, errors linked to fields and clear recovery.
- Dynamic errors and important results use appropriate live regions without
  excessive announcements.
- Status never relies on color alone.
- Drawers, dialogs and sheets expose correct roles, labels, focus traps and
  escape/back behavior.
- Images have useful alternatives or are marked decorative.
- Layout survives zoom, large text and reflow without loss of action or content.
- Reduced-motion preferences are honored.
- Screen-reader journeys are tested for all critical flows, not only individual
  components.

## 18. Motion & Feedback Principles

Motion communicates state and continuity; it does not decorate.

- Use the shared 80–320ms motion scale.
- Animate transform and opacity only unless a measured exception is justified.
- Respect reduced motion; remove or shorten nonessential transitions.
- Provide immediate pressed, hover and focus feedback.
- Use optimistic updates only when the operation is reversible, low risk and
  unlikely to be rejected by authoritative policy.
- Legal, tenancy, verification, destructive and security-sensitive mutations
  wait for server confirmation.
- Pending feedback belongs near the initiating control and prevents accidental
  duplicate submission.
- Success should usually appear through the changed interface state, with a
  concise confirmation when the result may otherwise be ambiguous.
- Preserve spatial continuity when opening and closing contextual detail.
- A metric reveal may animate the visual indicator to its authoritative value,
  but the displayed business value must never depend on watching the animation.
- Dashboard widgets must not pulse, float or continuously animate after loading.

## 19. Loading / Empty / Error / Success States

Every redesigned journey must explicitly cover:

### Loading

- Use skeletons matching the expected content shape for stable layouts.
- Keep existing content visible during background refresh where safe.
- Never leave a blank screen while session or authorization state resolves.

### Empty

- Explain what belongs here in one concise sentence.
- Offer the next permitted action.
- Distinguish “nothing exists” from “nothing matches this filter.”
- Do not manufacture decorative illustrations or statistics to fill space.

### Error

- State what failed and what remains safe.
- Give a concrete retry or recovery path.
- Preserve entered data and prior content where possible.
- Authorization errors must not masquerade as missing data.

### Offline / stale

- Clearly mark cached or last-confirmed information.
- Avoid pretending mutations succeeded while offline unless a real queued-write
  architecture supports it.
- Retrying must not duplicate high-impact operations.

### Success

- Reflect the new authoritative state.
- Use concise confirmation for actions whose result is not immediately visible.
- Return users to the most useful context, not automatically to an arbitrary
  dashboard.

## 20. Things Danpa HQ Must Never Do

- Never change backend authority, permissions or lifecycle rules for visual
  convenience.
- Never infer authorization from a visible role, route or hidden control.
- Never expose unavailable actions merely to make a screen look complete.
- Never flatten meaningful legal, tenancy, verification or security distinctions
  in the data model.
- Never create active tenancy, verified attendance or trust evidence through a
  cosmetic client transition.
- Never turn every feature into a top-level navigation item.
- Never create a page for every tiny action.
- Never make one enormous Settings page.
- Never copy desktop navigation directly onto mobile.
- Never use endless rounded cards, cards inside cards or arbitrary dashboard
  grids as the default composition.
- Never use gradient-heavy dashboards, glassmorphism, decorative charts,
  generic blue/purple SaaS styling or unnecessary icon boxes.
- Never use excessive pills, badges, banners, giant headings or whitespace.
- Never hide important information solely to achieve visual minimalism.
- Never repeat explanatory copy where hierarchy or a concise state communicates
  the answer.
- Never add motion that delays work, harms low-end performance or ignores reduced
  motion.
- Never assign credibility penalties from UI-only viewing or tenancy signals.
- Never begin a mass redesign before the current journey passes its quality gate.

## 21. Completed UX Refinements

### Program foundation

**Status:** COMPLETE — 2026-08-24

**Problems identified:** UI decisions lacked one durable product-wide source of
truth and journey progress could be lost between development sessions.

**Decisions made:** Adopt Daylight & Ledger, existing shared tokens,
capability-derived navigation and platform-specific interaction manners as the
foundation. Establish the hierarchy, navigation, disclosure, Settings and
quality-gate rules in this document.

**Patterns introduced:** Journey record template, three-layer information model,
surface selection rules, action hierarchy and navigation evaluation questions.

**Components introduced/reused:** No interface components introduced. Existing
design-system primitives documented for reuse.

**Important responsive behavior:** Web and mobile share meaning and product
language but may use different navigation and interaction surfaces.

**Remaining issues:** Native physical-device validation remains an environment
limitation and is tracked under the completed Property journey below.

**Next recommended journey:** Provider Home.

### Existing product foundations adopted by this program

These predate the refinement program and are not evidence that the surrounding
journeys are complete:

- Daylight & Ledger visual system and single token source.
- Capability-driven portal navigation and backend-provided entry routing.
- Responsive web portal rail/drawer behavior.
- Property checklist versus sequential Unit setup wizard.
- Shared verification Stamp and cross-platform component primitives.

### Provider entry and Property-category consistency

**Status:** COMPLETE — 2026-08-24

**Problems found:** A provider-capable account switching from the tenant
experience could reach a stale mobile “Create workspace” action. That action
bypassed the canonical first-Property path and exposed an internal Organization
concept. Web retained related stale setup copy and a tenant empty-state shortcut.
Separately, both Property forms treated Portfolio activities as an allow-list.
Explicit Portfolio setup defaulted to Residential, so valid Commercial and
Hostel categories disappeared even though backend metadata returned all three.

**Root causes:** The workspace-to-Portfolio product change had been applied to
the first-Property API but not every client entry surface. Portfolio activities
were also serving two incompatible meanings: descriptive prioritization in the
domain and authorization in client filters.

**Fixes made:** Tenant/provider crossing continues to use the backend workspace
switch and entry route. Approved individual providers see Add first Property;
the mutation creates/reuses their personal Portfolio. Full property-business
setup remains under Team and is capability-protected for companies, hostel
operators, professional managers and collaborative Portfolios. Web and mobile
now render the complete backend Property-type contract, explicit setup assumes
no activity, and Property creation records a missing activity on the Portfolio.

**Tests added:** Backend journeys cover tenant → provider switching, automatic
personal Portfolio initialization and continued setup; an existing
Residential-configured Portfolio creating a Commercial Property; explicit
hostel-operator setup through a hostel room and Bed; and rejection of direct
tenant-only Organization creation. Web/mobile contract tests guard the canonical
entry route, absence of Create workspace, no client Property-type filter, and
the deliberate business setup path. Targeted result: 25 backend integration,
77 web and 14 mobile tests passing; the canonical core lifecycle smoke also
passes.

**UX decisions established:** Workspace is an experience choice, never a setup
object. Ordinary providers begin with the thing they intend to manage. Portfolio
activities may prioritize choices but never make a valid backend category
disappear. Multi-Portfolio, Team and business architecture remains intact.

## 22. Current UX Work

### Journey: Provider Properties → Property → Unit

**Status:** COMPLETE — 2026-08-24

**Why the journey exists:** Let a provider recognize their inventory, open one
Property, manage the Units inside it, and take the correct lifecycle action on a
Unit with minimal cognitive effort.

**User goal:** Find a Property or Unit quickly, understand its operational state,
and complete the next permitted management action.

**Primary information:** Property identity/location, Unit inventory, Unit
availability/occupancy and the most relevant verification/publication state.

**Primary action:** Context-dependent and backend-authorized—commonly add a
Property, add a Unit, continue setup, submit for verification or publish an
eligible Unit.

**Secondary actions:** Edit relevant details, inspect current occupancy, manage
media/amenities and navigate to related tenant/listing records.

**On-demand information:** Verification evidence/history, complete lifecycle
detail, access-code administration, audit/history and destructive actions.

**Problems identified and addressed:**

- Property and Unit screens were long stacks of lifecycle, setup, verification,
  publication and configuration surfaces with equal visual weight.
- Property detail duplicated the same Continue setup action in its entity header
  and lifecycle band. The lifecycle explanation now owns unfinished and
  exceptional actions; the header becomes operational for Add Unit only when
  management can continue.
- Property detail duplicated tenant-operation explanation. It now presents a
  compact canonical Tenants link after Unit inventory.
- Unit detail now gives identity/state and the next permitted action priority,
  then Unit media/facts. Photos, amenities, entrance details, hostel-only Beds,
  and lifecycle detail are progressively disclosed.
- Mobile Property and Unit screens previously retained independent long card
  stacks, large Unit cards and bottom “Back” actions despite native stack
  navigation. They now share the web information hierarchy using native rows,
  disclosures, headers and platform back behavior.
- Visible product language now consistently says Property and Unit. Internal
  `spaces` route/model names remain unchanged.
- Mobile-web inventory rows initially wrapped their status and chevron into the
  wrong grid cells; responsive grid placement now preserves one scannable row.
- The mobile-web navigation drawer focused its first link but did not form a
  modal keyboard boundary, and its collapsed brand link had no accessible name.
  It now supplies an accessible home label, modal/inert semantics, a focus loop,
  Escape dismissal and opener-focus restoration.
- The lifecycle gate exposed repetitive actions and status copy: empty
  Properties repeated Add Unit, published Units repeated View public listing,
  and attention bands repeated the header status instead of explaining the next
  step. Each action now has one owner and state bands use action-oriented copy.
- Three-level Unit breadcrumbs became a column of long record names on phones.
  Phone-width web now shows one 48px Back to Property path while desktop keeps
  the complete context trail.
- Occupied Unit copy described protected backend axes instead of the provider's
  immediate consequence. It now says that new requests stop and directs tenant
  management to Tenants.
- Mobile listing withdrawal acted immediately. It now uses the platform-native
  destructive confirmation and preserves the verified/private distinction.

**Decisions made:**

- Properties list will optimize recognition and scanning.
- Property detail will be inventory-first: recognize the Property and manage its
  Units.
- Unit detail will be operational: identity/state, next action, essential
  related record, then configuration and history on demand.
- Property and Unit pages will link to canonical Tenant operations rather than
  duplicate them.
- Server action/capability payloads remain the only source of action eligibility.
- A lifecycle band owns corrective or submission actions when its explanation is
  necessary; the entity header must not independently select the same action.
- Property keeps inventory and brief Property facts; Unit owns media,
  configuration, verification/publication detail and hostel-only Bed management.
- Tenant access-code and tenancy administration remains in the canonical Tenants
  area. Property and Unit screens provide contextual links, not duplicate tools.

**Patterns introduced/validated:** Entity header, web context path, native stack
context, operational inventory row, compact status summary, lifecycle attention
band, detail disclosure and responsive action placement.

**Components introduced/reused:** Added evidence-based `WorkspacePatterns` on
web and mobile for entity headers, status lines, disclosures and loading rows;
reused PortalShell, Empty, Button, Notice, lifecycle components, native
Pressable/ScrollView and the existing setup/media components. Web listing
composition is a dedicated page rather than a large form embedded in Unit
detail.

**Important responsive behavior:**

- Desktop uses scan-efficient Property/Unit rows, breadcrumbs and a two-column
  Unit work surface with the next action in the secondary rail.
- Tablet collapses the Unit action rail above the record and keeps inventory
  rows scannable without horizontal overflow.
- Phone-width web uses the portal drawer, stacked lifecycle band, corrected
  three-column Unit rows and full-width primary actions. Native mobile uses stack
  back behavior, concise rows and disclosures rather than reproducing the web
  rail.
- Narrow 320px and 390px web layouts keep long Property and Unit names readable,
  replace multi-record breadcrumbs with one back target, and preserve 48px
  inline-link/action targets without horizontal overflow.

**Accessibility and state coverage:** Semantic headings, regions, lists,
definition lists, native web details/summary and mobile disclosure expanded
state, accessible row labels and minimum 48px action targets are in place.
Drawer focus entry, loop, Escape dismissal and return are verified.
Reduced-motion CSS removes row/button transitions. Loading, empty, stale/error,
draft, verified, pending, changes-required, rejected, withdrawn, available,
occupied, private and published states have explicit representations. Web
withdrawal confirmations were exercised; mobile publication withdrawal now uses
native Alert presentation with platform-appropriate destructive styling.

**Tests and visual review:** Web was reviewed in the live local application with
API-backed synthetic lifecycle fixtures at 1440×1000, 820×1000, 390×844 and
320×800. The matrix covered Property verified, pending, changes-required,
rejected and withdrawn states; Unit verification pending, changes-requested and
rejected states; available/occupied and private/published states; deliberately
long names and addresses; and the earlier Residential, Commercial and Hostel
inventory including hostel-only Beds. There is no horizontal overflow. The
private Unit → dedicated listing composition → published Unit → confirmed
withdrawal → private Unit journey was exercised end to end. Relevant result:
224 backend Property/Unit/verification/listing/occupancy integration tests, 78
web tests and 15 mobile tests pass; both clients pass type checking and lint.

**Remaining limitations:** No Android/iOS emulator or physical device is
available in the current Windows environment, so native large-text rendering,
TalkBack/VoiceOver, poor-network transitions and physical touch behavior are not
claimed. Expo source semantics, font scaling limits, wrapping behavior, minimum
targets, type checks and lint are verified. Browser file selection was not
manually repeated; condition/media upload and evidence behavior remain covered
by the backend integration suite, and the live UI's photo requirements and
editing states were visually exercised.

**User-test correction — mobile Property detail:** Although the first mobile
refinement replaced the legacy cards and copy, the native Property screen still
placed Unit inventory and every secondary Property control in one continuous
scroll. On a phone this preserved the feeling of a backend record dump and did
not match the inventory-first hierarchy established on web. Mobile Property
detail now opens on a virtualized `Units` view. A sibling `Details` tab contains
Property facts, shared amenities, buildings/blocks, verification history and
archive/delete controls. Lifecycle work stays above the tabs so a pending,
returned or incomplete Property never hides its next action.

Unit rows now use available imagery, concise rental facts and one restrained
operational status. The Details view uses the complete address contract and
restores contextual edit paths while keeping its subsections disclosed on
demand. This preserves building and lifecycle capabilities without making them
compete with daily Unit management. The native contract test now guards the
virtualized inventory and Units/Details separation; mobile typecheck, lint and
all 16 focused tests pass. No emulator or physical device was available, so
native rendering and physical large-text behavior remain a user-test item.

The first device retest still displayed the legacy screen even though the
active Expo bundle contained the new `PropertyTabs` implementation. The
connected Android client had retained Metro's pre-change module graph. Metro
was restarted with an empty cache and the connected device was force-reloaded;
a fresh 1,579-module Android bundle completed without route or render errors.
This was a local delivery/cache issue rather than a second Property route.

**Current journey / next recommended work:** Property → Unit is complete.
Provider Home was completed next and is recorded below.

### Journey: Provider Home

**Status:** COMPLETE — 2026-08-24.

**Why this journey exists:** Give a provider one quick answer to two questions:
what needs a decision now, and what is the current shape of this Portfolio?

**User goal:** Open Home, recognize urgent tenant/request/property work, take the
correct action, or confirm that the Portfolio is caught up without scanning
decorative metrics.

**Primary information:** Time-sensitive applications, viewing requests,
tenancy/access requests, overdue or unconfirmed rent where the existing summary
supports it, and Properties returned for correction.

**Primary action:** The first available attention row. When nothing is waiting,
Home states that plainly and keeps Open Properties as the quiet operational
path.

**Secondary information:** One concise Portfolio roll-up—Properties, Units and
occupied/available Units. Full inventory, tenant records, payment detail and
activity history remain in their canonical areas.

**Problems identified:** Web repeats “nothing is waiting” in the header and a
large empty panel, then duplicates five Property records and uses stale copy
claiming tenant/rent work is available before Property authority. Mobile is a
generic dashboard of four metric cards, rent and maintenance cards, notices,
recent-activity cards and a final CTA. Maintenance is not enabled, activity
belongs in Updates, full money detail belongs in Payments, and inventory belongs
in Properties.

**Decisions made:** Home is an attention queue plus one Portfolio summary, not a
dashboard. Empty attention is a sentence, not a large card. Request categories
link to their canonical destinations. Aggregate operational counts may summarize
the business but must not become achievement tiles. No backend capability or
domain rule changes are needed to create the hierarchy.

**Problems solved:** Web no longer repeats an empty attention message in a large
panel, duplicates five Property records, or suggests tenant and rent work exists
without the relevant authority. Mobile no longer presents four decorative
metrics, a disabled maintenance card, a duplicate money card, recent activity
or a repeated final call to action. During state review, an existing read-model
inconsistency was also found: a Unit in `pending_lease` was operationally
occupied but Property and Portfolio totals counted it as available. Aggregate
availability now follows the authoritative physical-occupancy rule while active
tenant and active-lease totals remain intentionally active-only.

**Implemented hierarchy:** The greeting answers whether work is waiting. When
needed, one `Needs attention` list aggregates actionable categories—viewings,
applications, tenancy/payment work and Properties returned for correction—and
links each category to its canonical area. A single ledger-style `Portfolio`
row summarizes Properties, Units and occupied/available Units. Full inventory,
individual requests, payment detail and activity history are not copied onto
Home. The caught-up state does not render an empty attention container.

**Reusable patterns established:** Home attention rows summarize a category and
its count, pair it with one short reason and expose one destination. They do not
become record cards or status-badge collections. The Portfolio row is a compact
orientation device rather than a performance metric. Web reuses the portal
header, sections and ledger-row language; mobile uses a focused `HomeRow`
Pressable rather than introducing a generic dashboard abstraction.

**Responsive/mobile decisions:** Web keeps label, explanation and destination
aligned at desktop/tablet widths, then lets the row stack naturally on phones.
The live page has no horizontal overflow at 1440×1000, 820×1000, 390×844 or
320×800. Web actions have a 48px minimum target. Native rows have a 72px minimum
height, wrap instead of truncating under larger text and expose the entire row
as the action. Mobile preserves the same hierarchy without copying the desktop
shell.

**Accessibility and copy:** Web uses one h1 and section h2s; native section
titles expose header roles. Action rows have complete labels and do not rely on
color. “Caught up” is stated once. Disabled capability explanations, generic
metric labels and duplicate navigation copy were removed.

**Tests and review:** The live web attention state and Portfolio roll-up were
reviewed at all four widths above, including long content and a multi-Property
Portfolio. The occupied/available aggregate regression is covered at the
backend Property and Portfolio read-model levels. Final relevant results are
224 backend integration tests, 78 web tests and 15 mobile tests; both clients
pass type checking and lint, and web production build completes across 40
routes.

**Remaining limitations:** No Android/iOS emulator or physical device is
available, so native rendering, screen-reader behavior and physical touch are
not claimed. Mobile source semantics, wrapping, minimum targets, contracts,
types and lint are verified. The local live data did not contain every possible
attention category simultaneously; their source contracts and destinations are
covered without fabricating domain behavior in Home.

**Superseded — 2026-08-24:** this record describes Home as "an attention queue
plus one Portfolio summary, not a dashboard". On user review that proved too
little, and Home was rebuilt as a control center — see the record at the end of
this section. The honesty rules below (no decorative metrics, no capability that
does not exist, no duplicated inventory) carried forward unchanged.

### Journey: Provider Tenants → Tenancy → Lease → Rent

**Status:** COMPLETE — 2026-08-24; awaiting user testing.

**Why this journey exists:** Help a provider act on the relationship with a
specific renter: recognize who or what needs attention, understand occupancy
and rent position, and reach the exact Property, Unit, Tenancy or Lease without
reconstructing context.

**Problems solved:** The former web Tenants page began with four figures
and then places tenancy requests, private access management and current tenants
in one long sequence. In the reviewed Portfolio it rendered more than 3,700px
high because every eligible Unit—including unavailable and unverified
variants—appeared before the current-tenants section. Individual tenant cards
also combine identity, tenancy state, Unit, lease terms, rent balance and three
entity links. Mobile uses the same broad workbench concept as a sequential stack
of tenant cards, Property-selection buttons, capability notices, Unit access
controls, tenancy requests and inline lease forms.

**Design decisions:** Tenants now opens on current relationships, with `Private
access` as a secondary task view rather than a full page section stacked above
the tenant list. The later Tenancy Requests refinement moved request review into
its own canonical provider inbox. Search and rent/attention filters support
large Portfolios. Each row represents one exact Unit/Bed tenancy—not one unique
person—and opens a focused tenancy screen containing status, dates, agreement,
rent position and links to the authoritative Property, Unit and Lease/Rent
areas. Only verified, available Units appear as private-sharing work; other
inventory is summarized with a path back to Properties.

**Interaction decisions:** Lease work is substantial but contextual. Agreement
actions use a modal dialog on web and a native page sheet on mobile rather than
a long inline expansion or a new top-level page. Ending an active mobile
tenancy uses a native destructive confirmation. Tenant rows remain dense
operational rows; access-code work uses cards because each contains state and
actions.

**Responsive/mobile decisions:** Desktop uses a scan-efficient four-column
tenant ledger. Tablet and phone layouts recompose the row and tenancy facts
before columns become cramped. Mobile uses a virtualized list, full-row links,
wrapping 48px tabs and 56–84px action targets. Web was reviewed at 1440, 820,
390 and 320px with long Property/Unit names and no horizontal overflow.

**Accessibility and focused validation:** Web tabs expose tab semantics and
Left/Right keyboard navigation; the native dialog contains focus and returns it
to its trigger when closed. Headings, complete row labels, non-color status
copy and minimum targets are present. Populated active/overdue tenancy,
approved-request, empty/filter and private-access states were reviewed in the
live web app. Web typecheck, lint and 79 frontend tests pass; mobile typecheck,
lint and 16 frontend tests pass. No backend suite was rerun because this area
changed presentation and frontend consumption of an existing Portfolio
response, not domain behavior. The shared-navigation correction below added a
focused web production build.

**User-test correction — Payments and mobile navigation:** The Tenants review
exposed overdue rent but web navigation offered no first-class destination for
acting on it. Payments now appears in the provider navigation, Provider Home
routes overdue balances and payment records there, and the web Payments
workspace presents the Portfolio ledger, recent payment records and existing
expense workflow without duplicating rent rules in the client. The overdue
summary links back to the affected tenant relationships. This is a necessary
operational destination and Home attention path; it is not the later full Rent
product-area refinement.

Mobile already had a first-class Payments tab, but its visible Tenants tab was
still backed by the legacy internal `messages` route. The route is now
canonically `tenants`, and all Home, Property, Unit and action destinations use
that route. This removes the stale route identity that could keep the current
mobile Tenants experience from reflecting consistently while preserving the
five-item provider tab hierarchy: Home, Properties, Tenants, Payments and More.
No lifecycle, payment, permission or API rule changed.

The correction was reviewed live on web at 1440, 820, 390 and 320px, including
the overdue, payment-history empty, expenses and expense-dialog states. The
shared navigation change passes web typecheck, lint, 79 tests and a 41-route
production build; mobile passes typecheck, lint and 16 tests. No native runtime
or physical device was available, so native visual behavior is not claimed.

**Remaining limitation:** No Android/iOS emulator or physical device was
available. Native layout, TalkBack/VoiceOver and physical touch behavior are
not claimed; mobile source semantics, navigation, large-text wrapping intent,
types, lint and contracts are verified.

**Next recommended work:** The user approved the mobile Property correction and
resumed the refinement program. Provider Viewings was completed next and is
recorded below.

**Refinement — 2026-09-15, product owner review (provider mobile).** The brief:
reorganize Tenants into a calm, premium page with the same functionality and
data — a compact hierarchy, clean grouping, rows that scan, clear rent and lease
context, purposeful actions, and one Filter control instead of separate filters.

- **One reading order, shared with Payments.** One glass panel leads with how
  many tenancies need attention, with overdue money under it in laterite and
  Tenancies and Paid up beside each other. A waiting tenancy request is one row
  that opens the requests inbox; requests are still decided only there. The
  introduction sentence and the relationships caption are gone.
- **One Filter control.** The Tenants and Private access tabs and the row of Show
  choices became one Filter pill beside the list's name and count. The shared
  sheet groups Show (Tenancies, Private access) and, for tenancies only, Status
  (All, Needs attention, Overdue, Paid up); every answer is a radio with its
  count, and the sheet closes on "Show N results" beside Reset. An active status
  appears as the pill's badge and one removable token. Search stays, over name,
  Property, Unit and bed.
- **Grouped tenancies, one exact tenancy per row.** The list is grouped into
  Needs attention and On track, each one glass panel under its name and size. A
  row reads the name against what is owed (or Paid up); the Property, Unit and bed
  against how the rent stands (Overdue, Due date, Next date); then the term:
  Agreement needed, Starts date or Ends date. Initials take the rent's colour.
  Amounts and statuses never give way: on phones narrower than 350pt a paid-up
  row's next date gives way instead, and term dates drop the day. A screen reader
  hears the whole tenancy, term included, and rows still open the tenancy screen.
- **Private access, lighter.** Still a secondary view of at most three verified,
  available Units. What a code lets someone do is said once above the cards, in
  `privateAccess`'s own words. Each card names the Unit with View Unit, then the
  code's state in one line (its full explanation still spoken) and the same acts
  as small pills: Create or New code, Revoke, and Share code with the one-time
  value in a selectable well. This is a `layout="card"` of the shared
  `UnitAccessCodeManagement`; the Unit screen keeps its section. A failed refresh
  now keeps the Portfolio on screen, so a code that was just issued is not
  unmounted with its card.
- **One kit.** The figures panel, decision rows, notes, list heading, Filter pill,
  token, search, row frame and lines, empty state and filter-sheet parts moved
  from Payments into `components/portfolio/PortfolioList.tsx`, and both pages are
  built from it.
- **Unchanged:** pull to refresh, `?view=access`, the `?view=requests` redirect to
  the inbox, attention-first ordering and what each filter means, the tenancy,
  View Unit, See all Units and Review Properties routes, and the empty and
  loading wording.

**Verified:** mobile typecheck and lint are clean. 188 of 190 mobile contract
tests pass; the two failures are the Explore header button's, from header work in
progress. Nine new Tenants tests were added and a mirror caught 55 of 55
mutations; the Payments tests were re-pointed at the kit and a mirror caught 35
of 35. Payments' five headless captures after the move are byte-identical to the
ones before it. Tenants was checked in headless Chrome on Expo web with a mocked
Portfolio at 390×844, 360×780 and 320×640: the summary and waiting request, the
grouped list, the sheet with a status chosen, the filtered state and its token,
Reset, Private access with active, new and expired codes, a code issued (rotate,
refetch, and the card and its code kept), the capped footer, a search with no
match, the empty Portfolio, and no truncated text at 360 or 320. No native device
was used.

### Journey: Provider Viewings

**Status:** COMPLETE — 2026-08-24; awaiting user testing.

**Why this journey exists:** Give a provider one reliable place to reply to new
Viewing requests, prepare for upcoming visits, verify attendance and preserve a
clear record after the visit ends.

**Problems solved:** Web rendered every Viewing as a large lifecycle card with
messages, directions, contact details, scheduling, cancellation, attendance and
history controls repeated inline. This became a long form wall as records grew.
Mobile used the same repeated-card model inside one `FlatList`; selecting the
Property listing rather than the Viewing made the operational workflow harder
to recover. The only collection control toggled between open and finished
records, so providers could not distinguish work requiring action from visits
that were merely upcoming or already concluded.

**Design hierarchy:** Viewings is now a searchable operational queue with three
task-based views: `Needs action`, `Upcoming` and `History`. Rows show the tenant,
Property/listing, location, one restrained state and the relevant date or time.
New requests, ready check-ins, checked-in visits and attendance responses belong
in Needs action; offered/confirmed visits that are waiting belong in Upcoming;
completed, cancelled, declined and resolved exceptions remain in History. No
decorative totals or duplicate listing detail were added.

**Interaction decisions:** Web opens one Viewing in a modal detail surface that
preserves queue context and becomes a bottom sheet on phone widths. Mobile opens
one native stack detail screen because scheduling, contact, directions,
attendance and appointment history form a substantial resumable record. Offer
and reschedule remain contextual forms; cancellation captures its structured
reason; decline uses an explicit confirmation; QR/code check-in keeps its
existing dedicated scanner. All action eligibility and transitions still come
from backend status/action payloads.

**Responsive/mobile decisions:** Web uses a five-part ledger on desktop,
recomposes location and timing at tablet width, then stacks state/time beneath
identity on phones. Search remains visible and the three tabs shrink within the
content width. Native mobile uses a virtualized list, 96px minimum rows,
48px tabs and a separate detail screen with disclosed request, outcome and
appointment history. Mobile More now says `Viewings` and describes requests,
upcoming visits and history rather than exposing only “Viewing requests.”

**Accessibility and copy:** Web uses semantic tab/list/dialog structures,
browser-native modal focus containment, Escape/backdrop dismissal and opener focus
return. Complete row labels do not rely on color. Native rows and tabs expose
roles and selected state; state dots always have text. Copy describes the next
task instead of repeating raw lifecycle labels. Danpa HQ's free-Viewing rule and
symmetric attendance-dispute language remain intact.

**Focused validation:** Local-only API-backed fixtures covered requested,
offered, confirmed, checked-in and completed states. Web Needs action, Upcoming,
History, detail, offer-time and narrow bottom-sheet states were reviewed live at
1440, 820, 390 and 320px with no horizontal overflow or browser errors. Web
typecheck, lint, 80 focused tests and the 41-route production build pass. Mobile
typecheck, lint and 17 focused tests pass. Metro was rebuilt after adding the
native detail route; the connected Android client completed a fresh 1,580-module
bundle with both routes and no route/render errors.

**Remaining limitation:** The connected physical Android screen was not
remotely inspectable, so this record does not claim a physical visual,
TalkBack, touch or large-text review. Expo web visual review is also blocked by
an existing `expo-secure-store` web-runtime incompatibility unrelated to this
journey. Native source semantics, route delivery, types, lint and contracts are
verified; the user should test the Android queue and detail interaction.

**Journey handoff:** The user approved moving on from Viewings. Provider Tenancy
Requests was completed next and is recorded below.

**Refinement — 2026-09-15, product owner review (mobile).** The brief: a layout
made for this page's purpose, the most important thing first, one Filter, few
words, and polish on small phones.

- **Today leads.** One glass panel: the visits in hand today, with what needs the
  host under it in laterite, and beside each other the next visit's time and how
  many viewings wait on a tenant. The next visit reads as a time today and a
  weekday otherwise, so the figure is never cut short.
- **One queue, in the order it is worked.** Needs action, then Upcoming grouped by
  day — Today, Tomorrow, the date, and last the times a tenant has still to pick —
  then the latest three of History with "View all" turning the Filter to it. It
  stays a `FlatList`: groups, days and rows are its items, so a long history still
  virtualises.
- **One green Filter and a search** in place of the three tabs: All viewings,
  Needs action, Upcoming and History, each a radio with its count, closing on
  "Show N results" beside a Reset that clears the search too.
- **A row answers the host's question.** A tile carries the time of a visit in
  hand or the date of one that is done, in the state's colour; then who it is with,
  how it stands, where, and the one detail that state needs — the first offered
  time, or how long a request has waited. On phones under 350pt the name keeps its
  whole line and the status moves under it.
- **Unchanged:** the Portfolio scope and its blanking, which visit belongs in which
  view, the sorting, the record route, pull to refresh, the error notice and every
  empty state's words. Added: a skeleton, and a way to Properties when there is
  nothing yet.

**Verified:** mobile typecheck and lint are clean; 234 of 236 contract tests pass,
the two failures being the Explore header button's, from header work in progress.
Four new tests in `providerViewingQueue.contract.test.mjs`, and a mirror caught 72
of 72 mutations across this page, Tenancy requests and Updates. Checked in headless
Chrome on Expo web with a mocked Portfolio at 390×844 and 320×640: the queue and
its day groups, the sheet, each view, History reached through "View all", nothing
yet, and no cut text at 320. No native device was used.

### Journey: Provider Tenancy Requests

**Status:** COMPLETE — 2026-08-24; awaiting user testing.

**Why this journey exists:** Give providers one reliable place to review people
asking to rent, understand the relevant claim, make a decision and continue an
accepted request into an agreement without reconstructing the workflow across
Applications, Tenants and Leases.

**Problems solved:** Public-listing applications lived in a large repeated-card
inbox while private access-code and post-viewing tenancy requests were buried
inside Tenants. The same provider task had two names and two destinations.
Accepted public applications disappeared from the open queue and resurfaced
only as agreement work on Leases. Mobile repeated every claim and action in the
collection instead of separating scanning from one decision. Tenants therefore
owned request decisions, active relationships and private sharing at once.

**Design hierarchy:** `Tenancy requests` is now a provider-wide, searchable
inbox across authorized Portfolios. It combines both existing backend request
contracts without merging their domain rules. `Needs action` contains public
applications awaiting review/decision and private requests awaiting approval;
`Agreement` holds accepted requests until an agreement is prepared or sent;
`History` preserves settled public applications and requests that advanced into
agreement/tenancy states. Rows show person, source, Property/Unit, one useful
state and received date. Source is stated at the useful contract boundary as
Public listing or Direct request; the underlying direct-request origin remains
server history rather than another collection label.

**Interaction decisions:** Web keeps queue context in a modal detail surface;
phone-width CSS recomposes it as a bottom sheet. Native mobile uses a dedicated
stack detail screen because claims, decision, agreement preparation and related
records form a substantial resumable workflow. Advance fit leads public-request
detail, followed by household/work and guarantor context. Decline requires an
explicit confirmation. Agreement preparation remains a contextual web dialog
or native page sheet; acceptance does not imply that a tenancy has started.
All actions still use the existing application, join-request and lease APIs.

**Navigation and ownership decisions:** Provider web navigation, Home, mobile
Home, More and Quick actions now say `Tenancy requests` and route to the unified
inbox. Tenants returns to current relationships and private Unit access. Legacy
Tenants request links redirect to the canonical destination. The inbox spans all
authorized Portfolios because the existing public-application endpoint is
provider-wide; filtering it through active Unit inventory would incorrectly
hide archived history. Property/Unit identity preserves Portfolio context, and
server authorization remains the boundary for every row and action.

**Responsive/accessibility decisions:** Desktop uses a scan-efficient ledger;
tablet removes the redundant Property column before narrow layouts stack state
and date below identity. Search stays visible and tabs remain horizontally
usable. Web uses semantic list/tab/dialog structures, complete accessible row
names, browser-native focus containment and text alongside every status color.
Native uses a virtualized list, 48px tabs, minimum 92px rows, selected-state
semantics, native destructive confirmation and wrapping rather than fixed text
heights. Copy names the next task rather than exposing raw state-machine detail.

**Focused validation:** Local API-backed data covered a submitted public
application with advance shortfall, household, occupation, employer, guarantor
and message, plus an approved private request needing an agreement. Both queue
and detail compositions were reviewed in the running web app, including a long
Property/Unit label. Web typecheck, lint, 80 focused tests and the 41-route
production build pass. Mobile typecheck, lint and 17 focused tests pass. Metro
was restarted with a clean route manifest after adding the native detail route;
the Expo web bundle completed without route warnings. No backend suite was run
because no API, permission or lifecycle rule changed.

**Remaining limitation:** The current browser-control surface did not expose a
resizable viewport during this review, so responsive behavior was reviewed from
the implemented breakpoint/recomposition rules rather than claimed as live
phone-width inspection. The physical Android display was not remotely
inspectable; native visual, TalkBack, touch and large-text behavior remain for
user testing. Expo web still has the existing SecureStore runtime limitation.

**Journey handoff:** The user approved moving on from Tenancy Requests. Provider
Leases was completed next and is recorded below.

**Refinement — 2026-09-15, product owner review (mobile).** The same brief as
provider Viewings.

- **What waits on the provider leads:** how many need a decision, how long the
  oldest has waited (laterite from three days), and beside them how many need an
  agreement and how many requests there are in all. The page title, its sentence
  and the three tabs are gone — the stack header already names the page.
- **One list grouped by what each request needs** — Needs your decision, Agreement
  to prepare, and History showing its latest three with "View all" — from both
  sources, still read as one inbox.
- **One green Filter holds the stage and the source together:** All requests,
  Needs action, Agreement and History; then Everywhere, Public listing and Direct
  request. Each count is what that choice would show beside the other choice
  already made, and the pill's badge counts both.
- **A row** reads the person against how long ago it arrived, the place they asked
  about, then where it stands in its colour beside where it came from. Initials
  carry that colour, so what waits on the provider is found before it is read.
- **Unchanged:** the one-Portfolio read and its blanking, both stage vocabularies,
  newest first, the search, the record route with its kind and Portfolio, pull to
  refresh and the error notice. Added: a skeleton, and a way to Tenants when there
  is nothing yet.

**Verified:** five new tests in `tenancyRequestInbox.contract.test.mjs`, and the
mirror above. Checked at 390×844 and 320×640 with mocked applications and direct
requests in every stage, including the source filter and nothing yet. The
`label="Action"` pins in `viewingAttendance`, `portfolioTeam` and web's
`discoveryPhase` now read `label="Needs action"` — the words web and this record
already use for that view.

### Journey: Provider Leases

**Status:** COMPLETE — 2026-08-24; awaiting user testing.

**Purpose and problems solved:** Providers open Leases to send a prepared
agreement, see whether the tenant has responded, understand whether a tenancy is
active and recover the durable agreement record. Web previously mixed accepted-
request discovery, agreement composition and lease management in one repeated-
card page. Mobile routed every account to the tenant agreement screen and gave
providers no Leases destination. A saved draft could also disappear from Home's
attention queue.

**Design hierarchy and ownership:** Tenancy Requests continues to own review,
acceptance and agreement preparation. Leases begins with existing agreement
records and groups them as `To send`, `Current` and `History`. Search covers
tenant, Property, Unit and bed. Scan rows show the counterparty, rented space,
rent, one useful lifecycle label and one relevant date. Full terms, acceptance
evidence and actions move into record detail. Provider Home now surfaces saved
drafts ready to send; rent balances and payment confirmation remain owned by
Payments/Rent rather than being duplicated here.

**Interaction decisions:** Web uses a modal record because inspection and the
few contextual actions should preserve queue position; phone-width CSS makes it
a bottom sheet. Native uses a dedicated stack detail because the frozen terms,
acceptance record and lifecycle actions form a substantial resumable record.
Drafts may be sent or deliberately discarded, open offers deliberately
withdrawn, and active tenancies ended only after an inline confirmation with an
optional reason. All detail prefers the backend's immutable agreement snapshot
and exposes its version/hash progressively. Older records fall back to their
original lease fields without inventing terms. No API, permission or lifecycle
rule changed.

**Navigation, responsive and accessibility decisions:** Web keeps Leases in
primary provider navigation. Mobile adds it to the operational section of More
without overcrowding the five-tab rail; the existing notification route becomes
role-aware through the canonical Agreements screen. Web rows collapse from five
columns to identity/state/date and then stack on phone width; search remains
visible, tabs scroll when needed and the dialog becomes a bottom sheet. Native
uses a virtualized list, minimum 52px tabs, minimum 92px rows, wrapping facts,
font-scaling primitives, text alongside every status color and explicit
selected/busy/disabled semantics.

**Focused validation:** Running API-backed web review covered the empty `To
send` state, one active agreement with a deliberately long Property label, the
scan row and full modal record. Web typecheck, lint, 83 focused tests and the
41-route production build pass. Mobile typecheck, lint and 20 focused tests
pass. Metro was restarted with a clean cache after adding the provider detail
route; the Expo web route bundle completed at 1,015 modules with no compile or
route error. The existing SecureStore web-runtime incompatibility prevents an
authenticated Expo-web visual review. No backend suite was run because backend
contracts and domain behavior were unchanged.

**Remaining limitation:** The available browser surface did not expose viewport
resizing, so narrow web behavior was reviewed from implemented breakpoints rather
than claimed as live phone-width testing. No remotely inspectable physical
device was available; native visual, touch, TalkBack and large-text behavior
remain for user testing.

**Next recommended work:** Provider Rent was completed next and is recorded
below.

**Refinement — 2026-09-15, product owner review (mobile, provider and tenant).**
The brief: a premium, compact Leases page for both readers with the same
functionality and data, far less text, one Filter control with a green
background, lease facts that scan at a glance, and animated Icons8 empty states.

- **One reading order per reader, from the Portfolio kit.** The provider opens on
  one glass panel: Active leads, with what waits on the provider under it in
  laterite ("2 to send · 1 to confirm"), and Waiting for tenant and All
  agreements beside each other. Waiting for tenant still counts `offered` only.
  Every agreement follows, grouped To send, Current and History. The tenant opens
  straight on their agreements, grouped Needs your decision, Active and Past. The
  AGREEMENTS label, the "Leases" display heading and the introduction sentence are
  gone; the stack header already names the page.
- **One green Filter.** The provider's tabs and the tenant's tab strip became one
  Filter pill with a kola background and white words, beside the list's name and
  count, with a white badge when a filter is on. It opens the shared sheet — All
  agreements, To send, Current and History for the provider; the shared agreement
  filters (All, Needs you, Active, Past) for the tenant — each a radio with its
  count, closing on "Show N results" beside Reset. The list's heading names what
  is showing. The green is a kit option (`filterTone="kola"`); Payments and
  Tenants keep the glass pill until asked. The provider's search stays, over
  tenant, Property, Unit and bed.
- **Rows that scan.** A provider row reads the tenant against the rent, the
  Property, Unit and bed against the status in its colour, then the rent's period
  and the one date that matters now: Starts, Ends or Prepared. Initials carry the
  status colour. On phones narrower than 350pt the space keeps its whole line and
  the status moves under it. A tenant row reads top to bottom — which home, with
  whom, the rent and term, then the move-in total and start — and closes on where
  it stands, with a green Review pill only while the decision is open.
- **The statuses, in one place.** `providerLeaseMeaning.ts` now holds the
  provider's stages, labels and tones for the list and the agreement screen. The
  list had fallen behind the canonical workflow: `ready` and `tenant_accepted`
  dropped into History with no label. They now sit in To send and Current as
  Ready to send and Confirmation needed, as web's `leaseMeaning` and the agreement
  screen already said.
- **Empty states.** Where the whole list is empty, the glyph sits large in a white
  disc, with the provider's one next step (Open tenancy requests); filter and
  search empties stay small. Icons8 animation was reviewed and deferred by the
  product owner: the free animated GIFs are served at 48×48 px, and the free
  licence requires an icons8.com link in the app plus store credits, which is not
  yet decided. `EmptyState` accepts an optional animation for the disc and shows
  the still glyph to anybody who has asked for reduced motion.
- **Unchanged:** one route for both readers, the Portfolio scope and its blanking
  on a switch, pull to refresh, newest first, the agreement routes, the tenant's
  refresh on return from deciding, the loading and error states, and every
  lifecycle rule.

**Verified:** mobile typecheck and lint are clean. 197 of 199 mobile contract
tests pass; the two failures are the Explore header button's, from header work in
progress. Nine new Leases tests were added and a mirror caught 41 of 41
mutations; the Payments and Tenants mirrors still catch 35 of 35 and 55 of 55
after the kit's Filter and empty-state options. Checked in headless Chrome on Expo
web with mocked agreements in every status at 390×844 and 320×640: the provider
summary, grouped list, sheet with a stage chosen, filtered state, a search with no
match and the empty Portfolio; the tenant's grouped list, sheet, filtered state
and empty state; and no truncated text at 320. No native device was used.

### Journey: Provider Rent

**Status:** COMPLETE — 2026-08-24; awaiting user testing.

**Why this journey exists:** Rent is the area a provider opens to answer three
questions: who owes money, what has actually been paid, and what does someone
need me to decide. Danpa HQ does not move money, so the product's whole value
here is an honest, mutually agreed record.

**Handover note:** The bulk of this area — the web `/payments` workspace, the
mobile Payments tab and the mobile `rent-account` screen — was implemented in a
previous session that ended before it validated or recorded the work. This
session verified that implementation, corrected two defects found in it,
validated the area and wrote this record. Anyone continuing should treat the
implementation below as the finished state.

**Primary information:** Outstanding and overdue balances per tenancy, and the
payment records that are waiting for the provider to confirm or dispute.

**Primary action:** Answer a claim the tenant recorded. Where the tenancy
permits it, record money received elsewhere or waive a balance.

**Secondary information:** Confirmed received, portfolio-wide outstanding and
overdue, and Property expenses.

**On-demand information:** The full lease ledger — every charge with its
purpose, period and due date; complete payment history with references,
disputes and verification source; and the link back to the tenancy.

**Problems solved:**

- **Home told providers to confirm their own payments.** The portfolio read
  model reported `pending_payment_records` — *every* claim not yet agreed by
  both parties — and Home, mobile Home and the Payments attention band all
  presented that number as the provider's queue: "3 payment records to
  confirm". A provider who had just recorded three cash instalments was being
  told to confirm records that were waiting on the *tenant*. It also inflated
  the "N things waiting on you" greeting. The read model now also returns
  `payment_records_awaiting_you`, counting only claims the user did not record
  themselves, and every attention surface uses it.
- **An unanswered claim could be hidden by newer activity.** The portfolio
  returned the ten most recent payment records. The one thing a provider
  actually owed an answer to could therefore fall off the list behind their own
  newer records, while the attention band still counted it — an actionable item
  the interface pointed at but could not show. Claims awaiting the user are now
  taken whole and merged ahead of the recent window, so an unanswered claim can
  never be pushed out of view.
- Balances, records and expenses were the same undifferentiated stream. They are
  now three views over one workspace with a shared search.

**Decisions made:** Payments is a working ledger, not a finance dashboard. The
three money facts it states — confirmed received, outstanding, overdue — are the
only aggregates the backend can defend, and none of them is called revenue,
settled, collected or a balance held. Recording surfaces say plainly that
Danpa HQ does not collect or transfer money and that the other party must confirm
before a balance changes. A claim is never allowed to look like a receipt.
Waiving is presented as forgiving an obligation, explicitly not as a payment.
`pending_payment_records` is preserved in the payload — it is still true, and
still the honest number for "not yet agreed" — but it is no longer allowed to
stand in for one person's queue.

**Interaction decisions:** Web inspects a rent account in a modal so the queue
position survives; phone-width CSS turns it into a bottom sheet. Native uses a
dedicated stack screen because the ledger is a substantial resumable record, and
recording a payment opens a native page sheet. Confirm, dispute and waive each
use an inline two-step confirmation, and dispute and waive both require a
written reason before they can proceed.

**Reusable patterns established:** The attention band pairs a count with the one
destination that resolves it, and counts only work belonging to the person
reading it. Money facts are stated as a definition list, never as achievement
tiles. Status is always words first — "Waiting for tenant", "Confirmed by both",
"Disputed" — with colour as reinforcement only.

**Responsive/mobile decisions:** Desktop uses a five-column ledger row. At 760px
it collapses to identity, state and amount; at 600px it stacks and the record
dialog becomes a bottom sheet, tabs scroll and the charge and payment lists go
single-column. Reduced motion removes row transitions. Native uses a virtualized
list, 72px attention rows and horizontally scrolling filter chips.

**Accessibility and state coverage:** Web tabs expose tab semantics with
Left/Right keyboard navigation; the dialog is a native `<dialog>` with Escape
handling and backdrop dismissal. Native section titles expose header roles.
Loading, error, empty, filtered-empty, locked-capability, overdue, outstanding,
current, claimed, confirmed, disputed and processor-confirmed states all have
explicit representations.

**Tests and validation:** The corrected read model is covered by a new backend
integration test that builds the exact failure — one older tenant claim behind
twelve newer provider records — and asserts 13 unagreed records, 1 awaiting the
provider, and the tenant claim first in the list. The same scenario was seeded
into the running development database and read back through the live service:
`pending_payment_records: 13`, `payment_records_awaiting_you: 1`, tenant claim
first. Relevant results: 138 backend integration tests across organization,
rent, payment-core, portfolio, management-portal, lease, notifications, API
contract and the canonical lifecycle smoke; 86 web tests; 23 mobile tests; both
clients pass type checking and lint; the web production build completes across
its 50 routes.

**Remaining limitations:** Web sign-in requires a password, which this session
would not enter, so no authenticated live visual review was performed here.
Breakpoint behavior was verified from the implemented CSS rather than claimed as
live rendering, and the corrected data path was verified through the service
layer instead. The seeded review scenario is left in the development database
under the `UI Review Portfolio` Portfolio so the states can be seen directly.
No Android/iOS emulator or physical device is available, so native rendering,
TalkBack/VoiceOver and physical touch remain user-test items. The Records view
still shows awaiting claims plus a recent window rather than a fully paginated
payment history; that needs a dedicated listing endpoint and is deliberately not
invented in the client.

**Next recommended work:** Provider Portfolio was completed next and is
recorded below.

### Journey: Provider Portfolio

**Status:** COMPLETE — 2026-08-24; awaiting user testing.

**Why this journey exists:** A provider needs to know which business they are
operating inside, what it is, what it holds, and how to move to another one. Up
to now the product had a Portfolio everywhere and nowhere: "Portfolio" was a
navigation *section title*, but the Portfolio itself had no destination.

**Primary information:** Which Portfolio you are in, what kind of operation it
is, and your role in it.

**Primary action:** Whatever the Portfolio needs next — most often none. Editing
identity, switching Portfolio, or answering an invitation when one is waiting.

**Secondary information:** What the Portfolio holds — Properties, Units,
occupied/available, and how many people are in it — each linking to the area
that owns it.

**On-demand information:** The identity form, which stays closed until asked
for.

**Problems solved:**

- **The Portfolio had no home, and lived inside its own Team.** Identity — name,
  kind of operation, activities — was at `/team/settings`, a sub-route of Team,
  with a "← Team" link. That inverts the real containment: a Team belongs to a
  Portfolio. Identity now lives on `/portfolio`, and Team is one of the things
  the Portfolio holds.
- **Switching was in three places with three mechanisms.** The account menu, a
  `Select` on Team, and a native `select` on Payments each set the active
  context their own way, and none of them told you what you were currently in
  from an ordinary screen. Switching now has exactly two homes — the account
  menu and the Portfolio page — and the operational pages follow the active
  context instead of carrying competing controls.
- **The rail never said what you were managing.** The operational section is now
  titled with the active Portfolio's name, falling back to "Portfolio". Someone
  with two Portfolios can see which one they are in from any screen.
- **Identity was a bare form.** It read as configuration to fill in rather than
  facts about a business. It is now a stated record with editing on demand, and
  a scoped role sees the facts plus who may change them, instead of a disabled
  form.
- **Invitations were an orphan.** `/portfolio-invitations` was reachable only
  from a link in Team's header. It remains the secure deep-link target, and the
  same pending invitations now appear on the Portfolio itself, where the rest of
  "which Portfolios am I in" is answered.
- **The navigation test mirror had silently drifted.** `portalNav.compiled.mjs`
  is a hand-written JS copy of `portalNav.ts` that the navigation tests import.
  Its header claimed the two were kept in step; nothing checked it, and Payments
  had been added to the shipping file months of work ago without reaching the
  mirror. Every navigation guarantee the suite claimed was being proved against
  a copy nobody shipped — including an exact-href assertion that had quietly
  become wrong. A mirror guard now holds the two to the same declared items and
  route prefixes, and was verified to fail when that exact drift is reintroduced.

**Decisions made:** The Portfolio is a record, not a settings page. Rows, not
cards: every entry on it is either a fact or a destination, and none of them is
an object with its own state to manage. Counts orient rather than celebrate —
Properties, Units and people are shown because they tell you the shape of the
business, and each one links to the area that actually owns it. Nothing on this
page duplicates Properties, Team or Payments.

**Interaction decisions:** Identity is edited in place on web — a name, a kind
and three checkboxes do not earn a route. Mobile keeps a focused nested
`Portfolio identity` screen instead, matching the mobile settings philosophy
already established for this program. Switching is a plain row, and the
confirmation is the page reloading as the Portfolio you chose.

**Reusable patterns established:** A destination row carries a label, one line
of detail and one action, and the whole row is the target. An entity page may
summarize what it contains, but the summary must link out rather than reproduce
the contained area. Where a domain concept is both a grouping and a thing, the
grouping is named after the thing.

**Responsive/mobile decisions:** Web rows are a two-part flex that stacks below
600px; the identity facts are three columns, one column below 760px. Reduced
motion removes row transitions. Native rows have a 72px minimum height, wrap
instead of truncating, and expose the whole row through one accessibility label.

**Accessibility and state coverage:** One h1 and section h2s on web; native
headers expose header roles. Loading, error, no-Portfolio onboarding,
single-Portfolio, multi-Portfolio, owner/admin editable, scoped read-only, and
pending-invitation states each have an explicit representation. Activity
checkboxes have 44px label targets.

**Tests and validation:** New web and mobile contract tests guard that the
Portfolio owns identity, holdings, switching and invitations; that `/team/
settings` no longer exists; and that no operational page carries its own
switcher. The navigation mirror guard is new, and was mutation-checked by
reintroducing the Payments drift and confirming it fails. The Portfolio page's
data path was read back through the live service for the review Portfolio —
name, kind, role, activities, 8 Properties / 9 Units / 2 occupied / 7 available,
member count and the context label the rail uses were all present. Results: 93
web tests, 26 mobile tests, both clients pass type checking and lint, and the
web production build completes across its 50 routes.

**Remaining limitations:** As with Rent, web sign-in requires a password this
session would not enter, so no authenticated live visual review was performed
here; breakpoint behavior was verified from the implemented CSS and the data
path through the service layer. No emulator or physical device is available, so
native rendering, TalkBack/VoiceOver and physical touch remain user-test items.
The review environment has one Portfolio with one member, so the multi-Portfolio
switching rows and the invitation rows were verified from their contracts and
source rather than seen populated. `/organization/setup` — deliberate business
setup — was left as it is; it is a creation flow rather than part of this
record, and belongs with the Settings area if it needs refinement.

**Superseded — 2026-08-24:** `/portfolio` was a primary rail destination when
this was written. On user review it moved to `/settings/portfolio`, and the
inventory roll-up on it was dropped as duplication of Properties and Home. The
identity, switching and invitation decisions still stand.

**Next recommended work:** Provider Team was completed next and is recorded
below.

### Journey: Provider Team

**Status:** COMPLETE — 2026-08-24; awaiting user testing.

**Problems solved:**

- Team was controls, not a roster. The invite form sat permanently open above the
  people you came to see, and every row carried a role select, a Remove button
  and a checkbox per Property — eight Properties and five members rendered forty
  controls at rest.
- Mobile removal fired on one tap with no confirmation at all.
- Role applied the instant the select moved: privilege changed with no statement
  of consequence and no chance to reconsider.
- Web removal used `window.confirm`, a browser dialog in a product that had
  settled on inline two-step confirmation everywhere else.
- Property assignment sent one request per tick, each followed by a full reload.
- Bordered member cards containing bordered Property chips — a card in a card.
- A scoped role saw an empty page. Listing members is owner/admin only. The same
  refusal was being turned into "1 person" on the Portfolio page from the
  previous area — a count invented from a 403 — corrected on both platforms.

**Important decisions:**

- Team is a roster you read: who, what may they do, what may they touch. Nothing
  that mutates access appears until you open a person.
- Roles are described by consequence, not vocabulary — "Manages only the
  Properties you assign, including tenants and lettings", not "Property manager".
- Pending invitations are people who are not in yet, so they sit with the roster
  rather than in a second stack below it.
- Role and scope are staged together and applied by one Save; the difference is
  computed and sent, not every checkbox.

**Reusable patterns:**

- A list row carries what identifies and describes; the controls belong to the
  record it opens (UX-013).
- A group of toggles is staged and settled once (UX-014).
- Mobile `Button` gained `selected`: a tick in a label reads by eye and says
  nothing to a screen reader, so a button used as a choice announces itself as a
  checkbox.
- Dialog shape for this area matches the Lease and Rent records — sticky head,
  scrolling body, labelled facts, and a sticky footer for unsaved changes so the
  action never scrolls out of reach. Each dialog owns its `aria-labelledby` id
  because two are mounted at once.

**Responsive/mobile:**

- Web roster is four columns, collapsing to identity/role/access at 760px and
  stacking at 600px, where the dialog becomes a bottom sheet.
- Native uses a virtualized list, 76px rows that wrap rather than truncate, one
  accessibility label per row, a page sheet for inviting that back cannot dismiss
  mid-request, and a dedicated `team-member` screen with a native destructive
  confirmation.
- Search appears only once a team is large enough to need it.

**Known limitations:**

- No authenticated live visual review — web sign-in needs a password this session
  would not enter. Breakpoints verified from the implemented CSS; the data path
  read back through the live service against a seeded Team covering all three
  access shapes plus a pending invitation.
- No emulator or device, so native rendering, TalkBack/VoiceOver and touch remain
  user-test items.
- Scope is applied as a sequence of single-assignment calls; the API has no bulk
  endpoint. A partial failure leaves earlier changes applied and visible on
  reload, deliberately not hidden behind an invented client-side rollback.

**Superseded — 2026-08-24:** Team moved from the rail to `/settings/team` on
user review. Its roster, dialogs and staged-save decisions are unchanged.

**Next:** Provider Settings was completed next and is recorded below.

### Journey: Settings

**Status:** COMPLETE — 2026-08-24; awaiting user testing.

**Problems solved:**

- Settings did not exist. `/account` was one page holding standing, an archive
  card, photo, name, identity submission, password, trust checks and signed-in
  devices in a single scroll, built from inline styles.
- The two platforms answered "is my account safe" differently: web listed
  sessions, mobile listed devices and a risk level. Neither showed the other.
- **Notification preferences existed in the backend the whole time and no client
  exposed them.** `sms_enabled`, `push_enabled` and `sms_important_only` are real
  fields on a real endpoint, so a user could not turn off an SMS that costs them
  money and costs the platform money. Both apps now expose all three.
- Provider More advertised three features that do not exist — Maintenance,
  Documents, Reports — as disabled rows. Home was cleaned of exactly this; More
  had kept it.
- Settings had no canonical entry: the avatar menu on web, and two different
  places on mobile.

**Important decisions:**

- Web uses a Settings shell with a quiet index and one panel per concern:
  Profile, Security, Notifications, Verification, and Archive for providers.
- **Team lives under Settings** at `/settings/team`, with Archive beside it.
  Both Portfolio and Team were briefly promoted to the rail while being refined;
  on user review they came back here (UX-015).
- **The Portfolio page was removed entirely** on user review — web
  `/settings/portfolio`, mobile `portfolio` and `portfolio-settings`, and the
  workspace CSS with them. Two capabilities it owned needed somewhere to go so
  nobody is stranded: switching Portfolio moved to Team, rendered only when the
  account belongs to more than one, and invitations waiting for you appear on
  Settings → Profile while one is pending — an invitee may not be a provider, so
  it cannot sit behind a provider-only panel.
- **The account menu carries three things**: Settings, the workspace crossing
  and Sign out. It previously held a Portfolio switcher, Updates, Portfolio
  invitations and Archive, each of which lives in the rail or in Settings.
  Listing them again made the menu a second navigation surface (UX-016).
- No Privacy or Billing section: nothing backs them yet. Sections appear when
  functionality does.
- Isolated preferences save immediately; grouped forms keep an explicit save. A
  failed toggle reverts rather than leaving the interface claiming something the
  server did not accept.
- Verification is its own panel rather than being buried under Security. It is
  about standing shown to other people, not about protecting the account.

**Reusable patterns:**

- Settings row: one line, one fact, one control. The devices list and the
  preference toggles share it, so Settings reads the same way whatever the
  concern is.
- The index marks position with `aria-current="page"` and matches exactly, so
  `/settings` does not claim every panel beneath it.

**Responsive/mobile:**

- The web index becomes a scrolling row above the panel below 900px rather than a
  column squeezing the content it serves.
- Mobile is an index of focused screens with native back — not the desktop
  sidebar. Rows are 72px, wrap rather than truncate, and carry one accessibility
  label. Preferences use a real `Switch`, not a tick in a label.
- Both mobile entry points — provider More and the tenant profile — lead to the
  same index instead of each listing part of it.

**Known limitations:**

- No authenticated live visual review; web sign-in needs a password this session
  would not enter. The notification-preference round trip was verified against
  the live service (GET, PATCH off, PATCH back).
- No emulator or device, so native rendering, TalkBack/VoiceOver and touch remain
  user-test items.
- Renaming a Portfolio and changing its activities is no longer exposed
  anywhere. `updateOrganization` still exists and the backend is untouched; the
  UI for it went with the Portfolio page. Auto-created personal Portfolios keep
  their generated name. Say so if that should come back — it would be a compact
  section on Team rather than a page.
- Web still lists sessions while mobile lists devices; they are separate backend
  endpoints with different semantics. Both platforms now sit under a Security
  panel with matching language, but unifying the two endpoints is a domain
  question, not a UI one, and was not invented here.
- `/me/security/` risk standing is shown on mobile only. Surfacing it on web
  needs a decision about what a held payout means to a provider mid-refinement of
  Payments; deliberately left alone.

**Review correction — 2026-08-24:** the shell was built and its contents were
never refined. Three failures, all of them ones §5 and §8 name:

- Every panel said its heading twice. `AccountSections` moved into the shell
  verbatim from the old one-page `/account`, each carrying its own
  `type-title-1` heading — page-title scale, inside a panel already under an h1 —
  its own explanatory paragraph, and its own bordered container. `/settings` read
  "Photo" then "Your photo", in a card inside the panel holding it. The sections
  are content only now; the panel owns heading, copy and frame.
- The index grouped Archive under PORTFOLIO. Archive is archived Properties and
  Units — inventory records. The two groups had been merged for tidiness when the
  Portfolio page was removed, which is grouping by convenience rather than
  meaning. Records is its own group again.
- **Mobile Settings → Profile opened the tenant profile tab.**
  `(tabs)/profile.tsx` re-exported `(app)/profile.tsx`, so the settings
  destination was a screen carrying application history, a workspace switch and
  Sign out, with the Save button for your name below all of it. §11 asks for a
  focused screen. `profile` is the editor alone now; the tab is its own screen —
  identity, history, the workspace crossing and a Settings row.
- Found while splitting them: **signing out existed only on the tenant profile**,
  so a provider had to cross workspaces to leave. Sign out is on the Settings
  index now, where both sides reach it.

**Next:** Notifications was completed next and is recorded below.

### Journey: Notifications

**Status:** COMPLETE — refined 2026-09-14; awaiting user testing.

**Problems solved:**

- The backend emits many event kinds and the feed rendered every one identically. A
  viewing request waiting on a reply looked exactly like a receipt for a payment
  that already went through.
- **Three of the seven target types were a dead tap on mobile.** `organization`,
  `portfolio_invitation` and `property_join_request` fell off the end of an
  if-chain: the row marked itself read and moved you nowhere. A Portfolio
  invitation is the one notification a person cannot act on anywhere else.
- Web sent those same three to the properties list — a wrong destination rather
  than none.
- Both clients carried a `listing` branch for an event that is never emitted.
- Mobile rendered every item as a `Surface`: one card per line of a feed.
- Both pages predated the workspace pattern — inline styles, no focus rings.
- The web empty state described a provider's world to tenants too.

**Important decisions:**

- Updates is a **log**, and says so: "Home is where you see what is still
  outstanding." Home derives attention from live domain state; a notification
  only knows whether it has been read. Two attention queues that disagree is
  worse than one.
- The communication centre has a small **presentation vocabulary**, not a second
  domain lifecycle: All, Unread, Action needed, Rental, Applications, Payments
  and System. Categories that have no records do not take up space. Maintenance
  is not exposed until the backend emits maintenance notifications; an empty
  filter would be dishonest affordance.
- `Action needed` is unread-and-actionable — the only honest proxy the record
  supports, and it clears itself when the row is opened. It is pulled ahead of
  the timeline in All. Home still owns the authoritative live work.
- Actionability is a property of the kind alone, because each kind reaches
  exactly one side of the relationship. `viewing.requested` only ever reaches the
  host, `lease.offered` only ever the tenant, so nothing has to know who is
  reading.
- Every emitted target type gets a destination, and no branch exists for an event
  that is not emitted.

**Reusable patterns:**

- `notificationMeaning` — classification shared across clients, destinations kept
  per platform because the route shapes differ and mobile splits several by
  workspace. Mirrored and guarded (UX-012): one test holds the two kind-lists in
  step, a second checks every classified kind is one the backend actually emits,
  a third checks every emitted target type has a destination on both clients.
  That last one is the guard the dead taps needed.
- Status in words before colour: `Action needed`, `Unread`, `Completed`,
  `Important` and `Read` are explicit text and reach the screen reader through
  the row label. Semantic colour reinforces that language: kola for successful
  completion, harmattan for action/warning, laterite for critical failure,
  lagoon for information and ink/field for neutral history.
- Source labels translate internal kinds into stable human context — Viewings,
  Applications, Agreements, Payments, Plan & billing and Portfolio. The UI never
  exposes event names.

**Responsive/mobile:**

- The shell owns the page title. Neither client repeats “Updates” inside the
  content, and neither adds a dashboard-style summary card above a feed whose
  filters already carry the useful counts.
- Web begins with a horizontally scrollable filter rail and grouped row
  surfaces. The wider canvas improves scanning without turning the feed into a
  table or a two-pane admin tool.
- Native uses a `SectionList` ordered Needs your attention → Today → This week →
  Earlier, with compact filters and one accessibility label per row carrying
  source, title, body, age and status.
- Both clients present at most ten records per page. Filtering still applies to
  the complete bounded history returned by the notification API, so page counts
  and category counts do not change merely because an item sits on a later page.
  Web uses compact Previous/Next controls; native uses the same paging model with
  thumb-sized directional controls.
- Unread is a left rule on both, never a coloured dot.
- Opening an item navigates immediately while the read acknowledgement settles;
  the network request can no longer make a tap feel dead. Longer context remains
  on the destination screen rather than in a notification modal.

**Known limitations:**

- `Action needed` cannot know an item was dealt with elsewhere. Answer a viewing
  on the Viewings page and its notification stays flagged until opened. Fixing
  that properly means the notification tracking its target's resolution, which is
  a domain change, not a UI one — deliberately not invented in the client.
- No authenticated live visual review; the classification was verified against
  the ten real notifications in the development database, which cover three of
  the seven target types. The other four are covered by the guard against
  `handlers.py` rather than by data.
- No emulator or device, so native rendering, TalkBack and touch remain user-test
  items.

**Next:** Stop for user testing. Then the tenant-facing areas.

**Refinement — 2026-09-15, product owner review (mobile).** The same brief as the
provider lists, held against this journey's own rule: Updates is a log, so no
summary card was added and the shell's title is still not repeated.

- **The rail of filter chips became one toolbar:** what is showing and how many,
  Read all while anything is unread (its glyph alone on the narrowest phones), and
  one green Filter. The sheet carries the same vocabulary with its counts — All,
  Unread, Action needed, then only the topics that have records.
- **The feed stands on the hub ground as glass.** A row keeps its glyph in the
  tone's well, the source and the age, the title heavier while unread, two lines of
  the body, and the status in words with Review now where something wants a reply.
  Unread is still a left rule and never a dot — now drawn over the separator, so it
  runs unbroken down a group.
- **Ten to a page still**, with the range and the page controls in one glass bar.
- **Unchanged:** `notificationMeaning` and every classification, the sections and
  their order, opening before the read acknowledgement settles, pull to refresh and
  the error notice. Added: a skeleton shaped like the rows, and a large glyph when
  there is nothing yet.

**Verified:** five new tests in `updatesFeed.contract.test.mjs` beside
`updatesWorkspace`'s, and the mirror above. Checked at 390×844 and 320×640 with
fourteen mocked updates: the toolbar, the sheet and its topics, Action needed, Read
all clearing it, both pages, and nothing yet.

### Fix: photographs that never loaded

**Status:** COMPLETE — 2026-08-25; awaiting user testing.

Two unrelated causes, both of which ended in an empty frame, and between them
they covered most of the product.

---

**Cause one: a URL an `<img>` cannot load.**

`GET /api/v1/files/<id>/download/` does not serve bytes. It returns
`{"url": …, "expires_in": …}` so the read goes from object storage to the client
without passing through Django, and it requires a bearer token. Measured
against the running API: **401 `application/json`** unauthenticated, and
**JSON** authenticated. An `<img src>` can do neither.

Three serializers handed that path out as `download_url` for every read that was
not the public one — which is every provider-side read there is:

| Serializer | Broken for |
|---|---|
| `UnitMediaSerializer` | any non-public context |
| `PropertyMediaSerializer` | **always** |
| `ListingMediaSerializer` / `_listing_photo_url` | any listing not currently ACTIVE |

So the Unit page, the Units list, the Property page, the photo manager and the
gallery of any withdrawn or paused listing — on both clients. Confirmed on live
data before the fix: `primary_photo.download_url` came back as
`/api/v1/files/…/download/`.

The product had already hit this once and patched it locally.
`apps.trust.condition._provided_detail` still carries the comment: *"which is
how every listing photograph on this product once failed to appear inside an
`<img>`"*. The lesson never reached the media serializers.

**The fix** is one helper, `apps/files/photos.py`, used by all four call sites: a
**photograph** gets a 300-second presigned `inline` URL; anything else keeps the
audited endpoint. The gate is deliberately *narrower* than the public one
already is — usable, not sensitive, `purpose == PROPERTY_PHOTO` — so identity
documents, property documents and verification evidence still go through the
endpoint that records the read. Anything the helper refuses falls back to
exactly the previous behaviour, so nothing private became public.

`inline` rather than the default `attachment` matters as much as the URL itself:
with an attachment disposition the request succeeds and the frame still stays
empty.

---

**Cause two: Explore looked in the wrong place.**

The listing card read `listing.media`, which is *campaign* media — an optional
set a provider may attach to an advertisement. **Nothing in the normal flow
creates any.** Photographs are uploaded to the **Unit**, because the Unit is
what the condition check is decided on and what `SpacePhotos` manages. On a
freshly built database there are **zero `ListingMedia` rows and twelve
`UnitMedia`**, so every card found nothing and said "Photo pending".

`cover_url` on `ListingSerializer` now follows the same order the detail gallery
does — the Unit's own primary photograph, then the rest of the Unit's, then the
campaign's — and both cards read it with campaign media as the fallback.

No trust snapshot per listing: an ACTIVE listing has already passed
`can_publish`, which asserts `space_condition_ok(unit)`, and if that check later
lapses `suspend_for_verification` takes the listing out of discovery. `status ==
ACTIVE` *is* the gate, which is the reasoning
`application.services.submit_application` already records. The photographs are
prefetched with the rows, so the search endpoint stays flat in query count —
measured at 11 queries for a page.

---

**What was already correct and is untouched:** avatars, which both clients
resolve through their own `photo.ts`; and evidence previews, which
`condition._provided_detail` had already been presigning inline.

**No client rendering changed.** Every `<img>` and `<Image>` already read
`download_url` — they were pointed at something that could not load. One card
read moved to `cover_url`.

---

**Cause three: one storage address cannot serve every client.**

A presigned URL carries the host it was signed for — SigV4 signs the `Host`
header, which is what `X-Amz-SignedHeaders=host` means in every one of them — so
the address cannot be rewritten after the fact. `S3_PUBLIC_ENDPOINT_URL` was
`http://localhost:9000`, which a desktop browser resolves to the API machine and
a phone or an Android emulator resolves to **itself**. Web worked; mobile showed
empty frames.

Mobile already solved this for the API: `src/api.ts` derives the host from
Expo's `hostUri` and falls back to `10.0.2.2` on the emulator. Storage had no
equivalent, and that asymmetry was the bug.

`S3_PUBLIC_ENDPOINT_FOLLOWS_REQUEST` takes the **host** from whoever is asking
and the scheme and port from the setting. The host a client reached the API on
is, by construction, one that client can resolve, so a laptop, an emulator and a
handset are all served at once with no address to maintain. Each address gets
its own signing client, so the signature is minted for the host the URL will
actually be fetched on rather than rewritten afterwards — a rewrite is what
returned 403 for every download in an earlier incident the code still documents.

`request.get_host()` is validated against `ALLOWED_HOSTS` before it is used, and
the flag is **off by default**: in production the storage host is a CDN or a
bucket that has nothing to do with the host the API answers on, so following the
request there would be wrong.

Verified by sending four Host headers to one API:

| Client reached the API on | Storage host issued |
|---|---|
| `localhost:8000` | `localhost:9000` |
| `172.20.10.4:8000` | `172.20.10.4:9000` |
| `10.0.2.2:8000` | `10.0.2.2:9000` |
| `192.168.1.42:8000` | `192.168.1.42:9000` |

Both the LAN-derived and the localhost URL fetch **HTTP 200, image/jpeg**, so
the signature holds for each.

**Known limitations:**
- No authenticated live visual review; the URLs were verified by fetching them
  (`HTTP 200 image/jpeg, 335,869 bytes`) rather than by looking at a page.

**Next:** Stop for user testing.

### Fix: Private access belongs to the Unit

**Status:** COMPLETE — 2026-08-25; awaiting user testing.

**Why the code did not appear on the web.** Both clients read Unit access codes
from one place: `tenant_access` on the Portfolio summary, which is scoped to
**organization membership**. A provider who holds authority over a Property
directly — no Portfolio — is not in that read at all. In the review database the
account managing Adom Heights, Rhema Jason, Makola, Legon Student House and Adom
Courtyard belongs to **zero organizations**, so the web "Private access" tab
showed its empty state while three of their verified Units carried live codes.

Nothing was broken about the codes themselves. `GET /units/<id>/` has always
returned `access_code`, and it is scoped by `is_managed_by` — the authority that
actually decides this. The data was one field away the whole time; no screen
read it.

**Why it could not be managed from the Unit.** Neither Unit detail exposed it.
Mobile carried a "Tenant access" heading whose only content was a link to the
Tenants tab; web had nothing. A provider looking at the Unit they wanted to
share had to leave it, find the right card in a portfolio list, and come back.

**What changed:**

| Element | Verdict |
|---|---|
| Access code on the Unit page | ADDED on both clients, read from the Unit's own record |
| Mobile "Tenant access" heading + "Open Tenants →" | REPLACED — the section is the thing now; the link that remains says *Tenancy requests and tenancies*, which is what it actually leads to |
| Web "Manage tenant access and tenancies →" | REWORDED for the same reason — access is no longer managed elsewhere |
| Two copies of the state copy, one per client | REMOVE AS DUPLICATE — `accessCodeMeaning.ts`, mirrored |
| "This is the private acquisition path…" explainer | REMOVE — one sentence now says what a code does, at the moment it is offered |
| A card explaining that an unchecked Unit cannot have a code | REMOVE — its verification section already says what is missing |

**Important decisions:**

- **The section renders only when it is worth showing.** `privateAccess()`
  decides, not the components, so both clients agree: hidden entirely for a
  reader who may not share the space; hidden for a Unit that has not been
  checked, because its verification section already answers that; shown with one
  line when the Unit *is* verified and one specific thing blocks sharing —
  today, an occupant. Measured, the blocked state is 107px and offers no
  controls at all.
- **A control the service would refuse is not offered.** `access_codes.snapshot`
  answers from the Unit alone and cannot know who is asking, so `can_rotate`
  came back true for somebody who may read a Unit but not share it. The
  Portfolio read had already narrowed both flags by the `tenant_access`
  capability; the Unit read had not, so the same Unit answered two different
  ways depending on which screen asked. The Unit read now narrows them the same
  way and both paths return `can_manage`.
- **One implementation per platform.** The web Tenants tab renders the same
  `UnitPrivateAccess` component the Unit page does, so the two cannot drift.
  Mobile's `UnitAccessCodeManagement` is used from both its Unit screen and its
  Tenants tab.
- **The readable value is still shown once and never stored.** It lives in
  component state after issue, is never reconstructed from a Unit response, and
  no read returns it. A contract test asserts all three.

  Which makes anything that unmounts the card fatal to it, and something did.
  The Tenants page cleared its Portfolio at the start of every load, including
  the refresh a provider's own action triggers — so creating a code set the
  card's state, blanked the branch the card was in, and rebuilt a fresh one with
  the code gone. It flashed and vanished. Blanking is how a *different*
  Portfolio should load, not how the current one should refresh, and it now only
  happens when the Portfolio actually changes.

**Backend:** `UnitSerializer.get_access_code` narrows `can_rotate` / `can_revoke`
by `PropertyCapability.TENANT_ACCESS` and adds `can_manage`; the Portfolio read
gains the same key. No lifecycle, no new endpoint, no change to how codes are
generated, hashed, rotated, revoked or resolved.

**Responsive:** the section is a short block under the Unit's management
disclosures on both clients. Measured at 375×812: active 191px, freshly issued
242px, no-code-yet 167px, blocked 107px, no horizontal overflow. The issued code
renders in the mono face at 17px with `user-select: all`, so one tap selects the
whole thing.

**Known limitations:**

- No authenticated live visual review — signing in needs a password. States were
  measured against the compiled stylesheet in a headless browser; the data was
  read back through the live serializer for a provider with no organization.
- Mobile native rendering is unverified: no emulator or device.
- `tenant_access` on the Portfolio summary is still organization-scoped. That is
  correct for a Portfolio view, but it means the Tenants tab remains blank for a
  provider without one — they now reach every code from the Unit instead. A
  Portfolio-free provider having no tenant *workspace* at all is a larger
  question than this fix.

**Next:** Stop for user testing.

#### Follow-up: the tab shows three, not all of them

The Tenants tab listed every share-ready Unit, each as a full card carrying its
own access-code section. At three Units that reads as a workspace; at thirty it
is a wall, and the one Unit the provider came to share is somewhere inside it.

It now shows **three**, with a single line beneath saying what is off screen and
one link to all of it:

> Showing 3 of 12 ready to share. 4 other Units are not ready yet. See all Units →

This is only tenable because private access is no longer exclusive to this tab
— the fix above put the same section on every Unit's own page, so **Units** is a
complete answer rather than a consolation. The two facts share one line because
they answer one question between them: *where is the rest of my inventory, and
why is some of it missing here.*

Both clients cap at the same `ACCESS_PREVIEW = 3` and both link to Units. The
mobile list is virtualized and could afford to render all of them, but the point
is not rendering cost — it is that this tab is somewhere to create a code, not
an inventory to browse.

**Next:** Stop for user testing.

#### Refinement: rent leads, and the two lists stop looking alike

Mobile only. The complaint was that the middle of the page read as one
undifferentiated run, and it was right for a specific reason each time.

**Rent shared a row with the agreement.** Two equal flex columns, same size,
same weight — so the amount somebody owes carried no more emphasis than the
words "Active until March". Money and paperwork are not peers on a rental home
screen. `RentBlock` now takes the body of the card and answers five things in
the order they are asked: **how much** (display size), **whether it is a
problem** (a chip, not colour on the number alone, so it survives both kinds of
colour blindness), **when**, **which home**, and **what to do** — a Rent account
action, offered only where a lease exists to open. The agreement drops to one
quiet line beneath; its terms live in Agreements. The card's border turns
`laterite` when rent is overdue.

Still one block per home. `lib/tenancy.ts` is emphatic that ambient selection is
how a tenant renting two places lost sight of one, so nothing is summed and
there is no "current" tenancy.

**Coming Up and Rental Activity were the same rows twice.** Both were plain
two-line entries in identical type, which is why a heading between them did not
separate them. They now read as opposites:

| | Coming Up | Recent activity |
|---|---|---|
| Tense | future | past |
| Anchor | a date on a left rail, with a connecting rule | a relative time trailing the line |
| Shape | a schedule | a feed |
| Interaction | none — you read it and plan | "See all" |

**The activity feed already existed and nobody was reading it.** The notification
stream *is* rental history — `lease.activated`, `application.accepted`,
`viewing.confirmed`, `payment.succeeded`, each with the time it happened — and
Home already fetches it for the unread count. One read, two jobs, no new request.
Filtered to tenant-rental kinds so provider and account noise never appear, and
read/unread is ignored: it makes no difference to a history.

This does not contradict the earlier decision that notifications are not a second
attention block. Attention is derived from records and answers *what is
outstanding*; this answers *what happened*. Different tense, different job.

**Everything Else stopped restating the tab bar.** Services, Saved and Explore
are all tabs one row below; shortcuts to them were duplication on the same
screen. Replaced with **Rent account**, **Agreements**, **Applications** and
**Updates** — deeper areas, none of them a tab.

**Payments is absent, and that is a finding.** There is no tenant payments
screen: `payments.tsx` exists only under `(provider-tabs)`, and a tenant's
payment history lives inside the per-lease rent account. Shipping a "Payments"
row would have been a second door to the screen the row above it already opens
— the same duplication this refinement was asked to remove, one level down.
`/me/rental-history/` exists on the backend with no mobile client or screen; that
is the honest place to build one.

**Rent account is conditional.** The screen is per-agreement and answers "this
rent account could not be found" without a `leaseId`, so the shortcut appears
only when exactly one tenancy has a lease. Each home card carries its own way in
regardless, which is the path that always works.

---

#### The "+" and the thing it was hiding

Removed as asked. It floated beside the greeting and could have meant add a
home, add a payment, or add anything at all.

**But it was the only entry point to `tenant-setup` for a tenant who already has
a home.** Profile lists Applications, Viewings, Saved, Security, Notifications
and Your checks — no Join. Deleting the glyph outright would have removed the
ability to join a second tenancy from the product entirely. So it became words
where they belong: **Join another home**, under the homes it would join, with a
key glyph and the access-code hint intact. The empty state keeps its own
access-code half.

Two existing contract tests pinned the old shape — `accessibilityLabel="Join a
home"` and `<Ionicons name="add"`. The rule they encode is *Join is offered on
tenant Home whatever account state you are in*, and the gate that enforces it
(`tenantMode = Boolean(me)`) is untouched. Repointed at the new affordance, with
one added assertion that the glyph is **gone**, so the removal cannot silently
undo itself.

**Validation:** 182 contract tests across both clients, both typechecks, both
lints. Six guards mutation-verified: removing the join affordance fails, a tab
reappearing as a shortcut fails, provider noise entering the history fails,
demoting the rent amount fails, and both repointed join tests still fail when
the affordance loses its name.

**Known limitations:** no device or emulator — the card, the rail and the feed
are asserted, not seen. Web is untouched, as briefed. During the loading
skeleton no join affordance is on screen; the old glyph was in the header and
always visible. That window is one request long and the empty and loaded states
both carry it, but it is a real difference rather than an oversight.

**Next:** Stop for user testing.

#### Correction: the schedule was broken, not just tight

Reported as "too close" and "poor arrangement". The spacing was the smaller of
the two problems.

**The entry was laid out wrong, and I broke it.** The rail added when Coming Up
became a schedule was a `::before` with `grid-column: 2` in a three-track grid.
A generated child is still a grid item, so it took a slot and auto-placement
scattered the rest of the row: the date landed in track 1, the mark in track 2,
and **the text wrapped onto a second row 88px wide and four lines tall.**
Measured in the browser at the column's real 304px, not inferred.

It went unnoticed because the entry was designed for a full-width row and only
later moved into a 19rem column, and because the test I wrote asserted the
*declaration* — `grid-template-columns: 5.5rem 12px minmax(0, 1fr)` — which was
present and correct while the result was not. A rule can be exactly what you
wrote and still produce the wrong layout; only measuring catches that.

Rebuilt for the column it actually lives in: the mark is a real element rather
than a pseudo-element, one 14px track beside one text track, and the date stacks
above what it dates instead of claiming 5.5rem of its own. The connector runs to
the next mark and stops at the last, the same construction the application
timeline uses.

| | Before | After |
|---|---|---|
| Text column | 88px | **245px** |
| Place line | 4 lines | **1 line** |
| Tracks | `88px 12px 180px`, text on row 2 | `14px 245px` |

**Then the spacing.** `space-6` is the gap between sections stacked in one
column; two regions side by side need more. Now `space-8`, with a hairline rule
and matching padding on the schedule — this system separates regions with edges,
and past a point extra whitespace stops reading as separation and starts reading
as a mistake.

**Validation:** 194 contract tests, typecheck, lint. Four guards
mutation-verified, and the two stale assertions were repointed at the result
rather than the declaration.

**Next:** Stop for user testing.

#### Web: homes beside what is next

The side-by-side treatment recorded as outstanding twice. My homes takes the
left column, Coming up a steady 19rem on the right.

Stacked, a home card ran the full width of the content column — 7rem of
photograph, a title and two short lines, and the rest whitespace — and it pushed
the schedule below the fold on the one screen whose job is to say what is next.

**A container query, not a media query.** The rail beside this column is
`16.5rem` and collapses at 48rem, so the same viewport gives the content wildly
different widths. A viewport breakpoint would split the page into two cramped
columns on a wide screen with the rail open, and leave it in one column on a
narrower screen with the rail shut. `.tenant-home` declares
`container-type: inline-size` and the split is measured against the column
itself — the first container query in this codebase, and the case that
genuinely wants one.

The threshold is **47rem of column**: a 19rem schedule, the gap, and 26rem left
for a card whose photograph alone is 7rem. Measured against the widths the shell
actually produces, rather than against the viewport:

| Viewport | Content column | Columns |
|---|---|---|
| 1024 | 728px | one — below the threshold |
| 1120 | 824px | `496px 304px` |
| 1280 | 984px | `656px 304px` |
| 1440 | 1144px | `816px 304px` |

The homes absorb every extra pixel; the schedule holds its measure, because a
date and two short lines gain nothing from more room. It is also sticky: two
homes against four upcoming entries is a short right column beside a tall left
one, and without it the schedule sits marooned at the top.

**Attention still spans both.** It outranks the split, and a ranked list of
things waiting on somebody should not be squeezed into a column.

**A note on earlier measurements.** Probes in previous entries appended elements
to `document.body`, which is the full viewport — the *rules* they verified
resolved correctly, but the pixel widths were not the real content widths. This
entry's probe reconstructs the column from the shell's own arithmetic.

**Validation:** 193 contract tests, typecheck, lint. Three guards
mutation-verified: reverting to a media query fails, dropping the sticky
schedule fails, and collapsing the split fails.

**Known limitations:** measured against the compiled stylesheet in a real
browser, not on an authenticated page.

**Next:** Stop for user testing.

#### Web follows, and "Rental activity" goes

The same two moves, applied to web, plus the removal on both.

**Rent leads the card.** It was one of two equal columns in a definition list,
at the same size as the agreement beside it. Now its own block: label with a
status **chip** (not colour on the number alone), the amount at 2rem, the due
date and which home on one line beneath, and the agreement demoted to a single
quiet line. Verified against the live cascade rather than the source — 32px,
`laterite` when overdue, chip background and text both `laterite`.

**Coming Up became a rail.** It used ruled rows identical to the activity list
below it, which is the actual reason a heading between them did not separate
them. Now a three-track grid — date, rail, content — with a dot per entry and a
`box-shadow` connector that stops at the last one, so the group reads as a
single run of time. Measured live: `88px 12px 476px`.

**The "Rental activity" section is gone from both clients.** With homes on
screen it sat between the schedule and the shortcuts, in rows shaped like the
schedule's, saying Applications / Viewings / Access request and very little
else.

Two things it carried had to survive it:

- **The empty state keeps the rows**, renamed **In progress**. Without a tenancy
  they are the whole point — they answer *what is happening with the places I
  asked about*, and dropping them would make a submitted application invisible
  on the one screen that person has. The CSS deleted with the section was
  restored for exactly this.
- **A pending access request** appeared nowhere else once somebody already had a
  home. `attention()` covers *rejected* requests, because those wait on the
  tenant; a pending one waits on the landlord and is not attention. It is now
  one line beneath the homes, on both clients.

**A section removed and nothing failed.** The whole block was unguarded — no
test named it on either client. Three tests added and mutation-verified: the
name coming back fails, losing the pending access request fails, demoting the
web rent amount fails, and a rail connector that never stops fails.

**Validation:** 185 contract tests, both typechecks, both lints. The new web CSS
checked in a real browser, not read.

**Known limitations:** mobile remains unseen — no device or emulator. Web was
verified by probing the compiled stylesheet, not by looking at an authenticated
page. The brief's richer web treatment — side-by-side tenancy overview,
timelines, payment and lease detail — is **still outstanding**; this pass
brought web level with mobile rather than using the extra width.

**Next:** Stop for user testing.

#### Refinement: the wait, and everything else

Re-briefed as a full control-center redesign. **The information architecture was
not rebuilt, and that is the finding rather than a shortcut taken.** The four
questions — *does anything need me, what am I renting, where do rent and
agreement stand, what is coming next* — already order the page, already adapt to
the lifecycle, and already collapse what used to be three competing banners into
one ranked block. Redoing that would have been churn dressed as progress.

Three things in the new brief were genuinely missing. Two were added. One should
not be, and the reason matters more than the other two.

---

**The wait was a caption.** Home rendered `Loading your homes…` on one line —
generic rows on web — then pushed the whole page down when the data landed.
Both clients now draw a skeleton with the real card's geometry: photograph
block, title, locality, and the rent/agreement pair. Nothing jumps, and the wait
reads as *this screen loading* rather than *this screen being empty*.

The pulse is the quietest one that still says working — opacity 0.45 → 1 on the
shared `slow` token. Reduce Motion holds it still rather than removing it: the
shape is the point, the movement is only reassurance. Extracting that check
turned up a duplicate-in-waiting, so `useReduceMotion` moved out of the tab bar
into `src/motion.ts` and both consumers share it. A second copy of an
accessibility check is a second place to forget it.

**Shortcuts, on the client that has no shell.** Mobile gained a quiet
*Everything else* block — Services, Saved, Updates, Explore — last on the page
and visually subordinate to everything above it. A count appears only when there
is one; "Saved · 0" is not information, and a row of zeroes reads as a product
nobody uses. The counts ride the existing tolerant batch, each with its own
`catch`, so neither can fail the load Home actually exists for.

**Web deliberately did not get them.** The web shell already carries Explore,
Saved, Applications, Agreements, Viewings and Updates in persistent left-hand
navigation. Repeating them along the bottom of Home would be exactly the generic
dashboard grid the brief rules out — the same six links, twice, on one screen.
Mobile has no such shell, which is the entire reason the block earns its place
there. The CSS written for it was removed rather than left dormant.

---

#### Why "notifications requiring action" is a shortcut, not a section

The brief asked for it as its own item. Adding it would have rebuilt the problem
the previous pass removed.

`attention()` already derives what is waiting **from the records themselves** —
an unpaid charge, an offered lease, a viewing or application needing a reply, a
rejected access request. Every actionable kind `notificationMeaning` recognises
is already one of those:

| `WANTS_A_REPLY` kind | Already covered by |
|---|---|
| `viewing.*` | `viewingsWaiting` |
| `application.submitted`, `tenancy_request.created` | `applicationsWaiting` |
| `lease.offered` | `offeredLeases` |
| `organization.invitation_created` | provider side, not this page |
| `payment.failed` | no PSP exists, so none can |

And the module defers to Home in as many words: *"Home is what actually knows
what is outstanding; this never claims to."* An unread flag is the weaker
signal — it clears when a row is opened, whether or not anything was done. A
second block would have said the same things twice, less accurately the second
time. So Updates is a shortcut with an unread count, and attention stays one
ranked list derived from facts.

**Maintenance stays absent** for the reason already recorded: there is no
maintenance domain, and a card reading "No open issue" is a promise the product
cannot keep.

---

**Validation:** 178 contract tests across both clients, both typechecks, both
lints. Three guards mutation-verified: reverting web to generic loading rows
fails, making the skeleton ignore Reduce Motion fails, and removing mobile's
shortcuts fails. One assertion repointed rather than deleted — the tab bar test
named `AccessibilityInfo` directly, and now names the shared hook it moved to.

**Known limitations:** no device, emulator or authenticated browser session —
geometry, motion and both skeletons are asserted, not seen. The brief's richer
web treatment (side-by-side tenancy overview, timelines, payment and lease
detail) is **not** done: the web Home remains a single column of sections. That
is a real gap against the brief rather than a decision, and it is the next piece
of work here.

**Next:** Stop for user testing.

### Fix: a Public filter on Units

**Status:** COMPLETE — 2026-08-25; awaiting user testing.

Units filtered on availability alone — All, Available, Occupied, and Attention
when it applied. None of them answered *what is currently on Explore*, which a
provider has to know before they can reason about why nobody is calling.

**One filter, no backend work.** The Unit already carries `publication` — state,
label, `listing_id` and `listing_status` — because `unit_publication` reads it
from the listing rather than storing a second copy on the space.

**Public means on Explore, not offered to it.** `publication.state ==
"published"` says the provider is offering the space publicly, and that is also
true of a listing waiting in the review queue, one a reviewer has flagged, and
one Management has suspended. Public search shows none of them — it filters on
the derived `status == "active"`. So the tab reads both fields:

```ts
const isPublic = (unit: Unit) =>
  unit.publication.state === "published" &&
  unit.publication.listing_status === "active";
```

Filtering on `publication.state` alone would have put a count on screen that no
tenant could reproduce. `unit_publication` already applies the other exclusion
public search does: a published listing on an occupied Unit reads as *"Not
public while occupied"*.

**A filter and nothing else.** No publish, withdraw or edit control moved onto
this screen; those live on the Unit, which is where the listing does. A contract
test asserts their absence, so the tab cannot quietly grow into a second
management surface.

**A guard that was asserting nothing.** The card test forbade
`publication.state === "published"` across the whole page file, so a filter
tripped a rule written about the *tile* — "a Unit card carries enough to
recognize it and nothing more". Narrowed to `UnitCard`'s own body rather than
deleted, since the intent still holds. The first extractor matched the
destructured parameter's braces (`({ unit }: { unit: Unit })`) and returned the
signature, so the assertion passed vacuously; mutation-testing caught it —
printing `publication.label` onto the tile did not fail the suite until the
extractor stepped over the parameter list first.

**Out of scope, deliberately.** Modifying a listing from this tab was raised and
declined. Recorded below because the constraint is real and will resurface.

> `update_listing` permits `DRAFT`, `REJECTED` and `FLAGGED` only. Withdrawing an
> ACTIVE listing moves the publication axis but keeps `moderation_state =
> APPROVED`, so the status becomes `WITHDRAWN` — still outside the editable set.
> **Once approved, a listing's terms cannot change again, live or withdrawn.**
> This is deliberate and tested: `test_an_approved_listing_cannot_be_edited_at_all`
> explains that skipping re-review on the way back up is only sound if the terms
> cannot have moved in between. The same test names the widening path — *"If
> that allowed-set ever widens, `update_listing` clears the approval"* — and
> that branch already exists in `update_listing`, currently unreachable. Web's
> `updateListing()` in `console.ts` is likewise dead code, called by nothing.

**Validation:** 100 web and 44 mobile contract tests, both typechecks, both
lints. Both new guards mutation-verified.

**Next:** Stop for user testing.

### Fix: Properties get a face, and Units get columns

**Status:** COMPLETE — 2026-08-25; awaiting user testing.

Two changes to the same journey. The Properties list identified a building by
name and address alone, and opening one listed its Units one per line.

---

**The thumbnail, and the third time this bug has appeared.**

`Property` carried no photograph field at all, so there was nothing to render.
Adding one meant deciding where a Property's picture comes from, and the obvious
answer is wrong in the same way it was wrong for Explore:

| Model | Rows on a built database |
|---|---|
| `PropertyMedia` | **0** |
| `UnitMedia` | 12 |

`PropertyMediaView` is routed and `attach_media` works — and **neither client
calls either**. There is no way to upload a Property photograph from web or
mobile, so a cover reading only `media` would have been an empty frame on every
row forever. Third occurrence of one shape: *the model that ought to hold the
photograph is not the model the photograph is on.*

`cover_url` reads the Property's own exterior or interior first, then falls back
to a photograph from one of its Units. Its own media leading is what makes the
fallback temporary: the day an upload flow exists, this stops falling back with
no change to the serializer.

Documents are refused twice over — `kind` is filtered to the two photographic
kinds, and `inline_image_url` refuses any file whose purpose is not
`property_photo`. Either guard alone would stop a title deed becoming a
thumbnail; a test pins both. A floor plan is a photograph by purpose and still
not the face of a building, which is why `kind` is filtered rather than trusted.
Retired Units do not supply one either.

Both list endpoints prefetch it — `PropertyListCreateView` and
`OrganizationPropertyView`, which serve web and the mobile Properties tab from
the same serializer. Measured: **5 queries for the cover regardless of row
count**, against 9 and climbing without the prefetch.

---

**Units five across.**

One per line put a hostel's fortieth room a long way below the fold, and a row
is mostly the whitespace between four short facts. Units are told apart by sight
before they are told apart by name, so the photograph leads.

The tile is the one **Units** already uses — same Unit, same card, no second
card design. It keeps `spaceStatus`, which is verification- and
publication-aware, rather than dropping to the availability label.

Bath count moved to the Unit itself. At a fifth of the shell the meta line is
one ellipsised line, and the two facts that identify a Unit *within a Property
you are already looking at* are what kind of space it is and how big.

**Five is a desktop answer.** 5 → 3 → 2 at 64rem and 48rem.

**The bug that layout nearly shipped with.** A Property row needs five tracks
where a Unit row needs four — it carries Unit counts beside the status — so it
took a compound selector, `.inventory-row-with-media.inventory-row-with-stat`.
That is specificity (0,2,0), and the narrow override it has to yield to was
(0,1,0), so **the five-column desktop template would have won inside the phone
media query** — source order does not settle that. The override now names the
same compound selector. Verified in the browser rather than by reading:

| Viewport | `.unit-columns` | Property row |
|---|---|---|
| 1280px | 5 | `104px 736px 144px 176px 24px` |
| 960px | 3 | — |
| 700px | 2 | `80px 560px 20px` |

**Validation:** 15 image tests (6 new, all mutation-verified), 99 property
tests, 101 web and 44 mobile contract tests, both typechecks, all lints, ruff.
Cover URLs fetched: **HTTP 200 `image/jpeg`, `inline` disposition**.

**Known limitations:**

- No authenticated visual review — signing in needs a password. Layout was
  measured against the compiled stylesheet in the live browser; the URLs were
  verified by fetching them.
- Mobile keeps its row layout for Units inside a Property. Five columns on a
  handset is five slivers; the Properties thumbnail is the part that carried
  over.
- `PropertySerializer` costs ~63 queries per row before any of this
  (capabilities, verification, amenities). Pre-existing and untouched.

**Next:** Stop for user testing.

#### Correction: the cover is the building, not one of its rooms

The cover fell back to a photograph of one of the Property's Units. That was
wrong, and obviously so once said plainly: **a room is not the block containing
it.** A property of twelve flats wore whichever flat happened to be photographed
first, and two buildings with a similar interior became hard to tell apart in
the one list whose whole job is telling them apart.

**Photographs of the building already existed.** Not in `PropertyMedia`, which
is still empty — but every Property is asked for its **front, a side and its
surroundings** before it can be verified, and those are stored as condition
evidence. On the live database: 22 files with purpose `property_photo`, 12 of
them Unit media, and **10 attached to property verifications**. Pictures of the
place, taken for that purpose, sitting unread.

`trust.condition.cover_photographs` now supplies them. Both properties in the
database resolve to their `property_front`.

**Why the slots being *named* is what makes this possible.** The evidence policy
asks for the front, a side and the surroundings as three separate slots rather
than three anonymous exterior uploads — so that a reviewer knows which wall they
are looking at, and a provider who sends the same one three times is told which
two are missing. That naming is exactly what a cover needs: `COVER_SLOTS` is
ranked, so the front of a building beats a side, which beats the surroundings.

Deliberately absent: the water source and the electricity meter. Both are
collected under `property_photo` like the rest, and both are photographs of a
*fact* rather than of the place. Only the slot list keeps them out, which is why
a test pins it.

Superseded reviews are excluded — a correction is a new verification, and the
picture it replaced should not come back as the building's face. Open reviews
are included: a provider who has just uploaded their front elevation should see
it, not wait for a reviewer.

**Batched, because it cannot be prefetched.** `Verification.subject_id` is a
`CharField`, not a foreign key, so `prefetch_related` cannot reach it and the
obvious implementation puts a query behind every row. The serializer resolves
the whole page in one query and caches it on the `ListSerializer`. Measured:
**3 queries for a Properties list of any length**, and a test asserts the
batch is exactly 1.

**A near miss worth recording.** The edit script that introduced this matched
its end-marker (`def get_amenities`) against an *earlier* occurrence in another
serializer, so the slice `s[:start] + new + s[end:]` silently duplicated 256
lines — a second `PropertyMediaSerializer` and a second `PropertySerializer`.
Caught by a class-count check, not by the type checker or the tests, both of
which were happy with the last definition winning. Repaired by deletion rather
than `git checkout`, because the file carried unrelated uncommitted work.

---

#### Mobile: Units two across

The row — one Unit per line, a 68pt square beside it — put a hostel's fortieth
room a long scroll away, and gave two thirds of the width to four short facts.

Both mobile Unit lists now render `UnitTile` at `numColumns={2}`: **Units**, and
**Units inside a Property**. One component, so a Unit looks the same whichever
way it is reached. The photograph takes the tile's full width at 4:3 rather than
a thumbnail's corner of it.

**Type steps down, and stops.** 15/20 for the label and 13/18 for the meta line,
against the row's 16/24 and 14/20. Half a phone is a narrow column and a label
that wraps to three lines reads worse than one slightly smaller. **13pt is the
floor** — a test asserts nothing in the tile goes below it, because "reduce the
font size" has an end and 11pt is where a card stops being readable and starts
being decorative.

**Two details that separate a grid from a broken grid:**

- `maxWidth: "50%"`. With `flex: 1` alone, a lone tile on an odd last row
  stretches the full width — and odd counts are exactly what real portfolios
  produce. Mutation-tested.
- The status may **wrap to two lines rather than truncate**. `StatusLine` gained
  a `compact` mode: a step smaller, the dot pinned to the first line, two lines
  allowed. "Verification in pro…" is worse than a status on two lines, and tiles
  in a row stretch to the tallest anyway.

**Web is unchanged at five.** Five columns on a handset is five slivers; two is
the handset answer to the same question.

**Contract tests repointed, not deleted.** `function UnitRow` moved into the
shared tile, so the assertions moved with it — the rule they encoded (these
screens render Units through a component, not an inline `map`) still holds.

**Validation:** 913 integration tests, 19 image tests, 101 web and 45 mobile
contract tests, both typechecks, all lints, ruff. Three new guards
mutation-verified: re-adding the Unit fallback fails, removing `maxWidth` fails,
dropping type below 13pt fails.

**Known limitations:** no device or emulator, so the mobile grid is unverified
visually — the layout rules are asserted, not seen.

**Next:** Stop for user testing.

### Fix: a way out of every screen a tab does not hold open

**Status:** COMPLETE — 2026-08-25; awaiting user testing.

Most non-tab screens already had a back button, because they are pushed onto a
Stack and the platform draws one. The problem is the word *most*.

**The native back button renders only when the stack has history**, and several
routes here arrive without any:

- `router.replace` **from inside a tab replaces the tab group itself.** Tenancy
  requests is reached exactly that way — `tenants.tsx` redirects on
  `?view=requests` — so the screen opened with no back button *and no tab bar*.
  On iOS, with no hardware back, that is a dead end. On Android the system
  button leaves the app.
- Eleven other `router.replace` calls land on non-tab screens the same way.
- **The four modals had nothing at all.** iOS shows no back button on a modal
  presentation, so `viewing/[id]`, `application/[id]`, `agreement/[id]` and
  `provider-actions` had a title and no control. Dismissing meant knowing to
  swipe down.

---

**One control, in `screenOptions`.**

`BackControl` is set once on the `(app)` Stack, so a screen has to opt *out*
rather than remember to opt in — a route added tomorrow gets it without anyone
thinking about it. It replaces the platform button (`headerBackVisible: false`)
rather than sitting beside it.

**It never asks only "can I go back".** With history it goes back; with none it
goes *home* — to the same entry route the app resolves at sign-in, which is the
tenant or provider surface this person actually uses rather than a fixed guess.
That is the whole point: there is always a way out.

**A modal is closed, not returned from**, so those four get a `close` glyph
instead of a chevron. Different gesture, different word, different icon.

**26pt icon in a 44pt target.** The smallest reliably hittable control, and the
measurement that decides whether a header feels considered or fiddly.

**One terminal exception.** `restricted` gets `headerLeft: () => null`. Access is
limited and the entry route the fallback would use is the very surface being
withheld — a back control there is a loop, not a way out.

**Two routes were not registered at all** — `restricted` and `tenancy` — so their
headers were titled from the filename: a screen literally captioned *"tenancy"*.
Both now have titles, and a test walks the route tree (including the nested
`viewing/`, `application/`, `agreement/`, `apply/`, `listing/` folders) and fails
if any file is missing from the layout.

---

**The trade-off, stated plainly.** Replacing the platform button costs iOS's
back-label — the previous screen's title beside the chevron. That label is also
the reason the control was never consistent: it reads "‹ Back", "‹ Tenancy re..."
or "‹ Units" depending on the journey, and truncates differently on every route.
A single shape that means *leave this screen* everywhere, and that is present
even when the platform would draw nothing, is worth more than a label that
changes with the path taken. The swipe-back gesture is unaffected —
`gestureEnabled` is independent of `headerLeft`.

**Auth is untouched.** Those screens are deliberately headerless and each
already carries its own way out — "Back to welcome", "Back to sign in",
`router.back()`. They are also pre-session, so the entry-route fallback has
nothing to resolve.

**A brittle test, repointed not deleted.** Two contract tests pinned the *entire*
`Stack.Screen` options object for the modal routes, so adding a close control
failed them. The rule they encode — the record presents as a modal — is
unchanged; they now match the route name and `presentation: "modal"` on one line
and survive further options.

**Validation:** 51 mobile and 101 web contract tests, both typechecks, both
lints. Three new guards mutation-verified: removing one modal's close fails,
leaving a route unregistered fails, and dropping the no-history fallback fails.

**Known limitations:** no device or emulator, so the header is unverified
visually — the rules are asserted, not seen.

**Next:** Stop for user testing.

### Journey: the main navigation bar

**Status:** COMPLETE — 2026-08-25; awaiting user testing.

One `MainTabBar` now draws both worlds — the renter's five tabs and the
provider's five plus a hidden `add` route. Same component, same measurements,
same motion; the tab set of neither changed.

**A shelf, not a floating pill.** The choice is stated in the component itself:
this design system establishes hierarchy with edges and rules, and lifting the
navigation into a rounded capsule would read as imported from another product.
The bar is `field-0` on a hairline top rule, with a soft upward shadow on iOS
and a flat edge on Android — which is what each platform's own navigation does.

**Active state is said four ways, not one.** The glyph swaps outline → filled,
the tone moves `ink-500` → `kola-800`, the label thickens to 700, and a 22×2
`kola-600` rule draws itself across the top of the cell. Colour is never the
only cue, which is what makes the state legible to someone who cannot separate
those two greens.

**Motion is quiet and optional.** Focus animates in over 220ms on a decelerating
curve and out over 140ms on an accelerating one — arriving is worth watching,
leaving is not. Press is a spring to 0.96. `AccessibilityInfo` is consulted and
every duration collapses to zero when Reduce Motion is on.

**Platform-appropriate rather than identical.** Android gets a `kola-50` ripple;
iOS gets an opacity press and a selection haptic. `hapticsPolicy.onSelection` is
already iOS-only in this product, so the two feel native rather than matched.

**Targets and safe area.** 62pt rows, 56pt minimum cell width, 4pt of hit slop,
and the home-indicator inset honoured with a floor of 6pt on iOS and 8pt on
Android. The row caps at 560pt and centres, so the bar does not smear across a
tablet.

---

#### What continuing it involved

**The build was broken.** `descriptors[route.key]` is optional under
`noUncheckedIndexedAccess` and was being read twice without a guard — two
`TS2532`s, so the app did not typecheck. Resolving each route once through
`flatMap` gives the checker its narrowing, and drops two `indexOf` scans per tab
per render along the way. A missing descriptor now narrows away rather than
being asserted away, on the one control the whole app is navigated by.

**A tap could throw.** The selection haptic dynamically imports `expo-haptics`
with no `.catch`. `code.tsx` already guards the same import, because a build
without the native module rejects it — which would have been an unhandled
rejection on **every tab press**. Guarded to match.

**Also:** an unused `Platform` import, and trailing whitespace on two JSX lines
that made an exact match fail invisibly.

**The tests were real, and now cover the two silent failures.** Mutation-checked
the ones already written — ignoring Reduce Motion fails, shrinking the target to
38pt fails, dropping the filled/outline pairing fails. Added three more, each
mutation-verified: the `href: null` filter (without it a sixth tab appears
labelled from the filename), the haptics guard, and the one-line label cap
(“Properties” wrapping would push the bar past its safe-area allowance).

#### The sixth tab

The provider bar shipped with six items. `add` is declared `href: null` — in the
navigator, off the bar — and the filter for it read `options.href === null`,
which matches nothing, because **`href` never reaches a custom tab bar.**

`expo-router`'s `TabsClient` destructures it away before the navigator sees it:

```js
const { href, ...options } = screen.options;   // href is gone
tabBarItemStyle: href == null ? { display: 'none' } : options.tabBarItemStyle,
tabBarButton: (props) => { if (href == null) return null; ... }
```

The default bar honours `href: null` only because it renders `tabBarButton`.
Anything custom has to read the marker left behind. `isHiddenFromBar` now checks
`tabBarItemStyle` for `display: "none"` — and still checks `href` too, because
the transform above is skipped when a screen's `options` is a function, and then
`href` does survive.

**The test that let it through.** It asserted `href === null ? [] : [` — the
*implementation*, not the outcome — so it went green against a bar that was
visibly wrong. Rewritten to pin the real mechanism, including two assertions
against `expo-router`'s own compiled source, so the day it changes how it marks a
hidden route the failure says so instead of a seventh tab appearing. Both
regressions mutation-verified: restoring the `href`-only filter fails, and
dropping the filter entirely fails.

The lesson generalises past this bar. A contract test that quotes the code back
to itself proves the code is unchanged, not that it is right — and the further a
behaviour lives inside a dependency, the more the assertion has to reach for the
dependency rather than for our own source.

**Validation:** 58 mobile contract tests, typecheck, lint. Every style the bar
references is defined and every one defined is used; all eight theme tokens
resolve.

**Known limitations:** no device or emulator, so none of this has been *seen* —
the geometry, motion and platform branches are asserted, not observed. The
provider header's `+` button is 42pt, under the 44pt floor the bar now holds to;
it sits in the header rather than the navigation bar, so it was out of scope
here.

**Next:** Stop for user testing.

#### Refinement: one indicator, and the system's own motion

**The bar was drawing two active states.** A 22×2 rule across the top of the
focused cell *and* a lozenge behind its glyph — two "you are here" marks four
points apart, with the rule landing directly under the shelf's own hairline
border and colliding with it. Two indicators do not read as twice as clear; they
read as indecision.

The lozenge stays, because it is the stronger mark and because it doubles as the
touch affordance — it shows where the thumb is going as well as where it has
been. The rule went. What remains states the active tab four independent ways:
the glyph fills, the tone moves `ink-500` → `kola-800`, the label thickens, and
the lozenge appears. Colour is never the only cue.

**It was reimplementing the design system in magic numbers.** The bar hardcoded
`220`, `140` and two bezier curves. Those are, character for character:

| Hardcoded | Token |
|---|---|
| `220` | `motion.duration.base` |
| `140` | `motion.duration.fast` |
| `cubic-bezier(0.05, 0.7, 0.1, 1)` | `motion.easing.enter` |
| `cubic-bezier(0.3, 0, 0.8, 0.15)` | `motion.easing.exit` |

Not a coincidence — whoever wrote it read the system and copied the values
across, because **mobile had no bridge for them.** `space` was bridged years
ago; `motion` and `radius` never were, so every screen has been picking its own
milliseconds. `ui.tsx` now exports both, and the bar is the first caller. A test
forbids the four duration values appearing as literals anywhere in it.

**The other numbers.** The touch floor is `targetMin: 48`, not the 44 the bar was
tuned against — rows are 60 and cells 56, and the test asserts *against the
token* rather than restating the number, so it stays correct if the row is
retuned. Gaps, padding and hit slop are `space` tokens; the lozenge uses
`radius.pill`.

**Micro-interactions, reconsidered:**

- **The press moves the glyph, not the label.** It used to scale the entire cell,
  type included. Text that rubber-bands under a thumb reads as a toy; holding the
  label still and letting only the target respond is the difference between
  playful and premium.
- **Android ripples inside the target.** It was `borderless: false` on a 60pt
  cell, so a tap flooded the whole rectangle out to the shelf edges. Now a
  bounded circle the width of the lozenge — which is what Material actually does
  in a navigation bar.
- **iOS gets scale alone.** No opacity on top of it; one response per press.
- The 1pt lift on focus went. A single point is imperceptible, and with a
  lozenge behind the glyph it had nothing left to say.

**Deliberately not tokenised:** the spring (`speed: 34, bounciness: 2` — springs
are not in the token set), the badge at 17pt, and the label at 11/14. The type
scale bottoms out at 12px and a five-tab bar on a 320pt handset needs less than
that; 11 is a considered bespoke value for a dense navigation surface, not an
oversight.

**A second test that proved nothing.** The token assertions passed against a bar
that had been reverted to hardcoded milliseconds — because the component's own
docstring *names all four tokens*, and the assertion was matching the prose. Now
matched against the source with comments stripped, and mutation-verified: going
back to `220 : 140` fails. That is the second time this session a contract test
has been satisfied by a comment rather than by code; the stripper is the fix,
and it is worth reaching for whenever an assertion names a symbol that the file
is also likely to *discuss*.

**Validation:** 59 mobile contract tests, typecheck, lint. Four guards
mutation-verified: hardcoded durations fail, a row under the 48pt floor fails,
removing the press feedback fails, an unbounded ripple fails. Every style
defined is used and every colour token resolves.

**Known limitations:** still no device or emulator — geometry, motion and the
platform branches are asserted, not seen. The provider header's `+` remains 42pt,
under the floor the bar now holds to; it lives in the header rather than the
navigation bar.

**Next:** Stop for user testing.

#### Explore header: Saved and Profile

Two circular actions at the top right of Explore — a bookmark and the person's
own face, falling back to a silhouette.

**Scoped to the tab, not to the screen.** This is the part that would have gone
wrong quietly. `explore.tsx` is a one-line re-export of `search.tsx`, and
`search` is *also* registered as a pushed route of its own — one component
rendered in two places. A header wired inside that component would have appeared
on the pushed `/search` route too, offering shortcuts to tabs that route has no
tab bar for. The `headerRight` is declared on the Explore `Tabs.Screen` and
nowhere else; a test asserts it appears exactly once across the whole tab layout.

**The disc is 40pt and the target is 48.** Reached with hit slop rather than by
drawing a bigger circle — a header of 48pt discs looks heavy, and a 40pt disc
that is only 40pt *to a thumb* is the more common mistake. The provider header's
`+` is 42pt with no slop and misses the floor; `HeaderCircleButton` is the shape
that should replace it. The test derives the floor from `targetMin` and asserts
both halves: the disc is smaller than the target, and disc plus slop clears it.

**It presses like the tab bar** — same spring, same bounded Android ripple. The
test parses both springs and compares them rather than matching a literal, so
they cannot drift apart. Two navigation affordances on one screen that answer a
thumb differently feel like two products.

**The same `push` and the same hrefs** that Profile → "Saved places" and Services
→ Profile already use. `navigate` would arguably suit sibling tabs better, but a
third method for a journey the app already makes twice is how a product starts
feeling assembled; the observation is recorded rather than acted on.

**The avatar** resolves through `resolvePhotoUrl`, which caches — one request a
session, not one a render — using the same guarded effect the Profile screen
uses, so a photo changed mid-resolve cannot flash the previous one back.

**Resolved by the 2026-08-31 Services rebuild:** this used to note that Saved
and Profile were both already renter tabs, so these buttons duplicated
destinations one tap away. Saved is no longer a tab — Services took its place —
and this header became one of the two ways it is reached rather than a shortcut
past a tab. The duplication it flagged is gone; the button did not have to
change. Explore also still shows a native header titled
"Explore" above an in-page display heading reading "Find a place"; that predates
this change and was left alone.

**Validation:** 64 mobile contract tests, typecheck, lint. Four guards
mutation-verified: dropping the `headerRight`, adding the pair to a second tab,
growing the disc to the full target, and drifting the spring all fail.

**Known limitations:** no device or emulator — the geometry and press states are
asserted, not seen.

**Next:** Stop for user testing.

### Refinement: Applications stops being a modal

Re-briefed across both clients. Most of what the brief asks for was already
there and was left alone: `applicationMeaning.standing()` resolves every
application to **one line that is the status and the next step**, stages it as
`action | open | past`, and joins the lease so "Accepted" is never the last word.
That is the brief's *separate active from closed*, *prioritise what needs the
tenant*, and *human status language*, already decided once for both clients.
Rebuilding it would have been churn.

Three things were genuinely wrong.

---

**The record was a modal, on both clients.** `<dialog showModal()>` on web, a
sheet on mobile. An application is read *against* the other applications
somebody has out — a modal hid exactly the context that makes it legible, and
closed itself on a stray backdrop click part-way through reading.

**This reverses an earlier instruction and that is worth recording.** Modals for
these records were explicitly requested earlier ("you didn't use modal for
viewing specific 'agreement' and 'viewing'"). This brief is narrower and later:
*do not use modals for full application details*. Applications changed;
**viewings and agreements keep theirs**, and the distinction holds — a viewing
or an agreement is read and answered in one sitting, while an application
carries a timeline, what was submitted, and the agreement it may become.

Withdrawal keeps its confirmation, which is the one interaction here a
lightweight prompt genuinely suits. It is inline, so it cannot bury the record
it is about.

**Web now puts the list beside the record.** Two panes above 64rem — a 20rem
list and a sticky panel — and one pane below it, where choosing an application
replaces the list rather than sitting a scroll beneath whatever was tapped, with
a back control that exists only at that width. Measured in a browser rather than
read: `320px 936px` side by side at 1280, single column with the back control at
960.

The panel opens on **the first thing wanting a decision**, else the newest thing
in progress, and never on something settled — a record beside an empty half
screen is a wasted half screen, and a closed application is not what anybody came
here for.

**Both waits were a caption.** `Loading…` on one line, then the page moved when
the data landed. Mobile now draws rows shaped like the real ones — thumbnail,
two lines, standing footer.

---

#### What the brief asked for that does not exist

| Asked for | Reality |
|---|---|
| **Draft** | No such status. `ApplicationStatus` is `submitted, under_review, accepted, rejected, withdrawn` — an application is created submitted. |
| **Viewing Scheduled** | Not an application state. Viewings are their own domain with no link on the application; they would join on `unit_id`. |
| **Lease Offered** | Not a status either, but already derived — `standing()` reads the joined lease and says "Agreement ready for you". |
| Approved / Declined | `accepted` / `rejected`, already worded that way. |

Nothing was invented to fill the list. A status chip for a state the backend
cannot be in is a promise the product cannot keep.

**Provider side untouched.** `RequestDetail` keeps its dialog: a landlord
triaging a queue answers one request and returns to the queue, which is what a
modal is for. The contract assertion is scoped to the tenant half of the file
rather than the file, because the two halves have different jobs.

**Validation:** 189 contract tests across both clients, both typechecks, both
lints. Four guards mutation-verified: mobile reverting to a sheet fails, web
reverting to a dialog fails, stacking both panes on a narrow screen fails, and
opening the panel on a settled application fails.

**Known limitations:** no device or emulator, so the mobile screen and skeleton
are asserted rather than seen; the web layout was measured against the compiled
stylesheet, not an authenticated page. Filtering was not added — the existing
grouping answers the same need and a filter control over three groups is a
control looking for a problem.

**Next:** Stop for user testing.

#### Correction: the list row did not fit the column I put it in

Re-briefed. Rather than re-read the code, the rows were **measured** — and the
same defect that broke Coming Up was sitting in the applications list, caused
the same way and by the same change.

`.application-row` is `6rem | 1fr | 13rem` with two `space-4` gaps and
`space-3` padding: **360px of fixed width**. The list/detail split introduced
earlier put that row in a **320px** column.

| List column | Tracks | Identity | Title | Row height |
|---|---|---|---|---|
| 320px — before | `96px **0px** 166px` | **0px** | **5 lines** | 207px |
| 320px — after | `64px 218px` | 218px | 2 lines | 171px |
| 640px | `96px 278px 208px` | 278px | 1–2 lines | unchanged |

The flexible track was crushed to **zero** and both the title and the place
wrapped to five lines each. Every row in that column was a tall stack of
fragments.

**The lesson is the same one as the schedule, so it is worth stating as a rule.**
Moving a component into a narrower container is a layout change to that
component, not just to its parent — and a contract test that asserts the
`grid-template-columns` *declaration* will pass throughout, because the
declaration is exactly what was written. Only measuring the computed tracks
catches it.

Rebuilt narrow-first: two tracks by default, the three-track form behind
`@container application-list (min-width: 38rem)`. Keyed to the list rather than
the window, because the same viewport gives this column two very different
widths depending on whether the detail panel is beside it.

**The standing line, twice.** Stacked — dot, line, time — it is right in a 13rem
side column and wrong as a full-width strip, where it read as three short rows.
Across the strip it is now one flex line with the time pushed to the far end
(33px, from 69px). Restoring the stacked form for the wide case then needed its
own `gap` and `align-items` back: the strip's metrics leaked in and cost the
wide row 24px before that was caught — also by measuring.

Titles clamp to two lines. A list is scanned, and a name running to five lines
stops being scannable.

**Kept, deliberately:** `StandingLine` stays a dot, a sentence and a time rather
than a badge — a pill reading "SUBMITTED" beside a sentence explaining what
submitted means is the same fact twice, and the brief rules out noisy badges.
The mobile record keeps its actions in a sticky footer rather than inline above
the timeline: always reachable beats positionally earlier, and it is already
more prominent than any metadata on the screen.

**Validation:** 195 contract tests, both typechecks, both lints. Four guards
mutation-verified.

**Next:** Stop for user testing.

#### Correction: the first pass changed how it opened, not what it says

The brief enumerated what an application record should *contain* — summary,
property context, **status timeline**, submitted information, upcoming actions,
lease connection. The first pass moved the record out of a modal on both
clients and stopped. That is plumbing, and it was reported as a redesign.

`mobile/app/(app)/application/[id].tsx` was never opened.

**The timeline did not exist on either client**, and the brief asks for it
twice. `standing()` collapses the lifecycle into one line, which says where an
application is and nothing about how it got there or what is left.
`timeline()` opens it out — mirrored, so the row and the record can never
describe the same application differently:

| Status | Steps |
|---|---|
| submitted / under_review | applied → **waiting or being considered** → their decision |
| rejected | applied → read → **not accepted** |
| accepted | applied → read → accepted → the agreement's own state |
| withdrawn | applied → **you withdrew this** |

Withdrawn is two steps on purpose. Drawing the review and the decision nobody
reached as greyed-out placeholders reads as a list of failures.

Dates come only from `created_at` and `decided_at` — the two the record actually
carries. A step with no date shows none; a test forbids `new Date()` in the
module so a plausible-looking date cannot be invented.

**Never colour alone.** Web: the mark changes fill, the current step gains an
inset ring, the label goes to 700, and waiting text dims. Mobile: a different
glyph per state — filled tick, ring, empty dot, cross — plus the weight change.
Measured in a browser across all four states rather than read.

**The agreement link went to the list of every agreement**, on both clients,
when the application already knows which agreement it became. Mobile now opens
`agreement/[id]`. Web links `\/leases?open=<id>` — **and the leases page did not
read that parameter**, so the link as first written would have landed on the
list with nothing open: a dead deep link dressed as a working one. The page now
honours it, behind the `Suspense` boundary `useSearchParams` requires.

**Also:** the web record gained the property photograph its rows already carry,
and the mobile record a skeleton in place of a bare `Loading…`.

**Validation:** 192 contract tests, both typechecks, both lints. Four guards
mutation-verified, one of which caught the mirror as well as the renderer.

**Known limitations:** mobile is asserted, not seen. The web timeline was
measured against the compiled stylesheet in a real browser, not on an
authenticated page.

**Next:** Stop for user testing.

### Refinement: tenant journey history becomes filter-driven

**Status:** COMPLETE — 2026-08-26; awaiting user testing.

Applications and Agreements no longer hide settled records behind a disclosure.
Both collections now open on **All**, ordered with action-required and live work
before history, and expose compact count-bearing filters at the top. The rail is
an underline treatment rather than a row of badges or rounded chips; it scrolls
horizontally where a phone cannot carry every label.

The labels follow each domain rather than forcing false parity:

- Applications: **All · Needs you · In progress · Approved · Past**.
- Agreements: **All · Needs you · Active · Past**.

The buckets are declared in the mirrored meaning modules, not rebuilt from raw
statuses in each screen. Applications distinguish an approval from a closed
outcome by joining the related agreement: offered needs action; accepted,
awaiting activation and active remain Approved; declined, cancelled and ended
belong to Past. Agreements retain their existing `action | active | past`
standing. Viewings remain a separate domain and are not invented as an
application state.

**Composition:** All shows every non-empty group with quiet headings. A focused
filter removes the redundant heading and gives a specific empty state instead
of an empty page. Rows use separators and typography rather than repeated card
containers. The next step remains the status treatment; old metadata does not
move back onto the collection.

**Responsive behavior:** desktop Applications keeps its list/detail split and
suggests the first visible record in the spare panel. Narrow web remains
list-first until a tenant explicitly chooses a row, then shows one pane with a
Back to applications control. Native Applications still opens a dedicated
screen. Agreements keep their existing read-before-decide record behavior: web
dialog and native modal, with the acceptance controls after the frozen terms.

**Scope held:** provider application and agreement workspaces are unchanged.
No lifecycle, permission, API or database behavior changed. The existing
application timeline, agreement frozen snapshot, exact agreement deep link and
withdraw/accept confirmation rules remain intact.

**Validation:** mirrored meaning contracts, complete frontend contract suites,
web and mobile typechecks/lints, production web build, and authenticated browser
review at desktop and 390×844. Native rendering remains type- and
contract-verified because no emulator is connected.

**Next:** Stop for user testing.

### Refinement: Viewings history and record surfaces

**Status:** COMPLETE — 2026-08-26; awaiting user testing.

Viewings now applies the same discoverable-history strategy as Applications and
Agreements without pretending the domains are identical. The tenant schedule
opens on **All** and offers **All · Upcoming · Needs you · Past** as a compact,
count-bearing filter rail. Upcoming still leads inside All because this is first
a schedule; action-required visits remain a direct filter rather than being
mixed into an undifferentiated status list. Past visits are visible immediately
and no longer live behind a disclosure.

**Modal audit:** a viewing record can contain time selection, released
directions and contact, check-in, attendance evidence, follow-up, rescheduling,
cancellation and withdrawal. That is substantial, resumable work with several
possible decisions, so it no longer opens in a dialog. Tenant and provider web
use responsive list/detail workspaces: both panes on wide screens, one pane at a
time with an explicit Back control on narrow screens. Native tenant viewing
records use a normal pushed screen; the provider native flow already did. A
focused provider decline confirmation may remain a native alert, and tenant
withdrawal now confirms inline in the record before the destructive request is
sent.

This supersedes the Viewings portion of **Correction: the tenant's records are
dialogs, not pages**. Applications and Agreements retain their separately
documented behavior. Deep links, lifecycle gates, check-in handoff, provider
scheduling and all backend/API behavior remain unchanged.

**Responsive behavior:** web suggests the first visible record in unused wide
screen space without marking it selected. Narrow web remains list-first until a
row is chosen. Native keeps the platform back gesture and full-screen space for
the record. Rows remain schedule entries rather than generic cards.

**Validation:** mirrored meaning contracts, frontend contract suites, web and
mobile typechecks/lints, and authenticated desktop/narrow-web review. Native
rendering remains type- and contract-verified when no emulator is connected.

**Next:** Stop for user testing.

### Refinement: Agreement records leave modal surfaces

**Status:** COMPLETE — 2026-08-26; awaiting user testing.

The Agreement modal decision was re-audited against the product's own dialog
rule and reversed. An agreement contains the frozen legal/financial terms,
advance-rent notice, parties, acceptance evidence, rent context and potentially
irreversible accept, decline, withdraw or end actions. It is substantial,
resumable work with several decisions—not a focused interruption.

Tenant and provider web now use responsive list/detail workspaces. Wide screens
keep the filtered collection beside the full record and suggest the first
visible agreement in otherwise unused space. Narrow web remains list-first,
then opens one record pane with an explicit **All agreements** return. Tenant
native uses an ordinary pushed screen; provider native already used a dedicated
record screen.

The read-before-decide order is unchanged. Advance notice, money, dates,
conditions, parties and the frozen evidence still precede tenant acceptance or
decline. Provider discard, withdrawal and tenancy-ending confirmations remain
inline inside the record. These focused confirmation steps do not create a
second modal.

This supersedes the Agreements portion of **Correction: the tenant's records
are dialogs, not pages**, and the modal sentence in **Refinement: tenant journey
history becomes filter-driven**. Filters, exact agreement links, frozen terms,
permission/lifecycle gates and backend APIs remain unchanged.

**Validation:** agreement and provider-lease contracts, web/mobile typechecks,
frontend lint, and authenticated desktop/narrow-web review. Native rendering
remains type- and contract-verified when no emulator is connected.

**Next:** Stop for user testing.

### Fix: a finished tenancy blocked the tenant who finished it

**Status:** COMPLETE — 2026-08-26; awaiting user testing.

Reported from Explore: a tenant whose tenancy had ended could not apply for the
same Unit again — "You have already applied for this place."

**The application that blocked them was their own completed tenancy.**
`BLOCKING_STATUSES` is `(submitted, under_review, accepted)`, and an accepted
application stays accepted forever. The comment beside it says an accepted
application "still represents the tenant's **live** acquisition of this Unit" —
which is right, and nothing anywhere checked whether it was still live.

There was no way round it from outside: an accepted application cannot be
withdrawn, and the rule is enforced by a **partial unique constraint**
(`app_one_current_per_unit`) as well as by the friendly check. Fixing only the
service would have turned a readable sentence into an `IntegrityError`.

**What was rejected.** Rewriting `status` would rewrite a decision that was
genuinely made. `superseded_by` needs a successor application, is a
data-migration artefact for legacy duplicates, and — because the tenant's own
list filters on it — would have hidden their past tenancy from their history.

**What was done.** `concluded_at` on the application: *when the acquisition this
produced came to an end*. The status is untouched; only its standing as a live
claim changes. It joins both the service check and the constraint condition, so
the two agree — the constraint now states what it was always trying to say, that
there is one **current** application per Unit per tenant rather than one
application in a particular set of statuses.

`conclude_for_lease` is called from the three places a lease reaches a terminal
state — declined, cancelled, ended — all in `lease/services.py`, by local import
because the two are separate domains. It is idempotent and silent for a lease
with no application behind it, which happens whenever an agreement is prepared
straight from a private access code.

**The migration backfills.** Without it the fix would only have helped future
tenants; anybody whose tenancy had already finished would still be stuck. The
moment is taken from the lease's own `declined_at` / `cancelled_at` /
`updated_at` rather than stamping historical rows with the deployment date.

**What still blocks, unchanged:** an open application, an accepted one whose
agreement is still live, an occupied Unit, and a listing that is not ACTIVE.

**Validation:** 920 integration tests, 212 unit tests, ruff. Five new tests,
two mutation-verified reproductions of the original bug — reverting the service
check fails, and never concluding fails, including one test that goes past the
service check straight at the database constraint.

**Known limitation:** `tests/unit/test_module_boundaries.py` fails on two
**pre-existing** module-level imports (`occupancy/tenancy_views.py →
apps.lease.models`, `application/serializers.py → apps.identity.models`).
Neither file is touched here and the three imports added by this change are
function-local.

### Journey: the tenant Services hub

**Status:** REBUILT — 2026-08-31; awaiting user testing.
**Supersedes** the 2026-08-25 housing-and-everyday hub described below.

Services is now one of the tenant's five primary tabs, replacing Saved:

```text
Home · Explore · Services · Payments · More
```

**Saved lost a tab and kept every route.** `(tabs)/saved` stays registered with
`href: null`, so both existing ways in still resolve unchanged — the bookmark
button in Explore's header, and a row in More. It gained rather than lost
standing in More: it used to be the third row of "Your history", which is the
wrong group for a shortlist somebody returns to, and it now leads its own
"Your shortlist". Agreements moved into that history group at the same time,
because the old Services page was carrying it and the new one is not.

**The fifth tab is "More", not "Me".** It was already the tenant's index of
everything else, and it now matches the provider's fifth tab. "Me" named the
person; "More" names what is behind it.

---

**What Services is now.** Household and digital services — the things a home
pays for beside the rent — in the categories a person actually thinks in:

```text
Utilities        Electricity · Water (coming later)
Entertainment    DStv · GOtv
Connectivity     Airtime · Mobile data
Home             Maintenance · Cleaning · Moving (all coming later)
More services    Coming soon
```

Rent left this page. It is the Payments tab's whole job, and the two are
deliberately not merged: a rent charge is a legal obligation between two named
parties on this platform, a data bundle is a purchase from a third party, and
one tab holding both is how a rental product starts looking like a wallet. The
tenancy rows the old page carried — Agreements, Viewings, Applications — are all
in More, where a tenant already looked for them.

---

**Glance → Understand → Act, down the page.**

*Glance* is a horizontal strip of anything already set up, ordered by use, so a
household that tops up the same meter every fortnight starts one tap from it. It
renders **only when there is something in it**: a strip of zeroes is not a
shortcut, it is a reminder that nothing is configured.

*Understand* is the four categories, each a heading and one line of context over
ruled rows in a single surface.

*Act* is the row itself.

**Not a grid of tiles.** A tile has to be big enough for an icon and a word,
which means four fit on a screen, which means a nine-service catalogue becomes
three screens of scrolling with no hierarchy in any of them. Ruled rows inside
one surface per category fit the whole hub in roughly a screen and a half and
let type and spacing carry the structure instead of chrome. There are exactly
two card-shaped things on the page, and both earn it: the quick-access chips,
which are shortcuts *past* the page rather than part of it, and nothing else.

**Colour does the sorting.** Each service carries a semantic tone rather than a
decorative one — power is `harmattan` because the palette's amber already means
energy across the product, water is `lagoon` because it is the only blue,
screens are `laterite`, the network is `kola` because connectivity is what
Danpa HQ itself runs on, and labour services are `ink` and read quieter on
purpose. A thumb finds Electricity before it reads the word. `ServiceGlyph`
resolves every tone from the palette, so a new one cannot be typed in as a hex
value.

---

**Three tiers, and the difference between them is honesty.**

| | What it means | How it behaves |
|---|---|---|
| `available` | Biller integrated *and* a payment rail configured | Fully interactive |
| `preparing` | Next to be built | Opens to a real job — see below |
| `later` | Named so the roadmap is legible | Not a control at all |

**Nothing is `available` today, and the page does not pretend otherwise.** No
biller exists anywhere in `backend/apps`, and `apps.payments` still registers no
production adapter — `create_intent` refuses before writing a row when one is
missing. A purchase button would be a lie with a spinner on it. A contract test
re-checks both upstream facts, so the day a real adapter lands the test is where
the conversation starts.

**"Coming soon" is not a destination, so `preparing` opens to one.** Tapping
Electricity today reaches a service screen that says what it will do and lets a
tenant **save the meter number**. That is a completed action with a real result:
the day the biller opens, buying is one tap instead of a hunt for the meter card
in a drawer. It is exactly why `preparing` rows are pressable and `later` rows
are not — the screen has a job for the first and nothing honest to offer the
second.

**A `later` row is not a disabled button.** A disabled control still invites a
tap and answers with nothing, which teaches people the screen is broken. It is a
drained glyph, a quiet label and the words "Coming later" — same shape, same
position, no colour, never a rejection. "Coming soon" appears exactly once on
the page, at the end, closing the catalogue rather than badging every row.

---

**The saved numbers are the product here.** `serviceAccounts.ts` holds them in
the same secure store the session token uses. A meter number is not a secret but
it *is* identifying, and phones in this market get lent to family — the reason
`secure.ts` gives for keeping tokens out of AsyncStorage applies unchanged. They
are shown masked to the last four, which is what a person checks when they want
to know whether this is the right meter.

**History deliberately does not live there.** `listRecentPurchases` returns
empty rather than reading the device. Once a service settles through the
Payments Core its purchases carry a transaction, an allocation and a receipt,
and a locally-kept list beside them would be a second version of the truth that
nobody reconciles — precisely what the payment architecture spent its effort
preventing. The hub is written against that read model's real shape now, so the
endpoint replaces one function and no caller changes. It renders nothing rather
than an empty heading: a heading over a blank box is a promise the page cannot
keep yet.

---

**Prepared for the Payments Core, not for its own checkout.** The failure mode
this page is built against is each new service growing a payment path of its
own. Danpa HQ already has server-priced intents, one open intent per obligation,
immutable provider transactions, allocation, a balanced ledger, receipts and
reconciliation; a second path beside that would have none of it and would look,
from a tenant's side, exactly the same.

So `SETTLEMENT_ROUTE = "payments_core"` is declared in the catalogue, and what a
service integration must add is the **obligation** — a row saying what is owed
and to whom, which an intent can be priced from. It adds no intent, no
transaction, no ledger and no receipt. A contract test enforces that
structurally: neither service screen may contain a provider reference, a
transaction id or a checkout call.

---

**Motion and feedback.** The press spring is the tab bar's, to the number, and a
contract test compares them — two navigation affordances on one screen that
answer a thumb differently feel like two products. Reduce Motion is honoured by
keeping the feedback and dropping the movement, not by dropping both. Loading is
a skeleton in the shape of the strip that is coming, never a spinner. A failure
reading saved details is an `info` notice above a working catalogue, because
losing a convenience must not replace the page with an error.

**Validation:** 106 mobile contract tests, typecheck, lint — all green. Twelve
of those tests are this hub's, including the tab order, that Saved kept every
route it had, that nothing offers to take money, that no service is `available`
without a route, and that the press matches the bar.

**Known limitations:** no device or emulator — spacing, press states and the
horizontal strip's overscroll are reasoned from the tokens, not seen. The
"More services" block invites feedback but has nowhere to send it yet.

**Next:** Stop for user testing. The first biller integration should add an
obligation type and a `route`, flip one catalogue entry to `available`, and
change nothing else on this screen.

**Redesign — 2026-09-15, product owner review.** The brief: tiles rather than
rows, professionally grouped, glassy and soft, with a premium consumer feel;
Referrals added to Home; and, mid-review, "too much text on the page — let
visuals speak for themselves". Functionality is unchanged. This supersedes "Not a
grid of tiles" above.

- **Tiles, two to a row.** Each category is its name over a grid of frosted glass
  tiles: white at 62%, a 1px `kola-900` edge at 8%, and a 0.05 shadow everywhere
  but Android. A tile is 48.5% wide, so the space between two is whatever is left
  over, and every row stands equally tall. The page stands on More's hub ground
  (`IndexPage`), so the two hub tabs read as one product.
- **Colour sorts, words don't.** A service that opens has its tone's wash in the
  top corner of its glass, gone before the far corner. A `later` service is
  thinner glass (40%) with a drained glyph and a clock. A saved count is a check
  and a number in the tone's ink on its wash. Nothing is printed that the glyph,
  colour or name already says, so the introduction, the line under each category
  (`blurb`, now removed from the catalogue), each service's summary and "Coming
  later" are gone from the page. A screen reader still hears the summary and
  "Coming later", and the service's own screen says what it will do. The footer is
  one line: MORE SERVICES, and Coming soon.
- **The hub fits in a little over one screen** at 390×844 (821pt of content in a
  717pt view), which is shorter than the ruled rows' screen and a half. That
  answers the objection that tiles cost scrolling.
- **Referrals joins Home as `later`.** Nothing in `backend/apps` refers anybody
  yet (Rewards & Referrals is a roadmap phase), so it is named and is not a
  control: no route and nothing to save. Its tone is `kola`, the network Danpa HQ
  runs on.
- The saved-numbers strip keeps each nickname, the one word that says which meter
  it is, and runs edge to edge.

**Verified:** mobile typecheck and lint are clean. 164 of 166 mobile contract
tests pass; the two failures are the Explore header button's, from header work in
progress alongside this change. Four new hub tests cover the tile grid and the
words it no longer prints, Referrals, open and drained glass, and contrast
computed from the tokens, and a mirror caught 26 of 26 mutations. Checked in
headless Chrome on Expo web, with the API answered in-page, at 390×844, 360×780
and 320×640, with and without saved numbers. Tapping Electricity still opens
`/service?id=electricity`, and Water and Referrals are not controls.

---

*Superseded — 2026-08-25 design, kept for the reasoning that still holds:*


**Status:** SUPERSEDED — 2026-08-31.

The tenant's destination for housing money and the everyday bills around it.

**What is actually there, checked first.** Of the services asked for, exactly one
has a backend: rent. There is no airtime, data, TV, electricity or water domain
anywhere in `backend/apps` — the only matches for "prepaid" and "electricity" are
*property attributes* (`power_meter_type`), not services.

And rent is subtler than it looks. `apps.payments` is built and careful — intents,
idempotency, receipts, webhooks — but `providers.py` registers a single stub:

```python
_PROVIDERS = {"memory": MemoryPaymentProvider}
```

and `create_intent` deliberately fails **before** writing a row when the provider
is unconfigured, with the reason stated in the source: *"Clients must never
mistake a local placeholder for an actual PSP attempt."*

So **the screen never offers to pay.** What a tenant can genuinely do is see what
is owed, see what is overdue, and record a payment made elsewhere — which is what
the rent account behind the card does. A "Pay now" button would have been a lie
with a spinner on it. A contract test asserts the absence of every settlement
verb *and* re-checks both upstream facts, so the day a real adapter lands the
test is where the conversation starts.

---

**Two groups, not one wall of tiles.**

Rent is a legal obligation between two named parties on this platform. Airtime is
a convenience purchase from a third party. Flattening them into one undifferentiated
grid is how a rental product starts looking like an unlicensed wallet — so
**Housing** leads, **Everyday services** follows, and rent is lifted out of both
as the primary card because it is the only entry carrying a live number, and a
balance inside a list of labels is a balance nobody reads.

The card shows the real outstanding total from the tenant's active lease ledger,
turns its border `laterite` when any of it is overdue, and prints the amount in
the **lease's own currency** rather than assuming cedis.

**A planned service is not a disabled button.** A disabled control still invites
a tap and answers with nothing, which teaches people the screen is broken. A
`planned` row is not a `Pressable` at all — it renders as a quiet row that was
never a control, under **one** sentence for the whole group. Five rows each
wearing a "Soon" chip is a badge collection, and reads as five failures rather
than one statement of intent.

**Expansion is one entry.** `serviceCatalogue.ts` declares every service — id,
label, one-line summary, icon, group, status, route — and the screen renders from
it. Next quarter's service is a row in that file and no change to the screen. A
test enforces the invariant that keeps it honest: **`status: "available"` and a
`route` must appear together**, so nothing can be marked live without somewhere
to go, and no service label may be hardcoded into the screen.

**Kept from the old page:** its central principle, which was already right —
unbuilt services are shown and marked rather than hidden, because someone
deciding whether this app is worth keeping is better served by knowing what is
coming than by a tab that looks finished and is nearly empty.

**Changed:** Applications is now a first-class row routing to
`/(app)/applications`, replacing the transitional "they moved to your profile"
notice, which had become a redirect to a place the tenant no longer needed to go.

---

**A test of mine broke a test of mine.** The Explore header test cited
`services.tsx` as evidence that `router.push` was the established idiom for these
hrefs — and this redesign rewrote that file. The assertion was sound but the
coupling was not: a test about the Explore header had no business depending on
the internals of an unrelated screen. Repointed at `profile.tsx`, which still
makes the same transition.

**Validation:** 71 mobile contract tests, typecheck, lint. Three guards
mutation-verified: a "Pay now" call to action fails, marking airtime available
fails, and dropping the lease currency from a formatted amount fails.

**Known limitations:** no device or emulator — spacing, press states and the
overdue treatment are asserted, not seen. The hub loads two requests on focus
(leases, then one ledger); a tenant with several active agreements sees the first
and is told so rather than having them summed into a total matching neither.

**Next:** Stop for user testing.

### Journey: Tenant Home — the rental control center

**Status:** COMPLETE — 2026-08-25; awaiting user testing.

**Four questions, in order.** *Does anything need my attention. What home(s) am
I renting. What is happening with my rent and agreement. What is coming next.*
Everything on the page answers one of them, and anything that could not change
what somebody does today is not there.

**The rule that shaped it: Home adapts to the lifecycle.** Somebody with no
tenancy is shown two ways forward and what they have in flight — no Rent card,
no Agreement card, no Home card. The old page rendered all three regardless,
so a person who had never rented anything was shown an empty tenancy panel, an
empty rent figure and an "Applications" section with an empty state inside it.
Measured on the rendered page, that state is now 428px of screen: a heading, two
choices and three counted rows.

**Element audit:**

| Element | Verdict |
|---|---|
| "Good day, {name}" | KEEP, made time-aware — morning, afternoon, evening |
| Home photograph | ADDED — somebody's own front door should be recognizable |
| Property title, Unit label, locality | KEEP, said **once** on the home card and nowhere else on the page |
| Rent figure | KEEP PROMINENT — one line per home: overdue, next due, or nothing due |
| Lease status | KEEP as one line; the terms live in Agreements |
| "Agreement waiting for you" section | REMOVE AS DUPLICATE — folded into the attention block |
| Standalone overdue `Notice` | REMOVE AS DUPLICATE — same |
| Applications section with three full rows | DEMOTE — one counted line; Applications manages them |
| Viewings section with three full rows | DEMOTE — one counted line carrying the next time |
| Applications empty state ("When you find a place you want…") | REMOVE — an empty module is not information |
| "Your ${n} tenancies, and anything waiting on you." | REMOVE — the page says it |
| "Lease required before this tenancy can become active." | KEEP, as the agreement line for `pending_lease` |
| Coming up | ADDED — the fourth question had no answer at all |
| Maintenance | NOT BUILT — see below |
| Rental listings | NOT ADDED — Home is not Explore |

**Problems solved:**

- **The fourth question was unanswerable.** Nothing on the old Home said what
  was coming next. `comingUp()` now merges confirmed viewings, the next rent
  that is not already late, a tenancy that has not started, and an agreement
  ending within 60 days — soonest first, four at most. Not a calendar of
  lifecycle events: an overdue charge is attention, not a diary entry, and a
  lease ending in eleven months is neither.
- **Attention was three competing banners.** An agreement section, an overdue
  `Notice` and a status word inside each tenancy panel. One ranked block now,
  rendered only when it is non-empty, with late money first because it is the
  only item whose cost grows.
- **A rejected access request was invisible everywhere.** See the backend note.
- **The mobile `+` was inside a branch a provider never reached.** `tenantMode`
  required `active_workspace === "tenant"` or an occupancy context, so a
  provider on the tenant tab fell through to the signed-out browsing screen —
  no Join, no homes, a wall of listings. It is now `Boolean(me)`: whose home
  this is does not depend on which workspace is active, because the tab itself
  is the tenant side.

**Important decisions:**

- **Every home is its own card. There is no selector.** The brief suggested a
  home selector; `lib/tenancy.ts` is emphatic that ambient selection is exactly
  how a tenant renting two places lost sight of one — "there is deliberately no
  `currentTenancy` here and no helper that picks one". A selector would
  reintroduce that the first time somebody reached for the convenient thing.
  Stacked cards, each carrying its own rent and its own agreement, answer the
  same need without a hidden "current" home. Nothing is ever merged: two
  overdue homes produce two attention lines, each naming its place, never one
  total.
- **No maintenance card.** Danpa HQ has no maintenance domain — there is no
  `apps/maintenance`, no model, no endpoint. A card reading "No open issue"
  would be a promise the product cannot keep. When the capability exists, the
  slot beside Agreement on the home card is where it goes, and `comingUp()`
  already has room for a scheduled inspection.
- **`homeMeaning.ts` is self-contained and mirrored.** It imports nothing, so
  the two copies can be compared byte for byte. The two predicates it would
  otherwise duplicate — whether a viewing or an application is waiting on you —
  are passed in by the caller, already decided by `viewingMeaning` and
  `applicationMeaning`, so Home cannot disagree with those screens about their
  own state.
- **Rent is a summary, never a ledger.** One line per home: what is owed next
  and when. History stays in the tenancy record. Nothing is presented as though
  Danpa HQ processed a payment.

**Backend:** two read-only additions, no new authority and no new behaviour.

1. `photo_url` and `space_type_label` on the tenancy read model.
   `participant_cover_url` now takes an optional listing, because a tenancy may
   never have been advertised — most of this market is let privately — so the
   Unit's own primary photograph is the whole answer there.
2. **`GET /me/join-requests/`.** The only read of a join request was
   `GET /properties/<pk>/join-requests/`, which asserts management of the
   Property, so the person who *sent* the request could not see it: after
   quoting an access code they got a success message and then silence. An
   approval eventually surfaced as a lease offer; a rejection surfaced as
   nothing at all, because no notification is emitted for the decision either.
   Scoped to `requester=request.user`.

**Reusable patterns:** the ranked attention block — one section, only when
non-empty, most consequential first, each line naming its place — and the
lifecycle-adaptive page, where a module that has nothing to say is not rendered
rather than rendered empty.

**Responsive/mobile:**

- Web is a single column of sections: greeting and Join, attention, homes,
  coming up, activity. Measured at 1280×800 the no-tenancy state is 428px, one
  home is 978px and two homes 932px; the home photograph is 112×84 and the Join
  control 44px.
- At 375×812 the header wraps to two rows with Join still on screen at
  134×44, the photograph becomes 80×60, the facts row and the coming-up rows
  become single columns, and there is no horizontal overflow.
- Mobile is the same information in `components/home/TenantHome`, with Join as a
  44px circular control beside the greeting.

**Known limitations:**

- No authenticated live visual review — signing in needs a password. Geometry
  was measured against the compiled stylesheet in a headless browser using the
  three seeded accounts; the data was read back through the live read model.
- Mobile native rendering is unverified: no emulator or device.
- **A join-request decision still emits no notification.** This pass made the
  outcome readable on Home; it did not make it arrive. Adding
  `join_request.decided.v1` to `apps/notifications/handlers.py` belongs with
  Notifications, not here.
- `comingUp` and `greeting` read the device clock and timezone. Every seeded
  record is in Ghana, so neither has been exercised across a boundary.
- Home links overdue rent to Agreements, because the tenancy record is where a
  web tenant can currently see charges. It should point at Rent when Rent
  exists.

**Review data.** Three accounts, one per lifecycle state:

| Account | State |
|---|---|
| `+233209999903` Kojo Asare | **No tenancy** — one application, a viewing confirmed in two days, one access request still waiting |
| `+233209999920` Akosua Mensah | **One home** — Adom Courtyard Flat 2B with a photograph, rent overdue, an agreement waiting, times offered on a viewing |
| `+233209999902` Ama Tenant | **Two homes** — an apartment and a shop, each with its own rent and its own agreement, both overdue and named separately |

**Next:** Stop for user testing.

### Correction: the tenant's records are dialogs, not pages

**Status:** COMPLETE — 2026-08-25; awaiting user testing. Applies to
Applications, Agreements and Viewings together.

**What was wrong.** Applications opened its record in a dialog; Agreements and
Viewings opened theirs by pushing a route. I justified that as "substantial
review deserves a screen". It was wrong on four counts, and one of them is a
rule from the brief I had already been given:

1. **Browsing context died.** *"Preserve browsing context and make
   back-navigation predictable."* A route push discards the list's scroll
   position and which disclosure was open. A tenant who opened the third past
   agreement came back to the top of a collapsed list.
2. **Two `<main>` landmarks.** Every portal page renders inside
   `<main id="main" class="portal-main">`. `<main className="agreement">` and
   `<main className="viewing">` nested a second one inside it — invalid HTML,
   and a screen reader announcing two mains with one `id`.
3. **A column that matched nothing.** `max-width: 46rem; margin: 0 auto` inside
   a left-aligned 78rem shell centred those two pages and no others.
4. **Three sibling areas, two behaviours.** No reason a tenant could infer.

**What it is now.** One `.record-dialog` shape, shared by the agreement and the
viewing, matching `.team-dialog`, `.rent-dialog` and `.request-dialog`: sticky
head, scrolling body, centred at `min(44rem, 100vw - 2rem)` on a desktop and a
bottom sheet below 720px. Escape and a backdrop click both close it. On mobile
all three records now carry `presentation: "modal"`, so the list stays beneath
and an iOS sheet is dismissed with the thumb rather than a reach to the header.

**The one thing that did not become conventional.** The record dialogs have
**no sticky footer**, which every other dialog in the product has. Pinning
Accept and Decline to the bottom of the frame would put them back in front of
the money, the dates and the statutory advance notice — the exact defect the
Agreements rewrite existed to fix. The decision stays at the end of the
scrolling body. Measured on the rendered dialog at 1280×800: the body shows
615px of 1,090px, and "Your decision" begins at 964px, so it is reached by
scrolling past the terms and in no other way.

**Deep links preserved.** `#agreement-<id>` and `#viewing-<id>` open the
corresponding record, the same shape the provider side already used for
`#lease-<id>`. Losing the `[id]` routes did not lose the ability to point a
notification at one record.

**Measured:** the agreement dialog is 704×736 centred with 32px of backdrop
above and below; the viewing dialog 704×547; the close control 40×40; at
375×812 both become full-width bottom sheets with a 12px top radius and no
horizontal overflow.

**Reusable pattern:** `.record-dialog` + `.record-panel` / `.record-head` /
`.record-body` / `.record-close`. Any future tenant-side record should use it
rather than a route.

### Journey: Viewings — the tenant's schedule

**Status:** COMPLETE — 2026-08-25; awaiting user testing. Third of three tenant
areas (Applications → Agreements → Viewings).

**A viewing is an appointment, not a status.** Somebody standing at a junction
wondering whether to get in a taxi wants two things: where, and when. Everything
else — the code, the directions, the number, the ways out — belongs to a moment,
and should be on screen during that moment and not before or after it.

**The defect this area existed to fix.** Both clients rendered the entire state
machine on every row, at all times: the slot picker, the released street
address, the appointment history, the landlord's phone number, the QR check-in,
the post-viewing follow-up, the attendance-resolution panel and three quiet
buttons. A tenant with three viewings read that machine three times to find out
what time to be somewhere. Nothing ever came off the card — a viewing that
happened last month still carried its cancel button.

**Element audit:**

| Element | Verdict |
|---|---|
| Listing headline, locality, landmark | KEEP PROMINENT |
| Photograph | ADDED — a schedule of headlines is one nobody recognizes their own appointments in |
| Confirmed time, buried mid-card as "Confirmed for Tue, 8 Sep, 3:30 PM" | KEEP PROMINENT, rewritten as **"Tomorrow · 3:30 PM"** — the line that makes this a schedule |
| `StatusPill` / raw status word | REPLACE — one line that is the state *and* what follows |
| Slot picker on the row | MOVE ON DEMAND — it is the action for one state, not furniture for all of them |
| Released street, GhanaPost address, entrance note | MOVE ON DEMAND — and still only when the backend releases them |
| Landlord's phone number | MOVE ON DEMAND |
| QR + six-digit code inline on the card | MOVE ON DEMAND — a check-in code is not something to carry around all week |
| "Check-in is not open yet · Come back after…" | REMOVE AS DUPLICATE — the standing line already says where this stands |
| Appointment history on every card | MOVE ON DEMAND — and only when there is more than one appointment |
| Post-viewing follow-up | KEEP, gated on `post_viewing.available`, so it disappears once a choice is made |
| Attendance panel | KEEP, gated on `attendance.can_report` / `can_respond` |
| Reschedule / Cancel / Withdraw on every row | MOVE ON DEMAND — to the record, and only those the backend permits |
| PageHeader description ("Times you have arranged to see a place.") | REMOVE — the page says it |
| "The landlord offers times, you pick one, and only then do you exchange numbers." | REMOVE — standing instructions explaining how viewings work are furniture |
| "Danpa HQ viewings are free" | KEEP on the provider side, where the fee temptation is |

**Problems solved:**

- The schedule was sorted by when the *request* was made. It now sorts by when
  the visit is, soonest first, with untimed requests after everything timed.
- **Nothing ever came off a card.** Every control is now gated on the server's
  own per-reader answer — `actions`, `check_in`, `attendance`, `post_viewing`,
  `viewing_directions` — and the clients re-derive none of it. A contract test
  asserts each gate by name.
- Twelve statuses reached the tenant as raw words. `standing()` collapses them
  into one sentence and one of three groups.
- The time was a full timestamp in the middle of a card. It is now the largest
  thing on the row.

**Important decisions:**

- **Upcoming leads, per the brief.** *Upcoming* · *Needs you* · *Past viewings
  (N)*, the last shut. Anything waiting on the tenant is pulled out of the
  schedule into its own accented group wherever it sits in the lifecycle — a
  time to pick, an attendance report to answer, a visit to say happened or not,
  a follow-up to choose. Putting *Needs you* second is the brief's ordering and
  is right for a screen opened to check the next visit; if testing shows a
  waiting dispute gets missed there, moving the group is one line.
- **`requested` sits in Upcoming, not a fourth group.** It is still ahead of
  you; it simply has no time yet, and says so. A fourth bucket for "waiting on
  the landlord" would split the schedule in half.
- **The photograph is the same one Applications uses.** `participant_cover_url`
  now lives once in `apps/listing/serializers.py` and both the application and
  viewing serializers call it, rather than each domain copying the
  cover-then-unit-primary rule.
- **The exact address is never a client decision.** The serializer withholds
  street, house number, GhanaPost address, coordinates and entrance note until a
  valid confirmed appointment, and returns null otherwise. Both clients render
  `viewing_directions` when it is present and ask no questions.
- **The check-in code is not a keepsake.** It renders only while
  `check_in.can_issue` — a window the server opens shortly before the
  appointment and closes after it.

**Backend:** `photo_url`, `property_title` and `unit_label` added to
`ViewingRequestSerializer`, plus a `prefetch_related` on both list views so a
photograph per row is not a query per row. `participant_cover_url` extracted so
one rule serves both domains. No lifecycle, permission or state change.

**Reusable patterns:** the schedule row — photograph, place, a large relative
time, a standing line and one action — and the *gate the control, not the copy*
rule: when a control cannot be used, it is absent, not disabled with an
explanation.

**Responsive/mobile:**

- Web rows are photograph · identity · one action, dropping the action to a
  full-width line below 720px. The record opens as a centred dialog over the
  schedule, and as a bottom sheet below 720px.
- Mobile rows open the record as a modal screen; check-in still hands off to the
  existing full `viewing-check-in` screen rather than duplicating it, because a
  code held up to be scanned wants the whole display.
- Measured at 1280×800 rows are 102–132px, "Tomorrow · 3:30 PM" renders at
  17px/650 and every action is 44px; at 375×812 rows are 158–188px with a
  full-width action and no horizontal overflow.

**Known limitations:**

- No authenticated live visual review — signing in needs a password. Geometry
  was measured against the compiled stylesheet in a headless browser using the
  seeded viewings; the lifecycle gating was read back through the live
  serializer.
- Mobile native rendering is unverified: no emulator or device.
- Suggesting a replacement time is still a date field and a time field on
  mobile, typed rather than picked. It works and it is honest, but it is the
  weakest interaction in the area and deserves a native picker.
- `whenLabel` uses the device clock and the device timezone. Every seeded
  appointment is in Ghana, so this has not been exercised across a timezone
  boundary.

**Review data.** Tenant **Akosua Mensah** (`+233209999920`) now has one viewing
in each group, all through the real services, all on listings with photographs:
a **confirmed** visit to 2 Bedroom Flat tomorrow at 3:30 PM — directions and the
landlord's number released, check-in window not yet open, so no code is drawn;
three times **offered** at Hostel Room waiting for her to pick; and a
**completed** visit to Single Room Self Contain with the follow-up already
chosen, so no visit controls remain on it.

**Next:** Stop for user testing. This completes Applications → Agreements →
Viewings.

**Refinement — 2026-09-15, product owner review (mobile).** The same brief as
tenant Payments: a layout for this page's purpose, the most important thing
first, one Filter, few words, and polish on small phones.

- **The next visit is a card.** The soonest confirmed visit leads Upcoming with its
  photograph, a calendar tile for its day, the time in large type, the place, and
  how it stands beside its one action ("Open check-in"). A request still waiting
  for a time never leads, and the card is not repeated in the list below it.
- **The rest is a schedule.** One glass list per group, still Upcoming, Needs you,
  Past — the brief's order. A row keeps its photograph, the time as its largest
  words, the headline over up to two lines, the place, and where it stands, with a
  solid kola pill when something waits on the tenant and a soft one otherwise.
- **One green Filter** replaces the tab strip: the shared sheet, with the mirrored
  filters and their counts.
- **The past shows its latest three.** "View all" turns the Filter to Past, so
  history stays filter-driven and visible rather than collapsed.
- **Small phones:** the pill drops under the line rather than cutting it.
- **Nothing yet, loading, failure:** a large glyph with Explore homes; a skeleton
  shaped like the card and rows; and no empty claim after a load failure.
- **Unchanged:** the mirrored meaning, soonest first, refresh on return, pull to
  refresh, the record route, and the accessible name that carries the call to
  action.

**Verified:** five new tests in `viewingSchedule.contract.test.mjs`, alongside the
web contracts that read this screen; checked at 390×844 and 320×640 with a mocked
schedule in every group: the card, the grouped list, the sheet, Needs you, the Past
filter reached through "View all", nothing yet, and no cut text at 320.

### Journey: Agreements — the tenant's side

**Status:** COMPLETE — 2026-08-25; awaiting user testing. Second of three tenant
areas (Applications → Agreements → Viewings).

**The six questions.** Which home, who it is with, what am I agreeing to, how
much, for what period, what dates matter, and what requires my action. The
collection view answers all but one of them per row. *What am I agreeing to* is
a document, and a document belongs on its own page.

**The defect this area existed to fix.** Both clients offered **Accept
agreement** and **Decline** *above* the money, the dates, the conditions and the
statutory advance notice — and then, inside the confirm step, asked the tenant
to tick *"I have read the advance-rent notice below"*. The notice was some fifty
lines further down, past three blocks, reachable only by scrolling back past the
buttons. The most consequential action in the product was offered before the
reading, and the consent checkbox pointed at something the tenant had not been
shown.

**Element audit:**

| Element | Verdict |
|---|---|
| Property title, Unit label | KEEP PROMINENT — "which home" |
| "Offered by {landlord}" | KEEP — "who it is with", now on the row as well |
| Rent, move-in total, term, start date | KEEP, promoted to the row — the list carried none of them |
| Accept / Decline **above** the terms | MOVE — to the end of the review, after the reading |
| "Review every term below before deciding" | REMOVE — the layout says it; a sentence asking someone to read is not reading |
| PageHeader description ("Review offers carefully, then keep…") | REMOVE — the page says it |
| Section heading "Lease offer(s) to review" | REMOVE AS DUPLICATE — the group heading is "Needs your decision" |
| Advance-rent notice | KEEP PROMINENT, MOVED to the top of the review |
| Acknowledgement checkbox | KEEP — legally load-bearing; its wording now points at where the notice actually is |
| "This is an older lease offer" | KEEP — a real integrity signal |
| Rent, move-in total, term figures | KEEP |
| Advance / deposit / agency fee / ends | KEEP |
| Conditions | KEEP, never truncated — water and electricity are the commonest source of a later argument |
| "Agreement version X · record abc…" + not-a-signature line | DEMOTE — kept, at the foot of the review |
| `accepted_by` | ADDED — serialized all along, rendered by neither client, on a record whose whole purpose is who pressed accept and when |
| Active lease: "This agreement is in place" success notice | REMOVE AS DUPLICATE — the standing line says it |
| Rent schedule on the collection view | MOVE — onto the active agreement's review page |
| "Nothing is paid through the app" | KEEP — it belongs with the money, not with the button |

**Problems solved:**

- The decision preceded the reading. It now follows it: advance notice → money
  → dates → conditions → parties → record → decision. Measured on the rendered
  page, "Your decision" is the last heading, 1,000px below the notice.
- **`awaiting_activation` rendered nowhere on web.** The tenant page bucketed
  `offered`, `active` and `declined|cancelled|ended`, so a lease in the fourth
  state appeared in none of them. It is reachable only when
  `activation_requirement` is `initial_payment` — a reserved Payment Core seam,
  not a production path today — so this was a hole rather than a live outage,
  but a state that renders nothing is a state nobody can debug. `standing()`
  now names every status, and a test asserts it.
- **Confirming said "this is important" rather than what it was.** The confirm
  step now states the figures: *"You are accepting GH₵22,500.00 to move in and
  GH₵900.00 per month for 24 months from 24 Sep 2026."*
- The whole agreement was dumped into the collection view, so two agreements
  meant reading everything twice to find the one that needed a decision.

**Important decisions:**

- **`agreementMeaning.ts` decides which copy of the terms is authoritative.** A
  lease carries its terms twice: live columns on the row, and the frozen
  snapshot inside the executed agreement whose canonical bytes produced the hash
  both parties accepted. The snapshot wins wherever it exists. Both screens used
  to reach for `terms?.money?.x ?? lease.x` field by field, fourteen times each
  — fourteen chances for one client to fall back where the other did not.
  `agreedTerms(lease)` does it once, mirrored, and a contract test asserts
  neither tenant screen reaches into `agreement.terms` directly any more.
- **The review is a record dialog on web and a modal screen on mobile.** It was
  briefly a pushed route on both; that discarded the list's browsing context and
  nested a second `<main>` landmark inside the portal's own. See *Correction:
  the tenant's records are dialogs, not pages*. The decision still sits at the
  end of the scrolling body rather than in a sticky footer, for the reason the
  whole area was rewritten.
- **The review reads from `/me/leases/`.** That endpoint returns only leases
  where the account is the tenant, so a provider opening the URL finds nothing
  rather than a page of tenant actions. No new endpoint, no permission
  reasoning in the client.
- **Detail is not density.** This area is explicitly allowed to be longer than
  the rest of the product: every term is present, conditions are never
  truncated, and nothing is folded away to save lines. §10.1 is a rule about
  *unnecessary* words, and on the highest-consequence screen almost none of them
  are unnecessary.
- **No photograph.** Applications gained one because a list of headlines is
  unrecognizable. An agreement is identified by Property and Unit, it is usually
  one row, and a lease may legitimately have no listing at all — "a lease agreed
  outside the platform and recorded afterwards, which is most of this market
  today". Identity in words, not pictures.
- **Declining stays reason-optional**, matching `can_decline_offer`: requiring
  one would make a tenant justify saying no to the party with more power. The
  asymmetry is deliberate in the policy and the interface follows it.

**Backend:** none. No lifecycle, permission or serializer change — `OPEN_TO_TENANT`
is still `offered` alone, acceptance still records a per-party row with its own
hash, and the advance-notice wording still comes from the server so the one
place it is decided is the one place a lawyer has to review.

**Reusable patterns:** the group → row → document shape, and the two-step
consequential action whose second step states figures rather than adjectives.
Viewings should reuse the first; anything irreversible should reuse the second.

**Responsive/mobile:**

- Web rows are two columns — identity and money on the left, standing and the
  one action on the right — stacking below 720px with a full-width action. The
  record opens as a centred dialog, and as a bottom sheet below 720px.
- Mobile rows are a card with the standing line under a rule, opening a
  dedicated screen. Measured at 1280×800 rows are 139–173px and every action is
  44px; at 375×812 rows stack to 288–346px with no horizontal overflow.

**Known limitations:**

- No authenticated live visual review — signing in needs a password. Reading
  order and geometry were measured against the compiled stylesheet in a headless
  browser using the seeded agreements; the data was read back through the live
  serializer.
- Mobile native rendering is unverified: no emulator or device.
- **The rent schedule still lives on the active agreement's review page.** It
  belongs in Rent, but the web tenant has no rent area — mobile has
  `rent-account` and the web nav has no equivalent — so moving it now would
  leave a tenant with no way to see their charges at all. It moves when Rent is
  built.
- The advance-rent wording has still not had a Ghanaian lawyer's review; see
  `docs/known-limitations.md`. Nothing in this pass changed it.

**Review data.** Tenant **Akosua Mensah** (`+233209999920`) now holds one
agreement in each group, all produced through the real services: an **offered**
one at Adom Heights (GH₵500/month, GH₵3,500 to move in), an **active** one at
Adom Courtyard with both acceptances recorded, and a **declined** one at Legon
Student House asking 24 months' advance — which fires the statutory notice and
carries the tenant's reason for refusing.

**Next:** Stop for user testing, then Viewings.

### Journey: Applications — the applicant's side

**Status:** COMPLETE — 2026-08-25; awaiting user testing. First of three tenant
areas (Applications → Agreements → Viewings).

**The four questions.** A tenant opening this list is asking: *where did I
apply, where does it stand, is anything needed from me, and what happens next.*
The old screens answered one and a half of them.

**Element audit.** Every element was classified before anything moved:

| Element | Verdict |
|---|---|
| `listing_headline` | KEEP PROMINENT — it is what they remember clicking |
| Photograph | ADDED — the list was a column of headlines; nobody recognizes a place by reading one |
| Property title, Unit label | ADDED — "Property/Unit identity", one quiet line |
| Rent | ADDED — it was nowhere on the list, on either client |
| `status_display` ("Being considered") | REMOVE AS DUPLICATE — folded into the standing line |
| Mobile's per-status sentence ("Sent. Waiting for the landlord to look at it.") | REMOVE AS DUPLICATE — the same fact as the status word, twice |
| "Offered N months advance; they asked for M." on every card | DEMOTE — to the record; the row keeps only the shortfall, and only while it still predicts the answer |
| "N months short — they may still say yes." | REMOVE — a reassurance nobody asked for, attached to a number |
| "Applied {date} · answered {date}" on the row | DEMOTE — "3 days ago" on the row, exact dates in the record |
| `decision_note` on the row | MOVE ON DEMAND — the landlord's words deserve room, which a row has not got |
| Web page description ("Places you have applied for, and where each one stands.") | REMOVE — the page says it |
| Withdraw button on every open row | MOVE ON DEMAND — into the record, behind a confirmation |
| Occupation, employer, income band, guarantor, covering message | MOVE ON DEMAND — behind "What you told them"; the tenant wrote them |

**Problems solved:**

- **"Accepted" did not say what to do.** Acceptance is not the end of the story
  and the story lives in the lease, so the tenant's own leases are joined in.
  An accepted application whose agreement has been sent now reads *"Agreement
  ready for you"* and sits under **Needs you**; one still being drawn up reads
  *"Agreement being prepared"*. Neither client could previously tell the two
  apart.
- **A status word and a sentence explaining that status word.** Mobile showed
  both. One line now carries the state *and* what follows it.
- **No way in.** There was no application record on either client — everything
  the tenant had sent was either crammed onto the row or not shown at all.
- **Withdrawing took one tap** from the list, with no confirmation, for an
  action that cannot be undone and releases the Unit to somebody else.
- **Nothing was grouped.** Six applications were six identical rows in
  submission order, with the settled ones interleaved among the live ones.

**Important decisions:**

- **`applicationMeaning.ts` is one file, mirrored.** Both clients import
  `standing()`, `placeOf()` and `shortfallNote()`. Two clients answering "where
  does this stand" differently is how a tenant is told one thing on the phone
  and another on the laptop; a contract test compares the two files below their
  header comment.
- **Three groups, no search.** *Needs you* · *In progress* · *Past
  applications (N)*, the last one shut. At a tenant's real scale — a handful,
  not a hundred — a search box is furniture. The heading above *In progress*
  appears only when there is a *Needs you* group to distinguish it from.
- **The status treatment is a dot, a line and a time.** No pill, no badge. Kola
  for something to do, harmattan for in flight, grey for settled.
- **The shortfall is stated once, and only while it predicts.** After a
  decision, the number explains nothing the outcome does not already say, so it
  leaves the row.
- **The photograph is the listing cover, presigned for participants.**
  `photo_url` prefers the campaign cover — the image the applicant clicked in
  Explore, so the one they will recognize — and falls back to the Unit's own
  primary photograph. It is presigned whether or not the listing is still being
  advertised: every endpoint that reaches this serializer is already scoped to
  a participant, and withdrawing a listing from discovery does not unshow an
  applicant a photograph they were shown while deciding. `_is_public_photo`
  still excludes evidence and anything sensitive; a test asserts a sensitive
  file never becomes a thumbnail.

**Backend:** read-only display fields on `RentalApplicationSerializer`
(`property_title`, `unit_label`, `space_type_label`, `photo_url`,
`rent_formatted`, `listing_status`) and a `prefetch_related` on both list views
so a photograph per row is not a query per row. No lifecycle, permission or
state change: `submitted → under_review → accepted | rejected`, withdrawable by
the applicant, is exactly as it was.

**Reusable patterns:** the standing line (dot · sentence · time) and the
row-plus-record shape — a scannable collection where every row opens one
record, rather than a collection that tries to be both. Agreements and Viewings
should reuse both.

**Responsive/mobile:**

- Web is a three-column row — photograph, identity, standing — opening a
  centred record dialog. Below 720px the standing drops to a full-width last
  line of the row, because three columns at 375px would be three unreadable
  ones, and the dialog becomes a bottom sheet.
- Mobile rows open the record as a modal screen, so the list stays beneath and
  the sheet is dismissed with the thumb.
  Measured at 1280×800 a row is 102px and the record dialog is 608×514,
  centred; at 375×812 rows are 147px with no horizontal overflow.

**Known limitations:**

- No authenticated live visual review — signing in needs a password. Layout was
  verified by measuring the compiled stylesheet against the seeded rows in a
  headless browser; the data path was read back through the live serializer.
- Mobile native rendering is unverified: no emulator or device.
- The record screen re-reads `/me/leases/` to work out standing. For one
  application that is one extra call; it is the same call the list already
  makes, and there is no per-application lease endpoint to use instead.

**Review data.** Tenant **Akosua Mensah** (`+233209999920`) now has one
application in every group: an agreement waiting (Needs you), one accepted
without an agreement yet, one under review, one just submitted and two months
short of the asked advance, plus a rejection carrying the landlord's note and a
withdrawal. Four of the six have photographs, so the placeholder is exercised
too.

**Next:** Stop for user testing, then Agreements.

**Refinement — 2026-09-15, product owner review (mobile).** The same brief as
tenant Payments and Viewings.

- **One green Filter** replaces the tab strip, over glass groups Needs you, In
  progress, Approved and Past. The past shows its latest three, and "View all"
  turns the Filter to Past.
- **A row draws how far it has come.** Under the photograph, headline, exact place
  and rent (only when there is one — no lone "/ month"), a short bar with one
  segment per step of `timeline()`: kola where it happened, harmattan while it
  waits on the landlord (kola when it waits on the tenant), laterite where it
  stopped. The shared standing line says the same in words, so the bar is hidden
  from screen readers. The shortfall stays while it still predicts.
- **An agreement waiting is one tap away.** "Review the agreement" sits under the
  row as its own button and opens the agreement; the row still opens the
  application. Two buttons side by side, never one inside the other.
- **Nothing yet, loading, failure:** a large glyph with Explore homes, a skeleton
  shaped like the rows, and no empty claim after a load failure.
- **Unchanged:** `standing()`, `applicationBucket()` and the mirrored filters, the
  leases join (and its tolerance of a lease failure), refresh on return, pull to
  refresh, and the record route.

**Verified:** five new tests in `applicationList.contract.test.mjs`, alongside the
web contracts that read this screen; checked at 390×844 and 320×640 with mocked
applications in every group, joined to agreements: the grouped list, the agreement
action, the sheet, In progress, nothing yet, and no cut text at 320.

### Journey: Listing detail

**Status:** COMPLETE — 2026-08-24; awaiting user testing. The photo gallery was
refined in a second pass the same day: see the gallery decisions below.

**Element audit.** Every element on the old page was classified before anything
moved:

| Element | Verdict |
|---|---|
| Gallery | KEEP PROMINENT — it sat *below* the text; it now leads |
| Rent | KEEP PROMINENT — was `title-2` under the heading, now the panel's first line |
| Headline, space type, place | KEEP — the small-caps label repeated the locality shown again under the property |
| Bed/bath/furnished/floor sentence | KEEP as facts, not prose |
| "Photos marked 'This unit' are…" | REMOVE — each photograph carries its own source |
| Description | DEMOTE — truncated with Read more |
| Unit amenities | KEEP, as tags |
| "GH₵X to move in" card | KEEP, merged into the terms panel with advance, deposit and fee |
| Property title, locality, region | KEEP — locality REMOVED AS DUPLICATE from the top label |
| Property features (water, meter, compound, security) | KEEP PROMINENT — these are the Ghana facts that decide what living there costs |
| Four `Stamp`s + "Know who you're dealing with" + paragraph | MOVE ON DEMAND — one `✓ Verified rental` line, detail behind a disclosure |
| "Interested in this space?" + two explanatory paragraphs | REMOVE — the actions say it |
| Three equal-weight buttons | KEEP with a hierarchy: one primary, one secondary, two quiet |

**Problems solved:**

- Photographs came fifth, after a label, a heading, a price and a facts line. A
  tenant recognizes a place by looking at it, so the gallery leads.
- Price had no hierarchy: `title-2`, one step under the headline, and then the
  move-in total repeated it in a card further down. Rent, terms and move-in
  total now sit together once, in the panel where the decision is made.
- **Verification dominated.** Four stamps, a heading and a paragraph in the
  middle of the page. One line now, with the stamps behind it.
- Two paragraphs explained what a viewing request and an application are, above
  three buttons of equal weight. Both paragraphs are gone and the actions carry
  a hierarchy.
- The page did not react to what had already happened — it offered "Request a
  viewing" to someone who had one confirmed. It now reads viewing status,
  application status and saved status, and says what each is.
- Saving existed but had no state: no way to see, or undo, a save.

**Important decisions:**

- **One gallery, grouped once rather than labelled everywhere.** The backend
  returns a single ordered `gallery` with a `source_label` per item — Unit
  photographs first, then the building. Neither client splits it into "Unit
  photos" and "Property photos" sections. The source is stated once where it
  helps someone navigate — a hairline break in the web thumbnail strip, a quiet
  group heading in the mobile overview grid, and the caption under whichever
  photograph is open — and never as a badge on each image.
- **The preview is capped, the exploration is not.** The gallery on the page is
  a recognition cue, not the gallery. Web holds it at
  `clamp(13rem, 32vh, 21rem)` — 256px on a 1280×800 laptop, against 684px for
  the 16/9 mosaic it replaced — so the headline, the rent, the facts and the
  primary action are all on the first screen. Mobile caps the hero at
  `min(width × 0.62, 280)`. Everything larger happens in the lightbox or the
  full-screen viewer.
- **One named way in.** "View all 8 photos" is a real 44px control beside the
  preview. It replaced a `+5 photos` sticker on the third tile, which a tenant
  had to guess was clickable.
- **Nobody swipes through eight photographs to find one.** The web lightbox
  carries a thumbnail strip; the mobile viewer has a grid toggle in its header.
  Both jump straight to a photograph. Sequential stepping stays available and
  stays restrained: 44px circular controls on the image, not oversized arrows.
- **Location privacy is reflected, not explained.** Street, house number and
  entrance note are never on this page: the serializer withholds them until a
  viewing is confirmed. The page states locality, district and landmark and says
  nothing about what it is not showing. A contract test asserts neither client
  reads those fields.
- **Action hierarchy:** Request a viewing (primary) → Apply to rent (secondary)
  → Save and Copy link (quiet). On mobile, applying sits with the rental terms
  it is about, so the sticky bar never holds two primaries.
- **Public browsing first.** An account is asked for at the moment of acting,
  never to read the page.
- A taken listing offers nothing to act on and says so once.
- **Discovery continues without becoming a feed.** Related rentals sit after
  the decision content and reuse the Explore card: four at most, ranked by the
  backend with locality and monthly affordability first. The current listing,
  unpublished/taken listings and occupied Units never enter the set. Web uses a
  responsive row/grid; mobile uses a snapping horizontal rail. A rail card does
  not add a second horizontal photo gesture — tapping it opens the next Listing
  Detail, whose full gallery already swipes.
- **Back means back to the comparison.** Mobile keeps Explore mounted under the
  Listing stack. Web writes the active filters into the existing Explore
  history entry only when a card is opened and stores its scroll offset for the
  return, so Explore → Listing → related Listing → Back never resets the search.

**Reusable patterns:** the decision panel — rent, terms, actions and one trust
line, following the page on desktop and becoming a bar on mobile. The disclosure
for trust detail is the same shape used for lease evidence.

**Responsive/mobile:**

- Web is a capped three-tile preview into a two-column body; the panel is
  sticky above 960px and static below, because a sticky column taller than a
  short viewport traps its own actions. Below 640px the preview is a single
  image at `clamp(12rem, 30vh, 16rem)` and "View all" carries the rest.
- The lightbox is budgeted against its own chrome — the stage is
  `min(100vh - 16rem, 40rem)` so the bar and the thumbnail strip are always on
  screen. Measured at 1280×800 it is 680px tall and centred; at 1280×620 it is
  500px and still whole.
- Mobile is a paging swipe hero with a tappable count that opens the overview
  grid, and a bar holding save and the viewing request that lives outside the
  ScrollView so it never covers content. Closing the viewer returns the hero to
  whichever photograph was being looked at.
- Related rentals are four columns at the largest web width, two below 960px
  and one below 640px; mobile cards occupy about 78% of the viewport so the next
  option remains visible as a continuation cue.

**Known limitations:**

- No authenticated live visual review; the four listings in the review database
  have no photographs, so the empty-gallery path was exercised and the populated
  one was not.
- Sharing is a copy-link on web and absent on mobile; a native share sheet is a
  small addition worth making when there is a real listing URL scheme to share.
- Gallery geometry was verified by measurement rather than by eye: the compiled
  stylesheet was rendered against placeholder photographs in a headless browser
  and every box checked with `getBoundingClientRect()`. Type metrics differ
  slightly from production because the self-hosted faces were not loaded.
- Mobile native rendering is unverified — no emulator or device is available —
  so touch targets, the overview grid's three-across fit and VoiceOver/TalkBack
  order are reasoned from the code, not observed.
- Photographs are not lazy-loaded and there is no low-resolution placeholder.
  On a Ghanaian mobile connection the preview requests three full-size images
  and the lightbox requests every thumbnail at full size. Worth fixing when
  there is a listing with real photographs to measure against.

**Defect found and fixed:** `<dialog>` elements are centred by the browser's
default `margin: auto`, which Tailwind's preflight resets to `0`. Every other
dialog in the product sets `margin: auto` back explicitly; the lightbox did not,
so it had been rendering pinned to the top-left corner of the screen.
`.payment-dialog` and `.lease-dialog` have the same gap and are logged as
separate work — they are not part of this area. **Resolved 2026-08-31:** both
now restore `margin: auto` on desktop, while their narrow-screen rules retain
the intentional `margin: auto 0 0` bottom-sheet placement. A contract test
checks every remaining native dialog class against this reset-sensitive rule.

**Next:** Stop for user testing.

### Journey: Explore — rental discovery

**Status:** COMPLETE — 2026-08-24; awaiting user testing. First tenant-facing
area.

**Problems solved:**

- **Discovery stopped at twenty rentals.** Both clients called the search
  endpoint, returned `page.results` and dropped `next` on the floor. The backend
  has always been cursor-paginated; nothing followed the cursor. However many
  rentals existed, a tenant saw the first page and no way to ask for more.
- **There was no way to sort.** Results were always newest-first, and the second
  question about a rental is what it costs. Added `sort=newest|rent_asc|rent_desc`
  — the one backend change here. Non-trivial only because the cursor *is* the
  ordering, so the sort has to move the paginator, not just the queryset; every
  option ends in `-created_at` so the cursor stays stable when two rents match.
- **The web card led with the wrong things.** Locality in small caps above the
  headline, rent in body weight, and **two full verification stamps** taking more
  room than the price. The permanent discovery order is now **Image → Price +
  advance → Identity → Place → Essentials → Trust**. One quiet verification
  line appears only when both identity and property checks passed.
- **Filtering was a form with a Search button.** Every adjustment was a round
  trip through submit. Controls now narrow as you set them, debounced, with a
  request guard so a slower earlier response cannot overwrite a newer one.
- **Mobile could not search by text or rent, and web could not search by place.**
  Mobile had locality and advance; web had text, type, bedrooms and rent. Both
  now have place-first search with locality suggestions, plus rent, bedrooms,
  advance and furnished.
- **Saving was not offered while browsing.** The heart is on the card now, on
  both clients, optimistic and reverting if the server disagrees.

**Important decisions:**

- **Place leads.** A Ghanaian tenant's first question is where, so the search box
  is a locality autocomplete rather than a keyword box hoping for a match. Free
  text still works when no locality is chosen.
- **Advance is a first-class filter, not a hidden field.** It is often what
  decides whether a place is possible at all, so it has its own control and sits
  beside the price as one financial decision.
- **Search → narrow → browse is one system.** Location is the dominant control;
  rent, Property type, bedrooms and furnishing are the short comparison rail.
  Active choices sit below it as individually removable feedback rather than
  being hidden inside controls. The complete supported set opens as an anchored
  panel on desktop and a bottom sheet on narrow web and native mobile. Results
  still update live while choices change, with stale responses refused and a
  quiet updating state instead of clearing the feed.
- **Property and Unit are not the same filter.** Both clients read the backend's
  Property/space vocabulary and send `property_type` and `space_type` as their
  separate API concepts. A Property choice narrows the valid Unit choices; no
  client-owned category list can drift from the domain rules.
- **Verification is reassurance, not the headline.** It closes the reading order
  below the essentials: one mark, and only when both checks passed — never a row
  of stamps competing with the photograph or price.
- **The card shows nothing a tenant cannot decide on.** No description, no
  minimum lease, no move-in total, no amenity list. Those belong to the listing.
- Explore lists Units through their Listings; the Property → Unit → Listing
  relationship is untouched, and no Property detail is duplicated onto a card.

**Reusable patterns:** the recognition card is shared from `components/listings`
across Explore, Saved, tenant-home recommendations and related rentals. Explore
and Saved expose the same optimistic heart interaction; recommendation surfaces
remain navigational. The lightweight search projection supplies at most five
`card_media` photographs assembled from the already-prefetched Unit and campaign
media, with Unit imagery first. This keeps cards visual without detail requests,
N+1 queries, or client-side reconstruction of Property/Unit relationships.

**Responsive/mobile:**

- Web is an auto-filling grid capped naturally at three generous columns in the
  Explore workspace. Its cards use calm 16:10 imagery and responsive type rather
  than stretching a mobile layout. Multiple photographs move on one continuous
  horizontal track and settle with restrained motion; drag/swipe, quiet position
  markers and hover-scoped previous/next controls keep several photos reachable
  without leaving carousel chrome behind after the pointer exits.
- Mobile is a virtualized list with compact 16:10 imagery. Horizontal gestures
  page through a card's photographs; vertical gestures retain ownership of the
  Explore feed. Photo position is conveyed with quiet dots, and the Save control
  remains an independent 42px target. A card embedded in the already-horizontal
  Related rentals rail disables its nested photo gesture and opens detail on tap.
- Infinite scroll remains on `onEndReached`, with a spinner footer,
  pull-to-refresh and focused filters. A failed page never empties what has
  already been scrolled past.
- Both keep browsing position: nothing navigates away to filter.

**Known limitations:**

- No authenticated live visual review. Sorting was verified against the live
  endpoint (`rent_desc` returns descending rents, an invalid value is rejected
  422), and the review database holds four listings — enough to prove ordering,
  not enough to exercise the second page. Pagination is covered by contract
  rather than by data.
- Listing detail is deliberately untouched, as scoped.
- The search endpoint supports `amenity_ids`, but Explore does not yet have a
  stable public amenity-option catalogue in its discovery client. Amenities are
  deliberately not shown as an inert checklist; Property and Unit type are now
  exposed from the existing backend-owned vocabulary.
- No map. `map_latitude`/`map_longitude` come from the locality, not the
  building, so a map would place every listing in a neighbourhood at the same
  point. That needs property-level coordinates before it would mean anything.

**Correction — choosing did not look like choosing.** The mobile filter controls
applied its choices correctly and gave no sign of having done so. `Button`'s
`selected` prop, added earlier for a screen reader, set `accessibilityState` and
never touched the palette — so a picked filter rendered identically to an unpicked
one. Every screen that needed a visible choice had worked around it by writing a
"✓ " into the label; the filter sheet had the prop and no tick, so it showed
nothing at all.

`selected` now carries a real treatment — kola tint, 2px kola border, kola label —
and the tick workaround is retired across Units, Team property scope, the expense
form, the payment record sheet and tenant setup, each of which now passes the prop
instead.

The original sheet was also the wrong shape: a column of identical full-width
buttons is not how anyone chooses. Bedrooms, advance and sort are now compact
horizontal choice sets, furnished is a switch, and maximum rent remains a true
numeric field.

**Correction — filters were hidden by default (2026-08-26).** Web removes the
Filters disclosure and the card-like drawer; two quiet rules hold the
always-visible controls. The narrow web stack explicitly clears the desktop
search flex basis; otherwise its 22rem width basis becomes 22rem of empty height
when the row turns into a column.

Mobile briefly mirrored that decision by putting every control inline. It was
reverted after visual review: the stack pushed the first rental too far down and
made discovery feel like form completion. Mobile returns to the compact Filters
entry and page sheet, with active filters visible and individually removable on
the Explore surface. Same filtering capability, platform-appropriate density.

**Refinement — search and filter controls (2026-09-12).** After the listing
redesign the discovery tray still read as default form parts. The structure is
unchanged; the controls were redrawn and de-duplicated on both clients.

- **Each choice is shown once and removed one way.** The web search field showed
  two clears — its own and the browser's `type="search"` cancel cross — and a
  location chip added a third while counting place on the Filters badge. Place
  now lives only in the field. Rent, property type, bedrooms and furnishing show
  on their own pills; chips carry only what no pill shows (unit type, maximum
  advance, a non-default sort). Clear all clears filters, never place, and
  appears once, beside the result count; empty states guide instead of
  repeating it.
- **Designed menus, not the operating system's list.** Web quick filters were a
  native `<select>` stretched invisibly over each pill under a CSS-border
  chevron. They are Radix menus of radio items with a kola check, portalled out
  of the scrolling rail; touch waits for the tap, so swiping the rail opens
  nothing. The panel's `Select`s became chip sets over real radios and
  furnishing a switch — on the phone too, where the sheet's drawn tick box had
  announced itself as a switch.
- **Filters leads the rail** on both clients. At the end it sat past the right
  edge of a 375px phone, taking its count with it.
- **Shared glyphs.** Chevron, close, check and filters joined the portal icon set
  at its 1.5px construction, replacing typed crosses, the CSS chevron and a
  one-off filter glyph drawn at 1.25px.
- **Warm tray, white controls, kola for state.** Rail controls share one height
  (40px; 44px on coarse pointers) and the chip radius; chosen is an inset kola
  edge, so a pill turning on moves nothing; floating surfaces share radius-lg
  and the floating shadow. Filter controls take the kola focus ring the form
  controls use.
- **The panel is the dialog it announced.** Focus moves in on open, Tab stays
  inside, Escape and Close return focus to the trigger, and the scrim is no
  longer a tab stop. The suggestions are a combobox and listbox: arrows move,
  Enter chooses, the first Escape closes the list, and blur closes it.
- **Found on the way.** "Single room / studio" sent `bedrooms_min=0`, which the
  backend reads as `>= 0` — Any under another name — so it went, and old links
  carrying `0` restore as Any. The narrow web search field was 15px, which makes
  iOS zoom the page on focus. Web said "rentals" while its panel and the phone
  said "homes"; both say rentals.

Guarded by contract tests on both clients, mutation-checked 30 ways against a
mirror of the files, so neither the dev server nor Metro loaded a broken build.
Not verified: the signed-in portal shell (the same component as the public page,
which was checked at 1280px and 390px) and the phone sheet on a device — Expo web
confirmed the header and rail only.

### Journey: Explore — place search and the map (web)

**Status:** web phase complete, 2026-09-13. A day later its basemap and place
table gave way to Google Maps, and the phone gained its map — see the next
entry. Architecture in ADR 0033, and ADR 0034 for what replaced them.

**Problems solved:**

- **The location field was a text box.** It suggested Danpa HQ localities by
  substring, with no towns, landmarks or regions and no geometry. It now searches
  8,227 curated places imported from OpenStreetMap — regions to villages, plus
  airports, universities, malls, stadiums and hospitals. Each suggestion is a
  place with a centre and a box: kind icon in its semantic colour (lagoon for
  regions and districts, ink for cities and towns, gold for landmarks), the typed
  part highlighted, a context line ("Accra, Greater Accra") and a kind tag.
  Recent searches show on focus. Enter takes the highlighted suggestion; with
  none, it searches listings for the text, and the list says so first.
- **There was no map, and nothing had a position.** Choosing a place, or the
  Map pill, turns the results into a map fitted to that place — inside the page,
  in the list's place, so the site header, the search and the filters stay
  where they were. It first shipped as a full-screen layer over the whole page,
  which read as leaving Explore. Opening it slides the search up under the
  header so the map fills the screen below. Wide screens keep the results
  beside a map that stays in view as they scroll, and the rail's pill is named
  for where it goes, "Map" or "List". On a phone the map takes the page's width
  and one floating switch moves between the two — "List · 3" on the map, "Map"
  on the list.
- **The search had no durable state.** The address bar is the search:
  `?place=adabraka-accra&view=map&rent_max=2500`. Refresh, Back, a shared link
  and a return from a listing all rebuild the same search. Closing the map
  changes the view and nothing else.

**Important decisions:**

- **A marker is never a door.** Public points are snapped to a 300 m grid or sit
  at the neighbourhood centre (ADR 0022). The listing's Location section draws a
  kola area and says in words how approximate it is.
- **One search, two views.** The cards, the markers and the count come from the
  same backend filter and the same client parameter builder, so they cannot
  disagree.
- **Price markers, not pins.** A marker is a white pill (`₵1.2k`) that takes
  kola's edge on hover, fills deep kola when chosen and steps back into the
  ground once visited. Clusters are haloed kola discs that grow with their
  count; a stack of rentals on one point is a pill with its count and lowest
  rent ("3 from ₵700") that opens a paged preview instead of zooming. Emphasis
  uses `scale`, because MapLibre owns the marker's `transform`.
- **Marker → preview → listing.** A tap opens a compact card: photo, price,
  type and bedrooms, headline, place, and save when signed in. Only the card
  leaves the map. On desktop it rides above its marker, moving the map only as
  far as it must to show the whole card; on narrow screens it rises from the
  bottom.
- **The map searches a new area only when asked.** A "Search this area" pill
  appears once the tenant has panned or zoomed well beyond what was searched. A
  pan otherwise only redraws markers for the window; the count belongs to the
  search.
- **An area drawn on the map is shown wherever it narrows the rentals.**
  Searching an area keeps the place and adds the area, and a lagoon "Map area"
  chip then sits in the controls both views share — on the list page as well as
  in the map's bar. It is where, not a filter, so Clear all leaves it; the chip
  is its one way back to the whole place.
- **The basemap is quiet so the markers can be loud.** Danpa HQ's flavour of the
  Protomaps style uses field neutrals for ground, kola parkland, a lagoon wash
  for water and ink-scale labels. It has no point-of-interest icons: the listings
  are the points of interest.
- **A card's address is its own destination.** It opens
  `/listings/<id>#location`, and the page arrives at that section at once, as an
  anchor does — even in a tab opened in the background, where the site's smooth
  scrolling never starts.

**States:** the empty area keeps the map, says "No available rentals in <place>"
on a gold-ruled card and offers Zoom out and, where filters exist, Clear filters.
Loading keeps the last markers and shows a thin kola progress bar. A failed
marker request offers Retry without touching the search, and a basemap that
cannot load says the rentals are still listed. Listings without a map position
are counted in a lagoon note beside the results, and when an area has more
markers than one view can draw, the map itself asks for a closer zoom. An area
no longer offered keeps every filter and says so.

**Verified:**

- The backend: the full suite (1,587 tests), and the map search tests on three
  runs in a row on the pinned GIS libraries. Ruff is clean, and mypy finds
  nothing in the new code; the listing app's older errors are unchanged.
- The web: typecheck and lint are clean, 346 contract tests pass, and a mirror
  caught 48 of 48 mutations of what they promise.
- On the live page, at 1280px and 390px: place suggestions; opening the map
  from a place, from the Map pill and from its URL; returning to the list keeps
  the place, and Back returns to the list; a filter updates the results and the
  address bar together; the Map area chip in both views, and removing it; the
  phone's one switch both ways, stepping aside for the Filters sheet; the map
  inside the page, under the site header and the search; the empty state; and
  a card's address arriving at the Location section.
- The basemap style validated against MapLibre's style spec, with every font and
  tile layer it uses present in the published assets.

**Not verified:** painted tiles and markers. The browser pane was hidden, so
WebGL never drew a frame. The preview popup's position and "Search this area"
after a real pan need a person at the map. The signed-in portal shell uses the
same component and was not opened.

**Next:** Stop for user testing. Then Listing Detail.

### Journey: Explore — Google Maps, and the map on the phone

**Status:** built 2026-09-14; waiting for Google Maps keys, then user testing on
the web, Android and iPhone. Architecture in ADR 0034.

**Problems solved:**

- **Place search knew only what an import knew.** The field now asks Places API
  (New), limited to Ghana, through Danpa HQ's API, so the streets, estates and
  businesses a tenant names can be found. Each suggestion shows its kind in
  colour: lagoon for areas, gold for landmarks, kola for addresses. Google's
  suggestions carry "Google Maps" beneath them, as Google requires when they
  appear without its map. Typing through to a choice is one Places session.
- **The map was a self-hosted OpenStreetMap basemap** that someone had to
  extract, publish and serve from a public bucket. The web now draws Google
  Maps, and the price pills, clusters and stacks stay Danpa HQ's own markers. A
  listing's Location section draws its approximate area on the same map.
- **The phone had no map.** Explore on the phone is now map-first. The search
  box and quick filters sit over the map, and the rentals rise in a sheet: a
  peek with the count, half the screen to compare, the whole screen to read. A
  price marker opens a preview card over the map, a stack pages through its
  rentals, and a cluster zooms in. When the list fills the screen, a kola "Show
  map" pill floats over it.
- **A shared link had to look its place up again.** The address bar now holds
  the area itself — `?area_name=Adabraka,+Accra+Metropolitan&area=-0.22639,5.54896,-0.19939,5.57596&area_ref=danpahq:<id>&view=map`
  — so a reload or a shared link asks nobody.

**Important decisions:**

- **Google stays behind Danpa HQ's interfaces.** One folder per layer knows it:
  the API's location providers, the web's `lib/maps/google` and the phone's
  `DanpaHQMap.native.tsx`. No Property, Unit or Listing field names Google.
- **No key is a working screen, not a broken one.** Without keys the web says
  the map is not available and keeps every rental in the list, the phone shows
  Explore as its list, and suggestions come from Danpa HQ's localities.
- **The preview never shows rent without the advance.** On the phone the advance
  sits in a gold chip under the price, because the lump sum on day one decides
  whether a tenant can take a place.
- **"Search this area" means what the tenant can see.** The phone measures the
  map between the header and the sheet rather than trusting a provider's region,
  and Google's logo stays above the sheet.
- **The sheet moves before the list scrolls.** Dragging the rentals moves the
  sheet until it fills the screen, and only then does the list scroll. For a
  screen reader the handle is adjustable: swipe up or down to show more or less.
- **Expo Go on an iPhone draws Apple Maps.** Google's iOS SDK cannot load there;
  every build Danpa HQ ships draws Google's.

**Verified:**

- The backend: the full suite (1,589 tests), including place lookups against a
  stand-in for Google — suggestions, resolving, the fallback to localities, a
  missing key, a place Google no longer knows, and malformed session tokens.
- The web: typecheck and lint are clean, and 350 contract tests pass. In the
  browser without keys, suggestions and the resolve share one session; choosing
  a place writes the area into the address and opens the map view, which says
  the map is not available while the list shows the rentals; and reloading that
  link makes no place lookup.
- The phone: typecheck and lint are clean, and 136 contract tests pass.
- A mirror of the files caught 116 of 116 mutations of what the web and phone
  contract tests promise.

**Not verified:** anything Google draws or answers. No keys were available, so
the painted map, its markers, the Map ID and Google's suggestions were not seen
on the web, on Android or on an iPhone. The phone screen has not run on a
device: the sheet's drag, the preview card and "Search this area" after a real
pan need a person with a phone.

**Next:** add keys (`docs/runbook.md`, Maps and places), then test on the web, an
Android phone and an iPhone. After that, property location capture with a
pin-confirmed point.

### Journey: Explore on the phone — two controls, a sheet that reaches the top, markers that keep their shape

**Status:** built 2026-09-14 after the first test on a phone; waiting for the next.

**Problems solved:**

- **The top of the map was crowded.** A search box, a rail of five filter pills
  and a row of chips sat over the map. Now there is one search bar, drawn in the
  "Search this area" pill's language — white, a kola edge, a soft shadow — and
  one Filters button beside it that carries the count of what is on. Every
  filter opens in the existing sheet. Below 340 points of width the button drops
  its word and keeps its icon and count. An area searched from the map shows as
  a lagoon "Map area" chip in the results sheet.
- **The results sheet stopped short.** Dragging the rentals up could leave the
  sheet halfway: the photographs in the cards swiped sideways and could take a
  drag meant for the sheet, and a release only snapped to the nearest stop. The
  photographs now swipe only once the sheet is full. A release snaps to where it
  is heading, a deliberate flick always moves at least one stop, and the sheet
  never bounces past it. Full is the whole Explore content area under the search
  bar, which settles onto the page as the sheet arrives. Only there does the list
  scroll, so scrolling never fights the sheet; the sheet's header drags it back
  down, and its Map button returns to the map. Collapsed shows exactly the
  sheet's measured header, so a larger font or an error never clips it.
- **"Search this area" floated over the rentals.** It now rides a step above the
  sheet's top edge and fades before the sheet can crowd it. It is gone while the
  sheet is full or a preview is open, and returns with the map. It appears once
  the map has moved a quarter of the view, or most of a zoom level, away from
  where the results were shown.
- **Price markers broke on Android.** react-native-maps snapshots a marker's
  views into a bitmap sized by a layout hook the New Architecture never calls,
  so every marker became a 100×100-pixel square: a cropped pill on a dense
  screen, extra space on a coarse one. Android now draws each marker face once,
  offscreen at its natural size, and places that image; iOS places the live
  face. A face sizes itself from its text and the system font size, capped at
  1.3×, and nothing it draws reaches outside its frame: the tail is made from
  borders rather than a rotated square, and there is no shadow. A marker keeps
  its plain face while its selected one is drawn, rather than vanishing.
- **Photo arrows sat under the thumb.** The previous and next buttons are gone
  from the phone's cards; the swipe and its dots remain.

**Verified:** typecheck and lint are clean with no warnings, 137 phone and 350
web contract tests pass, and a mirror caught 150 of 150 mutations of what the
web and phone contract tests promise.

**Not verified:** anything on a device — the sheet's drag and snapping, the fade
of "Search this area", and the drawn markers on an Android phone. The count
still reads "rentals", the word the web and the filter sheet's button use.

**Next:** test on an Android phone and an iPhone.

### Journey: Explore on the web — the phone's two controls

**Status:** built 2026-09-14; waiting for user testing.

**Problems solved:**

- **The search sat above a rail of five pills and a row of chips.** The web now
  has the phone's pair: one search bar and one Filters button, both white pills
  edged in kola like "Search this area", on a warm tray with a breath of kola in
  its corner. Rent, property type, unit, bedrooms, advance, furnishing and order
  all live in the Filters panel. The button carries their count in a kola badge,
  takes kola's doubled edge while any are on, and fills with kola's tint while
  its panel is open. The Rent, Property type and Bedrooms menus, the Furnished
  pill and the chips that repeated them are gone.
- **The way to the map was the last pill in the rail.** It is now a deep-kola
  pill at the end of the results row, named for where it goes — "Map" or "List"
  — beside the count, the lagoon "Map area" chip and the one Clear all. Phones
  keep their floating switch.
- **The panel opened under the whole tray.** It now opens beneath the Filters
  button, aligned to its edge; narrow screens still get it as a bottom sheet.
- **The search scrolled away with the results.** The tray now sticks under the
  site's header once the page scrolls past it: 8px below the public site's 80px
  header, and under the portal's shorter one when signed in. Stuck, it stands on
  a band of the page's own ground with a hairline beneath and a lifted shadow, so
  results pass under it rather than through it; unstuck, neither shows. The map
  view sticks beneath the tray at a height the page measures, and Filters opened
  from the stuck tray are sized to the room under it, so their actions never sit
  past the bottom of a short window.

**Responsive decisions:** below 30rem the button drops its word and keeps its
icon and count, which its label still says to a screen reader ("Filters, 1
active"), so the search bar keeps its width: at 375px, 253px of field beside a
48px button, with nothing scrolling sideways.

**Verified:** typecheck and lint are clean; the web contract tests pass except
one Updates test, which fails on a separate edit to `web/app/updates/page.tsx`;
a mirror caught 162 of 162 mutations across web and phone. On the live page, at
desktop width and at 375px: the bar and button at 52px (48px on a phone) with no
rail or chips; turning Furnished on gives the button its badge and kola edge and
brings Clear all; Clear all returns focus to the button; the panel opens under
the button with focus inside it, and Escape returns focus; on a phone it is a
full-width sheet over a scrim, and the floating switch steps aside; the map
view's pill reads "List". Scrolled past, the tray sat at 88px under the 80px
header with its band and hairline showing and the lifted shadow on; the map
stage stuck at 246px, the tray's measured 146px plus the gap; Filters opened
while stuck sat 8px under the button; at 375px the tray stuck at 88px with
nothing scrolling sideways, and the Filters sheet opened above the header.

**Not verified:** the painted look. The browser pane was hidden, so there was no
screenshot, and the measurements above stand in for one. The signed-in portal's
Explore uses the same component and was not opened.

**Next:** user testing.

### Journey: The mobile shell — one ground, one name, and a launch that waits

**Status:** built 2026-09-14; waiting for testing on an Android phone and an
iPhone.

**Problems solved:**

- **A refresh showed the wrong page first.** The gate let the navigator draw
  whatever screen the address named while the session was still loading, and
  only moved afterwards. A tenant's Home drew its signed-out browsing page, a tab
  drew its sign-in prompt, and `/` said "Loading your account…" under a native
  header titled "index". The gate now decides while rendering. Until the session
  is known and the route is the one it calls for, Danpa HQ's name stands over
  everything: the mark's accent letters rising in turn in kola, on the canvas, above a short
  gold rule. Redirects behind it do not animate and the screen behind it is
  hidden from screen readers; it lifts over 220ms once the right screen has had
  140ms to draw, and after eight seconds it says it is still connecting.
- **`/payments` opened the provider's tab for anybody.** Both workspaces have a
  Payments tab at that address, and a refresh opened whichever group sorts first.
  Signed in, the provider tabs now open only inside the provider workspace, and a
  tenant is moved to their own Payments tab; signed out, the renter's public tab
  is shown rather than the welcome journey.
- **The app looked framed by a white shell.** Tab screens set no background and
  fell through to React Navigation's default cool grey under near-white headers
  and a white tab bar with a shadow. A Danpa HQ navigation theme now paints every
  navigator surface. Pages stand on canvas (`field-100`) and the two Homes on
  stone; each tab declares its ground once, and its header — the strip behind
  the status bar included — and the tab bar take it from there. The bar's
  hairline is the only edge left.
- **Pages titled themselves twice.** Services said "YOUR HOUSEHOLD / Services"
  under a header that said Services, and both Payments tabs, Tenants,
  Properties, More and Archive did the same. A tab header now carries the name
  at the title-1 size, aligned with the content, and on the provider side names
  the Portfolio above it; the pages open with their one line of context or their
  content. Home's greeting is its title, so Home's header keeps only its
  controls — the provider's switcher and create action — or a breath under the
  status bar.
- **Header discs vanished.** Explore's Saved and Profile discs were `field-100`,
  which is now the canvas. They, the Portfolio switcher and the create action are
  paper wells: 40pt, edged with a hairline, reaching the 48pt floor with slop.
  The create action was 42pt with none.

**Decisions:** the curtain is the transition only for a change of who is looking
— launch, sign-in and sign-out; ordinary navigation keeps each platform's
animation. Edge to edge, the status bar is given no colour of its own, and
`needsStatusBarBackground` is gone. The splash and root background in `app.json`
are the canvas, so a build goes from splash to curtain to page in one colour.

**Verified:** mobile typecheck and lint are clean; 142 mobile contract tests pass,
including a new shell suite and the welcome gate assertion rewritten for the
render-time decision; a mirror caught 30 of 30 shell mutations, and the map
suite still catches 162 of 162. On Expo web at 390px and 360px: the Services
and Explore headers at 24px on the canvas; the tab bar on the same colour with a
hairline and no shadow; Explore's discs white, hairline-edged, 40px; five 70px
tabs at 360px with nothing scrolling sideways; a signed-out `/payments` stayed
on the renter's Payments tab; `/` went to the welcome journey; and the curtain
settled on every route.

**Not verified:** the painted look and the curtain lifting. The browser pane was
hidden, so there were no screenshots and no animation frames — the curtain
settled but stayed drawn. Signed-in screens, the Homes on stone and the provider
header's Portfolio line, were not rendered. Nothing ran on a device, so
edge-to-edge behaviour in Expo Go and TalkBack or VoiceOver on the curtain are
unconfirmed.

**Next:** on an Android phone and an iPhone, signed in as a tenant and as a
provider: a cold launch, a reload, signing in and out, and each tab's header.

### Journey: Mobile colour, a quiet tab bar, and a sheet that lets go

**Status:** built 2026-09-14. Its ink chrome, gold active tab and bare tab bar
were superseded the same day by the green shell in "Green shell, a compact
filter sheet and the dashboard ground"; its swipeable bottom sheet stands.

**Problems solved:**

- **The shell was one flat beige.** Header, page and tab bar all stood on
  `field-100`, which the tokens reserve for quiet fills, so nothing said which
  part was chrome and which was content. The shell now keeps the tokens' roles:
  ink chrome (`ink-950`) behind the status bar and every header, tab or pushed;
  ivory pages (`field-50`); paper cards, sheets and tab bar (`field-0`); and gold
  as the one accent. Header controls are raised `ink-800` wells with ivory
  glyphs. The provider's create action, being the primary action, inverts to an
  ivory disc with an ink plus, and the back chevron takes the header's ivory
  tint. The launch curtain and a build's splash are the same ink, with the mark's
  o's in gold, and both Homes carry that wordmark as their header title, so their
  band is never empty. The status bar's glyphs are light over the ink and dark
  only on the ivory sign-in journey.
- **The tab bar had a kola pill.** It is now a classic shelf: paper under a
  hairline, a 24pt glyph over an 11pt name in 56pt cells, and no pill, rule or
  shadow. The tab you are on is the filled glyph in `gold-600` over a semibold
  name; the rest are `ink-500` outlines. Changing tab crossfades the outline into
  the filled glyph, and one weight of the name into the other, on the native
  driver; a press springs the glyph alone, with a small ripple on Android and a
  selection haptic on iOS.
- **The filter sheet could not be swiped away.** It had a grab handle and no
  gesture behind it: a `Modal` that slid its scrim up with it. It is now the
  shared `BottomSheet`. The handle and title row drag it either way; the body
  drags it down from the top of its scroll; and a release past a quarter of its
  height, past 160pt or on a downward flick closes it, falling at the finger's
  speed. Anything less springs home without overshooting. The sheet claims the
  gesture under the platforms' touch slop and holds its scroll view still while
  it moves. Its scrim follows its position, it stays below the status bar, its
  actions sit above the home indicator, and the back button, scrim, close button
  and VoiceOver's escape all close it.

**Decisions:** Ink, not kola, is the chrome, because the tokens give kola to
verified and success. The tab bar is paper rather than ink: it is the surface
the thumb works on, it follows the calm light bars of WhatsApp and momondo, and
on Android it keeps the system navigation handle dark and visible without adding
a native module. The sheet has two resting places — open at its content's height,
and closed — because a middle detent would push its pinned results button off
screen, and changing height instead of position would animate layout rather than
transform.

**Verified:** mobile typecheck and lint are clean; 148 mobile contract tests pass,
including a new bottom-sheet suite and rewritten shell and navigation suites; a
mirror caught 58 of 58 shell, navigation and sheet mutations, and the map suite
still catches 162 of 162; the web contract tests pass except the Updates test
that fails on a separate edit. In headless Chrome on Expo web at 390×844 and
360×780, driven by real touch events: headers measured `rgb(22, 17, 14)` and the
tab bar white; Explore, Services, Payments, the Home wordmark and a pushed listing
header were captured. The filter sheet opened; sprang back to the same top after
a 70pt drag on its title; closed on a 360pt drag; closed on a drag down from the
top of its body; stayed open and scrolled its body instead when the body was
already scrolled; and closed from its button.

**Not verified:** anything on a device. The native scroll view's competition for
the drag on Android and iOS, the status bar's glyph colour, the Android navigation
handle over the paper bar, VoiceOver and TalkBack, and signed-in screens — both
Homes on stone under the wordmark, and the provider header's wells and ivory
create action — were not seen.

**Next:** on an Android phone and an iPhone: swipe the filter sheet down from its
handle, from the top of its body and from a scrolled body; then look at each tab
signed in as a tenant and as a provider.

### Journey: Green shell, a compact filter sheet and the dashboard ground

**Status:** built 2026-09-14; waiting for testing on an Android phone and an
iPhone.

**Problems solved:**

- **The ink shell read as dark and brown.** The product owner turned down the
  ink headers and the gold active tab and asked for Danpa HQ's green, used
  harmoniously. The band behind the status bar and every header is now
  `kola-600`, with white titles, translucent white header wells and a white
  create disc; the launch curtain, the splash and the wordmark share the green.
  The tab bar keeps its paper shelf, and the tab you are on regains a pale kola
  indicator (`kola-50`, 60×32) that widens behind a deep kola glyph and a bold
  name, over outlines in a muted kola. Removing that indicator, in the previous
  entry, made the bar poorer rather than calmer.
- **The filter sheet was too tall.** Two labelled rent fields, a chip for every
  property and unit type — eleven for units — chips for bedrooms and advance, and
  a list of sort rows reached from the home indicator to the status bar. Each
  question is now one row. Rent is a two-thumb range over fifteen stops, from no
  minimum to no maximum, that reads "From GH₵1,000" or "GH₵750 – GH₵3,000" and
  searches once, when a thumb is let go. Property type, unit type, maximum
  advance and sort are dropdowns that open in place, one at a time, with the
  answer ticked. Bedrooms is a segmented control and furnished stays a switch.
  The sheet opens 588pt tall on a 390×844 screen.
- **The dashboards stood on a warm stone** that read as a second, duller brand
  under the green header, with cream cards a shade of the same beige. Both Homes
  now stand on `kola-600` let down into `field-50` — 14%, 10% and 6% from the
  header to the foot — with a faint white sheen across the top corner and a pool
  of green low on the far side, painted once behind the scroller. Cards are
  white, with a hairline edge and a `kola-900` shadow at 0.04 (0.07 on the two
  primary surfaces). Fills inside cards stay warm and neutral, the shortcuts are
  frosted glass, and eyebrows standing on the ground went from 38% to 70% ink.
  Every other tab keeps the ivory page.

**Decisions:** The rent range snaps to stops rather than sliding freely, because
a rent filter wants round figures and a thumb held in the sun cannot place
GH₵1,137. Dropdowns open in the sheet's own flow rather than as floating menus,
so the sheet's edge can never clip one and Android never loses its touch. The
ground is derived from the tokens in code rather than added to `tokens.json`,
because that file also compiles into the web stylesheet, whose dashboards keep
their own ground. Only the Homes are green: a green page under every tab would
make the whole product green and leave the dashboards nothing to be.

**Verified:** mobile typecheck and lint are clean. 158 mobile contract tests
pass, including new suites for the filter fields and for the ground; the ground
suite computes its colours from the tokens and asserts contrast — headings at
13.9:1, eyebrows at 5.9:1 and shortcut names on glass above 4.5:1. The Explore
web contract tests pass. Mirrors caught 33 of 33 filter mutations, 30 of 30
ground mutations, 67 of 67 shell mutations and 162 of 162 map mutations.

In headless Chrome on Expo web, at 390×844 and 360×780, with real touch events:

- **Chrome:** headers measured `rgb(27, 107, 79)` and the tab bar white.
- **Sheet:** it opened 588pt tall with all seven rows.
- **Rent range:** the minimum thumb moved to "From GH₵1,000" and stopped one stop
  short of the maximum. Alternating drags of the two thumbs read "GH₵750 –
  GH₵7,500" and later "GH₵1,500 – GH₵2,000".
- **Choices:** Property type and Sort by opened in place and closed on a choice.
- **Persistence:** rent, a property type, bedrooms and an order survived a swipe
  away and back, with the Filters button counting 4.
- **Clearing and closing:** the sheet's own Clear all reset it and kept it open,
  and a drag from the top of its body closed it.

Two earlier runs dropped a thumb drag; both overlapped a Metro rebuild, and the
clean run did not. The tenant dashboard was captured from a temporary route with
two mock tenancies, since removed.

**Not verified:** anything on a device: the thumbs against the sheet's native
scroll view on iOS and Android, TalkBack and VoiceOver stepping the thumbs,
`LayoutAnimation` as a dropdown opens, the ground's gradient and card shadows on
Android, and the provider's dashboard, which needs a signed-in Portfolio.

**Next:** on an Android phone and an iPhone, drag both rent thumbs, open each
dropdown and swipe the sheet away. Then open both Homes signed in, as a tenant
and as a provider.

### Journey: Explore on the web — the phone's compact filters

**Status:** built 2026-09-14; waiting for user testing.

**Problems solved:**

- **The Filters panel was a form.** Rent was two labelled boxes, every property
  and unit type was a chip — the eleven unit types alone ran to several lines —
  bedrooms and advance were more chips, and the order was a fourth group, each
  under its own heading. The panel now asks what the phone asks, in the phone's
  order, as rows with the answer on the same line: a two-thumb rent range over
  the phone's fifteen stops, dropdowns for property type, unit type, maximum
  advance and sort, a segmented control for bedrooms and a switch for furnishing.
- **The panel was taller than it needed to be.** Under the full-width rent range,
  the rows pair up two to a line wherever the panel has room for two 17rem
  columns: property and unit, bedrooms and advance, furnishing and order. The
  panel narrowed from 46rem to 40rem and measures 403px tall in a 1280×860
  window, with nothing to scroll. At 390px it becomes a one-column sheet 611px
  tall, also without scrolling.
- **Lists fit wherever they open.** The dropdowns are the panel's own
  select-only comboboxes, never the operating system's list. Arrow keys, Home,
  End, Enter and Escape walk them, and Escape closes the list without closing
  the panel. A list is fixed to the window, because the panel scrolls and would
  clip it, and opens below its button when it fits and above when there is more
  room.

**Decisions:** The range is two real range inputs over one drawn rail, so each
thumb keeps native keyboard, pointer and screen-reader behaviour; only the thumbs
take the pointer, so the one on top never blocks the other. The stops live in
`exploreQuery`, and a contract test holds them equal to the phone's. The panel's
own Escape listener now ignores a key a control inside has already used: Next
hydrates React onto the document itself, where stopping propagation cannot keep
a key from a sibling listener.

**Verified:** typecheck and lint are clean. The web contract tests pass except
two that fail on edits made outside this change, to `web/app/updates/page.tsx`
and to the portal header in `PortalShell.tsx`. A new filter suite runs beside the
updated Explore suite. Mirrors caught 36 of 36 filter mutations, and the map
suite still catches 162 of 162.

In headless Chrome on the live page:

- **Desktop, 1280×860, mouse and keyboard:** the panel measured 640×403px, with
  two 283px columns.
  - **Rent:** dragging the thumbs read "From GH₵750" and then "GH₵750 –
    GH₵5,000". Two arrow presses moved the minimum to GH₵1,500, each change
    reaching the address bar after the pause.
  - **Lists:** Property type opened below its button and took "Residential"
    from ArrowDown and Enter. Unit type and Sort by opened above theirs, and End
    walked to the last option. Escape closed a list and left the panel open.
  - **Clearing:** bedrooms, furnishing and an order brought the Filters count to
    5, and Clear all emptied the address bar.
- **Phone, 390×844, touch:** the sheet measured 611px, in one column.
  - A drag set "From GH₵1,000".
  - Unit type's ten options scrolled in a 320px list above the button, inside
    the window.
  - A tap chose "House" without closing the sheet.

**Not verified:** Safari and Firefox, where the thumbs rely on
`::-webkit-slider-thumb` and `::-moz-range-thumb`; a screen reader on the
dropdowns; and a real phone.

**Next:** try the panel with a mouse and a keyboard in each browser, and on a
phone.

### Journey: Units — first-class across the Portfolio

**Status:** COMPLETE — 2026-08-24; awaiting user testing.

**Problems solved:**

- A Unit could only be found through its Property. A provider whose question is
  "where is Room 4" had to remember which building it was in first.
- **Units were readable one Property at a time.** `GET /properties/<id>/units/`
  was the only collection read, so a portfolio-wide screen would have meant a
  request per Property — fine at five, unusable at fifty. This is the one
  backend addition: `GET /organizations/<id>/units/`, same model, same
  serializer, same member scoping as the Portfolio summary beside it. No new
  projection and no duplicated rule.
- `UnitSerializer` had no `property_title`, so a Unit read outside its Property
  could not say where it was. Added, read-only.

**Important decisions:**

- **Two complementary surfaces, one Unit.** Property → Units answers "what is
  inside this building"; Units answers "where is Room 4". Property detail keeps
  its Units unchanged, and both open the same canonical Unit screen.
- **A card carries a photograph, a name, its Property and one state.** That is
  what recognizing a room takes. Verification, publication, occupancy, access
  codes, lease and listing detail stay on the Unit — the card shows a flag only
  when something is wrong or waiting.
- **"Attention" means wrong or waiting, not private.** A private Unit is a
  normal deliberate state; flagging it would make the filter meaningless. The
  tab appears only when something qualifies.
- **One creation flow.** Global Add Unit chooses a Property and hands over to the
  existing `spaces/new` route. Property → Add Unit skips the choice, because the
  Property is known. Only Properties whose `private_inventory` capability allows
  it are offered — the backend refuses the rest, and a menu of dead ends is
  worse than a short menu. One eligible Property is not a choice, so that case
  redirects straight through.

**Reusable patterns:** the recognition card — photograph, name, one line of
place, one state, a flag only on exception. Filters split by reach: what people
grab stays on the screen, what they rarely need goes behind one control.

**Responsive/mobile:**

- Web is an auto-filling card grid, controls wrapping to a column under 600px,
  tabs scrolling rather than wrapping.
- Mobile is its own screen — virtualized list, 92px rows with a 64px thumbnail,
  search and availability chips on the surface, Property and sort in a page
  sheet. It costs no tab: Units sits at the head of More's Management group,
  keeping the five-tab rail intact.

**Known limitations:**

- No authenticated live visual review. The collection read was verified against
  the live service: 9 Units across the review Portfolio, each with
  property_title, availability, verification, publication and primary photo.
- Sorting and filtering happen in the client over the full Portfolio response.
  That is right up to a few thousand Units; past that the endpoint needs query
  parameters and pagination, which is a backend change to make when a Portfolio
  that large actually exists.
- No Unit thumbnails existed in the review data, so the empty-photo frame was
  exercised and the populated one was not.

**Next:** Stop for user testing.

### Journey: Provider Home — control center

**Status:** SUPERSEDED — 2026-08-31 by “Provider Dashboard — operational visual
architecture” below. Retained as the record of the first control-center pass.

**Problems solved:**

- Home was an attention queue plus one summary row, built on the earlier
  decision that Home "is not a dashboard". On review that was too little: a
  provider could not see the shape of the business, the money, the schedule or
  what had happened without visiting four areas. The brief replaced that
  decision; this record replaces it in the document.
- Nothing on Home said what the Portfolio *is* — no Properties, Units, tenants
  or occupancy figure existed anywhere.
- No financial snapshot at all. Overdue rent appeared only as one attention row.
- No schedule. A provider had no idea what was happening today.
- No activity. `recent_activity` was loaded and never rendered.

**Important decisions:**

- **Built from a signal inventory first** (recorded above), so every figure came
  from a record the backend could defend. At the time, period rent, revenue,
  settlement, maintenance and vacant-but-unlisted were unavailable. Payment Core
  later added authoritative settlement fields; period trends remain unavailable.
- **The money is stated without a period, because none of it has one.**
  Outstanding is a point-in-time balance; Confirmed received is all-time and says
  so. An Expected/Collected/Outstanding triple would be three numbers of which
  only one means what it says. The former non-custodial copy was removed after
  PSP payment and settlement architecture became real product behavior.
- **Due soon** is computed from each tenancy's own `next_due_on`, not invented —
  a seven-day window over real due dates.
- **Recent activity is composed from Portfolio-scoped records** already loaded:
  payment records, accepted agreements, and the summary's two activity kinds.
  Notifications were the richer source and were rejected — they are per-account,
  so a provider with two Portfolios would see them mixed together on a page whose
  every other figure is scoped.
- **Occupancy does not link anywhere.** It is a ratio of the two figures beside
  it; a figure is a link only where there is somewhere useful to go.
- Home summarizes and hands off. It does not manage: every panel ends in the area
  that owns the work.

**Reusable patterns:**

- Figure tile: label, value, one qualifying note, optional destination. Earned
  its card because each is a distinct question.
- Panel: hairline border, no shadow, no gradient — the composition carries the
  weight, not the decoration.
- The honesty guard remains, but now rejects unsupported revenue and period
  claims while permitting the backend's explicit settlement figures.

**Responsive/mobile in that pass:**

- Web: four figures across, then two-by-two panels, collapsing to one column at
  1100px, two figures at 760px and one at 460px.
- Mobile is recomposed, not stacked — attention, rent, Portfolio shape, viewings,
  activity, in that order, and a contract test asserts that order holds.
- Empty Portfolio returns before any figure renders, so a new provider never sees
  a wall of zeroes.

**Known limitations:**

- No authenticated live visual review; the composition was read back through the
  live service instead. Against the review Portfolio: 8 Properties, 9 Units
  (7 available), 1 tenant, 22% occupancy, GH₵2,350 outstanding, GH₵850 overdue,
  GH₵0 confirmed all-time, 1 claim awaiting, 0 due soon, 17 activity records.
- **Vacant but unlisted** — the signal a provider most wants for lost revenue —
  needs per-Unit publication state in the Portfolio payload. Recorded as the next
  backend capability worth adding for this dashboard.
- Rent trend, occupancy trend and any period comparison need historical
  snapshots that do not exist.
- Viewings shows today and tomorrow with a count of what follows; there is no
  week view because Home is not the Viewings area.

**Removed with this work:** `mobile/app/(app)/home.tsx`, a Phase-1 screen whose
own comment said "there is no property search yet". Nothing navigated to it any
more — the tab groups are the home for each workspace — but it remained a
reachable `/home` route and the fallback destination for an unrecognised
notification. That fallback is now the tab group for whichever side the person is
on, which is where an unknown target should land anyway.

**Next:** Stop for user testing. Then Properties.

### Journey: Mobile Home cards, and the Settings copy budget

**Status:** SUPERSEDED — 2026-08-31 by the intentional mobile dashboard
composition. Retained as the record of the earlier card pass.

**Problems solved:**

- The mobile Home rebuild used bordered sections and rows, so the control center
  read as a list and the money was its loudest part. It now opens with four
  figure cards — Properties, Units, Tenants, Occupancy — and each question after
  that is its own card.
- Settings carried explanatory copy under rows and headings that named their own
  destination. Removed across both clients under §10.1.

**What was removed:** the photo caption (an avatar showing initials says it), the
Archive paragraph (each row already says whether it can be restored), the
signed-in-devices instruction (a row with no button marked THIS ONE explains
itself), the Team purpose statement (the roster shows who, what and where), the
"your checks" explanation (the Stamp carries it), the push-notification detail,
and every subtitle on the mobile Settings index.

**What was kept, and why:** the all-time qualifier stayed with its figure. The
former “does not hold or transfer money” copy was later retired when PSP payment
and settlement behavior became implemented. In Notifications: that
decisions always appear in Updates (otherwise people leave SMS on out of fear),
that texts carry network charges, and what "important" actually means. In Team
and the invite dialog: that nothing is granted until the person accepts. Signing
out everywhere keeps its warning because it signs you out too.

**Important decisions:**

- `detail` became optional on the mobile Settings row, the web toggle and the
  mobile toggle, so a self-evident label can simply have nothing beneath it
  rather than being given filler.
- The copy budget is a test, not a habit: the mobile Home guard reads the
  rendered captions and fails explanatory ones.

**Responsive/mobile:** figure cards are two to a row at phone width and grow to
fill; each card is the whole target with one accessibility label. Occupancy is a
ratio of the two figures beside it, so it is the one card that leads nowhere.

**Correction — mobile Home was doing Payments' job.** The Rent card carried
three figures, an all-time qualifier and a statement about how Danpa HQ handles
money — the largest thing on the dashboard, and most of it not actionable. Home
now shows Outstanding and Overdue, the two figures that change what a provider
does today, and links to Payments for the rest.

Moving the qualifier mattered more than removing it. Mobile Payments showed the
same all-time `Confirmed received` figure and never said it was all-time, so the
sentence keeping the number honest was living on a screen that no longer
displayed the number. Payments then owned both the figure and its qualifier,
including the non-custodial statement that was accurate before platform PSP
settlement was implemented. The contract guards moved with the figure and were
later revised with the payment architecture.

**Rule this establishes:** a figure and the sentence that keeps it true must not
live on different screens. When a summary hands detail back to the area that owns
it, the qualifier goes too.

**Known limitations:** the copy guard covers mobile Home only. Extending it to
other screens needs a shared helper and is worth doing when the next area is
refined rather than retrofitted now.

### Journey: Provider Mobile → More

**Status:** COMPLETE — 2026-08-24; awaiting user testing. The screen §10.1 was
written for.

**Problems solved:**

- Every row carried a description. `Leases — drafts, open offers and agreement
  history` where `Leases ›` is complete. All of them removed.
- Four bordered `Surface` blocks wrapped what are lists of links. A card around a
  list is structure the list did not ask for. Groups are now a small caps label
  and hairline-separated rows.
- Switching to the tenant experience was a heading, a two-sentence paragraph and
  a button. It is a change of view, not a change of account, so it is one link.
- Account was a single `Settings` row leading to a second index. Reaching
  Security meant More → Settings → Security. The five destinations are listed
  directly under **Account and settings**.
- `Verification` pointed at provider standing; it now points at **Your checks**,
  which is what a person goes looking for.
- `Messages` led to Updates. Renamed to match the area.
- The header was the word "More" over a sentence explaining the screen. It now
  carries that page name once; Portfolio identity stays available through the
  labelled switcher instead of forming a second stacked title.

**Important decisions:**

- **One index per side, built from one set of rows.** More is the provider's;
  the tenant's profile tab is theirs. What they list differs and should — a
  tenant has no Team or Archive, a provider has no rental history — but the rows
  themselves live in `components/account/IndexRows`.

  This replaces an earlier call to keep them as two independent lists. That
  reasoning was wrong: the difference is in *membership*, not in the row, and
  building the row twice meant keeping two screens in step by hand — which is
  exactly how they drifted. `settings.tsx` sat between the tenant tab and its own
  account destinations, listing most of the same rows a second time; it is gone,
  and the tab lists them directly the way More does.

  Signing out and changing workspace are on both indexes as quiet links. Sign out
  had been on `settings.tsx` alone, so removing that screen would otherwise have
  stranded it.

- **The profile editor is `profile-edit`, not `profile`.** A folder in
  parentheses contributes nothing to the URL, so `(app)/profile.tsx` and
  `(app)/(tabs)/profile.tsx` both resolved to `/profile` and one silently won.
  The collision was invisible while the tab merely re-exported its sibling, and
  broke the moment they became different screens — the tenant's Profile row led
  nowhere. A contract test now fails on any `(app)/x.tsx` that shares a path with
  a tab-group `x.tsx` without re-exporting it; `saved` is the one remaining pair
  and does re-export. The guard was checked by breaking `saved` deliberately.
- Updates carries an unread count. It is the one row where a number changes
  whether you tap, and zero is not shown.

**Reusable patterns:** grouped navigation rows — small caps group label, icon,
label, optional count, chevron, hairline between. No descriptions, no cards.
A contract test asserts More declares no `detail=` and no `<Surface`.

**Responsive/mobile:** 56px rows, icons at 22px in ink rather than accent so the
labels lead, and the chevron is the only affordance repeated.

**Refinement — 2026-09-14, product owner review.** The brief: More is a hub of
sections, not a profile page; soft, glassy, compact and premium, without flat
white lists, a card per row or heavy shadows; and the two acts at the foot
redesigned. Organization and functionality are unchanged. At the product
owner's request this surface departs from the general rule against glass and
icon boxes, and supersedes the no-cards and ink-icon patterns above.

- **The tenant's More opened as a profile.** An 88pt initials disc, a
  display-size name and the phone number stood above the groups, under a header
  that said "Profile" over a tab called More. The identity block is gone — who
  you are is behind the Profile row — the header says More, and the signed-out
  prompt says "Your account".
- **Each group is one frosted panel**, never a card per row: white at 72% with a
  1px `kola-900` edge at 8%, and a 0.05 `kola-900` shadow everywhere but Android,
  where elevation smudges through a translucent fill. Rows are 50–52pt with
  hairlines inset past the glyph. Group names are small caps in `kola-900` at 76%,
  the tab bar's muted green, and are headers to a screen reader.
- **Glyphs sit in wells tinted by group**, in the families Services already sorts
  by (`ServiceGlyph`'s `TONE`): harmattan for Waiting for you and for Growth and
  trust, laterite for Your shortlist, lagoon for Your history and Management, kola
  for Account and settings. Neighbouring groups never share a colour, and
  Verification is never laterite — a shield in that colour read as a failed
  check. Counts are a kola pill.
- **The page stands on ivory the chrome's green reaches into:** `kola-600` at 10%
  under the header fading over 420pt, a 2.5% floor, a white sheen across the top
  corner and a faint pool low on the far side, painted once behind the scroller.
  At its deepest that is 12.5% against the Homes' 14%, so the Homes remain the
  only green pages.
- **Switch experience and Sign out are buttons, not links.** On review
  (2026-09-15) they became two quiet glass tiles side by side, in Home's
  "Everything else" language: frosted glass with a `kola-900` edge, the switch's
  glyph and a small "Switch to" eyebrow in kola over its destination, and Sign out
  in laterite. Both show a spinner and their busy label while working, press with
  the tab bar's spring and honour Reduce Motion. A refused switch is said beside
  the switch rather than at the top of the page.
- **Provider More uses the same page, groups and acts**, because both indexes are
  built from one set of rows. Its groups and rows are unchanged.

**Verified:** mobile typecheck and lint are clean, and 162 mobile contract tests
pass. The index suite now asserts the hub, the glass panels, contrast computed
from the tokens and the two acts, and a mirror caught 37 of 37 mutations once the
acts' tests followed the foot's revision. In
headless Chrome on Expo web, with the API answered in-page, at 390×844, 360×780
and 320×640: an invitation waiting, an account without provider capability, the
busy switch, a refused switch, and provider More with an unread count.

**Known limitations:** not yet seen on an iOS or Android device, so the iOS
shadow, Android ripple and hairline, native font weights and VoiceOver/TalkBack
remain user-test items.

**Next:** Stop for user testing. Then Properties.

### Journey: Mobile profile editor

**Status:** REFINED — 2026-09-15, product owner review; awaiting user testing.

The brief: premium, simple, as little copy as possible, with every capability
and all data kept.

- **Every block was labelled and explained.** YOUR PHOTO, YOUR NUMBER, "Optional.
  Tap to add it", a sentence on how signing in works and a paragraph on
  completeness are gone. A camera badge on the photo says it can be changed, and
  a lock beside the number says it is how you sign in. Completeness is a thin
  kola ring round the photo and "80% complete" beside the number. It is never a
  tick, a shield or a stamp, because a complete profile is not a verified one.
  One sentence stays: "Landlords and agents see your preferred name."
- **The photo** sits in a white rim inside the ring, or initials on a kola
  gradient stand in when there is none. Without a photo the camera opens the
  library. With one, the platform's sheet offers a new photo or removal; this
  replaces the Remove photo button that sat under it.
- **The names are one glass panel of inline rows**, each label beside its input
  and a breath of kola behind the row being typed in. The panel stands on the hub
  ground More and Services use (`IndexGround`, now exported for pages that need
  their own scroller), and the scroller keeps taps while the keyboard is open.
- **Save is the page's one action**, in solid kola. It shows a spinner and
  "Saving…" while it works and "Saved" with a check once the save lands, then
  returns to "Save changes" on the next edit.
- **Fixed while there:** the screen can mount behind the launch curtain before
  the session is read, after a refresh or a link straight here. The fields opened
  empty, and saving from there would have sent empty names and switched the data
  saver off. The fields are now filled once, when the account arrives, and never
  over typing.

**Verified:** mobile typecheck and lint are clean. 171 of 173 mobile contract
tests pass; the two failures are the Explore header button's, from header work in
progress. Seven new editor tests were added, and a mirror caught 33 of 33
mutations. Checked in headless Chrome on Expo web, with the API answered in-page,
at 390×844, 360×780 and 320×640: filled fields on a cold load, focus, saving,
saved, a refused save, and a profile with a photo.

**Known limitations:** the photo sheet is the platform's `Alert`, which the web
preview does not draw, so replacing and removing a photo remain device checks.

### Provider Home — signal inventory (2026-08-24)

Taken before designing the control center, so the dashboard is built from what
Danpa HQ can calculate rather than from dashboard conventions.

**Portfolio-scoped and truthful** — `GET /organizations/{id}/portfolio/`:

| Signal | Source | Note |
|---|---|---|
| Properties, Units | `counts.properties`, `counts.units` | |
| Occupied / vacant Units | `counts.occupied_units`, `counts.vacant_units` | physical occupancy |
| Occupancy % | derived from the two above | |
| Active tenants, active leases | `counts.active_tenants`, `counts.active_leases` | |
| Pending tenancy requests | `counts.pending_join_requests` + `tenancy_requests[]` | |
| Outstanding rent | `money.outstanding_minor` | unsettled charge balance, point in time |
| Overdue rent | `money.overdue_minor` | due date passed and unsettled |
| Confirmed received | `money.confirmed_received_minor` | **all time**, confirmed payments only |
| Collection series | `rent_collection.monthly/yearly[]` | confirmed by payment date; current outstanding by obligation due date |
| Recorded expenses | `money.expenses_minor` | |
| Claims awaiting the provider | `money.payment_records_awaiting_you` | |
| Per-tenancy rent position | `tenants[].rent.{status,outstanding,overdue,next_due_on}` | supports a due-soon count |
| Recent payment records | `recent_payments[]` | |

Also available: per-Property `verification.review_state`, `unit_count`,
`occupied_unit_count`, `vacant_unit_count` (`listOrganizationProperties`); lease
`status`/`ends_on` (`listGrantedLeases`); viewing `status`, `confirmed_starts_at`,
`is_upcoming`, `check_in.state`, `attendance.can_report`/`can_respond`
(`listHostViewings`); applications awaiting a decision.

**Deliberately absent — cannot be calculated, so must not appear:**

- **Expected / billed rent for a period.** `rent_collection` now groups confirmed
  receipts by payment date and the balance still open by due date. It does not
  turn an obligation schedule into expected revenue or reconstruct old
  month-end balances.
- **Revenue or wallet balance.** Confirmed payments and provider settlements are
  now real records, but neither is a claim about accounting revenue or a stored
  Danpa HQ balance.
- **Maintenance.** `counts.maintenance_alerts` is always null — not enabled.
- **Vacant but unlisted.** Publication is per Unit and the Portfolio payload
  carries no per-Unit publication state; computing it needs a Unit fetch per
  Property. Recorded as a future dashboard capability rather than approximated.
- **Occupancy trend or historical outstanding balance.** Neither is snapshotted.
- **A rich Portfolio activity feed.** `recent_activity[]` carries exactly two
  kinds — a tenant joining and a Property being added. Home composes its activity
  from the Portfolio-scoped records it already holds (payments, requests, lease
  and viewing state) rather than from that field or from notifications, which are
  per-account and would cross Portfolios.

### Journey: Provider Dashboard — operational visual architecture (2026-08-31)

**Problems solved:** Provider Home was truthful and well scoped, but four equal
stat cards followed by four nearly identical white panels made occupancy, money,
attention, leasing and schedule read with the same weight. Interaction feedback
was limited to border changes and text underlines. Mobile reproduced the same
card-stack grammar instead of composing a phone narrative.

**Important decisions:** The existing Portfolio read model remains authoritative.
Its existing response now carries one read-only `rent_collection` projection;
no competing financial model or endpoint was created. A Portfolio pulse combines occupancy with
Properties, Units and tenants; attention is semantically ranked; rent has a
distinct interactive financial region; agreement state is an ordered pipeline;
and property capability readiness uses explicit numerator/denominator bars.
Settlement is now a valid payment-domain fact, so `Awaiting settlement` is shown
with `PSP-confirmed`. Monthly/Yearly collection uses confirmed `RentPayment.paid_on`
buckets; still-outstanding bars use current `RentCharge` balances grouped by
`due_on` and say so explicitly. Revenue and historical balance claims remain prohibited.

The web pass adds a dashboard-local application bar without replacing the
provider sidebar: Portfolio search spans the already-scoped Property, Unit and
tenant records, notifications remain account-wide, and Add Property remains
permission-derived. The largest real Property becomes a restrained Portfolio
highlight; it is deterministic, not a promoted or invented recommendation.

**Reusable patterns:** occupancy ring with textual equivalent; semantic icon
tile; attention queue with warning/danger meaning; dark financial position;
three-stage lifecycle summary; readiness bar with stated denominator; compact
all-clear state; architectural grid/registration marks; keyboard/pointer chart
inspection with crosshair and tooltip; geometry-matched dashboard skeleton. These establish the
permanent rules in 10.2, but are applied only to Provider Home in this review
slice.

**Responsive/mobile:** Web uses its width to show Portfolio relationships and
paired operational questions, then collapses by component width rather than by
window alone. At tablet width the Portfolio and attention regions stack while
attention becomes a compact horizontal decision row; chart labels and controls
remain readable. The existing sidebar/drawer behavior is unchanged. React Native
was not changed in this web-only review slice.

**Known limitations:** Occupancy and readiness are current snapshots. The chart
does not claim expected revenue or a historical outstanding balance. Recent
activity remains a small composition of records already loaded for this Portfolio.

**Next:** Stop for user review. Do not propagate this visual language to other
pages until the Provider Dashboard composition is approved.

### Journey: Property setup — photographs and creation checkpoints (2026-08-26)

Two parts of the creation flow that both failed the same way: they were sized
for the space they were designed in rather than the space they are used in.

**The photographs.** Each slot pairs what to photograph with why it matters —
*"A second angle shows the building as it stands, not as one photograph framed
it."* That line was reviewed for removal and kept: it changes which photograph
somebody takes, which is the whole point of asking for it. So this was a layout
problem, not a copy problem.

The slot ended in a control block of a fixed ~200px — thumbnail, Replace, Remove,
none of them allowed to wrap — laid out as one non-wrapping row. Every pixel the
column lost fell on the text. Measured in the browser:

| Container | Text column | Reason | Slot height |
|---|---|---|---|
| 560px | 342px | 2 lines | 93px |
| 420px *(the real step column)* | 254px | 2 lines | 93px |
| 320px | 156px | 3 lines | 113px |
| 280px | 116px | 4 lines | 157px |

On the phone the same slot was worse in the other direction: a `Surface` per
slot — a card inside the card the screen already is — holding a 140px-tall
full-bleed image and two buttons. Six photographs ran past 1,700px.

**The photograph is the control.** Tapping it replaces what is there, which is
how changing a picture works everywhere else; an empty slot is the same square
waiting, dashed, with a plus in it. That leaves exactly one fixed item per row —
64px, comfortably past the 48px minimum for something you tap — and nothing else
that refuses to shrink. Remove stays separate and quiet, because it is the only
action here that destroys something. Re-measured:

| Container | Text column | Reason | Slot height | Six slots |
|---|---|---|---|---|
| 720px | 500px | 1 line | 92px | 552px |
| 560px | 430px | 2 lines | 112px | 672px |
| 420px | 290px | 2 lines | 112px | 672px |
| 360px | 230px | 3 lines | 132px | 792px |

Zero overflow at every width down to 280px, at the row, the panel and the step
card. A first attempt used a container query to stack the controls under the
text below 26rem; it was thrown away because the threshold sat just under 420px,
so the most common case in the product was the worst row on the page. Removing
the unshrinkable thing beats picking a width to hide it at.

The chain that made this reach the card at all is worth naming: a flex or grid
item's default minimum is its own content, so **one unshrinkable child widens
every ancestor until something scrolls**. `min-width: 0` is now asserted on the
panel root, the list and the text column, and each is mutation-covered.

**The checkpoint journey.** The anonymous `SETTING UP` percentage treatment has
become a reusable, named milestone language shared by Property and Unit
creation. On web, the available width carries the full horizontal journey:
restrained icons, concise labels and a connector that changes from a quiet rule
to kola as work is completed. Completed, current, upcoming and needs-attention
states are distinct without turning the flow into a row of badges.

On a phone, the component shows only the immediate previous, current and next
checkpoint, with the current milestone visually anchored and a quiet `4 of 7`
position above it. This preserves context and overall progress without crushing
six or eight labels across the viewport. Movement into a checkpoint uses one
short scale transition and respects reduced-motion preferences.

The component communicates progress but does not become navigation. Property
setup remains resumable and non-sequential through its existing step list; Unit
creation remains sequential. The journey reflects those domain rules instead
of changing them. Its accessibility value counts required setup work, so an
optional stage left undone is never announced as missing progress, while the
visible journey still locates that stage honestly. Clearing the last required
checkpoint changes the heading to `READY TO REVIEW` rather than leaving the
provider to interpret a completed line.

### Journey: Form controls — the last native widgets (2026-08-26)

Everything a person types into or picks from, on both platforms. These were the
last things in the product still wearing the browser's own clothes, which is why
carefully drawn screens still read as ordinary once you reached the form on them.

**What was actually wrong**

- **The text field had no focus state at all.** The input inside it set
  `outline: none`, and nothing replaced it — the shell around it never reacted.
  Tabbing through a form moved a cursor nobody could see. This is the single
  biggest tell, and it was an accessibility failure as much as a visual one.
- **Nine screens hand-rolled `<input type="checkbox">` and `<input
  type="radio">` with no styling.** The operating system drew them: its grey, its
  size, its focus ring, next to type and colour chosen deliberately. Two of them
  set `accent-color` and nothing else, which tints the tick and leaves the widget.
- **`<select>` wore the OS arrow.** It cannot be recoloured, it differs on every
  platform, and no amount of care around it survives it.
- **Amenity chips had a native checkbox inside the chip** — a box inside a box,
  both saying "selected", one of them drawn by the OS.
- **Mobile `Choice` filled selected options solid kola with white text**, so a
  set of five options read as five primary buttons competing to be pressed rather
  than as one of them being the answer.

**The rules the new controls hold to**

1. **The real input stays.** It is unpainted, never removed: `opacity: 0`, not
   `display: none`. A control replaced by a div cannot be reached by a keyboard,
   announced by a screen reader, or grouped into a set by arrow keys. Drawn in
   `forms.css` rather than inline precisely because every state worth having —
   `:hover`, `:focus-visible`, `:checked`, `:disabled` — is a pseudo-class, and an
   inline style cannot express one. That is why these had none.
2. **Focus is a soft ring, not an outline.** `box-shadow: 0 0 0 3px kola-50` with
   the border going kola-600: the control comes forward instead of the browser
   drawing on top of it, and because it is a shadow it moves nothing.
3. **Turning something on never moves what is beside it.** A chip that gains a
   pixel of border re-wraps every chip after it, under the thumb of whoever
   pressed it. Selected is an *inset* shadow — measured at 97px in both states.
   The switch knob uses `transform`, not an offset. On the phone, where a border
   cannot be a shadow, the horizontal padding gives back exactly what the second
   pixel of border takes.
4. **State is never carried by colour alone.** Chosen differs in weight too: an
   inset ring on the web, `bodyStrong` on the phone.
5. **A setting is a switch; one of several answers is a checkbox.** "Send me an
   email when rent is due" is on or off. The phone keeps the platform's own
   switch, themed kola — parity here is semantic, not geometric (ADR 0014).

**New primitives** — `Check`, `Radio`, `CheckChip`, `Switch` (web, in
`Check.tsx`); `Chip` and a shared `SelectableChip` (mobile, in `ui.tsx`).
`Field` and `Select` were rewritten against `forms.css`; mobile `Field` holds
focus in state, since React Native has no `:focus`, and still passes the
caller's own `onFocus`/`onBlur` through.

**Adopted in**: property setup amenities, shared amenities, Portfolio setup
activities, Explore filters, agreement acknowledgement, viewing slot choice,
offered-slot confirmation, notification settings, team property assignment.
Explore's filter drawer had written out by hand exactly what `Select` and `Field`
already are, so its bespoke rule went with it. `PropertyTypeChoice` keeps its own
tiles — it was already drawn, with checked, hover and focus states, and is the
reference the chip language follows.

**Two real bugs found on the way**

- **The offered-slot radios had no `name`.** Without one they are N independent
  radios as far as the DOM and any assistive technology are concerned: arrow keys
  do not move between them and none of them is "one of a set". React held the
  state, so it looked fine and was not.
- **The mobile amenity tick was a character prefixed to the label.** Selecting a
  chip widened it, so every chip after it shifted and the rows re-wrapped under
  the thumb that pressed it.

**A specificity trap worth naming.** Four workspaces sized the native input with
descendant rules — `.viewing-slots input`, `.agreement-acknowledge input`,
`.settings-toggle input`. Those are (0,1,1) and beat `.control-input` at (0,1,0),
so the hidden input would have come back at 1.125rem, drawn by the operating
system, *beside* the box that replaced it. Each had to be retargeted, and a test
now asserts none of them returns.

**Two defects the first pass introduced, found on review** — both in the text
field, both the kind of thing that reads as unfinished without being nameable:

- **Every field came out 50px.** The input was padded to 48px inside a shell
  whose `min-height` was already 48, so the content pushed past it and the
  border added two more. Buttons and selects beside it were 48. Fields now
  measure 48, matching both.
- **A 12px strip down each side of the field was not part of the control.** The
  horizontal padding sat on the shell, so the input started 13px in; clicking
  the left edge of something that looks like a text box did nothing. Measured:
  8 of 160 sampled points inside the box missed the input. The padding moved
  onto the input and the frame now stretches it — **0 dead points of 360**. The
  phone had the same strip for the same reason, and got the same fix; a prefix
  ("GHS") carries the left padding itself so the text position is unchanged.

Both are guarded by a test, mutation-checked eight ways.

**A third defect, and the one worth remembering.** `globals.css` gives every
input a 2px kola-300 outline on focus — deliberately, so keyboard users always
see where they are. It is written as:

```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible { … }
```

`:where()` contributes **no specificity**, so that rule weighs (0,1,0) — exactly
what a bare class weighs — and it sits later in the cascade than `forms.css`.
**A single class cannot override it. It takes a pseudo-class to answer a
pseudo-class**, and that is not apparent from reading either rule.

The consequence was a **sharp-edged green rectangle**: the outline landed on the
input's own box, which has no radius, over a control drawn with one. It appeared
in five places, and stretching the input to fill its frame made it worse rather
than better — the rectangle moved from floating inside the field to sitting
exactly on its edges.

Worst of it was `PropertyTypeChoice`, where the input is stretched to `inset: 0`
across the whole tile: focusing a property type drew *two* rings, the intended
rounded one on the tile face and a square one from the invisible input on top of
it. Three 1px file inputs did a smaller version of the same thing — a 2px outline
offset by 2px around a 1×1 box is a ~9px green square beside the control it
belongs to. Those now use `.sr-only`, whose `clip-path` takes the outline with it.

The rule this leaves: **anywhere an input is hidden behind something that draws
the focus state itself, that input must suppress its own outline — and the
replacement must actually show focus, not merely switch it off.** Asserted for
all three, both halves, mutation-checked seven ways.


**Verified by measurement**, not by reading the CSS back: every state computed in
a browser — checkbox on/off/disabled, radio on/off, chip on/off/disabled, switch
on/off/disabled, field rest/error/disabled — plus a regression pass on the three
sites that kept their own frames. Two probe bugs had to be fixed first: a helper
that silently dropped its `::after` argument and so measured the parent every
time, and a read taken at t=0 of a 140ms transition, which returns the value the
animation started from rather than the one it lands on.

### Journey: Rent account and Tenancy requests — records, not layers (2026-08-26)

Two provider lists whose records opened as modals. Both now open at their own
address, and the second was rebuilt to the shape of the first.

**Why a modal was wrong for both.** A `<dialog>` is right for one short form —
the expense form on Payments still is one. It is wrong for a record somebody
*works in*. The rent account holds a review queue with irreversible decisions,
a schedule of charges, a payment history and two forms; a tenancy request holds
a note somebody types and leads straight into an agreement form. In both cases
the provider often wants to check something else first — the tenancy, the Unit,
their own bank record — and a modal makes leaving mean losing your place. It
also cannot be linked to, sent to a colleague, or reopened from history.

**`/payments/<leaseId>`** — the lease id, because the rent account *is* the
lease's: the ledger endpoint is `/leases/<id>/charges/`, and both lists that
reach it already carry `lease_id`. The ledger and the tenant beside it load
independently (`Promise.allSettled`), so a slow Portfolio lookup cannot keep the
account off the screen; the ledger is what decides whether the page has anything
to show. Rows became links — an occupancy with no lease has no account to open,
so it stops being a link rather than becoming a disabled one.

**`/applications/<requestId>`** — the record's own id. Two different records
arrive on this screen and read as one list: a public application against a
listing, and a private request to join a Unit. Separate tables, separate
endpoints, separate status vocabularies — and a provider answering the same
question either way, so `tenancyRequests.ts` gives them one vocabulary.

**Tenancy requests took the Payments layout**, because it is the same job: a
stack of things people sent you, worked through in an order, each row opening a
record where a decision gets made. A provider should learn that shape once.

| | Payments | Tenancy requests |
|---|---|---|
| Counts | Confirmed received · Outstanding · Overdue | Total requests · Accepted · Declined |
| Search | own row, `min(100%, 30rem)` | same |
| Stages | pills: All / Overdue / Outstanding / Current | pills: All / Needs action / Agreement / History |
| Rows | linked, 76px, five columns | linked, 76px, five columns |

The stage tabs had been underlined tabs sharing a row with the search box, which
put the two in competition for width and squeezed the tabs on a narrow screen.
They are now the same kola pills Payments uses, on their own line.

**What the counts may claim.** "Accepted" and "Declined" are decisions somebody
took. An application the applicant *withdrew*, or a request they *cancelled*, is
neither — counting it as declined would put a decision in the provider's name
that they never made. So `requestOutcome` returns `open` for both, **the three
numbers do not sum to the total, and they should not**. Two mutations assert
exactly this.

**Losing your place was the real cost of the move.** Tab, filter and search were
React state, which was free while the record opened over the top of the list —
closing it put everything back. As pages, coming back remounts the list and
would land somebody on Balances/All having left from a filtered list of payment
records. Both lists now keep those in the URL, with `replace` rather than `push`
so filtering does not build a history trail somebody has to walk back through.

**Nothing about authority moved.** Every action still goes to the endpoint it
always did; `can_record_payment` still gates recording and waiving,
`can_manage` still gates accepting and declining, and declining is still
confirmed rather than fired from one press. A test asserts each of those
against the component rather than the page, and mutation-checks the call sites
— an earlier version asserted the bare function name and went green with the
import still present and the call replaced by a no-op.

### Journey: Leases — the third list takes the same shape (2026-08-26)

Payments, Tenancy requests and now Leases are one pattern: three counts across
the top, a search on its own line, the stages as kola pills, linked rows, and
the record at its own address. A provider learns that once instead of three
times.

**This one was not a modal.** It was a split view — the list on the left, a
record pane on the right, and `visible[0]` opened into it whenever nothing was
chosen. Better than a dialog and still wrong in two ways: arriving at Leases
meant reading somebody's agreement picked by sort order rather than by anyone
asking for it, and the terms two parties are bound by — with the buttons that
send, withdraw or end them — had no address to be linked to or returned to.

`/leases/<leaseId>` now. `listGrantedLeases` is the same call the list makes and
is what scopes it: **the id in the address is not authority, the endpoint is.**

**The counts.** Total agreements · Active · Awaiting tenant. An aggregate, the
state that means a tenancy is actually running, and the one thing the provider
is waiting on somebody else for. `awaiting_activation` is deliberately **not**
folded into "Awaiting tenant" — the tenant has already accepted by then, and
counting it there would claim they had not. A mutation asserts exactly that.

**Old `#lease-<id>` links** used to select a row into the pane. They name a page
now, so the list redirects them rather than silently ignoring the thing somebody
clicked.

**Only the provider half changed.** The tenant reading of this route keeps its
own split view — a tenant reading their own agreements is a different job, and
was not part of this. That distinction had to be taught to the test: asserting
against the whole file caught the tenant's `explicit ?? suggested`, and worse,
would have let the provider half lose `useSearchParams` while the tenant's use
of it kept the test green. The contract now slices the file at
`function ProviderLeases()` and reads only that.

**Three existing contracts asserted the split pane** and were updated rather than
deleted — including one titled *"a substantial agreement gets a workspace or a
dedicated screen"*, which the provider half now satisfies by the second option
instead of the first. Each was mutation-checked after the edit.

Nothing about authority moved: one `leaseAction` endpoint, the available actions
still read from the status the server set, ending a tenancy still confirmed on a
second screen with a reason, and the frozen agreement record still leads with the
older-lease fallback intact.

### Journey: Viewings — the fourth list, and the pattern is complete (2026-08-26)

Payments, Tenancy requests, Leases and now Viewings are one shape: three counts
across the top, a search on its own line, the stages as kola pills, linked rows,
and the record at its own address. Four provider lists, one thing to learn.

**The strongest case of the four for giving the record an address.** A viewing
is a workflow that runs across a day — a host offers times in the morning and
checks somebody in that afternoon, often from a different device — and it lived
in a pane that could not be linked to, sent to a colleague, or returned to. The
split also fell back to `visible[0]`, so arriving at Viewings meant reading
somebody's appointment picked by sort order.

`/viewings/<viewingId>` now. `listHostViewings` is the same call the list makes
and is what scopes it: the id in the address is not authority, the endpoint is.

**The counts.** Total viewings · Confirmed · Completed. A time both sides have
agreed, and a visit that actually happened — deliberately **not** the stage
counts, which are the pills directly below. Saying the same number twice on one
screen is how a page stops being read, and a test asserts the cards never
restate a pill. No-shows and disputes are real outcomes and are left out: three
numbers is the budget, and "how many people did not turn up" is a question about
a Property rather than about today's work.

**Two naming collisions the move had to avoid.** `viewingMeaning.ts` is the
mirrored tenant module shared with the phone, so the host's reading went to a
separate, web-only `providerViewings.ts` — and its filter type is
`ProviderViewingFilter`, because the tenant's `ViewingFilter` is imported into
the same page. Likewise the component is `ProviderViewingRecord`, since
`components/tenant/ViewingRecord` already exists.

**Only the provider half changed**, as with Leases. The contract slices the page
at `function ProviderViewings()` so the tenant half cannot keep a provider
assertion alive.

**Six existing contracts asserted the old structure** and were updated rather
than deleted, including one titled *"a substantial viewing record gets a
workspace or a dedicated screen"* — now satisfied by the second option. One of
them sliced the tenant half using `formatViewingTime` as its end marker, which
had moved; that boundary is now `function ProviderViewings()`.

Nothing about authority moved. Every endpoint is unchanged, and what is drawn is
still read from `actions`, `check_in`, `attendance` and `post_viewing` — all
computed per-reader on the server. **Each of the six gates is asserted by name
and mutation-checked individually**, after a first version matched
`viewing.actions.` and stayed green while a gate was gutted.

### Journey: Applications, the tenant's side — the pattern crosses over (2026-08-26)

The fifth surface to take the shape, and the first on the tenant's side: three
counts, a search, the stages as pills, linked rows, and the record at its own
address. `/applications/<id>` now **branches on session** exactly as
`/applications` does — one idea, "the application record that concerns me",
read from whichever side the account is on.

**This one reversed a documented decision, and that is worth saying plainly.**
The tenant's split pane was argued for in a comment and defended by two contract
tests: *"an application record is a thing somebody reads against the other
applications they have out — a dialog hid exactly the context that makes it
legible."*

That reading is right, and the pane is not what delivered it. **The list is.**
Every row carries `standing()` — the one line that says where an application
stands — so four of them can be compared without opening any. What the record
adds is the detail behind one row: the timeline, what was offered, what was told
to the landlord, the guarantor, the landlord's note. That is a record, and a
record has an address.

The deciding evidence is that **the phone has always given it one**
(`app/(app)/application/[id].tsx`, a screen and not a sheet, asserted by an
existing test). Web was the odd one out, so this is parity restored rather than
parity broken.

The two tests that asserted the split were replaced by one that asserts what
they were really protecting: that the comparison happens in the list, that
nothing is opened for anybody, and that the way back is the breadcrumb the other
record pages use.

**The counts.** Applications sent · Approved · Turned down — the same rule the
provider's Tenancy requests holds for the very same records. An application the
tenant *withdrew* was not turned down by anybody, so the three do not sum to the
total.

**Group headings went with the split.** The stage is chosen by a pill, so a
heading over each group named it twice.

**Withdrawing** is unchanged: still `withdrawMyApplication`, still confirmed
inline rather than fired from one press. The pane used to close itself
afterwards; the page returns to the list it came from.

**`applicationMeaning.ts` is untouched** — it is mirrored byte-for-byte with the
phone, and a test asserts the list still gets `standing`, `applicationBucket`
and `matchesApplicationFilter` from it rather than forming a second opinion.

### Journey: List rows — a hover nobody could see (2026-08-26)

Reported as *"the rows feel static, no mouse hover or right arrow"*, and both
halves were literally true of the tenant's Applications row.

**The hover was `--color-field-50`. So is `body`.** Pointing at a row painted it
exactly the colour already behind it, so nothing happened. The other four lists
lift to `--color-field-0` — white against that cream ground — which is what
reads. Fixed, and now asserted: **a row's hover may never resolve to the page's
own colour**, read from `globals.css` rather than hard-coded in the test.

**The chevron was missing outright.** Payments, Tenancy requests, Leases and
Viewings all end their row with a `›`; Applications never had one. It needed
placing in both of that row's container-query layouts — `4rem 1fr 1.5rem`
narrow, `6rem 1fr 13rem 1.5rem` wide — with `standing` spanning only the first
two columns so the chevron keeps its own.

**And one shared addition, because "static" was fair.** Pointing at any of the
five now moves its chevron `translateX(2px)` toward where it is about to take
you, and lifts it from ink-300 to ink-500. Two pixels is the whole effect. The
colour change carries the cue on its own under `prefers-reduced-motion`, which
the global reset already neutralises the transform for.

**Dead CSS the new test found on its first run:** `.lease-row[aria-pressed]`,
left behind when that row stopped being a button inside a split view — a link is
never pressed. Two empty `@media` blocks in the same sheet, left by the
rule-stripper that removed the pane. Both gone, and asserted against.

The lesson is the one this pass keeps repeating in a new form: every assertion
in the suite was about **structure**, so a row could ship with no affordance at
all and nothing failed. `listRows.contract.test.mjs` is about what a row *looks
like it does*, across all five lists at once.

### Journey: Agreements, the tenant's side — the last split view (2026-08-26)

The sixth surface and the last of the panes. `/leases/<leaseId>` now branches on
session exactly as `/leases` does: a provider sends, withdraws and ends; a
tenant reads the terms they are being asked to be bound by, and accepts or
declines.

This is the most consequential record in the product from the tenant's side, and
that is the argument **for** an address rather than against it: somebody reading
an agreement wants to leave, check something, and come back to the same place.
The pane could not be linked to, and it fell back to opening the first row, so
arriving at Agreements meant reading one chosen by sort order.

**The counts are deliberately narrower than the pills beside them.** "Active" as
a stage also holds an agreement accepted but not yet started; "Past" holds one
the tenant declined and one the landlord withdrew. So the cards count statuses:

| | Pills (stage) | Cards (status) |
|---|---|---|
| | All · Needs you · Active · Past | Agreements · **In place** (`active`) · **Ended** (`ended`) |

A mutation asserts a card can never be redefined in terms of `state.stage`.

**A real regression this pass introduced and caught.** The application record
deep-linked to `/leases?open=<id>`, which the pane honoured. Removing the pane
turned that into a dead link dressed as a working one — a list with nothing
open. An existing contract had been written for exactly this failure and caught
it. The link now names `/leases/<id>` directly, and the list still forwards both
`?open=` and `#agreement-` for anything already sent out.

**Two hover findings on this page**, from the row-affordance contract added
after the previous report:

- `.agreement-row` had **no `:hover` rule at all** — it had never had one.
- `.agreement-row.is-action` paints a kola ground at (0,2,0), so a bare `:hover`
  would have stripped an action row of the emphasis it was given. Action rows
  keep their tint; their feedback is the chevron, which every row now gets.

The base `.agreement-row-arrow` rule also had to be moved **above** the media
query that overrides its placement — a base rule declared after its own override
is a base rule nothing reads first, and the contract's `rule()` helper found the
override instead.

`agreementMeaning.ts` is untouched: it is mirrored byte-for-byte with the phone,
and a test asserts the list still gets `standing` and `matchesAgreementFilter`
from it rather than forming a second opinion.

### Journey: The agreement row's pseudo-button (2026-08-27)

Removed on the instruction *"I don't think we need the 'open agreements'
buttons"*, and it was worse than redundant.

It was a `<span>` painted as a full 44px control — kola fill when a decision was
open, bordered otherwise — sitting **inside** the row's own `<Link>`. So it
looked like a separate button, was not focusable or operable as one, and did
exactly what clicking anywhere else on the row does. It also repeated the line
immediately above it: "Waiting for your decision" followed by a button reading
"Review agreement" says one thing twice.

The row is the control. The chevron says where it goes. §10.1: a row that names
its destination needs nothing under it.

`.agreement-primary` and `.agreement-secondary` went with it — nothing else used
them — and `.agreement-row-side` stopped distributing two children.

**Three loose ends the removal exposed**, all mine from earlier passes:

- The row's doc comment still claimed *"the row offers one thing — Review
  agreement"*, which the removal made false.
- Two files had `*/function` jammed together with no newline, from slicing a
  page at a function boundary and rejoining without one.
- `/tenants/<id>` still linked to `/leases#lease-<id>` — a hash into a list —
  when the agreement has had its own address since the split view came out.

**A test I wrote and then deleted.** The first guard tried to be general: *no
element inside a row may carry a class the stylesheet paints as a button*. It
collected "button-like" classes by taking the first class in each selector,
which flagged `.rent-filters button` as `rent-filters` and would have failed on
the filter pills. The six rows are also built in three different shapes, so
slicing "the row's markup" was unreliable. It was replaced with a named guard on
the two classes and the two labels — mutation-checked four ways.

A precise guard that holds beats a general one that cries wolf.

### Journey: Viewings, the tenant's side — the seventh and last (2026-08-27)

`/viewings/<viewingId>` now branches on session, as `/viewings` does. A host
offers times, checks somebody in and settles attendance; a tenant picks a time,
finds the place and shows a code on arrival. Seven surfaces now share one shape,
and no split views remain.

**The counts** are narrower than the pills beside them, as everywhere else:
"Upcoming" as a group also holds a request nobody has answered yet, and "Past"
holds a visit that was cancelled and one nobody attended. The cards count
`confirmed` and `completed` — what actually happened.

**The pseudo-button went too**, without being asked twice. The row carried a
span painted as a control reading `state.callToAction`. But `callToAction` is
the **mirrored** module's and the phone reads it into an accessibility label, so
the string was kept and moved into the row's accessible name rather than
deleted — same information, same source, no painted control inside a link.

**A stylesheet collision nobody had noticed.** Both `viewings-workspace.css` and
`viewings-tenant.css` declared `.viewings-list`, and the tenant sheet loads
second — so the *host's* list had been taking its `display: grid` from the
tenant's stylesheet. Prefixing the tenant's furniture cleared it, and a test now
asserts the two sheets do not name the same class.

**And the same invisible hover a third time.** `.tenant-viewing-row:hover`
painted `--color-field-50`, which is what `body` is. Caught by the row contract
the moment this row was added to it — which is the point of that contract.

---

**Two regressions I introduced and did not notice, in the agreements row.**

The money line (`rent / period · move-in total`) and the recorded decline reason
were both lost during the tenant-agreements rewrite — the second left commented
out. An existing contract caught the move-in total; **nothing** caught the rest,
because every assertion in that suite was about the page's *shape* rather than
about what a row actually tells somebody.

Both are restored, and `tenantAgreements.contract.test.mjs` now asserts the four
questions a row answers without opening anything — which home, with whom, **how
much**, for how long — plus the reason when there is one. Six mutations, all
caught.

That is the third time this pass that structure was fully guarded and *content*
was not. It is the failure mode to watch for in this codebase.

### Journey: The mobile welcome experience (2026-08-27)

The first thing anybody sees, once per installation. Its job is to say what
Danpa HQ *is* before somebody decides for themselves — which, for an app with an
Explore tab, is otherwise "a place to find apartments".

**One street, seen three ways.** Not three slides about three features: a
neighbourhood at dusk, then one lit window that is somebody's home, then the
same three buildings held together by a line. The camera moves and the layers
part; the story changes around a place that stays put. Scene three's dashed line
between the buildings *is* the proposition — one relationship, not three records.

| Stop | Says |
|---|---|
| 1 | Property. Renting. Connected. |
| 2 | Your home, in one place. |
| 3 | Manage property without the chaos. |
| 4 | How will you use Danpa HQ? |

**Discovery is a capability, not the pitch.** It appears once, quietly, under the
role question — "Just looking? Browse homes first" — and is never one of the two
answers. Anonymous browsing already works signed-out (`(app)/(tabs)` and
`(app)/listing` are allowed by the gate) and that capability is preserved; it is
simply not what the introduction is about.

**Drawn, not downloaded.** Every element is `react-native-svg` — a few kilobytes
of vector in the bundle. Reanimated and Lottie are not dependencies of this app
and none were added: a first launch on a low-cost Android over a slow connection
is exactly when a Lottie payload or a set of PNGs would make the product feel
broken before it had said anything.

**Moved natively.** Nothing animates an SVG property, which in React Native
means a JavaScript round trip per frame. The layers are ordinary views that
translate and fade with `useNativeDriver`, driven straight from the pager's
scroll offset. Five layers at five different rates is the depth. The only thing
that moves by itself is a slow pulse on the lit windows — a still scene reads as
a screenshot, a twitchy one reads as a GIF.

`useReduceMotion` stops **both** the loop and the parallax, not just the loop.

**Progress is Danpa HQ's own**, not `● ○ ○`: the same filling checkpoints property
setup uses, tracking the swipe rather than snapping at the end of it. The fill
slides under a clip rather than scaling — React Native scales from the centre,
which would grow each segment outward from its middle.

---

**First launch is local state, and nothing else.**

`welcomeSeen.ts` answers one device-local question: has anybody on this phone
seen the introduction. It is deliberately **not** account state — registration,
workspace access, provider verification and profile completion stay with the
backend and `resolveEntryRoute`, exactly as before.

The two have opposite lifetimes, which is the whole reason to keep them apart:
signing out does not un-introduce somebody, and signing in on a new phone does
not mean they have seen it. `clearLocal` clears the refresh token and the cached
`me` and leaves this key alone, and a test asserts that.

```
first launch          splash → introduction → role → existing sign-in
returning, signed out splash → sign-in
returning, signed in  splash → resolveEntryRoute(me, activeContext)
```

The gate waits for that flag before routing a signed-out person. That is not the
blocking splash the file's own comment warns against — that warning is about the
*token refresh*, a network call that can take seconds. This is a local read in
milliseconds, and routing before it lands would show one screen and replace it.

**It ends where the app already began.** The role question writes the existing
`OnboardingIntent` and hands `?workspace=` to the existing sign-in, exactly as
the old welcome screen did. No account is created here, no second sign-in is
drawn, and `(auth)/role.tsx` — the account-level question asked after a number is
confirmed — is untouched.

**The one assertion that had to be tightened.** "Every exit marks the
introduction seen" was first written as a count of `>= 1`, which let either exit
be gutted while the other kept it green — and a replaying introduction for
anybody who skipped is the single worst outcome this feature has. It now slices
each exit function and asserts both. Twenty-four mutations, none missed.

### Journey: Mobile sign in — the front door (2026-08-27)

The introduction plays once per installation, so sign-in is now the first screen
of almost every launch. It was built as the thing behind a welcome screen and
still read like it.

**Four full-width quiet buttons** sat under the one button that matters — "Back
to welcome" above, then "Forgot your password?", "Create an account" and "Or
keep browsing without an account" below. That is how a primary action stops
looking primary. Everything that is not *Sign in* is now a line of text, and
"Forgot your password?" sits under the password field, beside the thing it is
about, rather than stacked with the navigation.

**A line that said nothing.** "Use the number on your account and your password"
sat under the heading, over two fields labelled *Mobile number* and *Password*.
The heading says where signing in leads instead — "Sign in to your home", "Sign
in to manage your property", "Welcome back" — which is the one thing the fields
cannot say.

**A password nobody could check.** Typing one blind on a phone keyboard is the
most common reason a correct password gets entered wrong twice. `Field` gained
an optional `suffix`, so the reveal control sits *inside* the frame and moves
with the focus ring; every password field in the app can use it.

**The product now has a face on the screen people see most.** `AuthCrest` is the
welcome scene at header height with none of its machinery — static, no pager, no
parallax, no loop. *(Superseded in part by "The artwork, rebuilt as a pipeline"
below: it drew its own rooftops when this was written. It now shows a band of
the journey's opening scene, so the two can never drift apart.)* Without it, Danpa HQ's own illustration
would appear exactly once per installation and never again.

The number now advances to the password, the password submits, and one reading
of readiness drives both the keyboard and the button.

---

**A bug my own welcome work introduced, and the general rule that now holds it.**

Seven screens routed to `/(auth)/welcome`. Every one was correct while welcome
*was* the signed-out landing. As a once-per-installation introduction it is
wrong everywhere: two of them were **sign-out**, so leaving the app would have
replayed the introduction as though the person had never used it. `search.tsx`
sent an anonymous person hitting a gated action back through three scenes to
reach a form.

All of them point at sign-in now, and a contract walks every screen in
`mobile/app` asserting that **only the gate may route to the introduction** —
and only as a choice against the flag, never unconditionally. That is the rule
worth keeping, because the next screen that needs a signed-out destination will
reach for the same wrong one.

### Journey: The welcome journey, corrected (2026-08-27)

**Corrected on instruction.** The two entries above describe a design where a
returning person was sent to sign-in and the journey was a once-only thing they
could never see again. That was wrong on both counts.

The journey is one screen of four stops. The *story* is for first-timers. The
*choice* — its last page — is for everybody:

```
first launch          splash → journey, opening at stop 1
returning, signed out splash → journey, opening at stop 4 (the choice)
returning, signed in  splash → resolveEntryRoute(me, activeContext)
```

That is why it stays one screen and not two. The last page is not a landing that
happens to resemble the journey's end; it **is** the journey's end, so returning
means opening at the other side of it — and "← Back to welcome" is a scroll to
stop one, not a route. The story is never taken away.

**The gate stopped deciding.** It sends every signed-out person to
`/(auth)/welcome`, full stop; the journey reads the local flag and decides which
end of itself to open on. That is both simpler and more honest — where a screen
opens is the screen's business.

The flag is read *before the first render*, and nothing is drawn until it lands.
An offset applied after mount is a visible jump from scene one, which is exactly
the introduction a returning person is being spared. The pager also mounts at an
offset without scrolling, so no momentum event fires and the controls have to be
told which page they are on.

**Browsing is a third answer again**, not a footnote. `find_property` is the
intent this app has always used for it and the rest of onboarding already knows
it; demoting it to a quiet line under two cards quietly dropped a journey the
backend understands. It is drawn quieter than the two that begin a relationship
— 68px against 84, no fill, muted glyph — because it commits to nothing, but it
is a card and it records that the story was seen like the other two.

**The choice pushes rather than replaces**, so the system's own back gesture
returns to it. Somebody who taps the wrong side should not have to sign in to
correct it — and that is why sign-in draws no back control of its own.

**Seven screens repointed twice.** Every signed-out destination went to
`welcome`, then to `sign-in` under the wrong design, and now back to `welcome`
— which is correct, because `welcome` *is* the choice for anybody who has seen
the story. A sign-out and a gated action both land on three ways in rather than
on a form.

**The provider-to-choice transition keeps one frame.** The visible shift was
not caused by the pager artwork: the footer changed from a 48-point control row
to a taller, natural-height link stack after momentum ended. Because the pager
flexes above that footer and its content is bottom-aligned, the swap resized the
pager and moved the scene after the swipe had apparently finished.

The footer is now a fixed 52-point stage. Both control states remain mounted and
crossfade from the pager's native scroll value, with only a restrained four-point
vertical transform. Interaction and accessibility switch at the boundary without
changing layout. Bundled scene assets are preloaded from the scene manifest, the
animated scroll value is synchronised with the initial pager offset, and reduced
motion removes the transform and animated programmatic scroll. The screens and
their actions are otherwise unchanged. On iOS the touch state also synchronises
at drag-end from the predicted resting offset: a paged scroll can settle without
emitting a momentum-end event there, and a visible choice must never remain a
non-interactive animated layer. Android retains its momentum-end path.

### Journey: The artwork, rebuilt as a pipeline (2026-08-27)

**Rejected on sight.** The journey's scenes were hand-authored in
`react-native-svg` — compound walls as rects, roofs as triangles, people as two
quadratic curves. The verdict was "naive, broken", and it was right.

**The root cause is worth recording, because it will recur.** I have no visual
feedback loop: the browser pane cannot composite, so nothing I draw can be
looked at before somebody else looks at it. Authoring path data blind is not
illustrating — it is guessing coordinates and hoping. Geometry is what you get,
and geometry is what it read as.

So the rule now is: **code carries artwork, it does not try to be artwork.**
Anything that would need an eye to judge belongs in a file an illustrator made.

**What replaced it, in three parts.**

`assets/welcome/README.md` is the art direction — the brief an illustrator (or a
generator) works from. Six files, 430 × 420 pt, the safe band, the palette taken
from the app's own tokens, the three scenes described as **one street seen three
times**, and an explicit list of what to avoid: corporate-memphis figures,
floating feature icons, dashboards, heavy gradients, isometric startup city.

`scenes.ts` is the manifest: per scene, a `wash` and its layers. Each layer has
a `depth` and a `source`. The `require`s are written and commented out, because
`require` resolves at build time — a path to a file nobody has drawn yet is a
bundler error, not a blank screen. Installing the art is uncommenting six lines.

`WelcomeWorld` is the stage, and **draws nothing**. It cross-fades scenes and
translates layers. That is all it does, and that is the point.

**Bundled, never fetched.** A first launch on a slow connection is precisely
when a downloaded scene would make the product feel broken, which is the case
the brief asked to design for. The cost moves to install size instead — so the
brief carries a hard budget, ≤ 180 KB per file at `@3x` and under 1 MB for the
set, and a contract test asserts the budget still exists.

**Parallax is measured from each scene's own centre**, not from the start of the
journey. Measured from the start, the third scene has drifted three screens'
worth before anybody sees it. Every layer is a plain view on the native driver;
reduced motion stops the slide and leaves the cross-fade.

**The wash is not a placeholder illustration.** Until the art lands, each scene
is a tonal gradient. A wrong picture is worse than an honest absence, and the
wash still lets the motion, the type and the pacing be judged.

**The contract guards the rejection, not the implementation.** The tests that
matter assert no `<Path>`/`<Polygon>`/`<Circle>` in either component, every
layer bundled rather than fetched, and the two layers **of each scene**
travelling at different rates. Mutation verification found three assertions that
did not bite: a global count of distinct depths was satisfied by whichever scene
still differed, one bundled path answered for six, and a bare `useReduceMotion`
was satisfied by the import line while the value was pinned to `false`. All
three are the same mistake — **asserting a symbol appears rather than that it is
used** — and all three are now anchored on the usage.

**Known limitation:** the journey ships as washes until the illustrations are
installed. That is a content dependency, not a code one; nothing else changes
when they arrive.

**Next:** install the artwork, then Unit Creation.

### Journey: Lease creation and the contract system (2026-08-28)

**Problems solved.** A provider prepared a tenancy agreement by opening a modal,
typing a rent and one free-text "conditions" field, and pressing a button that
drafted *and sent* the offer in a single act. What was frozen afterwards was a
bag of structured values, not a contract; there was no wording, no document, no
version, and nothing either party could print, keep or produce in a dispute.

**Danpa HQ writes the agreement; the provider supplies terms.** A versioned
`LeaseTemplate` holds the standard clauses with `${placeholders}`; the builder
collects structured values; the backend renders the two into a complete
document. That split is the point — a provider configures what goes *into* a
clause and can add clearly-labelled custom terms, but cannot rewrite Danpa HQ's
wording, and every lease records the template code and version it was made
under.

**Draft → Ready → Sent → Reviewed → Tenant accepted → Provider confirmed →
Active.** Two of those are new and both are deliberate. *Ready* separates
finishing the form from sending the offer, because sending is the provider's
acceptance and should not be a form's side effect. *Provider confirmed* means
the tenant's acceptance no longer activates a tenancy on its own; the provider
sees what was accepted and confirms it, and only then is the PDF frozen.

**The architectural decision that mattered most: the rendered document is
stored, not just the fields.** Danpa HQ's wording will change. A lease accepted
under the 2026 template must still reproduce the 2026 agreement — same sections,
same hash, same PDF bytes. `TestTheAgreementOutlivesItsTemplate` rewrites the
template out from under an accepted lease and asserts nothing about it moves.
The PDF renderer reads only the stored snapshot, so a regeneration years later
cannot drift either.

**Amendment, because the code was promising something it did not have.** Three
separate places told a provider to "create an amendment instead" — the update
guard, the immutability error and the template's own clause 12 — and no such
thing existed. `amend_lease` opens a *replacement* lease that supersedes the
original and travels the same accept/confirm path, so a changed rent needs the
tenant's renewed acceptance. The original stays live and the tenancy undisturbed
until the amendment is itself active, which means an abandoned renegotiation
costs nobody their home. One tenancy survives across successive agreements,
which is why tenancy was a separate record in the first place.

**Two bugs found by writing the tests rather than by reading the code.**

- *Nothing had ever run.* Migration `0005` was generated before the model was
  finished, so `superseded_at`, the status choices and three constraints were
  missing. Every lease test errored at setup; `0006` closes the gap.
- *Reference numbers collided.* `reference_for` sliced the front of the id, but
  these ids are UUIDv7 whose leading 48 bits are a millisecond timestamp — so
  two agreements prepared in the same quarter-second produced the *same*
  reference against a unique column. An amendment is executed moments after its
  original, which is exactly how it surfaced. The reference now comes from the
  random tail.

**Legal position, stated plainly.** `docs/legal/GHANA_RESIDENTIAL_LEASE_CLAUSE_REVIEW.md`
maps every proposed clause to its source and lists ten questions counsel must
answer. The template ships marked `requires_ghana_legal_review`, and
`production.py` sets `LEASE_TEMPLATE_REQUIRE_APPROVAL = True` — so production
**refuses to send** an unapproved template, and a unit test asserts that line is
still there. Nothing here is a claim of legal compliance. Act 220's advance rule
is recorded and warned about rather than enforced, because s. 25(5) distinguishes
tenancy types in a way the current one-threshold product rule does not capture.

**Reusable patterns.** The template/snapshot split — versioned source, immutable
rendered copy, hash, reproduction from the copy — is the shape the receipts work
should take: Act 220 s. 33 requires written receipts with specified particulars,
which is the same problem with a smaller document.

**Known limitations.** The wording is pre-production and marked so on every
preview. End-date arithmetic uses approximate 30-day months and needs
counsel-approved calendar rules. The clause set has no assignment/subletting,
access-notice or severability clause — deliberately, because inventing them
would be fabricating law.

**Next.** Counsel review of the clause matrix, then Lease → Payments → Receipts.

### Fix: the payments figures were counting money nobody owed (2026-08-28)

Reported from use: "confirmed received, outstanding, and overdue seem to be
looked at... ended tenancy is still having values in it." Two defects, and the
second was the one doing the damage.

**The schedule was written in full and never closed.** `build_schedule` bills
the whole term the moment a tenancy goes live, because that is when the term is
known. Nothing had ever closed it. A twelve-month tenancy ended in month three
left nine months sitting at `due`, and those charges went on ageing into
*overdue* — forever, on the provider's dashboard, for a room somebody had
already moved out of.

**The portfolio read counted every lease a Unit had ever had.** The money query
was `Lease.objects.filter(unit_id__in=unit_ids)` with no status filter at all,
over every active Unit in the portfolio. So a re-let room added the previous
tenant's whole schedule to the current figures, and — since the amendment work
landed — a superseded agreement double-billed its own replacement. The test for
that reads GH₵40,300 counted against GH₵20,800 actually owed.

**Fixed at the source rather than in the read model.** `close_schedule` marks
the affected charges `cancelled`, so every consumer gets the right answer
instead of one query being taught to filter. Two rules, because the two events
mean different things:

- **A tenancy ended** closes only the unrun remainder. Charges already due stay
  owed — somebody who left owing two months still owes them, and clearing that
  would quietly forgive a real debt.
- **An agreement superseded** closes the whole unpaid schedule, because the
  replacement covers the same term and billing both is billing twice.

Rent hears about both through the outbox, so lease still knows nothing about
rent — `lease.superseded.v1` was added for the second.

**`cancelled` is a new status, deliberately not `waived`.** Waiving is a
provider forgiving a debt that exists, and belongs in the record as that
decision. This is the opposite claim: no debt was incurred, because nobody was
living there to incur it. It is also `is_settled`, which is what keeps it out of
*overdue* — a month nobody lived through cannot be late.

**A charge with money against it is never touched.** What was actually paid is
evidence, and a part-paid charge keeps its balance through both events.

Both clients render the backend's `status_display`, so the new label needed no
UI change — only the TypeScript union, which had been asserting a closed set of
four.

**Fixing the behaviour did not fix the rows, and that nearly shipped as done.**
`close_schedule` runs off `lease.ended.v1`. Those events fired for existing
leases long before there was a handler listening, and nothing replays them — so
every tenancy that had already finished kept its whole schedule at `due` and the
dashboard was unchanged. Caught by the report "it did not update any current
data", which was correct.

`rent/0005_close_finished_schedules` applies the same two rules to existing
rows, once, measuring an ended tenancy against its own `ended_on` rather than
against today: a tenancy that ended in March is judged as it stood in March, so
arrears accrued before it stopped are not retroactively forgiven. On this
database it closed 17 charges and took outstanding from GH₵68,800 to GH₵38,400.

The general lesson is worth keeping: **a fix that changes behaviour has not
finished until the data that behaviour was wrong about is also corrected.** An
event-sourced rule only ever applies to events that fire after it exists.

**Next.** Recording an amendment's effective date, so it stops re-billing months
already lived through. See `docs/known-limitations.md`.

## 23. Remaining UX Roadmap

Work through one complete product area on web and mobile, update this document,
then stop for user testing. Ordering changes require a concrete information-
architecture reason.

Journey records from Provider Team onward use the concise format: Problems
solved, Important decisions, Reusable patterns, Responsive/mobile, Known
limitations, Next. Earlier records are longer because they were written before
that was settled; they are left as they are rather than rewritten. Keep new
entries to what another session needs in order to continue — not a report.

| Order | Journey / area | Status | Intent |
|---:|---|---|---|
| 1 | Provider Home | REDESIGNED — USER REVIEW | Operational visual architecture: Portfolio pulse, semantic attention, financial position, leasing/readiness and schedule |
| 2 | Provider Properties → Property → Units → Unit | COMPLETE | Establish inventory, entity hierarchy, status and action patterns |
| 2b | Units across the Portfolio | COMPLETE — USER TEST | Find and manage any Unit without knowing its Property first |
| 3 | Provider Tenants → Tenancy | COMPLETE | Make tenant operations portfolio-first and preserve Lease/Rent continuity |
| 4 | Provider Viewings | COMPLETE | Refine scheduling, attendance and exception handling |
| 5 | Provider Tenancy requests | COMPLETE | Clarify request review, decisions and transition into agreement |
| 6 | Provider Leases | COMPLETE — USER TEST | Refine agreement list, offer, acceptance and lifecycle detail |
| 7 | Provider Rent | COMPLETE — USER TEST | Refine obligations, balances and payment records |
| 8 | Provider Portfolio | COMPLETE — USER TEST | Clarify Portfolio identity, activities and switching |
| 9 | Provider Team | COMPLETE — USER TEST | Clarify members, roles, invitations and Property assignments |
| 10 | Settings product area | COMPLETE — USER TEST | Implement grouped web settings and focused mobile hierarchy |
| 11 | Notifications | COMPLETE — USER TEST | Make updates actionable without duplicating their destination |
| 12 | Tenant Explore | COMPLETE — USER TEST | Search, scan, compare, open — with pagination, sort and saving |
| 13 | Tenant listing detail | COMPLETE — USER TEST | Photographs lead, one decision panel, trust on demand, capped full gallery, and backend-ranked related rentals |
| 14 | Tenant applications | COMPLETE — USER TEST | Photograph and Unit identity, one standing line, record behind the row |
| 15 | Tenant agreements | COMPLETE — USER TEST | The decision follows the reading; one shared reading of the frozen terms |
| 16 | Tenant viewings | COMPLETE — USER TEST | A schedule; every control gated on the lifecycle rather than always drawn |
| 16a | Tenant record dialogs | COMPLETE — USER TEST | Records open over their list on both clients; nested `<main>` removed |
| 17 | Tenant Home | COMPLETE — USER TEST | A control centre that adapts to the lifecycle; no module renders empty |
| 17a | Unit private access | COMPLETE — USER TEST | The code is read and managed from the Unit, not only from a Portfolio |
| 17b | Image display | COMPLETE — USER TEST | Photographs presign inline; Explore reads the Unit's photographs |
| 17c | Private access preview | COMPLETE — USER TEST | Tenants shows three share-ready Units and links to Units |
| 17d | Public filter on Units | COMPLETE — USER TEST | Units gains a Public tab; listing edits deliberately out of scope |
| 17e | Property cover and Unit columns | COMPLETE — USER TEST | Properties get a thumbnail; a Property's Units go five across |
| 17f | Building cover, Units two across | COMPLETE — USER TEST | Cover comes from the Property's own condition photographs; mobile Units are tiles |
| 17g | A way out of every screen | COMPLETE — USER TEST | One back control on the mobile Stack; modals close; no screen is a dead end |
| 17h | Main navigation bar | COMPLETE — USER TEST | One premium tab bar for both worlds; build, tap-crash and sixth-tab fixed; one indicator, motion from tokens |
| 17i | Explore header actions | COMPLETE — USER TEST | Saved and Profile as circular actions, scoped to the Explore tab |
| 17j | Tenant Services hub | SUPERSEDED by 17s | Rent as the primary card; a declarative catalogue; nothing offers to take money |
| 17k | Tenant control center | PARTIAL — USER TEST | Skeletons and mobile shortcuts; web side-by-side layout still outstanding |
| 17l | Mobile Home refinement | COMPLETE — USER TEST | Rent leads its card; schedule and history split; the ambiguous + becomes words |
| 17m | Web Home parity | COMPLETE — USER TEST | Rent leads on web; Coming Up becomes a rail; Rental activity removed from both |
| 17o | Web Home two columns | COMPLETE — USER TEST | Homes beside the schedule; schedule entry rebuilt for the narrow column |
| 17n | Applications refinement | COMPLETE — USER TEST | Status timeline on both clients; record leaves the modal; agreement link goes to the agreement |
| 17p | Tenant journey filters | COMPLETE — USER TEST | Applications and Agreements open on All; action, live, approved and past records remain directly discoverable |
| 17q | Viewings refinement | COMPLETE — USER TEST | All/Upcoming/Needs you/Past filters; substantial records leave dialogs for responsive web workspaces and native screens |
| 17r | Agreement record surfaces | COMPLETE — USER TEST | Tenant/provider web use responsive workspaces; tenant native uses a pushed record; confirmations remain inline |
| 17s | Services replaces Saved in the tenant bar | COMPLETE — USER TEST | Household services hub with Utilities/Entertainment/Connectivity/Home; Saved keeps both its routes from Explore and More; a `preparing` service opens to saving the number it will need; declared to settle through the Payments Core |
| 18 | Remaining tenant areas | NOT STARTED | Tenancy record and rent |
| 19 | Lease creation & contract system | COMPLETE — USER TEST | Versioned Ghana template, guided builder, offer/accept/confirm lifecycle, immutable rendered agreement, PDF, amendments |

Validation is proportional. Ordinary visual work gets relevant frontend
typecheck/lint/tests and breakpoint inspection. Broader backend, integration,
build or smoke suites are reserved for API, permission, lifecycle, shared-shell
or high-blast-radius changes and major milestones. Quality is measured by the
coherence of the finished area, not test volume or audit length.

## 24. Important Decisions / Rationale

### UX-001 — Refine, do not rebuild

**Decision:** Preserve the working architecture and improve one journey at a
time.  
**Rationale:** Product capability and domain integrity already exist. A broad
rewrite creates risk and produces shallow visual consistency rather than a
coherent experience.

### UX-002 — Backend authority, frontend composition

**Decision:** Backend states and capabilities remain authoritative; clients
summarize and progressively disclose them.  
**Rationale:** A sophisticated lifecycle should produce a simpler interface
without losing enforcement or evidence.

### UX-003 — Keep Daylight & Ledger

**Decision:** Continue the existing Ghana-first design system and generated
token architecture.  
**Rationale:** It is distinctive, legible in real conditions and already shared
across platforms. Refinement needs composition, not a new palette.

### UX-004 — Settings is a product area

**Decision:** Group account, security, Portfolio, Team, preferences and archive
under a coherent Settings architecture. Use secondary navigation on web and
focused nested screens on mobile.  
**Rationale:** Administration is important but should not pollute primary task
navigation or become one enormous page.

### UX-005 — Platform parity is semantic, not geometric

**Decision:** Web and mobile preserve capability, terminology and state meaning
while using platform-appropriate composition and interaction.  
**Rationale:** Copying desktop to mobile harms both efficiency and native
usability.

### UX-006 — Property management establishes the patterns

**Decision:** Begin with Provider Properties → Property → Unit and do not move
on until it passes the quality gate.  
**Rationale:** It exercises hierarchy, repeated records, media, lifecycle,
verification, actions, responsive behavior and cross-domain links—the strongest
foundation for reusable operational patterns.

### UX-007 — Navigation follows goals and frequency

**Decision:** Add primary navigation only when a frequent user goal naturally
belongs there. Preserve contextual paths between related entities and keep
administration secondary.  
**Rationale:** Backend modules are not a user mental model, and duplicate paths
create uncertainty.

### UX-008 — Abstract only after evidence

**Decision:** Design concrete journey screens first, then extract patterns that
have demonstrated stable shared needs.  
**Rationale:** Premature universal components force unlike domains into generic
template layouts.

### UX-009 — An attention count belongs to one reader

**Decision:** Any number the interface presents as work waiting on someone must
be scoped to that person. Where a domain total and a personal queue differ, the
backend returns both and the attention surface uses the personal one.  
**Rationale:** Rent exposed the failure directly: a portfolio-wide count of
unagreed payment claims was shown to the provider as records *they* had to
confirm, including the ones they had recorded themselves and which were waiting
on the tenant. A count that is technically true of the domain becomes a false
statement the moment it is addressed to a particular reader. This applies to
every future queue — verification, disputes, approvals — not only to rent.

### UX-010 — Actionable items are never paginated out of reach

**Decision:** When a surface both counts actionable work and lists it, the
listing must contain every counted item. Recency windows may trim context; they
may not trim the thing being pointed at.  
**Rationale:** The rent records list returned the ten most recent payments while
the attention band counted all unanswered claims, so a provider could be told to
answer something the list could not show. Where a full listing endpoint does not
exist, the actionable set is taken whole and merged ahead of the recent window
rather than inventing pagination in the client.

### UX-011 — Where a word is both a grouping and a thing, the thing wins

**Decision:** When a domain concept names both a navigation grouping and a real
entity, the entity gets the destination and the grouping is named after it.  
**Rationale:** "Portfolio" titled a nav section containing Properties, Team,
Tenants, Leases and Payments, while the Portfolio itself had nowhere to live and
its identity ended up filed inside its own Team. Naming the section after the
active Portfolio and giving the entity its own page fixed the containment and
answered "what am I managing" on every screen at the same time.

**Amended — 2026-08-24:** the entity needs one home, not a rail slot. The page
now lives at `/settings/portfolio`; the section is still named after the active
Portfolio, which is what actually answered "what am I managing". See UX-015.

### UX-012 — A mirror without a guard is not a mirror

**Decision:** Any file duplicated for testing, platform parity or build reasons
must have a check that fails when the copies diverge.  
**Rationale:** `portalNav.compiled.mjs` carried a header promising it was kept
in step with `portalNav.ts`. Nothing enforced it, Payments drifted out, and the
navigation suite — the one suite whose subject is visible on every screen —
spent that whole time proving things about a copy nobody shipped, including an
assertion that had silently become wrong. The comment was doing the job a test
should have been doing. `propertySetup.mirror.test.mjs` was already the pattern;
it simply had not been applied here.

### UX-013 — A row describes; the record it opens decides

**Decision:** Where a list row leads somewhere, the row carries only what
identifies and describes the thing. Controls that change it belong to the record
the row opens.  
**Rationale:** Team put a role picker, a Remove button and a checkbox per
Property inside every member row: forty controls at rest for a small team, an
unconfirmed destructive action one stray tap away on mobile, and no way to read
the roster without reading its machinery. Deciding is deliberate and deserves its
own surface; a list exists to be scanned.

### UX-014 — Stage a set, settle it once

**Decision:** A group of related toggles is collected as a decision and applied
in one save, as the difference between what was and what is chosen.  
**Rationale:** Property assignment fired one request per checkbox and reloaded
the page after each, so changing five Properties meant five round trips and five
reloads with no way to reconsider mid-way. Where the API has no bulk endpoint the
client batches the decision rather than pretending to batch the requests, and
says plainly what a partial failure leaves behind.

### UX-015 — A destination earns the rail by frequency, not by importance

**Decision:** Primary navigation holds what someone opens in the course of the
work. Things that are structurally important but rarely opened — configuring the
business, deciding who may operate it — belong in Settings.  
**Rationale:** Portfolio and Team were each promoted to the rail while being
refined, because each felt significant while it was the subject. A provider opens
Properties, Tenants, Leases and Payments daily; they set up a Portfolio once and
change the Team rarely. Importance is a reason for a thing to have one clear
home, not a reason to spend a rail slot on it. The rail section is still titled
with the active Portfolio's name, which is what actually answered "what am I
managing" — that never needed an item of its own.

### UX-016 — The account menu is not a second navigation

**Decision:** The menu behind the avatar holds what is true of the account, not
destinations: Settings, the workspace crossing, and Sign out. Anything with a
home in the rail or in Settings is not repeated there.  
**Rationale:** It had accumulated a Portfolio switcher, Updates, Portfolio
invitations and Archive — every one of them reachable elsewhere. A menu that
lists destinations competes with the navigation beside it, and the competition is
worse than the convenience: two places to look, two things to keep in step, and a
menu long enough that the three things people actually open it for stopped being
obvious. Where removing an item stranded a capability, the capability moved to
the surface that needed it rather than the menu keeping a link alive.

### UX-017 — A selected physical promise earns visible evidence

**Decision:** In Unit creation, every selected amenity creates one named,
required photo checkpoint on the following Photos step. The main Unit view and
two optional context views remain separate. The backend evidence policy owns
the slots; web and mobile render them and never maintain amenity-to-photo maps.
**Rationale:** A checklist that says “Private bathroom” while the photo step asks
only for “the main room” lets a high-value claim pass without showing it. Named
slots keep the claim, photo, review and eventual tenant presentation connected.
The creation journey says how many amenity photos the current selection adds
before advancing, so the requirement is not discovered after the decision.

**Draft rule:** Unit Details creates the existing private Unit draft. Every
later checkpoint saves directly to it. Save for later must be available from
each checkpoint after the minimum Unit type is known, return to Unit detail, and
Continue setup must reopen that same record rather than create a replacement.

### Journey: Tenant and provider Payments

**Status:** IMPLEMENTED — 2026-08-28; populated-state device review still
required before PSP sandbox work.

**Why this journey exists:** Payment Core had careful checkout, receipt and
settlement routes, but a tenant could reach money only through an individual
rent account. Providers had a ledger, yet its payout summary did not make the
gap between tenant payment and provider settlement visible enough.

**Decisions made:** `/payments` is role-aware. Tenant Payments opens on what is
due across all homes, with a quiet History view for successful receipts and
failed, expired or cancelled attempts. It never merges homes into one ambiguous
balance. Provider Payments names four distinct facts: paid online, awaiting
settlement, settled to the provider and fees deducted. Settlement rows show the
two-checkpoint journey `Paid → Settled`; a pending row never implies funds have
arrived. The provider bears the PSP transaction fee, while the tenant sees the
server-priced obligation amount.

**Mobile interaction:** Payments is one of the tenant's five primary tabs. Home
no longer duplicates it; each home card still opens its focused rent account.
Services is now the tab beside it and the two stay separate on purpose: rent is
an obligation between two named parties on this platform, a bundle is a purchase
from a third party, and one tab holding both is how a rental product starts
looking like a wallet. Services carries no rent balance and reaches no rent
account. Recording money received elsewhere is a dedicated,
resumable provider screen because choosing a charge, amount, date, method and
reference is a workflow, not a lightweight decision.
Confirm, dispute and waive remain small contextual confirmations.

**State and trust coverage:** available checkout, unavailable checkout, open
intent, overdue obligation, no balance, successful receipt and unsuccessful
attempt are explicit. A failed payment-history request fails the workspace
rather than silently showing incomplete financial history. No client creates a
success, receipt or settlement fact.

`Pay rent` remains visible for every outstanding tenant charge. It opens the
dedicated review journey even when setup is incomplete, where the
server-authored availability reason replaces payment methods and initiation.
This makes the payment affordance discoverable without offering a control that
can pretend to collect money.

**Tests:** focused contracts pass 19/19 on web and 5/5 on mobile. Both clients
pass TypeScript and lint; the web production build includes the role-aware
Payments route. No payment API or lifecycle semantics changed in this UI slice.

**Refinement — 2026-09-15, product owner review (provider mobile).** The brief:
a calm, premium financial page with the same functionality, a clearer hierarchy,
and one Filter control in place of filter chips scattered across the page.

- **One reading order.** The figures come first, in one glass panel. Outstanding
  leads, with overdue under it in laterite, and Rent recorded and Settled to you
  sit apart as the separate facts they are. Anything that needs a decision follows
  in one "Needs attention" panel, whose rows each go straight to the right list:
  activate online payments, overdue, records to review, awaiting payout, and a
  payout that needs attention. The introduction sentence and the records caption
  are gone.
- **One Filter control.** The four view tabs and the row of status chips became a
  single Filter pill beside the list's name and count. It opens the shared
  `BottomSheet`, grouped into Show (Rent due, Records, Payouts, Expenses) and,
  for rent only, Rent status. Every answer is a radio with its count, and the
  sheet closes on "Show N results", beside a Reset. On the page, the list's
  heading says which view is on, and a status filter appears as the pill's badge
  and one removable token. Search stays for every list that can be searched.
- **Rows never cut a figure short.** Each row is built from full-width lines, the
  name against the amount and the place against the status. The amount and status
  never give way; the words on the left take what width is left. The list reads
  as one glass panel with no repeated chevrons. On phones narrower than 350pt a
  due date and a payout fee give way, and a screen reader still hears both.
  Payout rows keep both checkpoints, Paid and Settled.
- **Notes are glass**, with their colour in the glyph: a payout in progress, a
  payout under review, and online collection not yet ready. The load error keeps
  the app-wide notice.
- **Unchanged:** pull to refresh, the rent-account route, the payout-account
  route for owners and admins, recording expenses (with "add" opening that form),
  lease-less tenants not opening, and late rent sorting first.

**Verified:** mobile typecheck and lint are clean. 179 of 181 mobile contract
tests pass; the two failures are the Explore header button's, from header work in
progress. Eight new Payments tests were added, and a mirror caught 34 of 34
mutations. Checked in headless Chrome on Expo web with a mocked Portfolio at
390×844 and 320×640: the summary and attention panels; the sheet opened, with a
status chosen and with Reset; each view reached through it; the filtered state; a
verified account with a payout needing review; and no truncated amount or status
at 320.

**Refinement — 2026-09-15, product owner review (tenant mobile).** The brief: each
page designed for its own purpose rather than one layout for all, the most
important thing first, long histories one tap away, one control for filtering,
few words, and polish on small phones.

- **One reading order instead of two tabs.** Due now and History became one page
  read top to bottom. Outstanding leads in a glass panel, with overdue under it in
  laterite (or how many payments are confirming, or "All paid up"), and Next due
  and Last paid beside each other. Last paid counts only a payment that counts —
  confirmed by both or by the processor, never a claim still waiting. The
  introduction sentence and the attention strips are gone.
- **What waits on the tenant comes next.** A payment the landlord recorded sits in
  one "Confirm an external payment" panel; each row opens the rent account.
- **Every due item keeps its one action.** A row reads what it is against how
  much, which home, then how it stands beside a pill: Pay rent (Pay deposit, and so
  on) in kola, or Check status in soft kola while a payment is under way, so nobody
  pays the same item twice. Late is laterite with its days, and part-paid is said.
  The panel shows three; "View all" opens every due item in the shared sheet, and a
  row there closes the sheet before leaving, because the sheet is a modal.
- **Payments, not a history dump.** The latest three, each with how it stands
  beside its Receipt (or Details), then date, method and home on a line that wraps
  rather than cutting a date. "View all" opens the rest, newest first. Unsuccessful
  attempts sit behind their own link and sheet, and are not a way in.
- **Small phones.** Where a status and its pill do not fit side by side, the pill
  drops under the line rather than squeezing it, and a short label stays with its
  word ("Bed A").
- **Unchanged:** the sign-in prompt, ended rent accounts, open-payment matching,
  late-first sorting, the checkout, status, receipt and rent-account routes, the
  availability explanation, and the error notice. Added: pull to refresh, a
  skeleton shaped like the page, and an empty state that leads to the agreements.

**Verified:** typecheck and lint are clean; 220 of 222 mobile contract tests pass,
the two failures being the header button's, from header work in progress. Seven new
tests in `tenantPaymentsPage.contract.test.mjs`; a mirror caught every mutation
across this page, tenant Viewings and Applications (74 of 74). The external-payment
pin in `rentWorkspace.contract.test.mjs` now ignores case, because the group label
is written in sentence case and drawn in capitals. Checked in headless Chrome on
Expo web with mocked tenancies, ledgers and payment attempts at 390×844 and
320×640: the full page, all three sheets, paid up, no rent account, and no cut
text at 320. No native device was used.

**Refinement — 2026-09-15, product owner review (the account pages).** The same
brief, applied to the four pages nobody visits often and everybody needs when
they do: Verification, Settlement account, Security and Notification settings.
Each was a stack of labelled rows; none of them said, at a glance, how things
stood.

- **Verification became progress, not a checklist.** How far the checks have got
  leads as a ring — kola only when every one is done, harmattan while any is
  outstanding — and the ring names the one check somebody can actually act on,
  never one that is merely waiting on Danpa HQ. The checks then read as two
  groups, the person's own and the Portfolio's, and a verified row carries a tick
  rather than its original glyph. The settlement account is read as a check in
  every state it can be in, including the one where somebody else owns it.
- **Settlement account: the account rent arrives in leads.** One card states the
  account in use, and says which of "no account chosen yet" and "no receiving
  account yet" is true, because a Portfolio with saved-but-unchosen accounts is
  not a Portfolio with none. Every saved account follows as one glass list, each
  row carrying its verification and only the act that state allows. Adding one is
  a panel opened on request, and the account number is never retained.
- **Security: how the account stands leads, in its own colour.** A paused payout
  is laterite and says how many hours it lasts; a noted account is harmattan;
  otherwise kola. The two device actions are kept apart, neither takes a second
  press while one is in flight, and reporting a handset lost is drawn as the
  irreversible thing it is. What to watch for is a note, not a page of prose.
- **Notification settings: one panel, and one rule about narrowing.** Each switch
  saves on its own and a refusal puts it back. A setting that only makes sense
  under another sits under it on a rail, and goes inert when its parent is off.
- **Unchanged:** every route, the identity-verification journey, the Paystack
  resolve/activate/refresh calls, the owner-and-admin gate on settlement, the
  provisioning check that must not be re-run, and the copy that says decisions
  always arrive in Updates whatever else is switched off.

**Verified:** typecheck and lint are clean; 249 of 251 mobile contract tests pass,
the two failures being the Explore header button's, from header work in progress.
Fifteen new tests across `verificationChecks.contract.test.mjs`,
`settlementAccount.contract.test.mjs` and `accountSafety.contract.test.mjs`; a
mirror caught 53 of 53 mutations. Checked in headless Chrome on Expo web with a
mocked account at 390×844 and 320×640: verification part-done, fully verified and
as a tenant; security at rest and with payouts paused; settlement in each of its
states; preferences with texts switched off; and no truncated text at 320. No
native device was used.

**Refinement — 2026-09-21, product owner review (Team, Archive and the shortlist).**
The last three pages of the same brief, plus one navigation decision: Saved is no
longer a first-class destination, so it should not carry the main navigation.

- **Saved left the tab bar.** The wrapper in `(tabs)` is deleted and its
  `Tabs.Screen` with it, so the renter's bar is five tabs rather than six-with-one-
  hidden. A hidden tab still rendered inside the tab navigator: it kept the bar and
  offered no way back. It is now a pushed screen beside Verification and Security,
  titled "Saved places", carrying a back arrow and no bar. Explore's header
  bookmark and More → "Saved places" both push `/(app)/saved`, and the signed-out
  prompt moved onto the screen itself, returning to that same route. It earns no
  Home shortcut: two entrances are enough, and a third is how one journey starts
  behaving three ways.
- **A note belongs to the card it was written against.** The shortlist keeps the
  shared recognition card; a note is drawn as that card's foot — pulled up beneath
  it with its top edge removed — rather than as a second card floating under it.
- **Team leads with how many people hold access.** Then the Portfolio's own
  identity as facts, with the single control that renames the business. Then the
  roster: members and the people invited to become members in one list, because an
  invitation is a person who is nearly here, named as two groups only when both
  exist. Initials carry the colour of that person's reach — kola for
  Portfolio-wide, harmattan for something unfinished, laterite for an ended one —
  and the role sits on the right, where an eye runs down a roster looking for it.
  An invitation opens rather than carrying controls in the list, and revoking is
  confirmed inside it. The search appears only from seven people.
- **Anything with a keyboard opens as its own page sheet.** Naming the Portfolio
  and inviting somebody are both forms; unfolded in the middle of a roster they
  move the list somebody was reading.
- **Archive answers the one question it exists for.** How much is archived leads,
  with how much of it can come back right now — "2 of 3 can be restored now", or an
  alert when none can. Each kind is grouped, and a row says only what it is, when
  it went, and "Can restore" or "Held" in its own colour. The reason, the blockers
  behind a refusal and the restore itself open on the row, so a rarely-visited
  recovery list stays a list rather than a stack of paragraphs. Restore is offered
  only where the server allows it, and closes the sheet it empties.
- **Unchanged:** every route and endpoint, the Team member screen and its staged
  access changes, the roles a Team may grant (never Owner), the invitation form and
  its seven-day expiry, the revoke wording, and both restore endpoints.

**Verified:** typecheck and lint are clean. Sixteen new tests across
`savedShortlist.contract.test.mjs`, `teamRoster.contract.test.mjs` and
`archiveRecovery.contract.test.mjs`; a mirror caught 57 of 57 mutations. 264 of 267
mobile contract tests pass: two are the Explore header button's, from header work in
progress, and the third is in-flight work on that header's Profile button — the test
now expects `/(app)/profile-edit` while the component still pushes the profile tab.
354 of 356 web tests pass, the two being the known PortalShell header and Updates
PageHeader failures. `tenantControlCenter.contract.test.mjs` no longer claims Saved
is a tab; it now pins the pushed route and that Home still does not shortcut to it.
Checked in headless Chrome on Expo web at 390×844 and 320×640: the shortlist with a
note and empty; Team with a full roster, operating alone, and with access withheld;
the invitation and both page sheets; the archive with a restorable and a held
record, the held one showing its blockers and offering no Restore; and the archive
empty. Two things worth knowing for the next capture: `stripOverlays()` deletes
react-native-web's `Modal` portal hosts, so an always-mounted sheet silently fails to
open unless the step skips stripping; and the only text clipped at 320 is the card
price, which relies on `adjustsFontSizeToFit` — implemented on the phone, absent on
web. No native device was used.

---

### Journey: The record pages

**Status:** IMPLEMENTED — 2026-09-21. Thirteen detail pages, tenant and
provider, redesigned onto one warm record language. Device review on a Samsung
handset still wanted for the edge-to-edge fix below.

**Why this journey exists:** The index pages had been recomposed onto Danpa HQ's
green with frosted glass, and tapping a row still opened the old screen: a
display heading, a column of bordered sections, and every act the page could
perform stacked as a full-width button at the bottom. A list that reads as one
product opening onto pages that read as another is worse than neither, because
the seam is exactly where somebody is deciding something.

**Decisions made:**

- **A record stands on warm paper, not on the dashboard's glass.** The index
  pages' 72%-white glass over `field-50` lifts by about one percent — it is
  invisible on ivory. So a record gets the same vocabulary in a warm dialect:
  `field-0` panels, `field-200` hairlines, and the house elevation rule (a very
  subtle shadow on iOS, hairlines on Android, because soft shadows smear on
  low-cost LCDs). The kit is `RecordSurfaces.tsx`: `RecordPanel`, `GroupLabel`,
  `Lead`, `StandingLine`, `Fact`, `LinkRow`, `Pill`, `QuietAct`, `ActionBar`,
  `Quote`, `Footnote`.
- **Every record leads with the one thing it is about.** `Lead` renders it
  once — what is outstanding, when the viewing is, which role this person
  holds — and the rest of the page is facts underneath it. A record that leads
  with a heading and a breadcrumb is a record nobody has read.
- **One act, not a collection of buttons.** The decision the record is waiting
  on goes in `ActionBar`, pinned under the thumb and outside the reading order.
  Everything quieter is a `QuietAct`: kola words, no furniture. Irreversible
  acts wait behind one quiet way in and are confirmed in a sheet that names
  what ends and what does not.
- **The agreement is the exception that proves it.** Every other record answers
  "what do I do now" and keeps its act under the thumb. An agreement answers
  "should I sign this", which is a question you finish reading before you
  answer, so its decision sits at the foot. The provider's copy of the same
  record *is* a queue item, so it keeps a bar.
- **A record may propose the several times the backend accepts.** `offer_slots`
  takes one to five; both clients had always sent exactly one, which made the
  other side's "Pick a time" a list of one. `TimeOffer` proposes up to five,
  refuses a duplicate, advances the date on its own, and — because re-offering
  deliberately replaces what was proposed before — names each time it will
  replace rather than counting them. The landlord's own offered times are now
  shown on their record while it waits; they had been invisible.
- **Access is chosen on the row that says what it costs somebody.** A role's
  consequence used to sit in a caption under the picker, which is after the
  choice rather than in it. `RoleChoice` puts it on each option. Properties are
  ticked rather than pressed. The member screen and the invitation sheet share
  both controls, because granting access and changing it are the same decision
  met twice.
- **A plan is a panel you can compare.** Change plan was four pricing cards,
  each a screen and a half tall — the one shape in which plans cannot be
  compared. A plan is now name, price, what it raises, and at most three things
  it adds; the panel itself is the choice, so there is no button inside it to
  miss and none beside three others to weigh. The plan in force says so in its
  badge and is not pressable. The feature matrix, behind its disclosure, wraps
  its three answers instead of holding three fixed columns, which on a 320pt
  handset left ninety points a column and cut every value that was a word.
- **Prose does not right-align.** `Fact` puts a date or an amount on the right,
  where an eye runs down a column of them, and takes `wide` for a sentence,
  which sits under its label and takes the width.
- **Colour, then words.** A payment row leads with its amount alone; the
  standing is carried by the row's tone and icon and leads the detail line.
  Joined to the amount on one line it was cut on every 320pt handset.

**Android edge-to-edge (2026-09-21):** A React Native `Modal` is a separate
native window. The app had one `SafeAreaProvider`, and `BottomSheet` read
`useSafeAreaInsets()` in the page's tree before rendering a `Modal` — so one
provider was describing two windows, and whichever reported last won. On a
Samsung handset the filter sheet's footer sat under the navigation buttons
while the page behind it was correctly inset, and a re-render swapped the two
over. `ModalSafeArea` gives every `Modal` its own provider, seeded with
`initialWindowMetrics` so nothing renders a frame at zero inset, and
`SafeBottom` / `SafeInsets` read the numbers inside that window. Applied to
every `Modal` in the app; the `BottomSheet` change alone covers filter sheets on
eighteen screens. A contract test scans `app/` and `src/` and fails on any
`<Modal` without the wrapper, because web reports zero insets on every window
and the capture harness is therefore blind to this.

**Unchanged:** every route and endpoint; the meaning modules mirrored with the
web (`viewingMeaning`, `applicationMeaning`, `agreementMeaning`,
`billingPresentation`, `notificationMeaning`, `providerLeaseMeaning`); the roles
a Team may grant (never Owner); the staged-then-settled-once shape of a member's
access change; the seven-day invitation expiry; and that choosing a plan only
opens its review, where the server prices it.

**Verified:** typecheck and lint clean. 286 mobile contract tests, 283 passing;
the three failures are in `exploreHeader.contract.test.mjs` and belong to header
work in progress. New pins in `recordPages.contract.test.mjs` and
`safeEdges.contract.test.mjs`; every one mutation-checked against a scratchpad
mirror. Checked in headless Chrome on Expo web at 390×844 and 320×640: both
viewing records including a multi-slot offer; both applications; both agreements;
both tenancies; the rent account as tenant, as provider and after a tenancy ends;
the record-payment form; the member screen with its role change, its Properties
and its removal sheet; the invitation; and Change plan on both cycles with the
comparison open. Zero clipped text at 320 on every page checked.

**How a control says what state it is in (2026-09-21):** React Native accepts
`accessibilityState={{ checked }}` and `aria-checked`, and the two are not
equivalent. Native honours both — `Pressable`, `View` and `Text` each fold
`aria-*` back into `accessibilityState`, with `aria-*` winning. But
`react-native-web` 0.21 honours *only* `aria-*`: `createDOMProps` reads
`aria-checked` and the deprecated flat `accessibilityChecked`, and never looks
at `accessibilityState`. Every radio and checkbox in the app had been written
the `accessibilityState` way, so the role reached the DOM and the state did
not — on the web build a screen reader could not tell which role was selected
or which Properties were ticked. It also made the capture harness lie, because
the harness drives the web build and was reading an attribute that was never
going to be there. All 48 sites now use the `aria-*` form, which is correct on
both renderers, and `ariaState.contract.test.mjs` scans `app/` and `src/` so
the other form cannot come back. Where a control switches between radio and
checkbox it sends only the attribute its own role reads, since `aria-selected`
on a checkbox and `aria-checked` on a radio are both ignored.

**Remaining:** `TimeOffer` and `lease-builder` still take a date and a time as
text fields (`YYYY-MM-DD`, 24-hour) rather than offering a picker.

---

## Journey update template

Copy this section after completing or materially advancing a journey:

```markdown
### Journey: [Name]

**Status:** COMPLETE / IN PROGRESS / NOT STARTED

**Why this journey exists:**

**Problems identified:**

**Decisions made:**

**Patterns introduced:**

**Components introduced/reused:**

**Important responsive behavior:**

**Accessibility and state coverage:**

**Tests and visual review:**

**Remaining issues:**

**Next recommended journey:**
```

When a durable decision changes, add a dated decision entry and explain why.
Do not silently rewrite history; mark replaced decisions as superseded so future
work can understand the tradeoff.
