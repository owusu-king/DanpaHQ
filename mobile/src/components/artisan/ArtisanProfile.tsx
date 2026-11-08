import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  CERTIFICATE_LABEL,
  getArtisan,
  inviteArtisan,
  inviteToDirectJob,
  listMyDirectJobs,
  suggestArtisan,
  type DirectJob,
  type PublicArtisan,
  type WorkKind,
} from "@/artisan";
import { Facts, shortDate } from "@/components/artisan/ArtisanChips";
import { ProblemReport } from "@/components/artisan/WorkFinish";
import { Pill } from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import { theme } from "@/theme";

/**
 * One artisan, shared by the Artisans sheet and the durable profile route.
 *
 * Opened from a repair or a posted job (`request`, `kind`, `mode`), it also
 * offers the one act that allows this reader: invite to quote, or — for a
 * tenant on a repair — suggest to the landlord. Inviting tells the artisan the
 * area and the job, never the address; a suggestion tells only the people who
 * run the property.
 */

const AMBER = theme.color.harmattan["600"];
const LAGOON = theme.color.lagoon["600"];
const WHITE = theme.color.field["0"];
const MUTED = theme.color.ink["500"];

type ForRequest = { id: string; kind: WorkKind; mode: "invite" | "suggest"; label: string };

export function ArtisanProfile({ id, forRequest, onNavigate }: { id: string; forRequest?: ForRequest; onNavigate?: (href: Href) => void }) {
  const [artisan, setArtisan] = useState<PublicArtisan | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getArtisan(id)
      .then((next) => { if (live) setArtisan(next); })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not open this artisan."); });
    return () => { live = false; };
  }, [id]);

  if (error) return <Notice tone="error" title={error} />;
  if (!artisan) return <ActivityIndicator color={AMBER} style={{ paddingVertical: space[8] }} />;

  return (
    <View style={{ gap: space[4] }}>
      <View style={styles.card}>
        <View style={styles.identity}>
          <View style={styles.portrait}>
            {artisan.cover_url ? <Image source={{ uri: artisan.cover_url }} style={StyleSheet.absoluteFill} /> : <Ionicons name="hammer-outline" size={26} color={MUTED} />}
          </View>
          <View style={styles.identityCopy}>
            <Type variant="captionStrong" style={styles.eyebrow}>Artisan profile</Type>
            <Type variant="title2" accessibilityRole="header">{artisan.name}</Type>
            <Type variant="caption" style={{ color: theme.color.ink["700"] }}>{artisan.trades.map((trade) => trade.label).join(" · ")}</Type>
            <View style={styles.area}>
              <Ionicons name="location-outline" size={14} color={MUTED} />
              <Type variant="caption" style={{ color: MUTED, flexShrink: 1 }}>Works in {artisan.districts.map((district) => district.name).join(", ")}</Type>
            </View>
          </View>
        </View>
        <Facts artisan={artisan} compact />
        {artisan.is_you ? null : forRequest ? (
          <AskAction artisanId={artisan.id} name={artisan.name} forRequest={forRequest} />
        ) : (
          <QuoteAsk artisan={artisan} onNavigate={onNavigate} />
        )}
      </View>

      {artisan.portfolio.some((photo) => photo.url) ? (
        <View style={styles.gallery} accessibilityLabel="Their work">
          {artisan.portfolio.map((photo, index) =>
            photo.url ? <Image key={photo.id} source={{ uri: photo.url }} style={styles.photo} accessibilityLabel={`Work photo ${index + 1}`} /> : null,
          )}
        </View>
      ) : null}

      <View style={styles.card}>
        {artisan.bio ? (
          <View style={{ gap: space[1] }}>
            <Type variant="captionStrong" style={styles.eyebrow}>About</Type>
            <Type variant="body">{artisan.bio}</Type>
          </View>
        ) : null}
        <View style={{ gap: space[2] }}>
          <Type variant="captionStrong" style={styles.eyebrow}>Certificates</Type>
          {artisan.certificates.length ? artisan.certificates.map((certificate) => (
            <View key={certificate.id} style={styles.cert}>
              <View style={{ gap: 1 }}>
                <Type variant="captionStrong">{certificate.trade_label}</Type>
                <Type variant="caption" style={{ color: MUTED }}>
                  {certificate.issuing_body}
                  {certificate.expires_on ? ` · expires ${shortDate(certificate.expires_on)}` : ""}
                </Type>
              </View>
              <Type variant="captionStrong" style={{ color: certificate.status === "verified" ? theme.color.kola["800"] : certificate.status === "expired" ? MUTED : LAGOON, fontSize: 12 }}>
                {CERTIFICATE_LABEL[certificate.status]}
                {certificate.status === "verified" && certificate.verified_at ? ` ${shortDate(certificate.verified_at)}` : ""}
              </Type>
            </View>
          )) : <Type variant="caption" style={{ color: MUTED }}>None shown. Certificates are optional.</Type>}
        </View>
        <View style={{ gap: space[1] }}>
          <Type variant="captionStrong" style={styles.eyebrow}>Reviews</Type>
          {artisan.reviews.length ? artisan.reviews.map((review) => (
            <View key={review.id} style={styles.review}>
              <Type variant="body">{review.text}</Type>
              <Type variant="caption" style={{ color: MUTED }}>
                {review.author} · {shortDate(review.at)} · {review.would_hire_again ? "Would hire again" : "Would not hire again"}
              </Type>
            </View>
          )) : (
            <Type variant="caption" style={{ color: MUTED }}>No reviews yet.</Type>
          )}
        </View>
      </View>

      <Type variant="caption" style={styles.foot}>
        On Danpa HQ since {shortDate(artisan.member_since)}. Danpa HQ checks identity and certificates and keeps a record of each job; it does not guarantee anybody&apos;s work.
      </Type>
      {artisan.is_you ? null : <ProblemReport target={{ kind: "artisan", artisanId: artisan.id }} />}
    </View>
  );
}

