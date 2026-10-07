import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { isLive, standing as applicationStanding } from "@/applicationMeaning";
import type { RentalApplication } from "@/applications";
import { Button, Notice, Type, radius, space } from "@/components/ui";
import {
  ActivityItem,
  CardList,
  Cell,
  CellRule,
  DayTile,
  Highlights,
  INK,
  MUTED,
  NextMoves,
  PRESSED,
  Section,
  StatCells,
  TONE,
  Well,
  WHITE,
  dash,
  type ActivityRow,
  type IconName,
  type ToneName,
} from "@/components/home/DashboardParts";
import { HomeSkeleton } from "@/components/home/HomeSkeleton";
import { HomeShortcuts, type Shortcut } from "@/components/home/HomeShortcuts";
import { plural, shortDate, useHomeDensity } from "@/components/home/plinth";
import { timeAgo, type Notification } from "@/notifications";
import {
  attention,
  comingUp,
  homeSpace,
  homeWhere,
  rentLine,
  type AttentionItem,
  type UpcomingEntry,
} from "@/homeMeaning";
import type { Lease } from "@/leases";
import { formatMinor } from "@/listings";
import { pressableFeedback } from "@/platform";
import type { MyJoinRequest, Tenancy } from "@/tenancy";
import { moveIcon, moveTone, rankMoves, tenantHighlights } from "@/tenantHomeWork";
import { standing as viewingStanding, whenLabel } from "@/viewingMeaning";
import type { Viewing } from "@/viewings";

/**
 * The tenant's Home, built from the same parts as the provider's (owner,
 * 2026-10-06), in the order a tenant reads it:
 *
 * 1. **Your next move.** The costliest thing waiting leads with its verb as a
 *    button — rent overdue, then an agreement to review — and the rest wait
 *    under it as rows.
 * 2. **Overview.** What they owe across every home, as the page's one big
 *    figure, over a straight line of counts that each open their list.
 * 3. **Highlights.** Where each agreement has got to, and how the applications
 *    went, each on a card whose corner arc draws the reading. The half dial
 *    that used to sit in the Overview lives on here as that arc.
 * 4. **My home(s)**, each a row whose amount opens its rent account.
 * 5. **Coming up** and **Recent activity**, each a short list that scans.
 *
 * Someone with no tenancy gets two ways forward and what they have in
 * flight — no Overview, because an empty module is not information.
 *
 * **A total is offered, and its parts are never lost.** The Overview adds
 * every home's outstanding rent in minor units, never by parsing a formatted
 * amount, and every home keeps its own row with its own figure, so the total
 * can always be traced back. There is no "current" tenancy and no selector
 * that hides one behind another; `src/tenancy.ts` says why.
 */
