import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { ph, useHomeDensity } from "@/components/home/plinth";
import { Notice, Type, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { resolvePhotoUrl, setProfilePhoto } from "@/photo";
import { isAndroid, isIOS, maxFontSizeMultiplier, useSafeBottom } from "@/platform";
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

/** Frosted glass on the hub ground, settled by a line in its own green. */
const GLASS = alpha(WHITE, 0.72);
const GLASS_EDGE = alpha(DEEP, 0.08);
const RULE = alpha(DEEP, 0.08);
/** A row being typed in: a breath of kola behind it. */
const FOCUS = alpha(KOLA, 0.06);
/** Secondary words, dark enough to read over the deepest part of the ground. */
const META = alpha(INK, 0.7);
const PLACEHOLDER = alpha(INK, 0.42);
const RING_TRACK = alpha(DEEP, 0.1);
const PANEL_RADIUS = 16;

export default function ProfileScreen() {
  const pageBottom = useSafeBottom(space[12]);
  const density = useHomeDensity();
  const [saving, setSaving] = useState(false);
  const { state, refreshMe } = useAuth();
  const me = state.status === "signed_in" ? state.me : null;

  const [firstName, setFirstName] = useState(me?.first_name ?? "");
  const [lastName, setLastName] = useState(me?.last_name ?? "");
  const [preferredName, setPreferredName] = useState(me?.preferred_name ?? "");
  const [dataSaver, setDataSaver] = useState(me?.data_saver ?? false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

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
    setDataSaver(me.data_saver);
  }, [me]);

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

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      await apiFetch("/me/", {
        method: "PATCH",
        body: {
          first_name: firstName,
          last_name: lastName,
          preferred_name: preferredName,
          data_saver: dataSaver,
        },
      });

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
            <GlassPanel>
              <NameRow
                label="Preferred name"
                value={preferredName}
                onChangeText={edit(setPreferredName)}
                placeholder="Kobby"
                textContentType="nickname"
              />
              <NameRow
                label="First name"
                value={firstName}
                onChangeText={edit(setFirstName)}
                textContentType="givenName"
              />
              <NameRow
                label="Surname"
                value={lastName}
                onChangeText={edit(setLastName)}
                textContentType="familyName"
              />
            </GlassPanel>
            {/* The one sentence on the page: it is about who can see you. */}
            <Type variant="caption" style={styles.footnote}>
              Landlords and agents see your preferred name.
            </Type>
          </View>

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

/** The person's initials on Rooomly's green, deepening across the disc. */
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

/** One frosted panel, with a hairline between whatever it holds. */
function GlassPanel({ children }: { children: React.ReactNode[] }) {
  return (
    <View style={[styles.panel, isAndroid ? null : styles.panelLift]}>
      <View style={{ borderRadius: PANEL_RADIUS - 1, overflow: "hidden" }}>
        {children.map((child, index) => (
          <Fragment key={index}>
            {index ? <View style={styles.rule} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/** A name, its label beside it rather than above, so three fit in a glance. */
function NameRow({
  label,
  onFocus,
  onBlur,
  ...input
}: TextInputProps & { label: string }) {
  const density = useHomeDensity();
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.row, focused ? { backgroundColor: FOCUS } : null]}>
      <Type
        variant="caption"
        style={[
          styles.rowLabel,
          { width: density.veryCompact ? 96 : density.compact ? 104 : 112, color: focused ? theme.color.kola["800"] : META },
        ]}
      >
        {label}
      </Type>
      <TextInput
        {...input}
        accessibilityLabel={label}
        autoCapitalize="words"
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        placeholderTextColor={PLACEHOLDER}
        selectionColor={KOLA}
        cursorColor={KOLA}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, { fontSize: density.compact ? 15 : 15.5 }]}
      />
    </View>
  );
}

/**
 * The page's one action, in Rooomly's green. While it works it says so, and once
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
  panel: {
    borderRadius: PANEL_RADIUS,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
  },
  // Android draws elevation through a translucent fill as a smudge, so there the
  // edge does it alone.
  panelLift: {
    shadowColor: DEEP,
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
    backgroundColor: RULE,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 52,
    paddingHorizontal: 14,
  },
  rowLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  // The row's tint says where you are typing, so the browser's own focus ring is
  // not drawn over it in the web preview.
  input: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    paddingVertical: space[3],
    color: INK,
    outlineWidth: 0,
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