/**
 * A profile reached by browsing: ask this artisan to quote — for one of your
 * open jobs, or a new job posted for them, which asks them as it is posted. A
 * repair on a rented home is asked about from the repair itself.
 */
function QuoteAsk({ artisan, onNavigate }: { artisan: PublicArtisan; onNavigate?: (href: Href) => void }) {
  const router = useRouter();
  const navigate = onNavigate ?? router.push;
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<DirectJob[] | null>(null);
  const [asked, setAsked] = useState<Record<string, "busy" | "done">>({});
  const [error, setError] = useState("");
  const first = artisan.name.split(" ")[0] || artisan.name;

  useEffect(() => {
    if (!open || jobs) return;
    listMyDirectJobs()
      .then((rows) => setJobs(rows.filter((row) => row.permissions.invite)))
      .catch(() => setJobs([]));
  }, [open, jobs]);

  async function ask(job: DirectJob) {
    setAsked((current) => ({ ...current, [job.job.id]: "busy" }));
    setError("");
    try {
      await inviteToDirectJob(job.job.id, artisan.id);
      setAsked((current) => ({ ...current, [job.job.id]: "done" }));
    } catch (cause) {
      setAsked((current) => { const next = { ...current }; delete next[job.job.id]; return next; });
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    }
  }

  if (!open) {
    return (
      <View style={{ marginTop: space[2] }}>
        <Pill icon="paper-plane-outline" label={`Ask ${first} for a quote`} onPress={() => setOpen(true)} />
      </View>
    );
  }
  return (
    <View style={styles.quoteAsk}>
      <Type variant="bodyStrong">What should {first} quote for?</Type>
      {error ? <Notice tone="error" title={error} /> : null}
      {jobs === null ? <ActivityIndicator color={AMBER} /> : jobs.map((job) => (
        <View key={job.job.id} style={styles.quoteAskRow}>
          <View style={{ flex: 1, gap: 1 }}>
            <Type variant="bodyStrong" numberOfLines={1}>{job.job.title}</Type>
            <Type variant="caption" style={{ color: MUTED }} numberOfLines={1}>{job.job.trade_display} · {job.job.area.locality}</Type>
          </View>
          {asked[job.job.id] === "done" ? (
            <Pill tone="quiet" label="Asked · open" onPress={() => navigate({ pathname: "/(app)/direct-job", params: { id: job.job.id } } as never)} />
          ) : (
            <Pill tone="quiet" label="Ask about this" busy={asked[job.job.id] === "busy"} busyLabel="Asking…" onPress={() => void ask(job)} />
          )}
        </View>
      ))}
      <Pill
        icon="add"
        label={`Post a new job for ${first}`}
        onPress={() =>
          navigate({
            pathname: "/(app)/direct-job-new",
            params: { invite: artisan.id, inviteName: artisan.name, trade: artisan.trades[0]?.value ?? "" },
          } as never)
        }
      />
    </View>
  );
}

function AskAction({ artisanId, name, forRequest }: { artisanId: string; name: string; forRequest: ForRequest }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  const invite = forRequest.mode === "invite";

  async function ask() {
    setState("busy");
    setError("");
    try {
      if (forRequest.kind === "direct_job") await inviteToDirectJob(forRequest.id, artisanId);
      else if (invite) await inviteArtisan(forRequest.id, artisanId);
      else await suggestArtisan(forRequest.id, artisanId);
      setState("done");
    } catch (cause) {
      setState("idle");
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    }
  }

  if (state === "done") {
    return (
      <View style={styles.asked}>
        <Type variant="caption" style={{ color: theme.color.kola["800"] }}>
          {invite
            ? `${name} has been asked to quote. They see the area and the job, not the address.`
            : `Suggested. Your landlord decides whether to ask ${name} to quote.`}
        </Type>
      </View>
    );
  }
  return (
    <View style={{ gap: space[2], marginTop: space[2] }}>
      <Pill
        icon={invite ? "paper-plane-outline" : "chatbubble-outline"}
        label={invite ? `Invite to quote for ${forRequest.label}` : "Suggest to your landlord"}
        busy={state === "busy"}
        busyLabel="Sending…"
        onPress={() => void ask()}
      />
      {error ? <Notice tone="error" title={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[5],
  },
  identity: { flexDirection: "row", alignItems: "center", gap: 14 },
  identityCopy: { flex: 1, minWidth: 0, gap: 5 },
  portrait: { width: 60, height: 76, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: theme.color.field["100"] },
  eyebrow: { color: MUTED, fontSize: 11, lineHeight: 16, letterSpacing: 1, textTransform: "uppercase" },
  area: { flexDirection: "row", alignItems: "center", gap: 4 },
  gallery: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  photo: { width: 104, height: 78, borderRadius: 8, backgroundColor: theme.color.field["100"] },
  cert: { gap: 8, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.field["200"] },
  foot: { color: MUTED, paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.field["200"] },
  review: { gap: 8, marginTop: space[2], paddingLeft: space[4], borderLeftWidth: 2, borderLeftColor: theme.color.field["200"] },
  quoteAsk: { gap: space[3], marginTop: space[2], padding: space[4], borderRadius: 16, backgroundColor: theme.color.harmattan["100"] },
  quoteAskRow: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: 12, backgroundColor: WHITE },
  asked: { marginTop: space[2], padding: space[3], borderRadius: 14, backgroundColor: theme.color.kola["50"] },
});
