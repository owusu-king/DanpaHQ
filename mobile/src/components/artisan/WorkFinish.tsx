import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  ABOUT_ARTISAN,
  ABOUT_CUSTOMER,
  MAX_DONE_PHOTOS,
  MAX_EVIDENCE_FILES,
  MAX_RECEIPTS,
  PAID_NOTE,
  confirmDirectJob,
  recordPaid,
  reopenDirectJob,
  reportArtisan,
  reportJobProblem,
  reportWorkDone,
  reviewJob,
  type ArtisanInvitation,
  type WorkFinish as Finish,
  type WorkReport,
} from "@/artisan";
import { shortDate } from "@/components/artisan/ArtisanChips";
import { ToggleField } from "@/components/filters/FilterFields";
import { GroupLabel, Pill, RecordPanel } from "@/components/record/RecordSurfaces";
import { Chip, Field, Notice, Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { uploadImage } from "@/provider";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * How artisan work finishes, on a repair, a posted job, and the artisan's own
 * job. Mirrors web's `WorkFinish`: each "done" the artisan reported with its
 * photographs (receipts for the money's side), then the next step the backend
 * allows — confirm or reopen a posted job, record payment, write the one review.
 * On a repair the tenant confirms in the maintenance section, as before.
 *
 * Recording payment moves no money and says so; a review is words and whether
 * the payer would hire them again, never a score.
 */

const KOLA = theme.color.kola["600"];
const KOLA_DEEP = theme.color.kola["800"];
const KOLA_WASH = theme.color.kola["50"];
const LAGOON = theme.color.lagoon["600"];
const LAGOON_WASH = theme.color.lagoon["100"];
const AMBER = theme.color.harmattan["600"];
const AMBER_WASH = theme.color.harmattan["100"];
const LATERITE = theme.color.laterite["600"];
const DEEP = theme.color.kola["900"];
const MUTED = theme.color.ink["500"];
const WHITE = theme.color.field["0"];

function failure(cause: unknown, fallback: string) {
  if (cause instanceof ApiFailure) return cause.error.message;
  return cause instanceof Error ? cause.message : fallback;
}

// --- reading the finish --------------------------------------------------------------

export function WorkFinish({
  work,
  priceOnRecord,
  directJobId,
  canConfirm = false,
  onChanged,
}: {
  work: Finish;
  priceOnRecord?: string;
  directJobId?: string;
  canConfirm?: boolean;
  onChanged: () => Promise<void>;
}) {
  if (!work.reports.length && !work.finished) return null;
  const reports = [...work.reports].reverse();
  return (
    <View style={{ gap: space[2] }}>
      <GroupLabel>The work</GroupLabel>
      <RecordPanel style={styles.finish}>
        <View style={styles.chips}>
          <Tag
            icon={work.finished ? "checkmark-circle" : "time-outline"}
            text={work.finished ? "Confirmed done" : "Reported done"}
            ink={work.finished ? KOLA_DEEP : AMBER}
            wash={work.finished ? alpha(KOLA, 0.14) : AMBER_WASH}
          />
          {work.paid_at ? <Tag icon="cash-outline" text={`Paid · ${shortDate(work.paid_at)}`} ink={LAGOON} wash={LAGOON_WASH} /> : null}
        </View>
        {reports.map((report, index) => <ReportCard key={report.id} report={report} latest={index === 0} />)}
        {canConfirm && directJobId ? <ConfirmOrReopen jobId={directJobId} onChanged={onChanged} /> : null}
        {work.may_record_paid && work.invitation_id ? (
          <RecordPaid invitationId={work.invitation_id} price={priceOnRecord} onChanged={onChanged} />
        ) : null}
        {work.review ? <ReviewCard review={work.review} /> : null}
        {work.may_review && work.invitation_id ? <ReviewForm invitationId={work.invitation_id} onChanged={onChanged} /> : null}
      </RecordPanel>
    </View>
  );
}

function Tag({ icon, text, ink, wash }: { icon: keyof typeof Ionicons.glyphMap; text: string; ink: string; wash: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: wash }]}>
      <Ionicons name={icon} size={13} color={ink} />
      <Type variant="captionStrong" style={{ color: ink, fontSize: 12 }}>{text}</Type>
    </View>
  );
}