export function TenantHome({
  tenancies,
  applications,
  viewings,
  leases,
  joinRequests,
  loading,
  error,
  onJoin,
  onExplore,
  onTenancy,
  onAgreements,
  onViewings,
  onApplications,
  unreadNotifications,
  recentActivity,
  onNotifications,
  onRentAccount,
}: {
  tenancies: Tenancy[];
  applications: RentalApplication[];
  viewings: Viewing[];
  leases: Lease[];
  joinRequests: MyJoinRequest[];
  loading: boolean;
  error: string;
  onJoin: () => void;
  onExplore: () => void;
  onTenancy: (tenancy: Tenancy) => void;
  onAgreements: () => void;
  onViewings: () => void;
  onApplications: () => void;
  unreadNotifications: number;
  recentActivity: Notification[];
  onNotifications: () => void;
  onRentAccount: (tenancy: Tenancy) => void;
}) {
  const [openedAt] = useState(() => Date.now());
  const viewingsWaiting = viewings
    .map((viewing) => ({ viewing, state: viewingStanding(viewing) }))
    .filter((row) => row.state.group === "action")
    .map((row) => ({
      id: row.viewing.id,
      headline: row.viewing.listing_headline,
      action: row.state.line,
    }));
  const applicationsWaiting = applications
    .map((application) => ({ application, state: applicationStanding(application, leases) }))
    .filter((row) => row.state.stage === "action")
    .map((row) => ({
      id: row.application.id,
      headline: row.application.listing_headline,
      action: row.state.line,
    }));

  const needs = rankMoves(attention({
    tenancies,
    offeredLeases: leases.filter((lease) => lease.status === "offered"),
    viewingsWaiting,
    applicationsWaiting,
    joinRequests,
  }));
  const upcoming = comingUp({ tenancies, viewings });
  const openApplications = applications.filter((row) => isLive(row));
  const nextViewing = viewings
    .filter((row) => row.confirmed_starts_at && row.is_upcoming)
    .sort((a, b) => (a.confirmed_starts_at ?? "").localeCompare(b.confirmed_starts_at ?? ""))[0];
  const pendingJoin = joinRequests.filter((row) => row.status === "pending");
  const ranked = rankHomes(tenancies);
  const owed = totalOwed(tenancies);
  const accepted = applications.filter((row) => row.status === "accepted").length;
  const activeLeases = leases.filter((row) => row.status === "active").length;
  const booked = viewings.filter((row) => row.confirmed_starts_at && row.is_upcoming).length;
  const open = (item: AttentionItem) => {
    if (item.destination === "tenancy" && item.targetId) {
      const tenancy = tenancies.find((row) => row.id === item.targetId);
      if (tenancy) return onRentAccount(tenancy);
    }
    if (item.destination === "agreements" || item.destination === "tenancy") return onAgreements();
    if (item.destination === "viewings") return onViewings();
    if (item.destination === "applications") return onApplications();
    return onExplore();
  };

  const readings = tenantHighlights({
    tenancies: ranked.map((tenancy) => ({
      id: tenancy.id,
      status: tenancy.status,
      starts_on: tenancy.lease?.starts_on ?? tenancy.starts_on,
      ends_on: tenancy.lease?.ends_on ?? tenancy.ends_on,
      name: homeSpace(tenancy) || tenancy.property.title,
    })),
    // The home whose rent comes first: overdue, then soonest due.
    rent: ranked[0] ? {
      tenancyId: ranked[0].id,
      name: homeSpace(ranked[0]) || ranked[0].property.title,
      amount: ranked[0].rent?.next_due?.amount_formatted ?? (ranked[0].rent?.outstanding_minor ? ranked[0].rent.outstanding_formatted : null),
      dueOn: ranked[0].rent?.next_due?.due_on ?? null,
      overdue: Boolean(ranked[0].rent?.next_due?.is_overdue),
      owedMinor: ranked[0].rent?.outstanding_minor ?? 0,
    } : null,
    now: openedAt,
    date: shortDate,
  });

  const history: ActivityRow[] = recentActivity
    .filter((item) => TENANT_HISTORY.test(item.kind))
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      title: item.title,
      line: item.body,
      icon: activityIcon(item.kind),
      tone: activityTone(item.kind),
      when: timeAgo(item.created_at),
      status: null,
    }));

  if (loading && tenancies.length === 0) {
    return (
      <View style={{ gap: space[6] }}>
        {error ? <Notice tone="error" title={error} /> : null}
        <HomeSkeleton />
      </View>
    );
  }

  if (tenancies.length === 0) {
    return (
      <View style={{ gap: space[6] }}>
        {error ? <Notice tone="error" title={error} /> : null}
        <NoTenancy
          applications={openApplications.length}
          nextViewing={nextViewing ?? null}
          pendingJoin={pendingJoin}
          onExplore={onExplore}
          onJoin={onJoin}
          onApplications={onApplications}
          onViewings={onViewings}
        />
        <Shortcuts onAgreements={onAgreements} onApplications={onApplications} onNotifications={onNotifications} unread={unreadNotifications} />
      </View>
    );
  }

  return (
    <View style={{ gap: space[6] }}>
      {error ? <Notice tone="error" title={error} /> : null}

      <Section title="Your next move" meta={needs.length ? `${needs.length} waiting` : undefined}>
        <NextMoves
          moves={needs.map((item) => ({
            key: item.id,
            title: item.title,
            detail: item.place,
            act: item.action,
            icon: moveIcon(item.kind),
            tone: moveTone(item.kind),
            onPress: () => open(item),
          }))}
          calm={{ title: "Nothing is waiting on you", hint: "Rent, agreements and viewings are up to date." }}
        />
      </Section>

      <Section title="Overview">
        <Overview
          owed={owed}
          homes={tenancies.length}
          agreements={activeLeases}
          applications={applications.length}
          accepted={accepted}
          viewings={booked}
          onHomes={() => (ranked[0] ? onTenancy(ranked[0]) : onAgreements())}
          onAgreements={onAgreements}
          onApplications={onApplications}
          onViewings={onViewings}
        />
      </Section>

      {readings.length ? (
        <Section title="Highlights">
          <Highlights
            items={readings.map((reading) => ({
              ...reading,
              onPress: () => {
                const tenancy = tenancies.find((row) => row.id === reading.tenancyId);
                if (!tenancy) return;
                if (reading.to === "rent" && tenancy.lease) onRentAccount(tenancy);
                else onTenancy(tenancy);
              },
            }))}
          />
        </Section>
      ) : null}

      <Section title={tenancies.length > 1 ? "My homes" : "My home"} meta={tenancies.length > 1 ? `${tenancies.length}` : undefined}>
        <CardList>
          {[
            ...ranked.map((tenancy) => (
              <HomeRow
                key={tenancy.id}
                tenancy={tenancy}
                onPress={() => onTenancy(tenancy)}
                onRentAccount={() => onRentAccount(tenancy)}
              />
            )),
            <JoinAnother key="join" onJoin={onJoin} />,
          ]}
        </CardList>
      </Section>

      {upcoming.length ? (
        <Section title="Coming up" link={{ label: "All viewings", onPress: onViewings }}>
          <CardList>
            {upcoming.map((entry) => <UpcomingRow key={entry.id} entry={entry} onViewings={onViewings} />)}
          </CardList>
        </Section>
      ) : null}

      {history.length ? (
        <Section title="Recent activity" link={{ label: "Updates", onPress: onNotifications }}>
          <CardList>
            {history.map((row) => <ActivityItem key={row.id} row={row} />)}
          </CardList>
        </Section>
      ) : null}

      <Shortcuts onAgreements={onAgreements} onApplications={onApplications} onNotifications={onNotifications} unread={unreadNotifications} />
    </View>
  );
}

