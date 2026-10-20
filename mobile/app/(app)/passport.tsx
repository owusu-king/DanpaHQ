import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { useHomeDensity } from "@/components/home/plinth";
import { CorrectionSheet, type CorrectionTarget } from "@/components/passport/CorrectionSheet";
import {
  CoverSkeleton,
  IdentitySection,
  NotRecorded,
  PassportCover,
  PassportSection,
  StatusLegend,
  TenancyRecord,
  Timeline,
} from "@/components/passport/PassportDocument";
import { SharedLinks, type PageNotice } from "@/components/passport/SharedLinks";
import { ShareSheet } from "@/components/passport/ShareSheet";
import { EDGE, KOLA, MUTED } from "@/components/portfolio/PortfolioList";
import { Act, Empty, Fold } from "@/components/work/WorkParts";
import { Button, Notice, Type, space } from "@/components/ui";
import {
  getMyPassport,
  listPassportShares,
  type MyPassport,
  type PassportCorrection,
  type PassportShare,
  type PassportTenancy,
} from "@/passport";
import { correctionFor, dayMonthYear, duration } from "@/passportMeaning";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { theme } from "@/theme";

/**
 * Housing Passport: the tenant's verified housing history, and who can see it.
 *
 * The mobile twin of web's `/passport`, read in the order web's phone layout
 * takes: the cover that summarises it, the one action (share), who it is shared
 * with, then the evidence — the housing record, the identity checks, the
 * timeline — and how to read it. Every status comes from the backend.
 */
export default function PassportScreen() {
  const { state } = useAuth();
  if (state.status !== "signed_in") {
    return <AuthPrompt title="Housing Passport" body="Sign in to see your housing record." next="/(app)/passport" />;
  }
  return <Passport />;
}

