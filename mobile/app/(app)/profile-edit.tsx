import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useId, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import {
  ActionRow,
  ChoiceRow,
  EmailSheet,
  FieldRow,
  GlassPanel,
  ReadRow,
  SectionTitle,
  StatusBadge,
  StepperRow,
  YesNoRow,
} from "@/components/account/ProfileSections";
import { ph, useHomeDensity } from "@/components/home/plinth";
import { Notice, Type, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { resolvePhotoUrl, setProfilePhoto } from "@/photo";
import { isAndroid, isIOS, useSafeBottom } from "@/platform";
import { uploadImage } from "@/provider";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * Your profile: the photo, and the names other people see.
 *
 * `preferred_name` sits above first and last name because Ghanaian naming does
 * not always fit that shape, and calling someone by the wrong name is a small
 * thing that erodes trust quickly.
 *
 * The completeness figure deliberately excludes verification: a complete profile
 * is not a verified one, and conflating them is exactly the false confidence
 * this product exists to remove. So it is a thin ring and a number — never a
 * tick, a shield or a stamp.
 *
 * As few words as the page can manage (product owner review, 2026-09-15). Every
 * block used to be labelled and explained — YOUR PHOTO, YOUR NUMBER, a paragraph
 * on completeness. Now a camera on the photo says it can be changed, a lock on the
 * number says it is how you sign in and is not changed here, and the names are one
 * glass panel with one line under it: who sees the name you choose.
 */

const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];
const INK = theme.color.ink["900"];
const KOLA = theme.color.kola["600"];

/** The badge's edge on the hub ground, in its own green. */
const GLASS_EDGE = alpha(DEEP, 0.08);
/** Secondary words, dark enough to read over the deepest part of the ground. */
const META = alpha(INK, 0.7);
const RING_TRACK = alpha(DEEP, 0.1);

type TenantDetails = {
  occupation: string;
  employer: string;
  income_band: string;
  household_size: number | null;
  move_in_from: string | null;
  budget_max_minor: number | null;
  has_pets: boolean | null;
  smoker: boolean | null;
};

type BusinessDetails = {
  is_company: boolean;
  company_name: string;
  company_registration_number: string;
};