/**
 * Deeper rental management, not the tab bar restated. Explore, Saved and
 * Payments are all one tap away on the bar below; each home row still owns its
 * focused per-agreement rent account.
 */
function Shortcuts({
  onAgreements,
  onApplications,
  onNotifications,
  unread,
}: {
  onAgreements: () => void;
  onApplications: () => void;
  onNotifications: () => void;
  unread: number;
}) {
  return (
    <HomeShortcuts
      shortcuts={[
        { id: "leases", label: "Agreements", icon: "document-text-outline", onPress: onAgreements },
        { id: "applications", label: "Applications", icon: "reader-outline", onPress: onApplications },
        { id: "notifications", label: "Updates", icon: "notifications-outline", onPress: onNotifications, count: unread },
      ] satisfies Shortcut[]}
    />
  );
}

/* --- the account, at a glance -------------------------------------------- */

type Owed = {
  minor: number;
  formatted: string;
  overdue: boolean;
  earliest: string | null;
};

/**
 * What this person owes across every home they rent.
 *
 * Summed in minor units, which is why the payload carries them: adding two
 * tenancies from `amount_formatted` would mean parsing "GH₵1,500.00" back into
 * a number, and money is added as integers or not at all.
 */
function totalOwed(homes: Tenancy[]): Owed {
  let minor = 0;
  let overdueHomes = 0;
  let earliest: string | null = null;
  let currency = "GHS";

  for (const home of homes) {
    const rent = home.rent;
    if (!rent) continue;
    minor += rent.outstanding_minor ?? 0;
    if (rent.outstanding_currency) currency = rent.outstanding_currency;
    const due = rent.next_due;
    if (!due) continue;
    if (due.is_overdue) overdueHomes += 1;
    if (!earliest || due.due_on < earliest) earliest = due.due_on;
  }

  return { minor, formatted: formatMinor(minor, currency), overdue: overdueHomes > 0, earliest };
}

