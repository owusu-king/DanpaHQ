import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Pressable, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";

import { isLive, standing as applicationStanding } from "@/applicationMeaning";
import type { RentalApplication } from "@/applications";
import { Button, Notice, Type, space } from "@/components/ui";
import { ComingUp } from "@/components/home/ComingUp";
import { HomeSkeleton } from "@/components/home/HomeSkeleton";
import { RentalActivity } from "@/components/home/RentalActivity";
import { HomeShortcuts, type Shortcut } from "@/components/home/HomeShortcuts";
import {
  ph,
  PlinthCard,
  plinthRow,
  plural,
  primarySurface,
  Register,
  shortDate,
  surface,
  Ticks,
  tile,
  useHomeDensity,
} from "@/components/home/plinth";
import type { Notification } from "@/notifications";
import {
  attention,
  comingUp,
  greeting,
  homeSpace,
  homeWhere,
  rentLine,
  type AttentionItem,
} from "@/homeMeaning";
import type { Lease } from "@/leases";
import { formatMinor } from "@/listings";
import { pressableFeedback } from "@/platform";
import type { MyJoinRequest, Tenancy } from "@/tenancy";
import { standing as viewingStanding, whenLabel } from "@/viewingMeaning";
import type { Viewing } from "@/viewings";

/**
 * The tenant's control center.
 *
 * Four questions, in this order: *does anything need me, what am I renting,
 * where does my rent and agreement stand, and what is coming next.* Everything
 * on the screen answers one of them.
 *
 * Drawn in the language both Homes now share — a soft green ground, white paper
 * surfaces, registration ticks on the surface that carries the screen, one
 * instrument — recomposed for a device that scrolls in one column and cannot
 * hover. `components/home/plinth.tsx` holds the vocabulary so the provider's
 * Portfolio and this cannot drift apart.
 *
 * It adapts to the lifecycle rather than showing everyone the same dashboard.
 * Somebody with no tenancy gets two ways forward and what they have in flight —
 * no Overview, no homes card, because an empty module is not information.
 *
 * **A total is offered, and its parts are never lost.** Home used to merge
 * nothing across tenancies at all. A person renting two places asked what
 * *they* owe, not what each lease owes, so the Overview adds them up — summed
 * in minor units, never by parsing a formatted amount — and every home keeps
 * its own row with its own outstanding figure, so the total can always be
 * traced back to its parts. There is still no "current" tenancy and no selector
 * that hides one behind another; `src/tenancy.ts` is explicit that ambient
 * selection is how a tenant renting two places lost sight of one.
 *
 * Not here: listings, which are a tab away in Explore. Not here either:
 * maintenance, because Rooomly has no maintenance domain yet and a card saying
 * "No open issue" would be a promise.
 */
