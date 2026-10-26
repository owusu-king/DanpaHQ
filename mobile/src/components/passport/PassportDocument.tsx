import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { EDGE, FAINT, INK, MUTED, RULE, type IconName } from "@/components/portfolio/PortfolioList";
import { Type, radius, space } from "@/components/ui";
import { MoreRow } from "@/components/work/WorkParts";
import {
  dayMonthYear,
  duration,
  monthYear,
  NOT_RECORDED_LABEL,
  period,
  placeLine,
  STATUS_LABEL,
  STATUS_MEANING,
  tenancyPeriod,
  tenancyStanding,
} from "@/passportMeaning";
import type {
  IdentityCredential,
  PassportPayments,
  PassportReview,
  PassportStatus,
  PassportTenancy,
  PassportView,
  TimelineEvent,
} from "@/passport";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * The Housing Passport as a document, the mobile twin of web's
 * `PassportDocument.tsx`: drawn the same way for its owner and in the share
 * preview, so the preview is the thing the recipient will read, not a likeness.
 *
 * The same two rules as web: every status says how it is known (the backend's
 * `basis` line), and nothing the record does not contain is drawn as a gap or a
 * zero against anyone.
 */

type Audience = "owner" | "recipient";

const C = theme.color;
const COVER_INK = "#F6F0E2";
const COVER_MUTED = alpha("#F6F0E2", 0.7);
const COVER_FOIL = C.gold["300"];

// --- the cover ---------------------------------------------------------------------

export function PassportCover({ view, audience, footer }: { view: PassportView; audience: Audience; footer?: ReactNode }) {
  const { holder, summary, sections } = view;
  const span = period(summary.period.from, summary.period.to, summary.period.ongoing);
  const identity = view.identity?.credentials.find((row) => row.key === "identity") ?? null;
  const idLine = identity
    ? identity.status === "verified"
      ? "Identity verified"
      : identity.status === "pending"
        ? "Identity check pending"
        : identity.status === "expired"
          ? "Identity check expired"
          : "Identity not verified"
    : null;

  return (
    <View style={styles.cover} accessibilityLabel={`Housing Passport of ${holder.name}`}>
      <CoverGround />
      <View style={styles.coverTop}>
        <View style={styles.wordmark}>
          <Ionicons name="id-card-outline" size={15} color={COVER_FOIL} />
          <Type variant="label" style={styles.wordmarkText}>
            DANPA HQ <Type variant="label" style={styles.wordmarkSub}>HOUSING PASSPORT</Type>
          </Type>
        </View>
        <View style={styles.mode}>
          <Ionicons name={audience === "owner" ? "lock-closed-outline" : "eye-outline"} size={12} color={COVER_MUTED} />
          <Type variant="caption" style={styles.modeText}>{audience === "owner" ? "Private to you" : "Read-only"}</Type>
        </View>
      </View>

      <View style={styles.holder}>
        <View style={styles.monogram} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Type variant="title2" style={styles.monogramText}>{holder.initials}</Type>
        </View>
        <View style={styles.holderText}>
          <Type variant="title1" accessibilityRole="header" style={styles.holderName}>{holder.name}</Type>
          {idLine && identity ? (
            <View style={styles.holderId}>
              <Ionicons
                name={identity.status === "verified" ? "shield-checkmark" : identity.status === "pending" ? "time-outline" : "information-circle-outline"}
                size={14}
                color={identity.status === "verified" ? "#A9D8C2" : identity.status === "pending" ? C.harmattan["500"] : COVER_MUTED}
              />
              <Type variant="caption" style={[styles.coverCaption, identity.status === "verified" ? { color: "#CDEBDC" } : null]}>{idLine}</Type>
            </View>
          ) : null}
          <Type variant="caption" style={styles.coverCaption}>On Danpa HQ since {monthYear(holder.member_since)}</Type>
        </View>
      </View>

      <View style={styles.figures}>
        <CoverFigure tall={sections.payments} label="Tenancies" value={String(summary.tenancies)} note={summary.current ? `${summary.current} current` : undefined} />
        <CoverFigure tall={sections.payments} label="On record" value={summary.tenancies ? duration(summary.months) : "—"} note={span || undefined} />
        {sections.payments ? (
          <CoverFigure
            tall
            label="Rent confirmed"
            value={String(summary.payments_confirmed ?? 0)}
            note={summary.payments_confirmed ? `${summary.payments_on_time ?? 0} on time` : "payments"}
          />
        ) : null}
      </View>

      {footer ? <View style={styles.coverFoot}>{footer}</View> : null}
    </View>
  );
}