/** Overdue first, then soonest due, then whatever order they arrived in. */
export function rankHomes(homes: Tenancy[]): Tenancy[] {
  return [...homes].sort((left, right) => {
    const a = rentLine(left);
    const b = rentLine(right);
    const weight = (line: ReturnType<typeof rentLine>) =>
      line?.tone === "overdue" ? 0 : line?.tone === "due" ? 1 : 2;
    if (weight(a) !== weight(b)) return weight(a) - weight(b);
    return (a?.when ?? "9999").localeCompare(b?.when ?? "9999");
  });
}

/**
 * The account, added up: what is owed across every home as the page's one big
 * figure, its state in a pill, and the counts behind the account on one line.
 *
 * Money leads, because it is the fact this card exists to carry and the only
 * one whose cost grows. The figure stays ink and the pill carries the colour:
 * a coloured amount looks like the warning rather than the fact. Nothing owed
 * is said in green, never as a red zero.
 */
function Overview({
  owed,
  homes,
  agreements,
  applications,
  accepted,
  viewings,
  onHomes,
  onAgreements,
  onApplications,
  onViewings,
}: {
  owed: Owed;
  homes: number;
  agreements: number;
  applications: number;
  accepted: number;
  viewings: number;
  onHomes: () => void;
  onAgreements: () => void;
  onApplications: () => void;
  onViewings: () => void;
}) {
  // A 320px phone fits the figure beside its pill only a size down; the web cannot shrink it to fit.
  const narrow = useHomeDensity().veryCompact;
  const state: { text: string; tone: ToneName } = owed.minor
    ? owed.overdue
      ? { text: "Overdue", tone: "danger" }
      : { text: "Scheduled", tone: "warning" }
    : { text: "All paid", tone: "calm" };
  const note = owed.earliest
    ? `${owed.overdue ? "Overdue since" : "Next due"} ${shortDate(owed.earliest)}`
    : owed.minor
      ? "No date set yet"
      : "Nothing outstanding on any home";

  return (
    <View style={dash.card}>
      <View accessible accessibilityLabel={`${owed.formatted} owed in total. ${note}.`} style={styles.owedHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Type variant="caption" style={{ color: MUTED }}>Owed in total</Type>
          <Type variant="display2" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.owed, narrow ? { fontSize: 27, lineHeight: 33 } : null]}>
            {owed.formatted}
          </Type>
          <Type variant="caption" numberOfLines={1} style={{ color: owed.overdue ? TONE.danger.ink : MUTED }}>{note}</Type>
        </View>
        <View style={[styles.pill, { backgroundColor: TONE[state.tone].wash }]}>
          <View style={[styles.pillDot, { backgroundColor: TONE[state.tone].ink }]} />
          <Type variant="captionStrong" style={[styles.pillText, { color: TONE[state.tone].ink }]}>{state.text}</Type>
        </View>
      </View>
      {applications ? <View style={[dash.rule, { marginLeft: 0, marginTop: space[4] }]} /> : null}
      {applications ? <ApplicationDial total={applications} accepted={accepted} onPress={onApplications} /> : null}
      <StatCells>
        <Cell label={plural(homes, "Home", "Homes")} value={homes} onPress={onHomes} />
        <CellRule />
        <Cell label={plural(agreements, "Agreement", "Agreements")} value={agreements} onPress={onAgreements} />
        <CellRule />
        <Cell label={plural(applications, "Application", "Applications")} value={applications} onPress={onApplications} />
        <CellRule />
        <Cell label={plural(viewings, "Viewing", "Viewings")} value={viewings} onPress={onViewings} />
      </StatCells>
    </View>
  );
}

/**
 * Applications, and how many were accepted — kept from the earlier Home and
 * refined (owner, 2026-10-06).
 *
 * A half dial rather than a full ring, because the quantity has a floor and a
 * ceiling a person can see at once — none accepted at the left stop, all of
 * them at the right — and a full circle reads as a share of a whole, which an
 * application count is not. Now in the Homes' colours: a pale track, the
 * accepted share in green with rounded ends and a knob at the reading, and no
 * gold register or caliper mark.
 */
