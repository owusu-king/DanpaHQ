import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Platform, Pressable, Share, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import { PassportDocument, PreparedFor } from "@/components/passport/PassportDocument";
import { CopyLink } from "@/components/passport/SharedLinks";
import { FAINT, INK, KOLA, MUTED, RULE } from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { SheetCard, SheetGlassButton, SheetPrimaryButton } from "@/components/sheet/SheetParts";
import { Empty } from "@/components/work/WorkParts";
import { Button, Choice, Field, Notice, Type, space } from "@/components/ui";
import {
  createPassportShare,
  previewPassport,
  SHARE_LIFETIMES,
  shareUrl,
  webOrigin,
  type PassportScope,
  type PassportShare,
  type PassportView,
  type ShareLifetime,
} from "@/passport";
import { dayMonthYear, tenancyPeriod } from "@/passportMeaning";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

type Step = "choose" | "preview" | "ready";

/**
 * Share Housing Passport: choose, see exactly what they will see, get a link.
 *
 * The mobile twin of web's `ShareFlow.tsx`, in the app's one sheet. The preview
 * is the backend's own answer for the chosen scope, drawn by the same document
 * the recipient reads. Once the link exists there is no way back into the
 * choices: a different choice is a different link, so a recipient's page never
 * changes under them.
 */
