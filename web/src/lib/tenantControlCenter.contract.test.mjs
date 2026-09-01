/**
 * The tenant control center, on both clients.
 *
 * The IA it already had is the part worth protecting: four questions, in order,
 * with one ranked attention block rather than a stack of banners. These tests
 * pin the two things added on top of it — a skeleton shaped like the card it
 * replaces, and shortcuts on the client that has no navigation shell — and the
 * reason notifications are *not* a second attention block.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const webHome = () => read("web/app/home/page.tsx");
const webCss = () => read("web/src/styles/home-workspace.css");
const mobileHome = () => read("mobile/src/components/home/TenantHome.tsx");
const mobileScreen = () => read("mobile/app/(app)/(tabs)/index.tsx");

test("the wait is the shape of what is coming, on both clients", () => {
  // Generic loading rows moved the page under the reader when data landed.
  assert.match(code(webHome()), /<TenantHomeSkeleton \/>/);
  assert.doesNotMatch(code(webHome()), /tenancies === null \? \(\s*<LoadingRows/);
  // Two panels and a surface, in the places they will occupy.
  assert.match(webCss(), /\.home-skeleton-grid \{/);
  assert.match(webCss(), /\.home-skeleton-pulse \{/);

  assert.match(code(mobileHome()), /<HomeSkeleton \/>/);
  assert.doesNotMatch(code(mobileHome()), /Loading your homes…/);
  const skeleton = read("mobile/src/components/home/HomeSkeleton.tsx");
  assert.match(skeleton, /accessibilityRole="progressbar"/);
});

test("the pulse stops when the reader has asked it to", () => {
  const skeleton = read("mobile/src/components/home/HomeSkeleton.tsx");
  assert.match(skeleton, /useReduceMotion/);
  assert.match(skeleton, /if \(reduceMotion\)/);
  assert.match(webCss(), /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}animation: none/);

  // One implementation of the question, not one per animation.
  const hook = read("mobile/src/motion.ts");
  assert.match(hook, /export function useReduceMotion/);
  assert.match(hook, /reduceMotionChanged/);
  assert.match(read("mobile/src/components/nav/MainTabBar.tsx"), /useReduceMotion/);
  assert.doesNotMatch(
    code(read("mobile/src/components/nav/MainTabBar.tsx")),
    /function useReduceMotion/,
  );
});

test("shortcuts exist where there is no shell, and nowhere else", () => {
  // Mobile has no persistent navigation beside the content, so the rest of the
  // tenant's rental life needs a way in from Home.
  assert.match(code(mobileHome()), /<HomeShortcuts/);
  const shortcuts = read("mobile/src/components/home/HomeShortcuts.tsx");
  assert.match(shortcuts, /EVERYTHING ELSE/);

  // Deeper rental management, not the tab bar restated one screen up.
  for (const label of ["Agreements", "Applications", "Updates"]) {
    assert.match(code(mobileHome()), new RegExp(`label: "${label}"`));
  }
  // Payments, Saved and Explore are tabs. A shortcut to a tab is a duplicate.
  const tabs = read("mobile/app/(app)/(tabs)/_layout.tsx");
  for (const tab of ["payments", "saved", "explore"]) {
    assert.match(tabs, new RegExp(`name="${tab}"`), `${tab} should still be a tab`);
    assert.doesNotMatch(
      code(mobileHome()),
      new RegExp(`id: "${tab}"`),
      `${tab} is a tab; Home must not shortcut to it`,
    );
  }

  // Payments is the multi-home tab, while the focused rent account stays
  // attached to each home card and still rejects an absent lease id.
  assert.match(code(mobileHome()), /onRentAccount=\{\(\) => onRentAccount\(tenancy\)\}/);
  assert.match(
    read("mobile/app/(app)/rent-account.tsx"),
    /if \(!leaseId\) \{ setError\("This rent account could not be found\."\)/,
  );

  // Web already carries every one of those in persistent left-hand navigation,
  // so repeating them along the bottom of Home would be the generic dashboard
  // grid this product is explicitly not.
  assert.doesNotMatch(code(webHome()), /HomeShortcuts|tenant-home-shortcut/);
  assert.doesNotMatch(webCss(), /tenant-home-shortcut/);
  const nav = read("web/src/lib/portalNav.ts");
  for (const href of ["/rentals", "/saved", "/updates", "/applications", "/leases"]) {
    assert.match(nav, new RegExp(`href: "${href}"`));
  }
});

test("a count appears only when there is something to count", () => {
  const shortcuts = read("mobile/src/components/home/HomeShortcuts.tsx");
  // "Saved · 0" is not information, and a row of zeroes reads as a product
  // nobody uses.
  assert.match(shortcuts, /typeof shortcut\.count === "number" && shortcut\.count > 0/);
});

test("notifications are not a second attention block", () => {
  // Home derives what is outstanding from the records themselves. The
  // notification module defers to it in as many words, and every actionable
  // kind it lists is already covered by `attention()`.
  const meaning = read("mobile/src/notificationMeaning.ts");
  // The sentence wraps across two JSDoc lines, so flatten the break and the
  // leading asterisk before matching.
  const flat = (text) => text.replace(/[\s*]+/g, " ");
  assert.match(flat(meaning), /Home is what actually knows what is outstanding/);
  for (const kind of ["viewing.requested", "application.submitted", "lease.offered"]) {
    assert.match(meaning, new RegExp(kind.replace(".", "\\.")));
  }
  const home = read("mobile/src/homeMeaning.ts");
  assert.match(home, /viewingsWaiting/);
  assert.match(home, /applicationsWaiting/);
  assert.match(home, /offeredLeases/);

  // So Updates is a shortcut, never an attention item. Against stripped code:
  // the module's own prose mentions notifications, to explain that a rejected
  // access request never emits one.
  assert.doesNotMatch(code(home), /notification/i);
  assert.doesNotMatch(code(mobileHome()), /Needs attention[\s\S]{0,400}notification/i);
});

test("a missing count never costs somebody their rent summary", () => {
  // The counts ride along with the existing tolerant batch, each with its own
  // catch, so neither can fail the load that Home actually exists for.
  const screen = code(mobileScreen());
  assert.match(screen, /listNotifications\(\)\.catch\(\(\) => \(\{ unread_count: 0/);
  assert.match(screen, /listMyTenancies\(\),/);
  // One read, two jobs: the unread count and the activity feed.
  assert.match(screen, /setUnreadNotifications\(updates\.unread_count\)/);
  assert.match(screen, /setRecentActivity\(updates\.results\)/);
  assert.doesNotMatch(screen, /listSaved/);
});

test("the schedule and the history are drawn as opposites", () => {
  // They were both plain two-line rows in identical type, which is why they
  // read as one long list with a heading in the middle of it.
  const coming = read("mobile/src/components/home/ComingUp.tsx");
  const activity = read("mobile/src/components/home/RentalActivity.tsx");

  // Coming Up is dated: a left rail with a date and a connecting rule.
  assert.match(coming, /COMING UP/);
  assert.match(coming, /function whenLabel/);
  assert.match(coming, /index < entries\.length - 1/);

  // Recent activity is past tense: a relative time trailing each line.
  assert.match(activity, /title="Recent activity"/);
  assert.match(activity, /timeAgo\(item\.created_at\)/);
  assert.doesNotMatch(code(activity), /whenLabel|Tomorrow/);

  // Future and past never share a source.
  assert.match(code(read("mobile/src/components/home/TenantHome.tsx")), /<ComingUp entries=\{upcoming\}/);
  assert.match(code(read("mobile/src/components/home/TenantHome.tsx")), /<RentalActivity items=\{recentActivity\}/);
});

test("the history is rental history, and costs nothing extra", () => {
  const activity = read("mobile/src/components/home/RentalActivity.tsx");
  // Provider-side and account noise must never appear on a tenant's home.
  assert.match(activity, /TENANT_HISTORY = \/\^\(lease\|application\|viewing\|payment\|tenancy_request\)/);
  assert.doesNotMatch(code(activity), /organization\./);

  // Read or unread makes no difference to a history.
  assert.doesNotMatch(code(activity), /is_read|read_at|needsYou/);

  // And it reuses the page already fetched for the unread count.
  assert.equal(
    (code(read("mobile/app/(app)/(tabs)/index.tsx")).match(/listNotifications\(/g) ?? []).length,
    1,
  );
});

test("rent leads the Overview, and its parts are never lost", () => {
  const home = code(read("mobile/src/components/home/TenantHome.tsx"));

  // The display-size amount used to be a `RentBlock` inside every home card.
  // With the homes drawn as rows in one card, that lead moved to the account's
  // own figure: the total, on the one surface that speaks for the account.
  const moneyAt = home.indexOf("accessibilityLabel={`${owed.formatted} owed in total`}");
  assert.ok(moneyAt > 0, "the Overview's money block is missing");
  const money = home.slice(moneyAt, home.indexOf("<Register", moneyAt));
  assert.ok(money.length > 200, "failed to isolate the Overview's money block");
  assert.match(money, /OWED IN TOTAL/);
  assert.match(money, /fontSize: density\.compact \? 28 : 32/);
  // The label turns brick the moment anything is outstanding; the figure stays
  // ink, because colouring the amount made the number look like the warning.
  assert.match(money, /color: owed\.minor \? ph\.brick : ph\.ink38/);
  assert.match(money, /letterSpacing: -0\.6, color: ph\.ink \}/);
  // State is said in words as well as colour, in the surface's own badge.
  for (const word of ["Rent overdue", "Rent scheduled", "Nothing due"]) {
    assert.match(home, new RegExp(`text: "${word}"`));
  }

  // And the total is traceable: one row per home, each with its own figure,
  // its own due date and the focused rent account for that agreement.
  assert.match(home, /ranked\.map\(\(tenancy\) => \(/);
  assert.match(home, /overdue \$\{shortDate\(due\.due_on\)\}/);
  assert.match(home, /Rent account for \$\{unit\}/);
  assert.match(home, /onRentAccount=\{\(\) => onRentAccount\(tenancy\)\}/);
  // Still no "current" tenancy and no selector that hides one behind another.
  assert.doesNotMatch(home, /currentTenancy/);
});

test("the ambiguous plus is gone, and joining is not", () => {
  const home = code(read("mobile/src/components/home/TenantHome.tsx"));
  // A round "+" beside the greeting could have meant add a home, add a payment
  // or add anything at all.
  assert.doesNotMatch(home, /name="add"/);
  assert.doesNotMatch(home, /borderRadius: 22/);

  // But it was the only entry point to `tenant-setup` for a tenant who already
  // has a home, so removing it outright would have removed the ability to join
  // a second tenancy.
  assert.match(home, /function JoinAnother/);
  assert.match(home, /<JoinAnother onJoin=\{onJoin\} \/>/);
  assert.match(home, /onJoin/);
  const profile = read("mobile/app/(app)/(tabs)/profile.tsx");
  assert.doesNotMatch(profile, /tenant-setup/, "still no other way in from Profile");
});

test("both clients drop the standalone Rental activity section", () => {
  // With homes on screen it sat between the schedule and the shortcuts saying
  // very little, in rows that looked exactly like the schedule's.
  for (const source of [code(webHome()), code(mobileHome())]) {
    assert.doesNotMatch(source, /Rental activity/);
  }

  // The rows survive in the empty state, where they are the whole point:
  // without a tenancy they answer "what is happening with the places I asked
  // about", and dropping them would make a submitted application invisible.
  assert.match(code(webHome()), /<h2>In progress<\/h2>/);
  assert.match(code(mobileHome()), /<Group heading="In progress">/);
  for (const source of [code(webHome()), code(mobileHome())]) {
    assert.match(source, /function NoTenancy\(/);
  }

  // A pending access request remains in that empty-state summary. Once the
  // tenant has a home, the summary is intentionally absent.
  for (const source of [code(webHome()), code(mobileHome())]) {
    assert.match(source, /Access request/);
    assert.match(source, /pendingJoin\[0\]!\.property_title/);
  }
  assert.match(read("mobile/src/homeMeaning.ts"), /request\.status !== "rejected"/);
});

test("web gives rent the same lead mobile does", () => {
  const css = webCss();
  const page = code(webHome());
  // Rent is the first thing on the primary surface and the only instrument on
  // the page: how long until it is due, with the amount a hover away.
  assert.doesNotMatch(page, /tenant-home-facts/);
  assert.doesNotMatch(css, /\.tenant-home-facts/);

  // Money is the first pair of figures on the primary surface, set in the
  // display face, and it turns brick the moment any of it is late.
  assert.match(page, /label=\{owed\.minor \? "Owed in total" : "Owed"\}/);
  // The card speaks for the whole account, so nothing on it names one home or
  // one locality — that is the list below's job.
  assert.doesNotMatch(page, /homeWhere\(leadHome/);
  assert.match(page, /plural\(activeLeases, "Active agreement", "Active agreements"\)/);
  assert.match(page, /label=\{owed\.earliest \? \(owed\.overdue \? "Overdue since" : "Earliest due"\)/);
  assert.match(page, /tone=\{owed\.overdue \? "overdue" : undefined\}/);
  // The label carries the state and the figure carries the fact: colouring the
  // amount too made the number itself look like the warning.
  assert.match(
    css,
    /\[data-tone="owed"\] small,\s*\.home-pulse-metric\[data-static="true"\]\[data-tone="overdue"\] small \{ color: var\(--ph-brick\)/,
  );
  assert.doesNotMatch(css, /\[data-tone="owed"\] strong/);
  assert.match(css, /\.home-pulse-metric\[data-figure="true"\] strong/);

  // Money outstanding is marked before it is late; nothing owed is left alone,
  // because a red zero would be alarming about good news.
  assert.match(page, /tone=\{owed\.overdue \? "overdue" : owed\.minor \? "owed" : undefined\}/);

  // The state is said in words as well as colour, in the surface's own badge.
  assert.match(page, /"Rent overdue" : "Rent scheduled"/);
});

test("Coming Up is a rail on web too, and it spans the page", () => {
  const css = webCss();
  const page = code(webHome());

  // It is a primary surface across the full width now rather than a narrow
  // column beside the homes: what happens next is the second question this
  // screen exists to answer, and it was being given the offcut.
  assert.match(page, /className="home-finance-chart tenant-schedule"/);
  assert.match(page, /className="tenant-timeline"/);

  // A date column, a rule with a mark on it, and what is happening.
  assert.match(css, /\.tenant-timeline li \{[\s\S]{0,200}grid-template-columns: 6\.5rem 1\.25rem minmax\(0, 1fr\)/);
  assert.match(page, /<span className="tenant-timeline-mark" aria-hidden="true" \/>/);
  assert.match(css, /\.tenant-timeline-mark::before/);

  // The rule is the element, not a pseudo-child that would take a grid slot.
  assert.doesNotMatch(css, /\.tenant-timeline li::before/);

  // Nothing scheduled says so, rather than drawing an empty rail.
  assert.match(page, /Nothing scheduled\./);
});

test("the two columns are two regions, not one crowded block", () => {
  const css = webCss();
  // Regions are separated by being separate surfaces on a darker ground, which
  // is the whole reason the page has a ground: paper against stone does the
  // work that a hairline and ever more air were doing.
  assert.match(css, /\.home-overview-grid \{[\s\S]{0,160}grid-template-columns: minmax\(0, 1\.15fr\) minmax\(19rem, \.85fr\)/);
  assert.match(css, /\.portal-workspace\.is-dashboard \{\s*background: var\(--ph-stone\)/);
  assert.match(css, /--ph-paper: #fcfbf7/);
});

test("the page reflows against its column, never against the window", () => {
  const css = webCss();
  const page = code(webHome());

  // A viewport breakpoint would be wrong here: the rail beside this content is
  // 16.5rem and collapses at 48rem, so the same viewport gives the content
  // wildly different widths.
  assert.match(css, /container: provider-home \/ inline-size/);
  assert.match(css, /@container provider-home \(max-width: 68rem\)/);
  assert.match(read("web/src/styles/portal.css"), /width: 16\.5rem/);

  // The overview and attention lead, side by side; the schedule spans beneath
  // them; the homes and what is in flight close the page.
  const rentAt = page.indexOf('aria-labelledby="tenant-overview-title"');
  const attentionAt = page.indexOf('aria-labelledby="tenant-attention-title"');
  const scheduleAt = page.indexOf('aria-labelledby="tenant-schedule-title"');
  const homesAt = page.indexOf('className="home-rows tenant-homes"');
  assert.ok(rentAt > 0 && rentAt < attentionAt, "the overview leads");
  assert.ok(attentionAt < scheduleAt, "attention sits above the schedule");
  assert.ok(scheduleAt < homesAt, "the schedule sits above the homes");
});

test("a tenant with homes goes straight from the tenancy cards to joining another home", () => {
  const web = code(webHome());
  const webHomes = web.slice(web.indexOf('className="home-rows tenant-homes"'), web.indexOf("tenant-progress"));
  assert.ok(webHomes.length > 200, "failed to isolate the web homes section");
  assert.doesNotMatch(webHomes, /InFlight|application[s]? out|Access request waiting on/);
  assert.doesNotMatch(webCss(), /tenant-home-inflight/);
  // Joining is the page's one contextual action, on the Overview card. The
  // page-level bar it used to sit in is gone: a whole sticky row for one button
  // was chrome, and the card is where the account-level facts already are.
  assert.match(web, /href="\/tenant\/setup" className="home-primary-action[^"]*"/);
  assert.doesNotMatch(web, /className="home-topbar"/);

  const mobile = code(mobileHome());
  const homesAt = mobile.indexOf('title={tenancies.length > 1 ? "My homes"');
  const scheduleAt = mobile.indexOf("<ComingUp entries=");
  assert.ok(homesAt > 0 && scheduleAt > homesAt, "failed to isolate the mobile homes card");
  const mobileHomes = mobile.slice(homesAt, scheduleAt);
  assert.ok(mobileHomes.length > 200, "the mobile homes card is suspiciously short");
  assert.doesNotMatch(mobileHomes, /application[s]? out|Access request waiting on/);
  assert.match(mobileHomes, /<JoinAnother onJoin=\{onJoin\} \/>/);

  // Without a tenancy, active requests remain useful lifecycle context rather
  // than duplicated clutter beneath cards for homes the tenant already has: on
  // web the panel is rendered only when something really is in flight, and it
  // never carries a permanent Explore row the shell's navigation already has.
  assert.match(web, /\{inFlight \? \(/);
  assert.match(web, /const inFlight = openApplications\.length/);
  const lowerAt = web.indexOf('data-single={inFlight === 0}');
  const afterHome = web.indexOf('function rankHomes');
  assert.ok(lowerAt > 0 && afterHome > lowerAt, "failed to isolate the web lower row");
  // Bounded to the rendered lower row: `NoTenancy` below it offers Explore
  // to somebody with no home, which is the whole point of that state.
  assert.doesNotMatch(web.slice(lowerAt, afterHome), /Explore rentals/);
  assert.match(mobile, /function Activity\(/);
});