function ApplicationDial({ total, accepted, onPress }: { total: number; accepted: number; onPress: () => void }) {
  const density = useHomeDensity();
  const share = Math.max(0, Math.min(1, accepted / total));
  const width = density.compact ? 112 : 124;
  const height = width * 0.6;
  const stroke = 12;
  const cx = 100;
  const cy = 100;
  const r = 82;
  // Left to right across the top: 180 degrees at none, 360 at all of them.
  const at = (share: number) => {
    const angle = Math.PI + share * Math.PI;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  const arc = (to: number) => {
    const start = at(0);
    const end = at(to);
    return `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`;
  };
  const knob = at(share);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${accepted} of ${total} ${plural(total, "application", "applications")} accepted`}
      accessibilityHint="Open your applications"
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.dial, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={{ width, height }}>
        <Svg width={width} height={height} viewBox="0 0 200 120">
          <Path d={arc(1)} fill="none" stroke={TONE.kola.wash} strokeWidth={stroke} strokeLinecap="round" />
          {share > 0 ? <Path d={arc(share)} fill="none" stroke={TONE.kola.ink} strokeWidth={stroke} strokeLinecap="round" /> : null}
          <Circle cx={knob.x} cy={knob.y} r={stroke * 0.8} fill={share > 0 ? TONE.kola.ink : WHITE} stroke={share > 0 ? WHITE : TONE.kola.wash} strokeWidth={3} />
        </Svg>
        {/* The reading sits inside the arc, on its baseline, between its two stops. */}
        <View pointerEvents="none" style={styles.dialReading}>
          <Type variant="display2" style={styles.dialFigure}>{accepted}</Type>
        </View>
        <View pointerEvents="none" style={styles.dialStops}>
          <Type variant="caption" style={styles.dialStop}>0</Type>
          <Type variant="caption" style={styles.dialStop}>{total}</Type>
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Type variant="caption" style={{ color: MUTED }}>Applications</Type>
        <Type variant="bodyStrong" numberOfLines={2} style={styles.dialLine}>{accepted} of {total} accepted</Type>
      </View>
      <Ionicons name="chevron-forward" size={16} color={MUTED} />
    </Pressable>
  );
}

/**
 * One home, as a row.
 *
 * The Unit leads: a tenant lives in Flat 2A, and East Legon Heights is where
 * Flat 2A is. The row and its money are two controls, not one: the row opens
 * the tenancy, and the amount opens that agreement's rent account — the ledger
 * the Overview's total can be traced back through.
 */
function HomeRow({
  tenancy,
  onPress,
  onRentAccount,
}: {
  tenancy: Tenancy;
  onPress: () => void;
  onRentAccount: () => void;
}) {
  // A 320px phone has no room for the place and the money side by side, so the money goes under it.
  const narrow = useHomeDensity().veryCompact;
  const rent = tenancy.rent;
  const due = rent?.next_due ?? null;
  const amount = rent?.outstanding_minor ? rent.outstanding_formatted : null;
  const note = !due
    ? amount ? "outstanding" : "nothing due"
    : due.is_overdue
      ? `overdue ${shortDate(due.due_on)}`
      : `due ${shortDate(due.due_on)}`;
  const tone: ToneName = due?.is_overdue ? "danger" : amount ? "warning" : "calm";
  const unit = homeSpace(tenancy) || tenancy.property.title;
  const where = [homeSpace(tenancy) ? tenancy.property.title : null, homeWhere(tenancy)]
    .filter(Boolean)
    .join(" · ");
  const money = (
    <View style={{ alignItems: "flex-end", gap: 3 }}>
      <Type variant="bodyStrong" numberOfLines={1} style={styles.amount}>{amount ?? "—"}</Type>
      <View style={[styles.chip, { backgroundColor: TONE[tone].wash }]}>
        <Type variant="captionStrong" numberOfLines={1} style={[styles.chipText, { color: TONE[tone].ink }]}>{note}</Type>
      </View>
    </View>
  );

  return (
    <View style={[styles.homeRow, narrow ? styles.homeRowNarrow : null]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        accessibilityLabel={`${unit}. ${where}. ${amount ? `${amount} outstanding, ${note}` : "Nothing outstanding"}.`}
        accessibilityHint="Open this tenancy"
        {...pressableFeedback(PRESSED)}
        style={({ pressed }) => [styles.homeMain, pressed ? { backgroundColor: PRESSED } : null]}
      >
        <View style={styles.thumb}>
          {tenancy.photo_url ? (
            <Image source={{ uri: tenancy.photo_url }} accessible={false} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
          ) : (
            <Ionicons name="home-outline" size={20} color={TONE.kola.ink} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Type variant="body" numberOfLines={1} style={dash.rowTitle}>{unit}</Type>
          <Type variant="caption" numberOfLines={2} style={dash.rowLine}>{where || "Location not added"}</Type>
        </View>
      </Pressable>
      {tenancy.lease ? (
        <Pressable
          onPress={onRentAccount}
          accessibilityRole="link"
          accessibilityLabel={`Rent account for ${unit}. ${amount ? `${amount} outstanding, ${note}` : "Nothing outstanding"}.`}
          hitSlop={{ top: 8, bottom: 8, right: 4 }}
          {...pressableFeedback(PRESSED)}
          style={({ pressed }) => [styles.homeMoney, narrow ? styles.homeMoneyNarrow : null, pressed ? { backgroundColor: PRESSED } : null]}
        >
          {money}
          <Ionicons name="chevron-forward" size={16} color={MUTED} />
        </Pressable>
      ) : (
        <View style={[styles.homeMoney, narrow ? styles.homeMoneyNarrow : null]}>{money}</View>
      )}
    </View>
  );
}

/**
 * Joining another home, said in words under the homes it would join. It stays
 * reachable in every state: a tenant with no other way to `tenant-setup` would
 * lose the ability to join a second tenancy entirely.
 */
function JoinAnother({ onJoin }: { onJoin: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Join another home"
      accessibilityHint="Enter the access code your landlord gave you"
      onPress={onJoin}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [dash.listRow, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Well icon="key-outline" tone="harmattan" size={36} />
      <Type variant="body" style={[dash.rowTitle, { flex: 1 }]}>Join another home</Type>
      <Ionicons name="chevron-forward" size={16} color={MUTED} />
    </Pressable>
  );
}

/** A dated thing ahead: a viewing, rent due, a start or an end, each in its own colour. */
function UpcomingRow({ entry, onViewings }: { entry: UpcomingEntry; onViewings: () => void }) {
  const kind = entry.id.split("-")[0];
  const tone: ToneName = kind === "viewing" ? "lagoon" : kind === "rent" ? "harmattan" : kind === "end" ? "laterite" : "kola";
  const at = new Date(entry.when.length <= 10 ? `${entry.when}T12:00:00` : entry.when);
  const when = entry.when.length > 10 ? whenLabel(entry.when) ?? shortDate(entry.when) : shortDate(entry.when);
  const body = (
    <>
      <DayTile at={at} tone={tone} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Type variant="body" numberOfLines={1} style={dash.rowTitle}>{entry.place}</Type>
        <Type variant="caption" numberOfLines={1} style={dash.rowLine}>{entry.what} · {when}</Type>
      </View>
    </>
  );
  if (kind !== "viewing") {
    return <View style={dash.listRow} accessible accessibilityLabel={`${entry.what}. ${entry.place}. ${when}.`}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${entry.what}. ${entry.place}. ${when}.`}
      onPress={onViewings}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [dash.listRow, pressed ? { backgroundColor: PRESSED } : null]}
    >
      {body}
      <Ionicons name="chevron-forward" size={16} color={MUTED} />
    </Pressable>
  );
}