export function ShareSheet({
  open,
  passport,
  onClose,
  onCreated,
}: {
  open: boolean;
  passport: PassportView;
  onClose: () => void;
  onCreated: (share: PassportShare) => void;
}) {
  const [step, setStep] = useState<Step>("choose");
  const [label, setLabel] = useState("");
  const [identity, setIdentity] = useState(true);
  const [tenancyIds, setTenancyIds] = useState<string[]>([]);
  const [payments, setPayments] = useState(true);
  const [amounts, setAmounts] = useState(false);
  const [days, setDays] = useState<ShareLifetime>(7);
  const [preview, setPreview] = useState<PassportView | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [share, setShare] = useState<PassportShare | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Each opening starts from the sensible default: everything agreed, no
  // amounts. Adjusted during render on the opening itself, so a reload of the
  // passport behind an open sheet never wipes what was chosen.
  const [seenOpen, setSeenOpen] = useState(false);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) {
      setStep("choose");
      setLabel("");
      setIdentity(true);
      setTenancyIds(passport.tenancies.filter((row) => row.status !== "pending_lease").map((row) => row.id));
      setPayments(true);
      setAmounts(false);
      setDays(7);
      setError("");
      setPreview(null);
      setShare(null);
    }
  }

  const scope: PassportScope = useMemo(() => ({
    include_identity: identity,
    tenancy_ids: tenancyIds,
    include_payments: payments && tenancyIds.length > 0,
    include_amounts: amounts && tenancyIds.length > 0,
  }), [amounts, identity, payments, tenancyIds]);
  const nothing = !identity && tenancyIds.length === 0;
  const lasts = SHARE_LIFETIMES.find((row) => row.days === days)?.label ?? "";
  // Fails closed: with no web origin to point a link at, no link is created —
  // a live link the tenant cannot send from here would only be a loose end.
  const canLink = webOrigin() !== null;

  async function showPreview() {
    setPreview(null);
    setPreviewError("");
    setError("");
    setStep("preview");
    try {
      setPreview(await previewPassport(scope));
    } catch (cause) {
      setPreviewError(cause instanceof ApiFailure ? cause.error.message : "The preview didn’t load.");
    }
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const made = await createPassportShare({ ...scope, recipient_label: label.trim(), expires_in_days: days });
      onCreated(made);
      setShare(made);
      setStep("ready");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "The link wasn’t created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function toggleTenancy(id: string, on: boolean) {
    setTenancyIds((current) => (on ? [...current, id] : current.filter((value) => value !== id)));
  }

  const title = step === "ready" ? "Link ready" : step === "preview" ? "What they’ll see" : "Share Housing Passport";

  const footer = step === "ready" ? (
    <SheetPrimaryButton label="Done" onPress={onClose} />
  ) : step === "preview" ? (
    <>
      <SheetGlassButton label="Change" icon="chevron-back" accessibilityLabel="Back to choices" onPress={() => setStep("choose")} />
      {canLink ? (
        <SheetPrimaryButton label="Create link" icon="link-outline" busy={busy} busyLabel="Creating…" disabled={!preview} onPress={() => void create()} />
      ) : (
        <SheetPrimaryButton label="Close" onPress={onClose} />
      )}
    </>
  ) : (
    <>
      <SheetGlassButton label="Cancel" onPress={onClose} />
      <SheetPrimaryButton label="Preview" icon="eye-outline" disabled={nothing} onPress={() => void showPreview()} />
    </>
  );

  return (
    <BottomSheet visible={open} onClose={onClose} title={title} closeLabel="Close sharing" footer={footer}>
      {step === "choose" ? (
        <View style={styles.body}>
          <Type variant="caption" style={styles.meta}>Choose what to show. Nothing else is shared.</Type>
          <SheetCard>
            <View style={styles.fieldPad}>
              <Field
                label="Who is it for? Optional · they’ll see this"
                value={label}
                maxLength={80}
                placeholder="e.g. Landlord at East Legon"
                onChangeText={setLabel}
              />
            </View>
          </SheetCard>

          <Type variant="label" style={styles.group}>INCLUDE</Type>
          <SheetCard>
            <CheckRow
              first
              checked={identity}
              onChange={setIdentity}
              label="Identity checks"
              note="Whether your Ghana Card, phone and email are verified — never the numbers"
            />
            {passport.tenancies.length ? passport.tenancies.map((tenancy) => (
              <CheckRow
                key={tenancy.id}
                checked={tenancyIds.includes(tenancy.id)}
                onChange={(on) => toggleTenancy(tenancy.id, on)}
                label={`${tenancy.place.title}${tenancy.place.space ? ` · ${tenancy.place.space}` : ""}`}
                note={[tenancyPeriod(tenancy), tenancy.place.locality].filter(Boolean).join(" · ")}
              />
            )) : (
              <Type variant="caption" style={[styles.emptyChoice, styles.ruled]}>No tenancies on Danpa HQ yet. You can still share your identity checks.</Type>
            )}
          </SheetCard>

          {passport.tenancies.length ? (
            <>
              <Type variant="label" style={styles.group}>FOR THE CHOSEN TENANCIES</Type>
              <SheetCard>
                <CheckRow
                  first
                  checked={payments && tenancyIds.length > 0}
                  disabled={!tenancyIds.length}
                  onChange={setPayments}
                  label="Rent payment record"
                  note="Confirmed, on-time, late and overdue counts"
                />
                <CheckRow
                  checked={amounts && tenancyIds.length > 0}
                  disabled={!tenancyIds.length}
                  onChange={setAmounts}
                  label="Show amounts"
                  note="Rent and total confirmed. Off by default"
                />
              </SheetCard>
            </>
          ) : null}

          <SheetCard>
            <View style={styles.fieldPad}>
              <Choice<`${ShareLifetime}`>
                label="Link lasts"
                value={String(days) as `${ShareLifetime}`}
                options={SHARE_LIFETIMES.map((row) => ({ value: String(row.days) as `${ShareLifetime}`, label: row.label }))}
                onChange={(value) => setDays(Number(value) as ShareLifetime)}
              />
            </View>
          </SheetCard>

          {nothing ? <Type variant="caption" accessibilityRole="alert" style={styles.warning}>Choose at least one thing to share.</Type> : null}
        </View>
      ) : step === "preview" ? (
        <View style={styles.body}>
          <Type variant="caption" style={styles.meta}>Read from your records each time it is opened</Type>
          {/* Said first, so nobody scrolls the whole preview to find there is no link. */}
          {!canLink ? (
            <Notice
              tone="info"
              title="Share it from the web for now"
              body="The app can’t make a link you could send yet, so it makes none. Open your Housing Passport on Danpa HQ on the web to share it; this preview is what they’ll see."
            />
          ) : null}
          {preview ? (
            <PassportDocument
              view={preview}
              audience="recipient"
              coverFooter={<PreparedFor label={label.trim()} until={`${lasts} from when you create it`} />}
            />
          ) : previewError ? (
            <SheetCard>
              <Empty
                compact
                crossed={false}
                icon="cloud-offline-outline"
                ground={theme.color.field["0"]}
                title="Preview didn’t load"
                hint={previewError}
                action={<Button variant="secondary" label="Try again" onPress={() => void showPreview()} />}
              />
            </SheetCard>
          ) : (
            <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading the preview" style={styles.previewLoading}>
              <Bone height={200} round={20} />
              <Bone width="40%" height={16} />
              <Bone height={120} round={16} />
            </View>
          )}
          {!canLink ? null : error ? <Notice tone="error" title={error} /> : (
            <Type variant="caption" style={styles.meta}>Lasts {lasts}. You can withdraw it at any time.</Type>
          )}
        </View>
      ) : share ? (
        <LinkReady share={share} />
      ) : null}
    </BottomSheet>
  );
}