const INCOME_BANDS = [
  { value: "under_1000", label: "Under GH₵1,000" },
  { value: "1000_3000", label: "GH₵1,000 – 3,000" },
  { value: "3000_6000", label: "GH₵3,000 – 6,000" },
  { value: "6000_10000", label: "GH₵6,000 – 10,000" },
  { value: "over_10000", label: "Over GH₵10,000" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `1994-03-02` as "2 March 1994", without leaning on a device's Intl data. */
function longDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return "Not given";
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

/** Digits in, `YYYY-MM-DD` out, as far as the person has typed. */
function formatDate(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join("-");
}

/** Only the fields that changed, so a save never rewrites what it did not touch. */
function changed<T extends Record<string, unknown>>(before: T | null, after: T | null): Partial<T> {
  if (!before || !after) return {};
  const out: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (after[key] !== before[key]) out[key] = after[key];
  }
  return out;
}

export default function ProfileScreen() {
  const pageBottom = useSafeBottom(space[12]);
  const density = useHomeDensity();
  const [saving, setSaving] = useState(false);
  const { state, refreshMe } = useAuth();
  const me = state.status === "signed_in" ? state.me : null;

  const [firstName, setFirstName] = useState(me?.first_name ?? "");
  const [lastName, setLastName] = useState(me?.last_name ?? "");
  const [preferredName, setPreferredName] = useState(me?.preferred_name ?? "");
  const [bio, setBio] = useState(me?.profile?.bio ?? "");
  const [dataSaver, setDataSaver] = useState(me?.data_saver ?? false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  // The role parts of a profile, read once and saved only where they changed.
  // A section is drawn only for a role this account holds: the API refuses the
  // others, and asking a tenant for a company registration number is noise.
  const isTenant = Boolean(me?.roles.includes("tenant"));
  const isLandlord = Boolean(me?.roles.includes("landlord"));
  const [tenant, setTenant] = useState<TenantDetails | null>(null);
  const [tenantSaved, setTenantSaved] = useState<TenantDetails | null>(null);
  const [business, setBusiness] = useState<BusinessDetails | null>(null);
  const [businessSaved, setBusinessSaved] = useState<BusinessDetails | null>(null);
  const [budgetText, setBudgetText] = useState("");

  // The screen can mount before the session has been read: a refresh, or a link
  // straight here, draws it behind the launch curtain. So the fields are filled
  // once, when the account first arrives, and never again — a later refresh must
  // not overwrite what somebody is typing. Without this, the fields opened empty,
  // and saving from there sent empty names and switched the data saver off.
  const seeded = useRef(me !== null);
  useEffect(() => {
    if (!me || seeded.current) return;
    seeded.current = true;
    setFirstName(me.first_name);
    setLastName(me.last_name);
    setPreferredName(me.preferred_name);
    setBio(me.profile?.bio ?? "");
    setDataSaver(me.data_saver);
  }, [me]);

  useEffect(() => {
    let live = true;
    if (isTenant) {
      void apiFetch<TenantDetails>("/me/profile/tenant/")
        .then((details) => {
          if (!live) return;
          setTenant(details);
          setTenantSaved(details);
          setBudgetText(details.budget_max_minor ? String(Math.round(details.budget_max_minor / 100)) : "");
        })
        .catch(() => null);
    }
    if (isLandlord) {
      void apiFetch<BusinessDetails>("/me/profile/landlord/")
        .then((details) => {
          if (!live) return;
          setBusiness(details);
          setBusinessSaved(details);
        })
        .catch(() => null);
    }
    return () => {
      live = false;
    };
  }, [isLandlord, isTenant]);

  const avatarEndpoint = me?.profile?.avatar_url ?? null;

  useEffect(() => {
    let live = true;
    setPhotoUri(null);
    if (!avatarEndpoint) return;

    resolvePhotoUrl(avatarEndpoint).then((url) => {
      // Guarded: the photo may have changed before this resolves, and writing a
      // stale URL would flash the previous picture.
      if (live) setPhotoUri(url);
    });
    return () => {
      live = false;
    };
  }, [avatarEndpoint]);

  if (!me) return null;

  // Initials rather than a silhouette: a stranger's outline says less than the
  // person's own name, and the mark is recognisable before any upload.
  const initials =
    (me.display_name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";

  // "Saved" answers the last save; a change made after it is not saved yet.
  const edit = (set: (value: string) => void) => (value: string) => {
    setSaved(false);
    set(value);
  };
  const editTenant = <K extends keyof TenantDetails>(key: K, value: TenantDetails[K]) => {
    setSaved(false);
    setTenant((current) => (current ? { ...current, [key]: value } : current));
  };
  const editBusiness = <K extends keyof BusinessDetails>(key: K, value: BusinessDetails[K]) => {
    setSaved(false);
    setBusiness((current) => (current ? { ...current, [key]: value } : current));
  };

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const writes: Promise<unknown>[] = [
        apiFetch("/me/", {
          method: "PATCH",
          body: {
            first_name: firstName,
            last_name: lastName,
            preferred_name: preferredName,
            data_saver: dataSaver,
          },
        }),
      ];
      if (bio !== (me?.profile?.bio ?? "")) {
        writes.push(apiFetch("/me/profile/", { method: "PATCH", body: { bio } }));
      }
      const tenantChanges = changed(tenantSaved, tenant);
      if (Object.keys(tenantChanges).length) {
        writes.push(apiFetch("/me/profile/tenant/", { method: "PATCH", body: tenantChanges }));
      }
      const businessChanges = changed(businessSaved, business);
      if (Object.keys(businessChanges).length) {
        writes.push(apiFetch("/me/profile/landlord/", { method: "PATCH", body: businessChanges }));
      }
      await Promise.all(writes);
      setTenantSaved(tenant);
      setBusinessSaved(business);

      await refreshMe();
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not save.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function choosePhoto() {
    // Asked at the moment of use, not at launch, and a refusal is a sentence
    // about what to do next. On both platforms a denied permission is a normal
    // answer rather than an error state.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to choose a profile picture.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      // Square, because the picture is always shown in a circle. Cropping here
      // lets the person choose the framing instead of discovering later that a
      // stylesheet cut their face off.
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;

    setPhotoBusy(true);
    setError("");
    setSaved(false);
    try {
      const stored = await uploadImage(result.assets[0], "avatar");
      if (!stored.is_usable) {
        setError(stored.status_message || "That photo could not be accepted.");
        return;
      }
      await setProfilePhoto(stored.id);
      await refreshMe();
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not set that photo.",
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    setError("");
    try {
      await setProfilePhoto(null);
      await refreshMe();
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not remove the photo.",
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  /**
   * Without a photo there is one thing to do, so the camera opens the library.
   * With one there are two, offered where the photo is, in the platform's own
   * sheet, rather than as a second button under it.
   */
  function editPhoto() {
    if (!photoUri) {
      void choosePhoto();
      return;
    }
    Alert.alert("Profile photo", undefined, [
      { text: "Choose a new photo", onPress: () => void choosePhoto() },
      { text: "Remove photo", style: "destructive", onPress: () => void removePhoto() },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <IndexGround>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={isIOS ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: density.pagePadding,
            paddingTop: density.compact ? space[5] : space[6],
            paddingBottom: pageBottom,
            gap: density.compact ? space[5] : space[6],
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Identity
            name={me.display_name}
            phone={me.phone_display}
            completeness={me.profile?.completeness ?? 0}
            initials={initials}
            photoUri={photoUri}
            busy={photoBusy}
            onEdit={editPhoto}
            onPhotoError={() => setPhotoUri(null)}
          />

          <View style={{ gap: space[2] }}>
            <SectionTitle>Your name</SectionTitle>
            <GlassPanel>
              <FieldRow
                label="Preferred name"
                value={preferredName}
                onChangeText={edit(setPreferredName)}
                placeholder="Kobby"
                textContentType="nickname"
              />
              <FieldRow
                label="First name"
                value={firstName}
                onChangeText={edit(setFirstName)}
                textContentType="givenName"
              />
              <FieldRow
                label="Surname"
                value={lastName}
                onChangeText={edit(setLastName)}
                textContentType="familyName"
              />
            </GlassPanel>
            <Type variant="caption" style={styles.footnote}>
              Landlords and agents see your preferred name.
            </Type>
          </View>

          {/* How Danpa HQ reaches you. The number is how you sign in, so it is
              shown and locked; the email is added or changed through a code. */}
          <View style={{ gap: space[2] }}>
            <SectionTitle>Contact</SectionTitle>
            <GlassPanel>
              <ReadRow label="Phone" value={me.phone_display} note="How you sign in" />
              <ActionRow
                label="Email"
                value={me.email ?? undefined}
                placeholder="Add an email"
                accessibilityLabel={
                  me.email
                    ? `Email ${me.email}, ${me.is_email_verified ? "confirmed" : "not confirmed"}. Change or confirm.`
                    : "Add an email address"
                }
                badge={
                  me.email ? (
                    me.is_email_verified ? (
                      <StatusBadge tone="good" label="Confirmed" />
                    ) : (
                      <StatusBadge tone="waiting" label="Tap to confirm" />
                    )
                  ) : null
                }
                onPress={() => setEmailOpen(true)}
              />
            </GlassPanel>
          </View>

          <View style={{ gap: space[2] }}>
            <SectionTitle>About you</SectionTitle>
            <GlassPanel>
              <ReadRow label="Date of birth" value={longDate(me.date_of_birth)} note="Set when you joined" />
              <FieldRow
                label="About"
                value={bio}
                onChangeText={edit(setBio)}
                placeholder="A line or two for providers"
                autoCapitalize="sentences"
                multiline
                maxLength={600}
              />
            </GlassPanel>
          </View>

          {isTenant && tenant ? (
            <View style={{ gap: space[2] }}>
              <SectionTitle>For your applications</SectionTitle>
              <GlassPanel>
                <FieldRow
                  label="Occupation"
                  value={tenant.occupation}
                  onChangeText={(value) => editTenant("occupation", value)}
                  placeholder="Nurse"
                />
                <FieldRow
                  label="Employer"
                  value={tenant.employer}
                  onChangeText={(value) => editTenant("employer", value)}
                  placeholder="Korle Bu"
                />
                <ChoiceRow
                  label="Monthly income"
                  value={tenant.income_band}
                  options={INCOME_BANDS}
                  onChange={(value) => editTenant("income_band", value)}
                />
                <FieldRow
                  label="Rent budget"
                  value={budgetText}
                  onChangeText={(value) => {
                    const digits = value.replace(/\D/g, "").slice(0, 7);
                    setBudgetText(digits);
                    editTenant("budget_max_minor", digits ? Number(digits) * 100 : null);
                  }}
                  placeholder="GH₵ a month"
                  keyboardType="number-pad"
                />
                <FieldRow
                  label="Move in from"
                  value={tenant.move_in_from ?? ""}
                  onChangeText={(value) => editTenant("move_in_from", formatDate(value) || null)}
                  placeholder="2026-12-01"
                  keyboardType="number-pad"
                  maxLength={10}
                />
                <StepperRow
                  label="Household"
                  value={tenant.household_size}
                  onChange={(value) => editTenant("household_size", value)}
                />
                <YesNoRow label="Pets" value={tenant.has_pets} onChange={(value) => editTenant("has_pets", value)} />
                <YesNoRow label="Smoker" value={tenant.smoker} onChange={(value) => editTenant("smoker", value)} />
              </GlassPanel>
              <Type variant="caption" style={styles.footnote}>
                Helps a provider read your application. Leave anything you would rather not say.
              </Type>
            </View>
          ) : null}

          {isLandlord && business ? (
            <View style={{ gap: space[2] }}>
              <SectionTitle>Your business</SectionTitle>
              <GlassPanel>
                <YesNoRow
                  label="Registered company"
                  value={business.is_company}
                  onChange={(value) => editBusiness("is_company", Boolean(value))}
                />
                {business.is_company ? (
                  <FieldRow
                    label="Company name"
                    value={business.company_name}
                    onChangeText={(value) => editBusiness("company_name", value)}
                  />
                ) : null}
                {business.is_company ? (
                  <FieldRow
                    label="Registration no."
                    value={business.company_registration_number}
                    onChangeText={(value) => editBusiness("company_registration_number", value)}
                    autoCapitalize="characters"
                  />
                ) : null}
              </GlassPanel>
            </View>
          ) : null}

          {error ? <Notice tone="error" title={error} /> : null}

          <SaveButton
            label="Save changes"
            busyLabel="Saving…"
            busy={saving}
            saved={saved}
            onPress={save}
          />
        </ScrollView>
      </KeyboardAvoidingView>
      <EmailSheet
        visible={emailOpen}
        onClose={() => setEmailOpen(false)}
        current={me.email ?? null}
        verified={Boolean(me.is_email_verified)}
        onChanged={() => refreshMe()}
      />
    </IndexGround>
  );
}

/**
 * Who this is: the photo inside a ring that fills as the profile does, the name,
 * and one quiet line with the number and the figure.
 */
function Identity({
  name,
  phone,
  completeness,
  initials,
  photoUri,
  busy,
  onEdit,
  onPhotoError,
}: {
  name: string;
  phone: string;
  completeness: number;
  initials: string;
  photoUri: string | null;
  busy: boolean;
  onEdit: () => void;
  onPhotoError: () => void;
}) {
  const density = useHomeDensity();
  const avatar = density.veryCompact ? 80 : density.compact ? 88 : 96;
  // Three points of arc and four of air on each side of the photo.
  const ring = avatar + 14;
  const badge = density.compact ? 28 : 30;

  return (
    <View style={{ alignItems: "center", gap: space[3] }}>
      <Pressable
        onPress={onEdit}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={photoUri ? "Change or remove your profile photo" : "Add a profile photo"}
        aria-busy={busy} aria-disabled={busy}
        hitSlop={space[2]}
        style={({ pressed }) => ({
          width: ring,
          height: ring,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <CompletenessRing size={ring} value={completeness} />
        <View
          style={[
            styles.avatar,
            isAndroid ? null : styles.avatarLift,
            { width: avatar, height: avatar, borderRadius: avatar / 2, opacity: busy ? 0.7 : 1 },
          ]}
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} onError={onPhotoError} />
          ) : (
            <Initials initials={initials} size={avatar} />
          )}
        </View>
        <View
          style={[
            styles.badge,
            isAndroid ? null : styles.badgeLift,
            { width: badge, height: badge, borderRadius: badge / 2 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={KOLA} />
          ) : (
            <Ionicons name="camera" size={density.compact ? 14 : 15} color={KOLA} />
          )}
        </View>
      </Pressable>

      <View style={{ alignItems: "center", gap: 2 }}>
        <Type
          variant="title2"
          style={{ textAlign: "center", fontSize: density.compact ? 20 : 21, lineHeight: 26, letterSpacing: -0.2, color: INK }}
        >
          {name}
        </Type>
        <View
          accessible
          accessibilityLabel={`Signed in with ${phone}. Profile ${completeness}% complete.`}
          style={styles.meta}
        >
          <Ionicons name="lock-closed" size={11} color={META} />
          <Type variant="caption" style={styles.metaText}>{phone}</Type>
          <View style={styles.metaDot} />
          <Type variant="caption" style={styles.metaText}>{completeness}% complete</Type>
        </View>
      </View>
    </View>
  );
}

/** How complete the profile is, drawn round the photo from twelve o'clock. */
function CompletenessRing({ size, value }: { size: number; value: number }) {
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = Math.max(0, Math.min(1, value / 100));
  const centre = size / 2;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={size} height={size}>
        <Circle cx={centre} cy={centre} r={radius} stroke={RING_TRACK} strokeWidth={stroke} fill="none" />
        {share > 0 ? (
          <Circle
            cx={centre}
            cy={centre}
            r={radius}
            stroke={KOLA}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - share)}
            transform={`rotate(-90 ${centre} ${centre})`}
          />
        ) : null}
      </Svg>
    </View>
  );
}

/** The person's initials on Danpa HQ's green, deepening across the disc. */
function Initials({ initials, size }: { initials: string; size: number }) {
  const id = `initials${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <View style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={KOLA} />
              <Stop offset="1" stopColor={theme.color.kola["800"]} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      </View>
      <Type style={{ fontSize: Math.round(size * 0.32), lineHeight: Math.round(size * 0.4), fontWeight: "500", letterSpacing: 0.6, color: WHITE }}>
        {initials}
      </Type>
    </View>
  );
}

/**
 * The page's one action, in Danpa HQ's green. While it works it says so, and once
 * the save lands it says that too, until something is changed again.
 */
function SaveButton({
  label,
  busyLabel,
  busy,
  saved,
  onPress,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  saved: boolean;
  onPress: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (toValue: number) => {
    if (reduceMotion) {
      scale.setValue(toValue);
      return;
    }
    Animated.spring(scale, { toValue, speed: 34, bounciness: 2, useNativeDriver: true }).start();
  };

  return (
    <Animated.View style={[styles.saveFrame, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={busy ? busyLabel : label}
        accessibilityHint={saved ? "Your changes are saved" : undefined}
        aria-busy={busy} aria-disabled={busy}
        disabled={busy}
        onPress={onPress}
        onPressIn={() => animate(0.98)}
        onPressOut={() => animate(1)}
        style={({ pressed }) => [styles.save, pressed ? { opacity: 0.9 } : null]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={WHITE} />
        ) : saved ? (
          <Ionicons name="checkmark-circle" size={18} color={WHITE} />
        ) : null}
        <Type variant="bodyStrong" style={styles.saveText}>
          {busy ? busyLabel : saved ? "Saved" : label}
        </Type>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    overflow: "hidden",
    borderWidth: 3,
    borderColor: WHITE,
    backgroundColor: theme.color.field["100"],
  },
  // A whisper of green shadow under the photo and its badge, off Android.
  avatarLift: {
    shadowColor: DEEP,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  badge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
  },
  badgeLift: {
    shadowColor: DEEP,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  metaText: {
    fontSize: 13,
    lineHeight: 18,
    color: META,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: alpha(INK, 0.35),
  },
  footnote: {
    paddingHorizontal: space[1],
    fontSize: 12.5,
    lineHeight: 17,
    color: ph.ink70,
  },
  saveFrame: {
    borderRadius: 16,
    backgroundColor: KOLA,
    ...(isAndroid
      ? { elevation: 2 }
      : {
        shadowColor: DEEP,
        shadowOpacity: 0.14,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      }),
  },
  save: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingHorizontal: space[5],
    borderRadius: 16,
    overflow: "hidden",
  },
  saveText: {
    fontSize: 15.5,
    lineHeight: 20,
    color: WHITE,
  },
});