/** Rental events, newest first. Provider-side and account noise never appear. */
const TENANT_HISTORY = /^(lease|application|viewing|payment|tenancy_request)\./;

function activityIcon(kind: string): IconName {
  if (kind.startsWith("payment.")) return "wallet-outline";
  if (kind.startsWith("lease.")) return "document-text-outline";
  if (kind.startsWith("viewing.")) return "calendar-outline";
  return "reader-outline";
}

function activityTone(kind: string): ToneName {
  if (kind.startsWith("payment.")) return "kola";
  if (kind.startsWith("lease.")) return "harmattan";
  if (kind.startsWith("viewing.")) return "lagoon";
  return "ink";
}

/* --- nothing rented yet --------------------------------------------------- */

/** Somebody not renting anything yet: two ways forward, and what is in flight. */
function NoTenancy({
  applications,
  nextViewing,
  pendingJoin,
  onExplore,
  onJoin,
  onApplications,
  onViewings,
}: {
  applications: number;
  nextViewing: Viewing | null;
  pendingJoin: MyJoinRequest[];
  onExplore: () => void;
  onJoin: () => void;
  onApplications: () => void;
  onViewings: () => void;
}) {
  const inFlight = applications || nextViewing || pendingJoin.length;
  return (
    <>
      <Section title="Find your home">
        <View style={[dash.card, { gap: space[3] }]}>
          <View style={styles.invite}>
            <Well icon="search-outline" tone="kola" size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Type variant="bodyStrong" accessibilityRole="header" style={dash.leadTitle}>Find your next home</Type>
              <Type variant="caption" style={dash.rowLine}>Search verified rentals across Ghana.</Type>
            </View>
          </View>
          <Button label="Explore rentals" onPress={onExplore} />
          <View style={[dash.rule, { marginLeft: 0 }]} />
          <View style={styles.invite}>
            <Well icon="key-outline" tone="harmattan" size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Type variant="bodyStrong" accessibilityRole="header" style={dash.leadTitle}>Have an access code?</Type>
              <Type variant="caption" style={dash.rowLine}>Your landlord can give you one for the place you live in.</Type>
            </View>
          </View>
          <Button label="Join a home" variant="secondary" onPress={onJoin} />
        </View>
      </Section>

      {inFlight ? (
        <Section title="In progress">
          <CardList>
            {[
              <InFlightRow
                key="applications"
                icon="reader-outline"
                tone="lagoon"
                label="Applications"
                value={applications ? `${applications} active` : "None"}
                onPress={onApplications}
              />,
              <InFlightRow
                key="viewings"
                icon="calendar-outline"
                tone="lagoon"
                label="Viewings"
                value={nextViewing?.confirmed_starts_at ? whenLabel(nextViewing.confirmed_starts_at) ?? "Booked" : "Nothing booked"}
                onPress={onViewings}
              />,
              ...(pendingJoin.length
                ? [<InFlightRow key="access" icon="key-outline" tone="harmattan" label="Access request" value={`Waiting on ${pendingJoin[0]!.property_title}`} />]
                : []),
            ]}
          </CardList>
        </Section>
      ) : null}
    </>
  );
}