/** Deep kola with a lit corner and a faint gold guilloche, as web's cover. */
function CoverGround() {
  return (
    <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="xMidYMid slice" viewBox="0 0 400 260">
      <Defs>
        <LinearGradient id="pp-base" x1="0" y1="0" x2="0.4" y2="1">
          <Stop offset="0" stopColor={C.kola["800"]} />
          <Stop offset="0.78" stopColor={C.kola["900"]} />
        </LinearGradient>
        <RadialGradient id="pp-glow" cx="400" cy="0" r="300" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={C.kola["600"]} stopOpacity={0.72} />
          <Stop offset="0.58" stopColor={C.kola["600"]} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="400" height="260" fill="url(#pp-base)" />
      <Rect x="0" y="0" width="400" height="260" fill="url(#pp-glow)" />
      {Array.from({ length: 9 }).map((_, index) => (
        <Ellipse key={index} cx="330" cy="40" rx={60 + index * 26} ry={34 + index * 15} fill="none" stroke={COVER_FOIL} strokeWidth={0.6} strokeOpacity={0.16} />
      ))}
    </Svg>
  );
}

/** Three across on a phone, so a label may take two lines: `tall` keeps every value level. */
function CoverFigure({ label, value, note, tall = false }: { label: string; value: string; note?: string; tall?: boolean }) {
  return (
    <View style={styles.figure}>
      <View style={tall ? styles.figureLabelBox : null}>
        <Type variant="label" style={styles.figureLabel}>{label.toUpperCase()}</Type>
      </View>
      <Type variant="amountLg" style={styles.figureValue}>{value}</Type>
      {note ? <Type variant="caption" numberOfLines={2} style={styles.figureNote}>{note}</Type> : null}
    </View>
  );
}

/** Who a preview is prepared for, and how long it lasts: the recipient's line on the cover. */
export function PreparedFor({ label, until }: { label: string; until: string }) {
  return (
    <>
      <Type variant="caption" style={styles.coverCaption}>
        {label ? <>Prepared for <Type variant="captionStrong" style={{ color: "#FFFBF2" }}>{label}</Type></> : "Shared by link"}
      </Type>
      <Type variant="caption" style={styles.coverCaption}>Valid {until}</Type>
    </>
  );
}