function Passport() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const [passport, setPassport] = useState<MyPassport | null>(null);
  const [error, setError] = useState("");
  const [shares, setShares] = useState<PassportShare[] | null>(null);
  const [sharesError, setSharesError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState<CorrectionTarget | null>(null);
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const [showPast, setShowPast] = useState(false);

  const loadPassport = useCallback(async () => {
    try {
      const next = await getMyPassport();
      setPassport(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Your passport didn’t load.");
    }
  }, []);

  const loadShares = useCallback(async () => {
    try {
      const next = await listPassportShares();
      setShares(next);
      setSharesError("");
    } catch (cause) {
      setShares((current) => current ?? []);
      setSharesError(cause instanceof ApiFailure ? cause.error.message : "Your links didn’t load.");
    }
  }, []);

  useEffect(() => { void loadPassport(); void loadShares(); }, [loadPassport, loadShares]);

  // A notice says what just happened, then gets out of the way.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const retry = useCallback(async () => {
    setRetrying(true);
    await Promise.all([loadPassport(), loadShares()]);
    setRetrying(false);
  }, [loadPassport, loadShares]);

  const replaceShare = useCallback((share: PassportShare) => {
    setShares((current) => {
      const rest = (current ?? []).filter((row) => row.id !== share.id);
      return [share, ...rest].sort((left, right) => right.created_at.localeCompare(left.created_at));
    });
  }, []);

  const reported = useCallback(() => {
    setNotice({ tone: "success", title: "Sent for review", body: "Danpa HQ will reply in Support. The record shows as disputed until then." });
    void loadPassport();
  }, [loadPassport]);

  const followSupport = useCallback((correction: PassportCorrection) => {
    if (correction.support_case_id) router.push({ pathname: "/(app)/support/[id]", params: { id: correction.support_case_id } });
    else router.push("/(app)/help" as never);
  }, [router]);

  const summary = useMemo(() => {
    if (!passport) return "";
    const { tenancies, months, payments_confirmed } = passport.summary;
    if (!tenancies) return "Your verified housing record, built from tenancies on Danpa HQ";
    return [
      `${tenancies} tenanc${tenancies === 1 ? "y" : "ies"}`,
      `${duration(months)} on record`,
      payments_confirmed ? `${payments_confirmed} rent payment${payments_confirmed === 1 ? "" : "s"} confirmed` : "",
    ].filter(Boolean).join(" · ");
  }, [passport]);

  // Homes you live in, are moving to or are waiting on lead; ended ones fold
  // away, unless one is under review, which must stay in sight. With no live
  // home, the most recent past one leads so the record never opens empty.
  const record = useMemo(() => {
    const tenancies = passport?.tenancies ?? [];
    const leads = (row: PassportTenancy) => row.status !== "ended" || Boolean(row.review || row.payments?.review);
    let lead = tenancies.filter(leads);
    let past = tenancies.filter((row) => !leads(row));
    if (!lead.length) { lead = past.slice(0, 1); past = past.slice(1); }
    return { lead, past };
  }, [passport]);

  const failed = Boolean(error) && !passport;

  return (
    <IndexGround>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: space[5] }}
        refreshControl={passport ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([loadPassport(), loadShares()]);
              setRefreshing(false);
            }}
            tintColor={KOLA}
          />
        ) : undefined}
      >
        {failed ? (
          <Empty
            crossed={false}
            icon="cloud-offline-outline"
            title="Your passport didn’t load"
            hint={`${error} Check your connection and try again.`}
            action={<Button variant="secondary" label="Try again" busy={retrying} busyLabel="Retrying…" onPress={() => void retry()} />}
          />
        ) : !passport ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your passport" style={styles.loading}>
            <CoverSkeleton />
            <Bone height={48} round={24} />
            <Bone width="38%" height={16} />
            <Bone height={140} round={16} />
          </View>
        ) : (
          <>
            <View style={styles.head}>
              <PassportCover view={passport} audience="owner" />
              <Type variant="caption" style={styles.summary}>{summary}</Type>
              {error ? <Notice tone="error" title={error} body="Pull down to try again." /> : null}
              {notice ? <Notice tone={notice.tone} title={notice.title} body={notice.body} /> : null}
              <Button
                label="Share passport"
                icon={<Ionicons name="share-outline" size={18} color={theme.color.field["0"]} />}
                onPress={() => setSharing(true)}
              />
            </View>

            <SharedLinks shares={shares} error={sharesError} onShare={() => setSharing(true)} onChanged={replaceShare} onNotice={setNotice} />

            <PassportSection
              title="Housing record"
              count={passport.tenancies.length ? String(passport.tenancies.length) : undefined}
              card={false}
            >
              {passport.tenancies.length ? (
                <>
                  <View style={styles.card}>
                    {record.lead.map((tenancy, index) => (
                      <TenancyRecord
                        key={tenancy.id}
                        tenancy={tenancy}
                        first={index === 0}
                        action={<RecordAction tenancy={tenancy} corrections={passport.corrections} onReport={setReporting} onFollow={followSupport} />}
                      />
                    ))}
                  </View>
                  {record.past.length ? (
                    <Fold
                      icon="home-outline"
                      title="Past homes"
                      summary="Ended tenancies, each with its rent record"
                      count={record.past.length}
                      open={showPast}
                      onToggle={() => setShowPast((value) => !value)}
                    />
                  ) : null}
                  {showPast && record.past.length ? (
                    <View style={styles.card}>
                      {record.past.map((tenancy, index) => (
                        <TenancyRecord
                          key={tenancy.id}
                          tenancy={tenancy}
                          first={index === 0}
                          action={<RecordAction tenancy={tenancy} corrections={passport.corrections} onReport={setReporting} onFollow={followSupport} />}
                        />
                      ))}
                    </View>
                  ) : null}
                </>
              ) : (
                <Empty
                  icon="home-outline"
                  title="No tenancies on Danpa HQ yet"
                  hint="When you and a landlord accept a tenancy agreement here, it joins your passport with its rent record. Nothing missing counts against you."
                  action={<Act primary icon="compass-outline" label="Explore rentals" onPress={() => router.push("/(app)/(tabs)/explore" as never)} />}
                  compact
                />
              )}
            </PassportSection>

            {passport.identity ? (
              <IdentitySection
                identity={passport.identity}
                action={<IdentityAction corrections={passport.corrections} onReport={setReporting} onFollow={followSupport} />}
              />
            ) : null}

            {passport.timeline.length ? <Timeline events={passport.timeline} limit={6} /> : null}

            <StatusLegend />
            <NotRecorded view={passport} audience="owner" />
          </>
        )}
      </ScrollView>

      {passport ? (
        <ShareSheet open={sharing} passport={passport} onClose={() => setSharing(false)} onCreated={replaceShare} />
      ) : null}
      <CorrectionSheet target={reporting} onClose={() => setReporting(null)} onReported={reported} />
    </IndexGround>
  );
}