function ReportCard({ report, latest }: { report: WorkReport; latest: boolean }) {
  return (
    <View style={[styles.report, latest ? null : { opacity: 0.78 }]}>
      <Type variant="caption" style={{ color: MUTED }}>
        Reported done {shortDate(report.at)}
        {report.confirmed_at ? ` · confirmed ${shortDate(report.confirmed_at)}` : ""}
      </Type>
      {report.note ? <Type variant="body">{report.note}</Type> : null}
      {report.photos.some((photo) => photo.url) ? (
        <View style={styles.photos}>
          {report.photos.map((photo, index) =>
            photo.url ? (
              <Image key={photo.id} source={{ uri: photo.url }} style={styles.photo} accessibilityLabel={`Finished work, photo ${index + 1}`} />
            ) : null,
          )}
        </View>
      ) : null}
      {report.receipts.map((receipt) => (
        <Pressable
          key={receipt.id}
          onPress={() => receipt.url && void Linking.openURL(receipt.url)}
          accessibilityRole="link"
          style={styles.receipt}
        >
          <Ionicons name="receipt-outline" size={15} color={LAGOON} />
          <Type variant="captionStrong" style={{ color: LAGOON, flexShrink: 1 }} numberOfLines={1}>{receipt.name}</Type>
        </Pressable>
      ))}
      {report.reopened_at ? (
        <Type variant="caption" style={{ color: AMBER }}>
          Reopened {shortDate(report.reopened_at)}: {report.reopen_reason}
        </Type>
      ) : null}
    </View>
  );
}