/** The cover's shape while the passport loads, so nothing jumps when it arrives. */
export function CoverSkeleton() {
  return <View style={[styles.cover, styles.coverLoading]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

// --- status ----------------------------------------------------------------------------

const STATUS_GLYPH: Record<PassportStatus, IconName> = {
  verified: "shield-checkmark",
  confirmed: "checkmark-circle-outline",
  pending: "time-outline",
  disputed: "alert-circle-outline",
  unverified: "information-circle-outline",
  expired: "alert-circle-outline",
  none: "information-circle-outline",
};

/** Verified is the brand's colour, solid; confirmed is the same colour as a line. */
const STATUS_TONE: Record<PassportStatus, { ink: string; fill: string; ring: string }> = {
  verified: { ink: C.kola["800"], fill: C.kola["50"], ring: alpha(C.kola["600"], 0.22) },
  confirmed: { ink: C.kola["600"], fill: C.field["0"], ring: alpha(C.kola["600"], 0.45) },
  pending: { ink: C.harmattan["600"], fill: C.harmattan["100"], ring: alpha(C.harmattan["500"], 0.3) },
  disputed: { ink: C.laterite["600"], fill: C.laterite["100"], ring: alpha(C.laterite["600"], 0.24) },
  expired: { ink: C.laterite["600"], fill: C.field["0"], ring: alpha(C.laterite["600"], 0.4) },
  unverified: { ink: C.ink["500"], fill: C.field["100"], ring: C.field["200"] },
  none: { ink: C.ink["500"], fill: C.field["100"], ring: C.field["200"] },
};

export function StatusMark({ status }: { status: PassportStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <View style={[styles.status, { backgroundColor: tone.fill, borderColor: tone.ring }]}>
      <Ionicons name={STATUS_GLYPH[status]} size={12} color={tone.ink} />
      <Type variant="captionStrong" numberOfLines={1} style={[styles.statusText, { color: tone.ink }]}>{STATUS_LABEL[status]}</Type>
    </View>
  );
}

function ReviewNote({ review }: { review: PassportReview }) {
  if (!review) return null;
  return (
    <View style={styles.review} accessible accessibilityRole="text">
      <Ionicons name="alert-circle-outline" size={15} color={C.laterite["600"]} style={{ marginTop: 2 }} />
      <Type variant="caption" style={styles.reviewText}>
        {review.note} <Type variant="caption" style={styles.reviewSince}>Under review since {dayMonthYear(review.since)}.</Type>
      </Type>
    </View>
  );
}

// --- sections -------------------------------------------------------------------------------

/** A section of the document: its name, an optional count or act, then its card. */
export function PassportSection({ title, count, action, children, card = true }: {
  title: string;
  count?: string;
  action?: ReactNode;
  children: ReactNode;
  card?: boolean;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Type variant="bodyStrong" accessibilityRole="header" style={styles.sectionTitle}>{title}</Type>
        {count ? <Type variant="captionStrong" style={styles.sectionCount}>{count}</Type> : null}
        <View style={{ flex: 1 }} />
        {action}
      </View>
      {card ? <View style={styles.card}>{children}</View> : children}
    </View>
  );
}

// --- identity -------------------------------------------------------------------------------

const IDENTITY_GLYPH: Record<IdentityCredential["key"], IconName> = {
  identity: "shield-checkmark-outline",
  selfie_match: "person-outline",
  phone: "call-outline",
  email: "mail-outline",
};

function glyphTone(status: PassportStatus) {
  if (status === "verified") return { ink: C.kola["600"], fill: C.kola["50"] };
  if (status === "pending") return { ink: C.harmattan["600"], fill: C.harmattan["100"] };
  if (status === "expired") return { ink: C.laterite["600"], fill: C.laterite["100"] };
  return { ink: C.ink["500"], fill: C.field["100"] };
}

export function IdentitySection({ identity, action }: { identity: NonNullable<PassportView["identity"]>; action?: ReactNode }) {
  return (
    <PassportSection title="Identity checks" action={action}>
      <ReviewNote review={identity.review} />
      {identity.credentials.map((row, index) => {
        const tone = glyphTone(row.status);
        return (
          <View key={row.key} style={[styles.identityRow, index ? styles.ruled : null]}>
            <View style={[styles.glyph, { backgroundColor: tone.fill }]}>
              <Ionicons name={IDENTITY_GLYPH[row.key]} size={17} color={tone.ink} />
            </View>
            <View style={styles.grow}>
              <Type variant="bodyStrong" style={styles.rowTitle}>{row.title}</Type>
              <Type variant="caption" style={styles.rowNote}>{row.basis}{row.as_of ? ` · ${dayMonthYear(row.as_of)}` : ""}</Type>
              {row.valid_until ? <Type variant="caption" style={styles.rowFaint}>Valid until {dayMonthYear(row.valid_until)}</Type> : null}
            </View>
            <StatusMark status={row.status} />
          </View>
        );
      })}
      <Type variant="caption" style={styles.fineprint}>Document numbers, phone numbers and email addresses are never shown.</Type>
    </PassportSection>
  );
}

// --- tenancies ---------------------------------------------------------------------------------

const STANDING_TONE: Record<PassportTenancy["status"], { ink: string; fill: string }> = {
  active: { ink: C.kola["800"], fill: C.kola["50"] },
  upcoming: { ink: C.lagoon["600"], fill: C.lagoon["100"] },
  pending_lease: { ink: C.harmattan["600"], fill: C.harmattan["100"] },
  ended: { ink: C.ink["700"], fill: C.field["100"] },
};

export function TenancyRecord({ tenancy, action, first = false }: { tenancy: PassportTenancy; action?: ReactNode; first?: boolean }) {
  const where = placeLine(tenancy);
  const standing = STANDING_TONE[tenancy.status];
  const per = tenancy.rent ? (tenancy.rent.period === "monthly" ? "month" : tenancy.rent.period.replace(/ly$/, "")) : "";
  return (
    <View style={[styles.tenancy, first ? null : styles.ruled]}>
      <View style={styles.tenancyHead}>
        <View style={styles.placeMark}>
          <Ionicons name="home-outline" size={18} color={C.kola["600"]} />
        </View>
        <View style={styles.grow}>
          <Type variant="bodyStrong" numberOfLines={2} style={styles.rowTitle}>
            {tenancy.place.title}
            {tenancy.place.space ? <Type variant="body" style={{ color: C.ink["700"] }}> · {tenancy.place.space}</Type> : null}
          </Type>
          <Type variant="caption" numberOfLines={1} style={styles.rowNote}>{[tenancy.place.space_type, where].filter(Boolean).join(" · ")}</Type>
        </View>
        <View style={[styles.standing, { backgroundColor: standing.fill }]}>
          <Type variant="captionStrong" style={[styles.standingText, { color: standing.ink }]}>{tenancyStanding(tenancy)}</Type>
        </View>
      </View>

      <ReviewNote review={tenancy.review} />

      <View style={styles.facts}>
        <Fact label="Period">
          <Type variant="body" style={styles.factValue}>{tenancyPeriod(tenancy)}</Type>
          {tenancy.months ? (
            <Type variant="caption" style={styles.rowFaint}>
              {duration(tenancy.months)}{tenancy.agreed_until ? ` · agreed to ${monthYear(tenancy.agreed_until)}` : ""}
            </Type>
          ) : null}
        </Fact>
        <Fact label="Agreement">
          <View style={styles.markRow}><StatusMark status={tenancy.credential.status} /></View>
          <Type variant="caption" style={styles.rowFaint}>
            {tenancy.credential.basis}
            {tenancy.credential.as_of ? ` · ${dayMonthYear(tenancy.credential.as_of)}` : ""}
            {tenancy.agreements > 1 ? ` · ${tenancy.agreements - 1} renewal${tenancy.agreements > 2 ? "s" : ""}` : ""}
          </Type>
        </Fact>
        <Fact label="Property">
          {tenancy.property.verified ? (
            <View style={styles.inlineMark}>
              <Ionicons name="shield-checkmark" size={13} color={C.kola["600"]} />
              <Type variant="body" style={[styles.factValue, { color: C.kola["600"] }]}>Verified by Danpa HQ</Type>
            </View>
          ) : (
            <Type variant="body" style={[styles.factValue, { color: C.ink["500"] }]}>Not verified by Danpa HQ</Type>
          )}
          {tenancy.property.as_of ? <Type variant="caption" style={styles.rowFaint}>Checked {dayMonthYear(tenancy.property.as_of)}</Type> : null}
        </Fact>
        {tenancy.rent ? (
          <Fact label="Rent">
            <Type variant="amount" style={styles.factValue}>{tenancy.rent.formatted}</Type>
            <Type variant="caption" style={styles.rowFaint}>per {per}</Type>
          </Fact>
        ) : null}
      </View>

      {tenancy.payments ? <PaymentRecord payments={tenancy.payments} /> : null}
      {action ? <View style={styles.tenancyFoot}>{action}</View> : null}
    </View>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.fact}>
      <Type variant="label" style={styles.factLabel}>{label}</Type>
      <View style={styles.factBody}>{children}</View>
    </View>
  );
}

function PaymentRecord({ payments }: { payments: PassportPayments }) {
  if (payments.status === "none" && !payments.review) {
    return (
      <View style={[styles.payments, styles.paymentsEmpty]}>
        <Ionicons name="wallet-outline" size={16} color={FAINT} />
        <Type variant="caption" style={[styles.rowNote, styles.grow]}>{payments.basis}</Type>
      </View>
    );
  }
  const settled = payments.on_time + payments.late + payments.overdue;
  const bar = settled
    ? [
        { key: "on-time", count: payments.on_time, label: "on time", tone: C.kola["600"] },
        { key: "late", count: payments.late, label: "late", tone: C.harmattan["500"] },
        { key: "overdue", count: payments.overdue, label: "overdue now", tone: C.laterite["600"] },
      ].filter((part) => part.count > 0)
    : [];
  // `count`, never `value`: Expo’s Babel preset runs the Worklets plugin, which
  // reads `x.value` in an inline style as a Reanimated shared value and injects a
  // require of Reanimated — and loading that in Expo Go breaks the screen.
  const counts: { key: string; count: number; label: string; dot: string }[] = [
    { key: "confirmed", count: payments.confirmed, label: "confirmed", dot: C.ink["300"] },
    ...(settled ? [{ key: "on-time", count: payments.on_time, label: "on time", dot: C.kola["600"] }] : []),
    ...(payments.late ? [{ key: "late", count: payments.late, label: "late", dot: C.harmattan["500"] }] : []),
    ...(payments.overdue ? [{ key: "overdue", count: payments.overdue, label: "overdue now", dot: C.laterite["600"] }] : []),
    ...(payments.awaiting ? [{ key: "awaiting", count: payments.awaiting, label: "awaiting confirmation", dot: C.harmattan["500"] }] : []),
    ...(payments.disputed ? [{ key: "disputed", count: payments.disputed, label: "disputed", dot: C.laterite["600"] }] : []),
  ];

  return (
    <View style={styles.payments}>
      <View style={styles.paymentsHead}>
        <Ionicons name="wallet-outline" size={16} color={C.kola["600"]} />
        <Type variant="bodyStrong" style={[styles.rowTitle, styles.grow]}>Rent payments</Type>
        <StatusMark status={payments.status} />
      </View>
      <ReviewNote review={payments.review} />
      <Type variant="caption" style={styles.rowNote}>{payments.basis}</Type>

      {bar.length ? (
        <View style={styles.bar} accessible accessibilityRole="image" accessibilityLabel={bar.map((part) => `${part.count} ${part.label}`).join(", ")}>
          {bar.map((part) => <View key={part.key} style={{ flexGrow: part.count, minWidth: 6, backgroundColor: part.tone }} />)}
        </View>
      ) : null}

      <View style={styles.counts}>
        {counts.map((row) => (
          <View key={row.key} style={styles.count}>
            <View style={[styles.countDot, { backgroundColor: row.dot }]} />
            <Type variant="caption" style={styles.rowNote}>
              <Type variant="captionStrong" style={styles.countValue}>{row.count}</Type> {row.label}
            </Type>
          </View>
        ))}
      </View>
      {payments.total_formatted || payments.last_paid_on ? (
        <View style={styles.paymentsFoot}>
          {payments.total_formatted ? <Type variant="caption" style={styles.rowNote}>{payments.total_formatted} confirmed</Type> : null}
          {payments.last_paid_on ? <Type variant="caption" style={styles.rowFaint}>Last confirmed payment {dayMonthYear(payments.last_paid_on)}</Type> : null}
        </View>
      ) : null}
    </View>
  );
}

// --- timeline ---------------------------------------------------------------------------------------

const TIMELINE_GLYPH: Record<TimelineEvent["kind"], IconName> = {
  joined: "person-outline",
  identity: "shield-checkmark-outline",
  agreement: "document-text-outline",
  moved_in: "home-outline",
  upcoming: "time-outline",
  ended: "archive-outline",
};

function timelineTone(kind: TimelineEvent["kind"]) {
  if (kind === "agreement" || kind === "moved_in") return { ink: C.kola["600"], fill: C.kola["50"], ring: alpha(C.kola["600"], 0.28) };
  if (kind === "identity") return { ink: C.gold["600"], fill: C.gold["50"], ring: alpha(C.gold["500"], 0.35) };
  if (kind === "upcoming") return { ink: C.lagoon["600"], fill: C.lagoon["100"], ring: C.lagoon["100"] };
  return { ink: C.ink["500"], fill: C.field["0"], ring: C.field["200"] };
}

export function Timeline({ events, limit }: { events: TimelineEvent[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? events.slice(0, limit) : events;
  return (
    <PassportSection title="Timeline">
      <View style={styles.timeline}>
        <View style={styles.timelineRail} />
        {shown.map((event, index) => {
          const tone = timelineTone(event.kind);
          return (
            <View key={`${event.kind}-${event.on}-${index}`} style={styles.timelineRow}>
              <View style={[styles.timelineDot, { backgroundColor: tone.fill, borderColor: tone.ring }]}>
                <Ionicons name={TIMELINE_GLYPH[event.kind]} size={13} color={tone.ink} />
              </View>
              <View style={styles.grow}>
                <Type variant="body" style={styles.timelineTitle}>{event.title}</Type>
                {event.detail ? <Type variant="caption" style={styles.rowFaint}>{event.detail}</Type> : null}
              </View>
              <Type variant="caption" style={styles.timelineDate}>{dayMonthYear(event.on)}</Type>
            </View>
          );
        })}
      </View>
      {shown.length < events.length ? <MoreRow label={`Show all ${events.length} events`} onPress={() => setAll(true)} /> : null}
    </PassportSection>
  );
}

// --- reading it -----------------------------------------------------------------------------------------

export function StatusLegend() {
  return (
    <PassportSection title="How to read this">
      {STATUS_MEANING.map((row, index) => (
        <View key={row.status} style={[styles.legendRow, index ? styles.ruled : null]}>
          <View style={styles.legendMark}><StatusMark status={row.status} /></View>
          <Type variant="caption" style={[styles.rowNote, styles.grow]}>{row.meaning}</Type>
        </View>
      ))}
    </PassportSection>
  );
}

export function NotRecorded({ view, audience }: { view: PassportView; audience: Audience }) {
  if (!view.not_recorded.length) return null;
  const things = view.not_recorded.map((key) => NOT_RECORDED_LABEL[key] ?? key);
  const list = things.length > 1 ? `${things.slice(0, -1).join(", ")} or ${things.at(-1)}` : things[0];
  const first = view.holder.name.split(" ")[0];
  return (
    <View style={styles.notRecorded}>
      <Ionicons name="information-circle-outline" size={16} color={C.lagoon["600"]} style={{ marginTop: 1 }} />
      <Type variant="caption" style={[styles.rowNote, styles.grow]}>
        Danpa HQ doesn’t record {list} yet, so {audience === "owner" ? "their absence here says nothing about you" : `their absence says nothing about ${first}`}.
        {" "}History from before Danpa HQ isn’t shown either.
      </Type>
    </View>
  );
}

/** The whole document, for the preview: what the recipient will read. */
export function PassportDocument({ view, audience, coverFooter }: { view: PassportView; audience: Audience; coverFooter?: ReactNode }) {
  return (
    <View style={styles.document}>
      <PassportCover view={view} audience={audience} footer={coverFooter} />
      {view.tenancies.length ? (
        <PassportSection title="Housing record" count={String(view.tenancies.length)}>
          {view.tenancies.map((tenancy, index) => <TenancyRecord key={tenancy.id} tenancy={tenancy} first={index === 0} />)}
        </PassportSection>
      ) : null}
      {view.identity ? <IdentitySection identity={view.identity} /> : null}
      {view.timeline.length > 1 ? <Timeline events={view.timeline} /> : null}
      <StatusLegend />
      <NotRecorded view={view} audience={audience} />
    </View>
  );
}

const styles = StyleSheet.create({
  document: { gap: space[5] },
  grow: { flex: 1, minWidth: 0 },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },

  cover: {
    overflow: "hidden",
    gap: space[5],
    padding: space[5],
    borderRadius: 20,
    backgroundColor: C.kola["900"],
  },
  coverLoading: { minHeight: 228, backgroundColor: C.kola["800"], opacity: 0.85 },
  coverTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  wordmark: { flexDirection: "row", alignItems: "center", gap: space[2] },
  wordmarkText: { color: COVER_FOIL, letterSpacing: 1.4 },
  wordmarkSub: { color: COVER_MUTED, fontWeight: "400", letterSpacing: 0.9 },
  mode: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: space[2],
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: alpha(COVER_FOIL, 0.4),
  },
  modeText: { fontSize: 11.5, lineHeight: 15, color: COVER_MUTED },
  holder: { flexDirection: "row", alignItems: "center", gap: space[4] },
  monogram: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: alpha(COVER_FOIL, 0.8),
    backgroundColor: alpha(COVER_FOIL, 0.08),
  },
  monogramText: { color: COVER_FOIL, letterSpacing: 1 },
  holderText: { flex: 1, minWidth: 0, gap: 3 },
  holderName: { color: "#FFFBF2" },
  holderId: { flexDirection: "row", alignItems: "center", gap: 5 },
  coverCaption: { color: COVER_MUTED },
  figures: { flexDirection: "row", gap: space[3] },
  figure: { flex: 1, minWidth: 0, gap: 2 },
  figureLabel: { color: COVER_FOIL, letterSpacing: 1, opacity: 0.9 },
  figureLabelBox: { minHeight: 30, justifyContent: "flex-end" },
  figureValue: { fontSize: 24, lineHeight: 29, color: COVER_INK, fontVariant: ["tabular-nums"] },
  figureNote: { fontSize: 12, lineHeight: 16, color: COVER_MUTED },
  coverFoot: {
    gap: 4,
    paddingTop: space[3],
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderTopColor: alpha(COVER_FOIL, 0.32),
  },

  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  statusText: { fontSize: 11.5, lineHeight: 15 },
  markRow: { flexDirection: "row" },

  review: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    marginTop: space[3],
    padding: space[3],
    borderRadius: radius.sm,
    backgroundColor: alpha(C.laterite["100"], 0.75),
  },
  reviewText: { flex: 1, color: C.laterite["600"] },
  reviewSince: { color: C.ink["700"] },

  section: { gap: space[2] },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 32, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 16, lineHeight: 21, color: INK },
  sectionCount: { color: MUTED },
  card: {
    paddingHorizontal: space[4],
    paddingBottom: space[1],
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: EDGE,
    backgroundColor: C.field["0"],
  },

  identityRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[3] },
  glyph: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, lineHeight: 20, color: INK },
  rowNote: { color: MUTED },
  rowFaint: { color: FAINT },
  fineprint: {
    paddingTop: space[3],
    paddingBottom: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
    color: FAINT,
    fontSize: 12,
    lineHeight: 17,
  },

  tenancy: { gap: space[3], paddingVertical: space[4] },
  tenancyHead: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  placeMark: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: C.kola["50"] },
  standing: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, marginTop: 2 },
  standingText: { fontSize: 11.5, lineHeight: 15 },
  facts: { gap: space[3], paddingLeft: 36 + space[3] },
  fact: { gap: 3 },
  factLabel: { color: FAINT },
  factBody: { gap: 3 },
  factValue: { color: INK },
  inlineMark: { flexDirection: "row", alignItems: "center", gap: 5 },
  // Stacked, so a long review line wraps inside the record rather than pushing the page sideways.
  tenancyFoot: { alignItems: "flex-start", gap: 2, paddingLeft: 36 + space[3] },

  payments: {
    gap: space[2],
    marginLeft: 36 + space[3],
    padding: space[3],
    borderRadius: 12,
    backgroundColor: C.field["50"],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: EDGE,
  },
  paymentsEmpty: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  paymentsHead: { flexDirection: "row", alignItems: "center", gap: space[2] },
  bar: { flexDirection: "row", gap: 2, height: 6, overflow: "hidden", borderRadius: radius.pill, marginTop: 2 },
  counts: { flexDirection: "row", flexWrap: "wrap", columnGap: space[4], rowGap: 4 },
  count: { flexDirection: "row", alignItems: "center", gap: 5 },
  countDot: { width: 6, height: 6, borderRadius: 3 },
  countValue: { color: INK, fontVariant: ["tabular-nums"] },
  paymentsFoot: { gap: 2 },

  timeline: { paddingVertical: space[2] },
  timelineRail: { position: "absolute", top: space[2] + 14, bottom: space[2] + 14, left: 13, width: 2, borderRadius: 1, backgroundColor: C.field["200"] },
  timelineRow: { flexDirection: "row", alignItems: "flex-start", gap: space[3], paddingVertical: 6 },
  timelineDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  timelineTitle: { fontSize: 14.5, lineHeight: 20, color: INK },
  timelineDate: { color: FAINT, fontSize: 12, lineHeight: 20, fontVariant: ["tabular-nums"] },

  legendRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[3] },
  legendMark: { width: 112 },
  notRecorded: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    padding: space[3],
    borderRadius: 12,
    backgroundColor: alpha(C.lagoon["100"], 0.7),
  },
});
