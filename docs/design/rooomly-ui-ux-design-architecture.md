# Rooomly UI/UX Design Architecture

**Document status:** Living design architecture\
**Product:** Rooomly --- Ghana-first rental and property-management
platform\
**Purpose:** Durable source of truth for UI/UX refinement across web and
mobile\
**Applies to:** Next.js web, Expo/React Native mobile, shared design
language\
**Last updated:** 2026-08-24

------------------------------------------------------------------------

## 1. Purpose

This document defines the product-design architecture for Rooomly.

Rooomly is an existing, functioning product. This UI/UX program does
**not** replace the domain architecture, lifecycle rules, permissions,
verification system, tenancy model, lease model, or API contracts. Its
purpose is to make the sophistication underneath Rooomly feel simple,
coherent, trustworthy, and pleasant to use.

The core objective is:

> **Make Rooomly dramatically easier to understand and operate without
> weakening the sophistication, safety, or business rules underneath.**

This document must remain useful across development sessions. A new
engineer or AI coding session should be able to read it, inspect the
current implementation, and continue the design program without relying
on conversational history.

### Source-of-truth hierarchy

1.  Current code --- implementation truth.
2.  Architecture/domain documentation --- business and technical
    contracts.
3.  This document --- UI/UX principles, patterns, decisions, progress,
    and handoff.
4.  Conversation history --- temporary context only.

------------------------------------------------------------------------

## 2. Product Design Vision

Rooomly should feel like a world-class digital housing product designed
specifically around Ghanaian rental realities.

The experience should feel:

-   calm;
-   trustworthy;
-   focused;
-   modern;
-   premium without being decorative;
-   fast;
-   human;
-   mobile-first;
-   easy to learn;
-   efficient for frequent users;
-   financially credible;
-   consistent without becoming repetitive.

Rooomly must not look like a generic AI-generated SaaS dashboard.

The interface should reduce cognitive effort. Users should spend their
attention on finding homes, managing properties, handling tenants,
attending viewings, managing leases, and understanding rent --- not on
understanding the software.

### Premium means

**Clarity + restraint + hierarchy + consistency + speed + excellent
interaction quality.**

Premium does not mean more gradients, cards, badges, shadows, animation,
or whitespace.

------------------------------------------------------------------------

## 3. Design Principles

### 3.1 Purpose before layout

Before changing a screen, determine:

1.  Why does this screen exist?
2.  What is the user's primary goal?
3.  What information is necessary now?
4.  What is the most likely next action?
5.  What belongs elsewhere or on demand?

The layout must follow those answers.

### 3.2 Progressive disclosure

Every screen should separate information into:

**Primary** --- what matters immediately.\
**Secondary** --- context needed to understand or complete the task.\
**On demand** --- history, evidence, advanced controls, technical
details, and rare actions.

Do not expose all three levels simultaneously without a strong reason.

### 3.3 Backend complexity should not leak into the UI

Rooomly may internally track several verification, publication,
availability, moderation, tenancy, and authorization states. Preserve
those distinctions in the domain.

The normal interface should summarize them into the smallest useful
representation.

For example, a user may need:

`Verified · Available`

rather than six internal state badges.

Detailed state information remains accessible where useful.

### 3.4 Information must earn its place

Do not display information merely because an API returns it.

Remove or relocate:

-   duplicated information;
-   repetitive explanations;
-   technical terminology;
-   permanent notices for normal states;
-   irrelevant metadata;
-   actions unrelated to the current task.

### 3.5 Simplicity is not under-design

Do not force every screen into a sparse single-column layout.

Use cards, grids, multi-column layouts, tables, lists, side panels,
tabs, search, filters, and sorting when they genuinely improve
comprehension or efficiency.

The goal is **organized complexity**, not artificial minimalism.

------------------------------------------------------------------------

## 4. Product Information Architecture

Navigation should reflect the user's mental model rather than backend
bounded contexts.

### Provider product areas

The intended high-level product areas are approximately:

1.  Home
2.  Properties
3.  Tenants
4.  Viewings
5.  Tenancy Requests / access workflow where applicable
6.  Leases
7.  Rent
8.  Portfolio
9.  Team
10. Notifications
11. Settings

The exact primary navigation must remain intentionally small. Related or
lower-frequency areas may be grouped rather than all becoming top-level
items.

### Tenant product areas

Approximately:

1.  Home
2.  Explore
3.  Viewings
4.  Tenancy / Homes
5.  Leases
6.  Rent
7.  Notifications
8.  Settings

Navigation should evolve based on actual frequency and product usage
rather than mirroring the provider interface.

------------------------------------------------------------------------

## 5. Navigation Architecture

Navigation must be exceptionally easy on web and mobile.

Users should always understand:

-   where they are;
-   what entity/context they are managing;
-   how to return;
-   where the most common related action lives.

### Rules

-   Important destinations require few interactions.
-   Frequently used capabilities must not be buried.
-   Rare configuration must not pollute primary navigation.
-   Avoid multiple competing routes to the same destination unless they
    serve meaningful contextual entry points.
-   Preserve context through related entities.
-   Use user language, not internal architecture terminology.
-   Do not add a primary navigation item merely because a backend module
    exists.

Before adding navigation, ask:

> How often is this needed, where would the user naturally look for it,
> and does it deserve primary navigation?

### Web

Use desktop space intentionally. Appropriate patterns include:

-   primary application navigation;
-   breadcrumbs/context navigation;
-   secondary navigation within major areas;
-   contextual actions;
-   settings side navigation;
-   drawers/side panels where preserving context is useful.

### Mobile

Do not shrink the web navigation.

Use:

-   focused tab navigation;
-   native back behavior;
-   nested screens;
-   bottom sheets;
-   contextual action menus;
-   sticky primary actions where useful.

Keep primary mobile navigation small enough to remain understandable.

------------------------------------------------------------------------

## 6. Entity Hierarchy

Rooomly should communicate relationships clearly:

``` text
Portfolio
└── Property
    └── Unit
        ├── Listing
        ├── Tenancy
        ├── Lease
        └── Rent
```

Related workflows such as viewings and requests connect to this
hierarchy without requiring the user to understand the data model.

### Parent/child rule

A parent summarizes children. A child owns its detailed information.

Example:

-   Properties screen: recognize and find properties.
-   Property screen: understand the property and manage its units.
-   Unit screen: understand the unit's status and perform unit-specific
    actions.
-   Tenant screen: understand the tenant relationship.
-   Lease screen: understand contractual terms and actions.
-   Rent screen: understand financial obligations/history.

Do not duplicate the complete child state on the parent.

------------------------------------------------------------------------

## 7. Page Composition

A typical detail screen should establish:

1.  Context / back navigation.
2.  Entity identity.
3.  Current meaningful status.
4.  Primary task/content.
5.  Primary action.
6.  Secondary information.
7.  Less-common actions/details on demand.

This is a principle, not a mandatory template. Different domains may
require different compositions.

### Property example

A normal verified Property page should prioritize recognition and units
rather than repeatedly explaining verification.

Conceptually:

``` text
← Properties

Asokwa Residence                         Verified
Asokwa, Kumasi

[Property image]

Units                                      + Add unit

[image] Room 1                         Available
        Self-contained

[image] Room 2                          Occupied
        Single room

Property details →
```

Verification history and evidence can be available through a secondary
destination rather than dominating normal management.

------------------------------------------------------------------------

## 8. Action Architecture

Actions have hierarchy.

### Primary

The most important likely next action.

### Secondary

Common alternatives that support the current task.

### Overflow

Rare, administrative, destructive, or advanced actions.

Avoid presenting many equally prominent buttons.

Destructive actions must not compete visually with normal primary
actions.

Backend capabilities remain authoritative. The interface must never
offer an action merely because it is visually convenient when the
current lifecycle/permission state forbids it.

------------------------------------------------------------------------

## 9. Choosing the Correct Interaction Surface

Do not automatically create a page for every capability.

### Inline interaction

Use for very small changes where preserving context is valuable.

### Modal/dialog

Use on web for focused, short tasks such as:

-   confirmation;
-   archive/delete confirmation;
-   short forms;
-   simple choices;
-   status changes;
-   assigning a team member;
-   small edits.

### Bottom sheet

Prefer on mobile for short contextual actions and option selection where
it feels native.

### Drawer/side panel

Use on larger screens when users need additional detail or a short
workflow while retaining the surrounding context.

### Dedicated page/screen

Use when the task has:

-   substantial information;
-   multiple sections;
-   several decisions;
-   legal or financial significance;
-   complex review;
-   a workflow that may be left and resumed.

The interaction surface should match task complexity.

------------------------------------------------------------------------

## 10. Information Presentation

Choose representation according to the task and data.