function ConfirmOrReopen({ jobId, onChanged }: { jobId: string; onChanged: () => Promise<void> }) {
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
    } catch (cause) {
      setError(failure(cause, "That did not go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.step}>
      {error ? <Notice tone="error" title={error} /> : null}
      {reopening ? (
        <>
          <Field label="What is still not right?" value={reason} onChangeText={setReason} multiline maxLength={500} style={{ minHeight: 72, textAlignVertical: "top" }} />
          <View style={styles.acts}>
            <Pill label="Send it back" busy={busy} busyLabel="Sending…" disabled={reason.trim().length < 5} onPress={() => void run(() => reopenDirectJob(jobId, reason.trim()))} />
            <Pill tone="quiet" label="Not now" onPress={() => setReopening(false)} />
          </View>
        </>
      ) : (
        <>
          <Type variant="bodyStrong">Is the work done the way you agreed?</Type>
          <View style={styles.acts}>
            <Pill icon="checkmark" label="Yes, it's done" busy={busy} busyLabel="Confirming…" onPress={() => void run(() => confirmDirectJob(jobId))} />
            <Pill tone="quiet" label="Something's not right" onPress={() => setReopening(true)} />
          </View>
        </>
      )}
    </View>
  );
}

function RecordPaid({ invitationId, price, onChanged }: { invitationId: string; price?: string; onChanged: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function record() {
    setBusy(true);
    setError("");
    try {
      await recordPaid(invitationId);
      await onChanged();
    } catch (cause) {
      setError(failure(cause, "Could not record the payment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.step}>
      {error ? <Notice tone="error" title={error} /> : null}
      {asking ? (
        <>
          <View style={styles.tip}>
            <Type variant="caption" style={{ color: theme.color.ink["700"] }}>{PAID_NOTE}</Type>
          </View>
          <View style={styles.acts}>
            <Pill label={`I paid${price ? ` ${price}` : ""}`} busy={busy} busyLabel="Recording…" onPress={() => void record()} />
            <Pill tone="quiet" label="Not yet" onPress={() => setAsking(false)} />
          </View>
        </>
      ) : (
        <Pill tone="quiet" icon="cash-outline" label="Record payment" onPress={() => setAsking(true)} />
      )}
    </View>
  );
}

function ReviewCard({ review }: { review: NonNullable<Finish["review"]> }) {
  return (
    <View style={styles.review}>
      <Type variant="body">{review.text}</Type>
      <Type variant="caption" style={{ color: MUTED }}>
        {review.author} · {shortDate(review.at)} · {review.would_hire_again ? "Would hire again" : "Would not hire again"}
      </Type>
    </View>
  );
}

function ReviewForm({ invitationId, onChanged }: { invitationId: string; onChanged: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [again, setAgain] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await reviewJob(invitationId, { text: text.trim(), would_hire_again: again });
      await onChanged();
    } catch (cause) {
      setError(failure(cause, "Could not save the review."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.step}>
      <Type variant="bodyStrong">How did it go?</Type>
      {error ? <Notice tone="error" title={error} /> : null}
      <Field
        label="Your review"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={1000}
        placeholder="On time? Tidy? Did it hold?"
        style={{ minHeight: 88, textAlignVertical: "top" }}
      />
      <ToggleField label="I would hire them again" value={again} onChange={setAgain} />
      <Pill label="Add review" busy={busy} busyLabel="Saving…" disabled={text.trim().length < 10} onPress={() => void submit()} />
    </View>
  );
}

// --- the artisan's "done" -------------------------------------------------------------

function PhotoPicker({
  label,
  picked,
  max,
  onChange,
}: {
  label: string;
  picked: ImagePicker.ImagePickerAsset[];
  max: number;
  onChange: (next: ImagePicker.ImagePickerAsset[]) => void;
}) {
  async function add() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: max - picked.length,
    });
    if (!result.canceled) onChange([...picked, ...result.assets].slice(0, max));
  }
  return (
    <View style={{ gap: space[2] }}>
      <Type variant="captionStrong" style={{ color: theme.color.ink["700"] }}>{label}</Type>
      <View style={styles.photos}>
        {picked.map((asset, index) => (
          <View key={`${asset.uri}-${index}`} style={styles.photo}>
            <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} accessibilityLabel={`${label} ${index + 1}`} />
            <Pressable
              onPress={() => onChange(picked.filter((_, at) => at !== index))}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${label.toLowerCase()} ${index + 1}`}
              hitSlop={6}
              style={styles.remove}
            >
              <Ionicons name="close" size={13} color={WHITE} />
            </Pressable>
          </View>
        ))}
        {picked.length < max ? (
          <Pressable onPress={() => void add()} accessibilityRole="button" accessibilityLabel={`Add ${label.toLowerCase()}`} {...pressableFeedback(alpha(AMBER, 0.12))} style={styles.add}>
            <Ionicons name="image-outline" size={20} color={AMBER} />
            <Type variant="captionStrong" style={{ color: AMBER, fontSize: 12 }}>Add</Type>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function WorkDoneForm({
  invitation,
  onDone,
}: {
  invitation: ArtisanInvitation;
  onDone: (next: ArtisanInvitation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [receipts, setReceipts] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  if (!open) {
    return <Pill icon="checkmark-circle-outline" label="The work is done" onPress={() => setOpen(true)} />;
  }

  async function submit() {
    if (!photos.length) {
      setError("Add at least one photo of the finished work.");
      return;
    }
    setError("");
    try {
      setBusy("Uploading photos…");
      const photoIds: string[] = [];
      for (const asset of photos) photoIds.push((await uploadImage(asset, "artisan_done_photo")).id);
      const receiptIds: string[] = [];
      for (const asset of receipts) receiptIds.push((await uploadImage(asset, "artisan_receipt")).id);
      setBusy("Sending…");
      onDone(await reportWorkDone(invitation.id, { note: note.trim(), photo_file_ids: photoIds, receipt_file_ids: receiptIds }));
    } catch (cause) {
      setError(failure(cause, "Could not send it."));
    } finally {
      setBusy("");
    }
  }

  const confirmer = invitation.request.kind === "direct_job" ? "The customer" : "The tenant";
  return (
    <View style={{ gap: space[2] }}>
      <GroupLabel>The work is done</GroupLabel>
      <RecordPanel style={styles.doneForm}>
        <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
          {confirmer} confirms it, or tells you what is still not right.
        </Type>
        {error ? <Notice tone="error" title={error} /> : null}
        <Field label="What you did (optional)" value={note} onChangeText={setNote} multiline maxLength={500} style={{ minHeight: 72, textAlignVertical: "top" }} />
        <PhotoPicker label="Photos of the finished work" picked={photos} max={MAX_DONE_PHOTOS} onChange={setPhotos} />
        <PhotoPicker label="Receipts (optional)" picked={receipts} max={MAX_RECEIPTS} onChange={setReceipts} />
        <View style={styles.acts}>
          <Pill label="Send for confirmation" busy={Boolean(busy)} busyLabel={busy || "Sending…"} onPress={() => void submit()} />
          <Pill tone="quiet" label="Not yet" onPress={() => setOpen(false)} />
        </View>
      </RecordPanel>
    </View>
  );
}

// --- Report a problem ----------------------------------------------------------------

export function ProblemReport({
  target,
  side = "customer",
}: {
  target: { kind: "job"; invitationId: string } | { kind: "artisan"; artisanId: string };
  side?: "customer" | "artisan";
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [evidence, setEvidence] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const choices = side === "artisan" ? ABOUT_CUSTOMER : ABOUT_ARTISAN;

  if (sent) {
    return (
      <View style={styles.sent}>
        <Type variant="caption" style={{ color: KOLA_DEEP }}>
          Sent to Danpa HQ&apos;s team with what you attached and the job as it stands. They may contact you.
        </Type>
      </View>
    );
  }
  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" hitSlop={8} style={styles.reportLink}>
        <Ionicons name="flag-outline" size={14} color={MUTED} />
        <Type variant="captionStrong" style={{ color: MUTED }}>Report a problem</Type>
      </Pressable>
    );
  }

  async function submit() {
    setError("");
    try {
      setBusy("Uploading…");
      const fileIds: string[] = [];
      for (const asset of evidence) fileIds.push((await uploadImage(asset, "report_evidence")).id);
      setBusy("Sending…");
      const input = { category, summary: summary.trim(), details: details.trim(), file_ids: fileIds };
      if (target.kind === "job") await reportJobProblem(target.invitationId, input);
      else await reportArtisan(target.artisanId, input);
      setSent(true);
    } catch (cause) {
      setError(failure(cause, "Could not send the report."));
    } finally {
      setBusy("");
    }
  }

  return (
    <RecordPanel style={styles.report2}>
      <View style={styles.reportHead}>
        <Ionicons name="flag" size={15} color={LATERITE} />
        <Type variant="bodyStrong" style={{ color: LATERITE }}>Report a problem</Type>
      </View>
      <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
        Danpa HQ&apos;s team reviews every report and can suspend an artisan. It does not settle payments between you.
      </Type>
      {error ? <Notice tone="error" title={error} /> : null}
      <View style={styles.chipsWrap}>
        {choices.map((option) => (
          <Chip key={option.value} label={option.label} selected={category === option.value} onPress={() => setCategory(option.value)} />
        ))}
      </View>
      <Field label="In a few words" value={summary} onChangeText={setSummary} maxLength={180} />
      <Field label="What happened (optional)" value={details} onChangeText={setDetails} multiline maxLength={3000} style={{ minHeight: 88, textAlignVertical: "top" }} />
      <PhotoPicker label="Photos (optional)" picked={evidence} max={MAX_EVIDENCE_FILES} onChange={setEvidence} />
      <View style={styles.acts}>
        <Pill tone="danger" label="Send report" busy={Boolean(busy)} busyLabel={busy || "Sending…"} disabled={!category || summary.trim().length < 5} onPress={() => void submit()} />
        <Pill tone="quiet" label="Cancel" onPress={() => setOpen(false)} />
      </View>
    </RecordPanel>
  );
}

const styles = StyleSheet.create({
  finish: { gap: space[3], padding: space[4], borderColor: alpha(KOLA, 0.18), backgroundColor: KOLA_WASH },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3, paddingHorizontal: space[2], borderRadius: 999 },
  report: { gap: space[2], padding: space[3], borderRadius: 14, borderWidth: 1, borderColor: alpha(DEEP, 0.08), backgroundColor: WHITE },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  photo: { width: 84, height: 84, borderRadius: 12, overflow: "hidden", backgroundColor: theme.color.field["100"] },
  remove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: alpha(DEEP, 0.6) },
  add: { width: 84, height: 84, gap: 2, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: alpha(AMBER, 0.45), alignItems: "center", justifyContent: "center", backgroundColor: AMBER_WASH },
  receipt: { flexDirection: "row", alignItems: "center", gap: 6 },
  step: { gap: space[2], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: alpha(DEEP, 0.14) },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  tip: { paddingVertical: 6, paddingHorizontal: space[3], borderRadius: 10, backgroundColor: theme.color.gold["50"] },
  review: { gap: 4, paddingVertical: space[3], paddingHorizontal: space[3], borderLeftWidth: 3, borderLeftColor: LAGOON, borderRadius: 10, backgroundColor: WHITE },
  doneForm: { gap: space[3], padding: space[4], backgroundColor: KOLA_WASH, borderColor: alpha(KOLA, 0.18) },
  reportLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: space[1] },
  report2: { gap: space[3], padding: space[4], borderColor: alpha(LATERITE, 0.25) },
  reportHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sent: { padding: space[3], borderRadius: 14, backgroundColor: KOLA_WASH },
});