/** Report a problem, or — once reported — where the review stands. */
function RecordAction({
  tenancy,
  corrections,
  onReport,
  onFollow,
}: {
  tenancy: PassportTenancy;
  corrections: PassportCorrection[];
  onReport: (target: CorrectionTarget) => void;
  onFollow: (correction: PassportCorrection) => void;
}) {
  const open = [correctionFor(corrections, "tenancy", tenancy.id), correctionFor(corrections, "payments", tenancy.id)]
    .filter((row): row is PassportCorrection => row?.state === "under_review");
  const label = `${tenancy.place.title}${tenancy.place.space ? ` · ${tenancy.place.space}` : ""}`;
  return (
    <>
      {open[0] ? <ReviewLink correction={open[0]} onFollow={onFollow} /> : null}
      {open.length < 2 ? (
        <ReportLink onPress={() => onReport({ kind: "tenancy", tenancyId: tenancy.id, label, hasPayments: Boolean(tenancy.payments?.confirmed) })} />
      ) : null}
    </>
  );
}

function IdentityAction({ corrections, onReport, onFollow }: {
  corrections: PassportCorrection[];
  onReport: (target: CorrectionTarget) => void;
  onFollow: (correction: PassportCorrection) => void;
}) {
  const open = correctionFor(corrections, "identity");
  if (open?.state === "under_review") return <ReviewLink correction={open} onFollow={onFollow} />;
  return <ReportLink onPress={() => onReport({ kind: "identity" })} />;
}

function ReportLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={6}
      {...pressableFeedback(theme.color.laterite["100"])}
      style={({ pressed }) => [styles.link, pressed ? { backgroundColor: theme.color.laterite["100"] } : null]}
    >
      <Ionicons name="alert-circle-outline" size={14} color={MUTED} />
      <Type variant="captionStrong" style={{ color: MUTED }}>Report a problem</Type>
    </Pressable>
  );
}

function ReviewLink({ correction, onFollow }: { correction: PassportCorrection; onFollow: (correction: PassportCorrection) => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => onFollow(correction)}
      hitSlop={6}
      {...pressableFeedback(theme.color.laterite["100"])}
      style={({ pressed }) => [styles.link, pressed ? { backgroundColor: theme.color.laterite["100"] } : null]}
    >
      <Ionicons name="time-outline" size={14} color={theme.color.laterite["600"]} />
      <Type variant="captionStrong" style={{ color: theme.color.laterite["600"], flexShrink: 1 }}>
        Review requested {dayMonthYear(correction.reported_on)} · Follow in Support
      </Type>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { gap: space[3] },
  card: {
    paddingHorizontal: space[4],
    paddingBottom: space[1],
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: EDGE,
    backgroundColor: theme.color.field["0"],
  },
  summary: { color: MUTED, paddingHorizontal: 2 },
  loading: { gap: space[4] },
  link: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 32,
    paddingHorizontal: space[2],
    marginLeft: -space[2],
    borderRadius: 8,
  },
});