### Cards

Use when visual recognition, imagery, status, or compact actions matter.

Likely examples:

-   Properties;
-   Units;
-   public listings.

Cards should not become decorative containers around every piece of
information.

### Multi-column/grid layouts

Use on larger screens when they improve scanning, recognition,
comparison, or space efficiency.

Responsive layouts should recompose naturally rather than merely shrink.

### Lists

Use for compact, scan-friendly collections.

### Tables

Use for operational/dense data where users compare fields across rows.

Possible areas include:

-   team members;
-   rent/payment history;
-   leases;
-   operational tenant data.

Tables must remain responsive and should not be forced onto small mobile
screens unchanged.

------------------------------------------------------------------------

## 11. Search, Filter, Sort, and Scale

Design collections for realistic growth.

A screen that works with 3 Properties should remain usable with 30 or
300 where the domain permits it.

Consider:

-   search;
-   filters;
-   sorting;
-   tabs;
-   segmented views;
-   status filters;
-   date filters;
-   contextual grouping.

Do not add all controls mechanically.

Add them when they reduce time-to-find or make a collection easier to
understand.

### Desktop

Controls may share horizontal space when appropriate.

### Mobile

Keep the default surface compact. Search may remain directly accessible
while advanced filtering/sorting can move into a bottom sheet or focused
control.

------------------------------------------------------------------------

## 12. Status Presentation

Status must be quiet but clear.

Avoid a wall of badges.

Show the state that affects what the user understands or can do now.

Detailed lifecycle information belongs in secondary details when
necessary.

Status design should distinguish:

-   normal state;
-   attention required;
-   blocked state;
-   success/completion;
-   destructive/problem state.

Do not use alarming presentation for ordinary lifecycle states.

------------------------------------------------------------------------

## 13. Product Copy

Copy should be concise, human, and actionable.

Avoid:

-   paragraphs explaining obvious UI;
-   internal architecture language;
-   repeated reassurance;
-   verbose success messages;
-   technical state descriptions;
-   instructions that interaction design can communicate.

Prefer `Verified` over a paragraph explaining that verification
succeeded.

Longer explanations are justified for:

-   legal consequences;
-   money;
-   security;
-   privacy;
-   destructive actions;
-   unusual or unfamiliar workflows.

------------------------------------------------------------------------

## 14. Settings Architecture

Settings is a product area, not a miscellaneous page.

### Web

Use an organized settings shell with secondary navigation where
supported by actual functionality.

Potential grouping:

``` text
Settings

Account
  Profile
  Security
  Notifications

Portfolio
  Portfolio details
  Team
  Property assignments

Preferences
  Viewing
  Communication
  Privacy

Data
  Archived
```

This is conceptual. Do not invent settings that do not exist.

Settings groups should reflect stable concerns rather than backend
modules.

### Mobile

Do not reproduce the desktop sidebar.

Use focused nested settings screens:

``` text
Settings
→ Account
→ Security
→ Notifications
→ Portfolio
→ Team
→ Privacy
→ Archived
```

------------------------------------------------------------------------

## 15. Web Design Principles

Web should exploit larger screens without becoming a dense
administration console.

Use:

-   meaningful multi-column composition;
-   efficient list/grid views;
-   contextual side panels;
-   strong scanning hierarchy;
-   secondary navigation;
-   keyboard accessibility;
-   useful hover/focus states;
-   responsive density.

Do not turn every page into a dashboard.

------------------------------------------------------------------------

## 16. Mobile Design Principles

Mobile is first-class, especially Android.

Design for:

-   one-handed use;
-   smaller screens;
-   clear touch targets;
-   intermittent connectivity;
-   lower-cost devices;
-   mobile-money workflows;
-   camera/location workflows where relevant;
-   limited screen density;
-   clear back navigation;
-   concise content;
-   bottom sheets;
-   sticky actions when useful.

Web and mobile share product language and design principles, not
necessarily identical layouts.

------------------------------------------------------------------------

## 17. Responsive Architecture

Every refined area must consider:

-   small mobile;
-   typical mobile;
-   tablet/narrow desktop;
-   desktop;
-   wide desktop where relevant.

Responsive behavior should change composition when needed.

Do not simply scale dimensions.

Examples:

-   grids reduce columns;
-   tables may become structured list rows;
-   secondary side navigation may become nested navigation;
-   desktop dialogs may become mobile sheets/screens;
-   action groups may collapse into contextual menus.