export function TenantHome({
  name,
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
  name: string;
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
  const density = useHomeDensity();
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

  const needs = attention({
    tenancies,
    offeredLeases: leases.filter((lease) => lease.status === "offered"),
    viewingsWaiting,
    applicationsWaiting,
    joinRequests,
  });
  const upcoming = comingUp({ tenancies, viewings });
  const openApplications = applications.filter((row) =>
    isLive(row),
  );
  const nextViewing = viewings
    .filter((row) => row.confirmed_starts_at && row.is_upcoming)
    .sort((a, b) => (a.confirmed_starts_at ?? "").localeCompare(b.confirmed_starts_at ?? ""))[0];
  const pendingJoin = joinRequests.filter((row) => row.status === "pending");
  const ranked = rankHomes(tenancies);
  const owed = totalOwed(tenancies);
  const acceptedApplications = applications.filter((row) => row.status === "accepted").length;
  const activeLeases = leases.filter((row) => row.status === "active").length;
  const open = (item: AttentionItem) => {
    if (item.destination === "agreements" || item.destination === "tenancy") return onAgreements();
    if (item.destination === "viewings") return onViewings();
    if (item.destination === "applications") return onApplications();
    return onExplore();
  };

  return (
    <View style={{ gap: density.sectionGap }}>
      {/* The greeting stands alone. A round "+" floated beside it and could
          have meant add a home, add a payment or add anything else; joining is
          now stated in words, under the homes it would join. It is still
          reachable in every state — that was the point of the original fix —
          just no longer as an ambiguous glyph. */}
      <View style={{ gap: space[1], paddingBottom: density.compact ? space[1] : space[2] }}>
        <Type variant="label" style={{ fontSize: density.labelSize, lineHeight: 14, color: ph.ink70 }} numberOfLines={1}>
          {ranked[0] ? ranked[0].property.title.toUpperCase() : "YOUR RENTALS"}
        </Type>
        <Type
          variant="display2"
          accessibilityRole="header"
          style={{ fontSize: density.headingSize, lineHeight: density.headingLine, color: ph.ink }}
        >
          {greeting(name)}
        </Type>
        <Register width={density.compact ? 24 : 30} height={2} gap={density.compact ? 2 : space[1]} />
      </View>

      {error ? <Notice tone="error" title={error} /> : null}

      {loading && tenancies.length === 0 ? (
        <HomeSkeleton />
      ) : tenancies.length === 0 ? (
        <NoTenancy
          applications={openApplications.length}
          nextViewing={nextViewing ?? null}
          pendingJoin={pendingJoin}
          onExplore={onExplore}
          onJoin={onJoin}
          onApplications={onApplications}
          onViewings={onViewings}
        />
      ) : (
        <>
          <Overview
            homes={tenancies.length}
            owed={owed}
            activeLeases={activeLeases}
            applications={applications.length}
            accepted={acceptedApplications}
            onApplications={onApplications}
          />

          <AttentionPanel signals={needs} onOpen={open} />

          <PlinthCard
            title={tenancies.length > 1 ? "My homes" : "My home"}
            meta={`${tenancies.length} ${plural(tenancies.length, "home", "homes")}`}
          >
            {ranked.map((tenancy) => (
              <HomeCard
                key={tenancy.id}
                tenancy={tenancy}
                first={tenancy.id === ranked[0]?.id}
                onPress={() => onTenancy(tenancy)}
                onRentAccount={() => onRentAccount(tenancy)}
              />
            ))}
            <JoinAnother onJoin={onJoin} />
          </PlinthCard>

          <ComingUp entries={upcoming} onViewings={onViewings} />

          <RentalActivity items={recentActivity} onOpenAll={onNotifications} />

        </>
      )}

      {/* Deeper rental management, not the tab bar restated. Explore, Saved and
          Payments are all one tap away on the bar below; each home row still
          owns its focused per-agreement rent account. */}
      <HomeShortcuts
        shortcuts={[
          { id: "leases", label: "Agreements", icon: "document-text-outline", onPress: onAgreements },
          { id: "applications", label: "Applications", icon: "reader-outline", onPress: onApplications },
          {
            id: "notifications",
            label: "Updates",
            icon: "notifications-outline",
            onPress: onNotifications,
            count: unreadNotifications,
          },
        ] satisfies Shortcut[]}
      />

    </View>
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
function rankHomes(homes: Tenancy[]): Tenancy[] {
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
 * The account, added up.
 *
 * Money leads, because it is the fact this card exists to carry and the only
 * one whose cost grows. The label turns brick the moment anything is
 * outstanding — not only once it is late — while the figure itself stays ink:
 * colouring the amount too made the number look like the warning rather than
 * the fact. Nothing owed is left unmarked, because a red zero would be alarming
 * about good news.
 *
 * Nothing here names one home or one locality. This speaks for the whole
 * account; naming a place on an aggregate would be quietly wrong the moment
 * there are two, and the card below gives every home its own row.
 */
function Overview({
  homes,
  owed,
  activeLeases,
  applications,
  accepted,
  onApplications,
}: {
  homes: number;
  owed: Owed;
  activeLeases: number;
  applications: number;
  accepted: number;
  onApplications: () => void;
}) {
  const density = useHomeDensity();
  const badge = owed.minor
    ? owed.overdue
      ? { text: "Rent overdue", fg: ph.brick, bg: ph.brickSoft }
      : { text: "Rent scheduled", fg: ph.amber, bg: ph.amberSoft }
    : { text: "Nothing due", fg: ph.sage, bg: ph.greenSoft };

  return (
    <View style={[primarySurface, { padding: density.cardPadding, borderRadius: density.compact ? 14 : 16 }]}>
      <Ticks />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], marginBottom: density.compact ? space[3] : space[4] }}>
        <Type variant="bodyStrong" style={{ fontSize: density.compact ? 13 : 14, lineHeight: 19, color: ph.ink }}>Overview</Type>
        <View style={{ flexShrink: 1, paddingHorizontal: density.compact ? 7 : 9, paddingVertical: density.compact ? 2 : 3, borderRadius: 20, backgroundColor: badge.bg }}>
          <Type variant="caption" numberOfLines={1} style={{ fontSize: density.compact ? 10.25 : 11.5, lineHeight: 15, fontWeight: "500", color: badge.fg }}>
            {badge.text}
          </Type>
        </View>
      </View>

      <View accessible accessibilityLabel={`${owed.formatted} owed in total`}>
        <Type variant="label" style={{ fontSize: density.compact ? 8.5 : 9.5, lineHeight: 12, letterSpacing: 0.55, color: owed.minor ? ph.brick : ph.ink38 }}>
          {owed.minor ? "OWED IN TOTAL" : "OWED"}
        </Type>
        <Type
          variant="display2"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={{ marginTop: 1, fontSize: density.compact ? 28 : 32, lineHeight: density.compact ? 33 : 38, letterSpacing: -0.6, color: ph.ink }}
        >
          {owed.formatted}
        </Type>
        <Type
          variant="caption"
          numberOfLines={1}
          style={{ fontSize: density.compact ? 11 : 12, lineHeight: 16, color: owed.overdue ? ph.brick : ph.ink55 }}
        >
          {owed.earliest
            ? `${owed.overdue ? "Overdue since" : "Earliest due"} ${shortDate(owed.earliest)}`
            : "Nothing scheduled"}
        </Type>
      </View>

      <Register width={density.compact ? 18 : 22} gap={density.compact ? space[3] : space[4]} />

      <View style={{ flexDirection: "row", alignItems: "stretch", minHeight: density.compact ? 34 : 38 }}>
        <OverviewFact label={plural(homes, "Tenancy", "Tenancies")} value={homes} compact={density.compact} />
        <View pointerEvents="none" style={{ width: 1, marginVertical: density.compact ? 7 : 8, backgroundColor: ph.line }} />
        <OverviewFact
          label={plural(activeLeases, "Active agreement", "Active agreements")}
          value={activeLeases}
          compact={density.compact}
        />
      </View>

      {applications ? (
        <ApplicationGauge
          total={applications}
          accepted={accepted}
          onPress={onApplications}
        />
      ) : null}
    </View>
  );
}

/** A figure and what it counts. Static: the homes card below is the way in. */
function OverviewFact({ label, value, compact }: { label: string; value: number; compact: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={`${value} ${label}`}
      style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: compact ? 5 : 6, paddingRight: compact ? 4 : 6 }}
    >
      <Type variant="display2" style={{ fontSize: compact ? 17 : 19, lineHeight: compact ? 21 : 23, color: ph.ink }}>
        {value}
      </Type>
      <Type variant="caption" numberOfLines={1} style={{ flex: 1, fontSize: compact ? 10 : 11, lineHeight: 14, color: ph.ink55 }}>
        {label}
      </Type>
    </View>
  );
}