function InFlightRow({
  icon,
  tone,
  label,
  value,
  onPress,
}: {
  icon: IconName;
  tone: ToneName;
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Well icon={icon} tone={tone} size={36} />
      <Type variant="body" style={[dash.rowTitle, { flex: 1 }]}>{label}</Type>
      <Type variant="caption" numberOfLines={1} style={[dash.rowLine, { flexShrink: 1, textAlign: "right" }]}>{value}</Type>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={MUTED} /> : null}
    </>
  );
  if (!onPress) return <View style={dash.listRow} accessible accessibilityLabel={`${label}. ${value}.`}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}. ${value}.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [dash.listRow, pressed ? { backgroundColor: PRESSED } : null]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  owedHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
  },
  owed: {
    marginVertical: 2,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.8,
    color: INK,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  pillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  pillText: {
    fontSize: 12,
    lineHeight: 16,
  },
  dial: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    marginTop: space[1],
    marginHorizontal: -8,
    paddingHorizontal: 8,
    paddingTop: space[3],
    paddingBottom: space[1],
    borderRadius: 12,
  },
  dialReading: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 2,
    alignItems: "center",
  },
  dialFigure: {
    fontSize: 24,
    lineHeight: 28,
    color: INK,
  },
  dialStops: {
    position: "absolute",
    left: 2,
    right: 2,
    bottom: -14,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dialStop: {
    fontSize: 11,
    lineHeight: 14,
    color: MUTED,
  },
  dialLine: {
    fontSize: 15.5,
    lineHeight: 21,
    color: INK,
  },
  homeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  homeRowNarrow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 0,
  },
  homeMoneyNarrow: {
    alignSelf: "flex-end",
    marginTop: -6,
  },
  homeMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    marginLeft: -8,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 12,
  },
  homeMoney: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginRight: -8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 12,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TONE.kola.wash,
  },
  amount: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  chipText: {
    fontSize: 11.5,
    lineHeight: 15,
  },
  invite: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
});