Avoid horizontal page overflow.

------------------------------------------------------------------------

## 18. Feedback, Motion, and Perceived Performance

Motion communicates:

-   state;
-   continuity;
-   hierarchy;
-   success;
-   loading;
-   interaction feedback.

Use restrained:

-   transitions;
-   pressed/hover states;
-   skeletons where appropriate;
-   success feedback;
-   modal/sheet transitions;
-   image transitions.

Do not animate for decoration.

Respect reduced-motion preferences.

------------------------------------------------------------------------

## 19. Loading, Empty, Error, and Success States

These are part of the product, not edge cases.

### Loading

Preserve layout stability and communicate useful progress.

### Empty

Explain what the absence means and, when appropriate, provide the next
action.

### Error

State what failed in human terms and offer recovery where possible.

### Success

Confirm meaningful completion without unnecessary celebration or
interruption.

Avoid permanent banners after the information has served its purpose.

------------------------------------------------------------------------

## 20. Accessibility

At minimum:

-   readable typography;
-   sufficient contrast;
-   clear focus states;
-   semantic web structure;
-   keyboard navigation;
-   adequate touch targets;
-   accessible form labels/errors;
-   screen-reader-friendly controls;
-   reduced-motion support;
-   layouts resilient to larger text.

Accessibility should be proportional and continuous rather than used as
a reason to stall ordinary design progress.

------------------------------------------------------------------------

## 21. Anti-Patterns --- Rooomly Must Not Become

Avoid:

-   generic SaaS dashboards;
-   cards inside cards without purpose;
-   excessive rounded containers;
-   giant headings on routine operational pages;
-   meaningless statistics;
-   arbitrary dashboard grids;
-   blue/purple AI aesthetics;
-   decorative gradients;
-   glassmorphism without purpose;
-   excessive badges;
-   giant explanatory banners;
-   unnecessary icon boxes;
-   duplicated information;
-   every action becoming a dedicated page;
-   every backend state becoming visible;
-   desktop UI simply compressed onto mobile;
-   one identical layout applied to every domain.

Do not confuse consistency with sameness.

------------------------------------------------------------------------

## 22. Design Inspiration Policy

The product team may study world-class products such as Stripe, Linear,
Airbnb, Vercel, Ramp, Notion, OpenAI, GitHub, and excellent
hospitality/property products.

Study principles such as:

-   hierarchy;
-   information density;
-   navigation;
-   contextual actions;
-   settings architecture;
-   progressive disclosure;
-   responsive behavior;
-   empty states;
-   interaction quality.

Do not copy another company's visual identity or reproduce its screens.

Rooomly must develop its own recognizable Ghanaian housing identity.

------------------------------------------------------------------------

## 23. Refinement Methodology

This program must **not** be executed as one mass redesign.

Work one complete product area at a time.

### Current working sequence

1.  Home
2.  Properties
    -   Properties list
    -   Property
    -   Units
    -   Unit
3.  Tenants
    -   Tenant list
    -   Tenant/Tenancy
    -   related Lease/Rent navigation
4.  Viewings
5.  Tenancy Requests / access workflow
6.  Leases
7.  Rent
8.  Portfolio
9.  Team
10. Settings
11. Notifications
12. Tenant-facing areas, following the documented current product state

The order may be adjusted when dependencies or existing architecture
provide a strong reason. Record the reason.

### Per-area process

``` text
Understand purpose
→ Inspect existing implementation
→ Identify UX problems
→ Define hierarchy/navigation
→ Implement
→ Focused responsive review
→ Focused accessibility review
→ Relevant frontend validation
→ Polish
→ Update this document
→ STOP for user testing
```

Do not automatically proceed to the next product area.

The user should be able to test each coherent area before the next is
changed.

------------------------------------------------------------------------

## 24. Validation Strategy

Validation must be proportional to risk.

### Ordinary UI-only changes

Use:

``` text
Implement
→ relevant typecheck/lint
→ directly affected UI tests where useful
→ inspect relevant breakpoints/states
→ polish
```

Do not repeatedly run the complete backend, E2E, integration,
production-build, and smoke suites after small layout/copy changes.

### Broader validation is appropriate when changing

-   application shell/navigation;
-   shared components with large blast radius;
-   API behavior;
-   permissions/capabilities;
-   lifecycle/state logic;
-   domain behavior;
-   major completed journeys.

World-class quality means intelligent risk-based validation, not maximum
process for every change.