/**
 * Applications, and how many were accepted.
 *
 * A half dial rather than a full ring, because the quantity has a floor and a
 * ceiling a person can see at once — none accepted at the left stop, all of
 * them at the right — and because a full circle reads as a proportion of a
 * whole, which an application count is not.
 *
 * A wide, short instrument, so on a phone it takes the full width of the card
 * as its own band rather than being squeezed into a column beside the money.
 * The arc is a path rather than a dashed circle so both ends are genuinely
 * flat, the register of ticks is the same drafting language as the Portfolio
 * gauge, and a caliper mark points at the reading.
 */
function ApplicationGauge({
  total,
  accepted,
  onPress,
}: {
  total: number;
  accepted: number;
  onPress: () => void;
}) {
  const density = useHomeDensity();
  const share = Math.min(1, Math.max(0, accepted / total));
  const width = density.compact ? 104 : 118;
  const height = width * 0.58;
  // Left to right across the top: 180 degrees at nought, 360 at all of them.
  const angle = 180 + share * 180;
  const point = (radius: number) => [
    100 + radius * Math.cos((angle * Math.PI) / 180),
    100 + radius * Math.sin((angle * Math.PI) / 180),
  ] as const;
  const [innerX, innerY] = point(66);
  const [outerX, outerY] = point(92);
  // A half turn of an 84-unit radius, in the units the viewBox is drawn in.
  const arc = Math.PI * 84;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${accepted} of ${total} ${plural(total, "application", "applications")} accepted`}
      accessibilityHint="Open your applications"
      style={{
        marginTop: density.compact ? space[3] : space[4],
        paddingTop: density.compact ? space[2] : space[3],
        borderTopWidth: 1,
        borderTopColor: ph.line,
        flexDirection: "row",
        alignItems: "center",
        gap: density.compact ? space[3] : space[4],
      }}
      {...pressableFeedback(ph.paperDim)}
    >
      <View style={{ width, height }}>
        <Svg width={width} height={height} viewBox="0 0 200 116">
          <Path d="M 16 100 A 84 84 0 0 1 184 100" fill="none" stroke={ph.lineStrong} strokeWidth={11} strokeLinecap="butt" />
          <Path
            d="M 16 100 A 84 84 0 0 1 184 100"
            fill="none"
            stroke={ph.brand}
            strokeWidth={11}
            strokeLinecap="butt"
            strokeDasharray={`${arc} ${arc}`}
            strokeDashoffset={arc * (1 - share)}
          />
          <Path
            d="M 16 100 A 84 84 0 0 1 184 100"
            fill="none"
            stroke={ph.gold}
            strokeWidth={1}
            strokeDasharray="1 13"
            opacity={0.55}
          />
          <Line x1={innerX} y1={innerY} x2={outerX} y2={outerY} stroke={ph.gold} strokeWidth={2.4} strokeLinecap="round" />
        </Svg>
        {/* The reading sits inside the arc, on its baseline. */}
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: height * 0.862, alignItems: "center", justifyContent: "flex-end" }}>
          <Type variant="display2" style={{ fontSize: density.compact ? 20 : 23, lineHeight: density.compact ? 22 : 25, color: ph.ink }}>
            {accepted}
          </Type>
        </View>
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", justifyContent: "space-between" }}>
          <Type variant="caption" style={{ fontSize: 9, lineHeight: 12, color: ph.ink38 }}>0</Type>
          <Type variant="caption" style={{ fontSize: 9, lineHeight: 12, color: ph.ink38 }}>{total}</Type>
        </View>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Type variant="label" style={{ fontSize: density.compact ? 8.5 : 9.5, lineHeight: 12, letterSpacing: 0.55, color: ph.ink38 }}>
          APPLICATIONS
        </Type>
        <Type variant="bodyStrong" numberOfLines={2} style={{ fontSize: density.compact ? 12.5 : 13.5, lineHeight: 18, color: ph.ink }}>
          {accepted} of {total} accepted
        </Type>
      </View>
      <Ionicons name="chevron-forward" size={density.compact ? 12 : 14} color={ph.ink38} />
    </Pressable>
  );
}

/**
 * What is genuinely waiting on this person.
 *
 * The panel stays in place with an all-clear reading rather than disappearing
 * when there is nothing: "nothing is waiting on you" is worth saying out loud,
 * and a section that vanishes leaves the reader wondering whether it failed to
 * load. Severity is a dot with a halo and a word, never colour alone.
 */
function AttentionPanel({
  signals,
  onOpen,
}: {
  signals: AttentionItem[];
  onOpen: (item: AttentionItem) => void;
}) {
  const density = useHomeDensity();
  return (
    <View style={[surface, { padding: density.cardPadding, borderRadius: density.compact ? 14 : 16 }]}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: space[2] }}>
        <Type variant="bodyStrong" accessibilityRole="header" style={{ fontSize: density.compact ? 13 : 14, lineHeight: 19, color: ph.ink }}>
          Needs attention
        </Type>
        <Type variant="caption" style={{ fontSize: density.compact ? 11.5 : 12.5, lineHeight: 17, color: ph.ink38 }}>
          {signals.length ? `${signals.length} ${plural(signals.length, "item", "items")}` : "All clear"}
        </Type>
      </View>

      {signals.length ? (
        signals.slice(0, 5).map((item, index) => {
          const danger = attentionTone(item) === "danger";
          return (
            <Pressable
              key={item.id}
              onPress={() => onOpen(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.place}. ${item.action}.`}
              style={plinthRow(index === 0, density.compact)}
              {...pressableFeedback(ph.paperDim)}
            >
              <View
                style={{
                  width: density.compact ? 6 : 7,
                  height: density.compact ? 6 : 7,
                  borderRadius: 4,
                  backgroundColor: danger ? ph.brick : ph.amber,
                  borderWidth: 3,
                  borderColor: danger ? ph.brickSoft : ph.amberSoft,
                }}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Type variant="bodyStrong" numberOfLines={1} style={{ fontSize: density.compact ? 12.25 : 13.2, lineHeight: 17, color: ph.ink }}>
                  {item.title}
                </Type>
                <Type variant="caption" numberOfLines={1} style={{ fontSize: density.compact ? 10.5 : 11.5, lineHeight: 15, color: ph.ink55 }}>
                  {item.place}
                </Type>
              </View>
              {density.veryCompact ? null : (
                <Type variant="caption" style={{ fontSize: density.compact ? 10.25 : 11, lineHeight: 15, color: ph.ink38 }}>
                  {item.action}
                </Type>
              )}
              <Ionicons name="chevron-forward" size={density.compact ? 12 : 14} color={ph.ink38} />
            </Pressable>
          );
        })
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: density.compact ? space[2] : space[3], paddingVertical: space[2] }}>
          <View style={{ width: density.compact ? 24 : 26, height: density.compact ? 24 : 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: ph.greenSoft }}>
            <Ionicons name="checkmark" size={density.compact ? 13 : 14} color={ph.sage} />
          </View>
          <View style={{ flex: 1 }}>
            <Type variant="bodyStrong" style={{ fontSize: density.compact ? 12.25 : 13.2, lineHeight: 17, color: ph.ink }}>Nothing is waiting on you.</Type>
            <Type variant="caption" style={{ fontSize: density.compact ? 11 : 12, lineHeight: 16, color: ph.ink55 }}>Rent, agreements and viewings are all up to date.</Type>
          </View>
        </View>
      )}

      {signals.length > 5 ? (
        <Type variant="caption" style={{ marginTop: space[2], fontSize: density.compact ? 11 : 12, color: ph.ink38 }}>
          {signals.length - 5} more waiting
        </Type>
      ) : null}
    </View>
  );
}