function LinkReady({ share }: { share: PassportShare }) {
  const url = share.token ? shareUrl(share.token) : null;
  return (
    <View style={[styles.body, styles.ready]}>
      <Type variant="caption" style={styles.meta}>Works until {dayMonthYear(share.expires_at)}</Type>
      <View style={styles.readyMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="link-outline" size={24} color={KOLA} />
      </View>
      <Type variant="body" style={styles.readyText}>
        Anyone with this link can read what you chose until {dayMonthYear(share.expires_at)}. Send it only to the person it’s for.
      </Type>
      {url ? (
        <View style={styles.readyActs}>
          <CopyLink url={url} />
          <Button
            variant="secondary"
            label="Send with another app"
            icon={<Ionicons name="share-outline" size={18} color={theme.color.kola["800"]} />}
            onPress={() => void Share.share(
              Platform.OS === "ios" ? { url, title: "My Danpa HQ Housing Passport" } : { message: url, title: "My Danpa HQ Housing Passport" },
            ).catch(() => undefined)}
          />
        </View>
      ) : (
        <Notice tone="warning" title="The link can’t be shown in the app yet" body="It was created and is listed under Shared links. Copy it from your passport on the web." />
      )}
      <Type variant="caption" style={styles.fineprint}>It stays in Shared links on your passport, where you can copy it again or withdraw it.</Type>
    </View>
  );
}

/** One thing to include: its name, what it shows, and a box that says whether it will. */
function CheckRow({ label, note, checked, onChange, disabled = false, first = false }: {
  label: string;
  note: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  first?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      accessibilityLabel={label}
      accessibilityHint={note}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => [styles.check, first ? null : styles.ruled, disabled ? { opacity: 0.5 } : null, pressed ? { opacity: 0.8 } : null]}
    >
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={checked ? KOLA : theme.color.ink["300"]} />
      <View style={styles.checkText}>
        <Type variant="body" style={{ color: INK }}>{label}</Type>
        <Type variant="caption" style={{ color: MUTED }}>{note}</Type>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[3], paddingBottom: space[2] },
  meta: { color: MUTED, paddingHorizontal: 2 },
  fieldPad: { paddingVertical: space[4] },
  group: { color: FAINT, letterSpacing: 0.8, marginTop: space[2], paddingHorizontal: 2 },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  check: { flexDirection: "row", alignItems: "flex-start", gap: space[3], minHeight: 56, paddingVertical: space[3] },
  checkText: { flex: 1, minWidth: 0, gap: 2 },
  emptyChoice: { color: MUTED, paddingVertical: space[3] },
  warning: { color: theme.color.laterite["600"], paddingHorizontal: 2 },
  previewLoading: { gap: space[3] },
  ready: { alignItems: "stretch" },
  readyMark: {
    alignSelf: "center",
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space[2],
    backgroundColor: theme.color.kola["50"],
  },
  readyText: { color: INK, textAlign: "center" },
  readyActs: { gap: space[3] },
  fineprint: { color: FAINT, textAlign: "center" },
});