------------------------------------------------------------------------

## 25. Architecture Protection Rules

UI/UX work must not casually change:

-   authentication;
-   authorization;
-   capability enforcement;
-   verification rules;
-   property/unit lifecycle;
-   listing lifecycle;
-   viewing state machine;
-   tenancy rules;
-   lease rules;
-   payment/rent integrity;
-   audit architecture;
-   security boundaries.

If good UX reveals a genuine product/domain problem, document it
separately and address it deliberately rather than hiding a domain
change inside frontend work.

------------------------------------------------------------------------

## 26. Durable Session Handoff

At the beginning of every future UI/UX session:

1.  Read this document.
2.  Read `docs/phases.md`.
3.  Read `docs/status.md`.
4.  Read relevant architecture/domain documents.
5.  Inspect current implementation and Git state.
6.  Continue from the **Current UX Work** section below.

Do not rely on conversational memory.

After each completed area, update the progress ledger below.

------------------------------------------------------------------------

## 27. UX Progress Ledger

### Completed UX refinements

Record completed product areas here with concise notes.

For each:

``` text
Area:
Status: COMPLETE

Problems solved:
- ...

Design decisions:
- ...

Reusable patterns:
- ...

Responsive/mobile decisions:
- ...

Remaining limitations:
- ...
```

### Current UX work

**Status:** Continue from repository truth.

The previous documented work indicated refinement around the provider
Property → Unit experience. Before continuing, inspect the current code
and prior design-document changes to determine whether that area is now
complete.

Do not redo completed work unnecessarily.

### Planned product-area sequence

After confirming the current state:

``` text
Home
→ Properties
→ Tenants
→ Viewings
→ Tenancy Requests / access
→ Leases
→ Rent
→ Portfolio
→ Team
→ Settings
→ Notifications
→ remaining tenant-facing journeys
```

After each area: document, report, and stop for user testing.

------------------------------------------------------------------------

## 28. Decision Log

Important UI/UX decisions should be recorded here rather than left only
in conversation history.

### D-001 --- Progressive disclosure

**Decision:** Normal screens show the minimum state/details required for
the current task. Advanced lifecycle/evidence information remains
available on demand.

### D-002 --- Product-area refinement

**Decision:** Redesign proceeds by complete product area rather than one
application-wide pass.

**Reason:** This allows coherent design, focused validation, and user
testing between areas.

### D-003 --- Appropriate interaction surfaces

**Decision:** Small contextual actions should use inline controls,
dialogs, drawers, or mobile bottom sheets where appropriate. Dedicated
pages are reserved for tasks that justify them.

### D-004 --- Cards and grids are allowed

**Decision:** Rooomly does not prohibit cards or multi-column layouts.

**Reason:** The anti-pattern is unnecessary cardification, not cards
themselves. Visual entities such as Properties and Units can benefit
substantially from image-led cards and responsive grids.

### D-005 --- Collections must scale

**Decision:** Search, filter, sort, tabs, and grouping should be
introduced when collection size or user tasks justify them.

### D-006 --- Settings is a structured product area

**Decision:** Web Settings may use grouped secondary side navigation.
Mobile should use native-style nested settings screens.

### D-007 --- Risk-based validation

**Decision:** UI refinement uses focused validation for ordinary visual
work and broader suites only when risk warrants them.

------------------------------------------------------------------------

## 29. Definition of a Successful Rooomly Screen

A successful screen allows a user to quickly answer:

1.  Where am I?
2.  What am I looking at?
3.  What matters right now?
4.  What can I do next?
5.  Where can I find additional detail if I need it?

The user should not need an explanatory paragraph to understand normal
operation.

The interface should be visually composed enough to feel premium, but
restrained enough that content and actions remain dominant.

------------------------------------------------------------------------

# Final Product Design Principle

Rooomly is not being redesigned to look fashionable.

It is being refined so that a sophisticated Ghanaian rental and
property-management system feels **obvious, trustworthy, fast, and
enjoyable to operate**.

Use the right amount of information.

Use the right layout.

Use the right interaction surface.

Use cards when cards are best.

Use grids when grids are best.

Use tables when tables are best.

Use modals or sheets when a new page would be unnecessary.

Use search, filtering, and sorting when collections require them.

Keep navigation predictable.

Keep copy concise.

Keep domain complexity underneath the interface.

And refine the product **one coherent area at a time**, allowing user
testing before moving forward.