/**
 * A tenant's attention item carries no severity of its own, so it is read from
 * the kind: money and agreements cost the most to ignore.
 */
function attentionTone(item: AttentionItem): "danger" | "warning" {
  return item.kind === "rent_overdue" || item.kind === "agreement_offered" ? "danger" : "warning";
}

/**
 * One home, as a row.
 *
 * The Unit leads. A tenant lives in Flat 2A; East Legon Heights is where Flat
 * 2A is, and two tenancies in one building are otherwise two identical-looking
 * rows.
 *
 * The row and its money are two controls, not one: the row opens the tenancy,
 * and the amount opens that agreement's rent account — the focused ledger the
 * Overview's total can be traced back through. Only the note carries colour;
 * the figure stays ink, so a number never looks like a warning by itself.
 */
function HomeCard({
  tenancy,
  first,
  onPress,
  onRentAccount,
}: {
  tenancy: Tenancy;
  first: boolean;
  onPress: () => void;
  onRentAccount: () => void;
}) {
  const density = useHomeDensity();
  const rent = tenancy.rent;
  const due = rent?.next_due ?? null;
  const amount = rent?.outstanding_minor ? rent.outstanding_formatted : "—";
  const note = !due
    ? "nothing due"
    : due.is_overdue
      ? `overdue ${shortDate(due.due_on)}`
      : `due ${shortDate(due.due_on)}`;
  const unit = homeSpace(tenancy) || tenancy.property.title;
  const where = [homeSpace(tenancy) ? tenancy.property.title : null, homeWhere(tenancy)]
    .filter(Boolean)
    .join(" · ");
  const thumb = density.compact ? 38 : 42;

  const value = (
    <>
      <Type variant="bodyStrong" numberOfLines={1} style={{ fontSize: density.compact ? 12.5 : 13.5, lineHeight: 18, textAlign: "right", color: ph.ink }}>
        {amount}
      </Type>
      <Type variant="caption" numberOfLines={1} style={{ fontSize: density.compact ? 9.75 : 10.75, lineHeight: 14, textAlign: "right", color: due?.is_overdue ? ph.brick : ph.ink38 }}>
        {note}
      </Type>
    </>
  );

  return (
    <View style={[plinthRow(first, density.compact), { minHeight: density.compact ? 54 : 58 }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${unit}. ${where}. ${amount === "—" ? "Nothing outstanding" : `${amount} outstanding, ${note}`}.`}
        accessibilityHint="Open this tenancy"
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: density.compact ? space[2] : space[3] }}
        {...pressableFeedback(ph.paperDim)}
      >
        <View
          style={{
            width: thumb,
            height: thumb,
            borderRadius: 9,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: ph.paperDim,
            borderWidth: 1,
            borderColor: ph.line,
          }}
        >
          {tenancy.photo_url ? (
            <Image
              source={{ uri: tenancy.photo_url }}
              accessible={false}
              resizeMode="cover"
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <Ionicons name="home-outline" size={density.compact ? 15 : 17} color={ph.ink38} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Type variant="bodyStrong" numberOfLines={1} style={{ fontSize: density.compact ? 12.75 : 13.75, lineHeight: 18, color: ph.ink }}>
            {unit}
          </Type>
          <Type variant="caption" numberOfLines={1} style={{ fontSize: density.compact ? 10.5 : 11.5, lineHeight: 15, color: ph.ink55 }}>
            {where || "Location not added"}
          </Type>
        </View>
      </Pressable>

      {tenancy.lease ? (
        <Pressable
          onPress={onRentAccount}
          accessibilityRole="button"
          accessibilityLabel={`Rent account for ${unit}. ${amount === "—" ? "Nothing outstanding" : `${amount} outstanding, ${note}`}.`}
          hitSlop={{ top: 8, bottom: 8, right: 4 }}
          style={{ flexDirection: "row", alignItems: "center", gap: 2, maxWidth: density.compact ? 122 : 138 }}
          {...pressableFeedback(ph.paperDim)}
        >
          <View style={{ flexShrink: 1, minWidth: 0 }}>{value}</View>
          <Ionicons name="chevron-forward" size={density.compact ? 12 : 13} color={ph.ink38} />
        </Pressable>
      ) : (
        <View style={{ maxWidth: density.compact ? 122 : 138 }}>{value}</View>
      )}
    </View>
  );
}

/**
 * Joining another home, said in words under the homes it would join.
 *
 * This replaced a round "+" floated beside the greeting, which could have meant
 * add a home, add a payment or add anything at all. It stays reachable in every
 * state — a tenant with no other entry point to `tenant-setup` would otherwise
 * lose the ability to join a second tenancy entirely.
 */
function JoinAnother({ onJoin }: { onJoin: () => void }) {
  const density = useHomeDensity();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Join another home"
      accessibilityHint="Enter the access code your landlord gave you"
      onPress={onJoin}
      style={[plinthRow(false, density.compact), { minHeight: density.compact ? 44 : 48 }]}
      {...pressableFeedback(ph.paperDim)}
    >
      <View style={tile(false, density.compact)}>
        <Ionicons name="key-outline" size={density.compact ? 13.5 : 15} color={ph.gold} />
      </View>
      <Type variant="bodyStrong" style={{ flex: 1, fontSize: density.compact ? 12.5 : 13.5, lineHeight: 18, color: ph.ink }}>
        Join another home
      </Type>
      <Ionicons name="chevron-forward" size={density.compact ? 12 : 14} color={ph.ink38} />
    </Pressable>
  );
}

/* --- nothing rented yet --------------------------------------------------- */

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  const density = useHomeDensity();
  return (
    <View style={{ gap: space[2] }}>
      <Type variant="label" accessibilityRole="header" style={{ fontSize: density.labelSize, lineHeight: 14, color: ph.ink70 }}>
        {heading.toUpperCase()}
      </Type>
      {children}
    </View>
  );
}

/** Somebody not renting anything yet: two ways forward, and nothing empty. */
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
  const density = useHomeDensity();
  return (
    <>
      {/* No registration ticks here. They mark a surface that carries a
          reading, and an invitation carries none — on a 9.5px eyebrow the
          corner mark also lands inside the first letter. */}
      <View style={[primarySurface, { padding: density.cardPadding, borderRadius: density.compact ? 14 : 16, gap: space[2] }]}>
        <Type variant="label" style={{ fontSize: density.compact ? 8.5 : 9.5, lineHeight: 12, letterSpacing: 0.55, color: ph.ink38 }}>
          VERIFIED RENTALS IN GHANA
        </Type>
        <Type variant="title2" accessibilityRole="header" style={{ color: ph.ink }}>Find your next home</Type>
        <Type variant="caption" style={{ fontSize: density.compact ? 11.5 : 12.5, lineHeight: 17, color: ph.ink55 }}>
          Search verified rentals across Ghana.
        </Type>
        <Button label="Explore rentals" onPress={onExplore} />
      </View>

      <View style={[surface, { padding: density.cardPadding, borderRadius: density.compact ? 14 : 16, gap: space[2] }]}>
        <Type variant="title2" accessibilityRole="header" style={{ color: ph.ink }}>Have an access code?</Type>
        <Type variant="caption" style={{ fontSize: density.compact ? 11.5 : 12.5, lineHeight: 17, color: ph.ink55 }}>
          Your landlord can give you one for the place you live in.
        </Type>
        <Button label="Join a home" variant="secondary" onPress={onJoin} />
      </View>

      {applications || nextViewing || pendingJoin.length ? (
        <Activity
          applications={applications}
          nextViewing={nextViewing}
          pendingJoin={pendingJoin}
          onApplications={onApplications}
          onViewings={onViewings}
        />
      ) : null}
    </>
  );
}

/**
 * What somebody has in flight, for the empty state only.
 *
 * This used to render on the loaded page too, under a "Rental activity"
 * heading, which is the section that was removed: with homes on screen it sat
 * between the schedule and the shortcuts saying very little. Without a tenancy
 * it is the answer to "what is happening with the places I asked about", and
 * removing it there would make a submitted application invisible.
 */
function Activity({
  applications,
  nextViewing,
  pendingJoin,
  onApplications,
  onViewings,
}: {
  applications: number;
  nextViewing: Viewing | null;
  pendingJoin: MyJoinRequest[];
  onApplications: () => void;
  onViewings: () => void;
}) {
  const density = useHomeDensity();
  return (
    <Group heading="In progress">
      <View style={[surface, { padding: density.cardPadding, borderRadius: density.compact ? 14 : 16 }]}>
        <ActivityRow
          first
          label="Applications"
          value={applications ? `${applications} active` : "None"}
          onPress={onApplications}
        />
        <ActivityRow
          label="Viewings"
          value={
            nextViewing?.confirmed_starts_at
              ? whenLabel(nextViewing.confirmed_starts_at) ?? "Booked"
              : "Nothing booked"
          }
          onPress={onViewings}
        />
        {pendingJoin.length ? (
          <ActivityRow
            label="Access request"
            value={`Waiting on ${pendingJoin[0]!.property_title}`}
          />
        ) : null}
      </View>
    </Group>
  );
}

function ActivityRow({
  label,
  value,
  first = false,
  onPress,
}: {
  label: string;
  value: string;
  first?: boolean;
  onPress?: () => void;
}) {
  const density = useHomeDensity();
  const body = (
    <>
      <Type variant="bodyStrong" style={{ flex: 1, fontSize: density.compact ? 12.5 : 13.5, lineHeight: 18, color: ph.ink }}>
        {label}
      </Type>
      <Type variant="caption" numberOfLines={1} style={{ flexShrink: 1, fontSize: density.compact ? 11 : 12, lineHeight: 16, textAlign: "right", color: ph.ink55 }}>
        {value}
      </Type>
      {onPress ? <Ionicons name="chevron-forward" size={density.compact ? 12 : 14} color={ph.ink38} /> : null}
    </>
  );
  const style = [plinthRow(first, density.compact), { minHeight: density.compact ? 44 : 48 }];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${value}.`}
      onPress={onPress}
      style={style}
      {...pressableFeedback(ph.paperDim)}
    >
      {body}
    </Pressable>
  );
}
