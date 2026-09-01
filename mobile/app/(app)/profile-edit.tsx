import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Field, Notice, Surface, Type, space } from "@/components/ui";
import { resolvePhotoUrl, setProfilePhoto } from "@/photo";
import { isIOS } from "@/platform";
import { uploadImage } from "@/provider";
import { theme } from "@/theme";

/**
 * Profile editing.
 *
 * `preferred_name` sits above first and last name because Ghanaian naming does
 * not always fit that shape, and calling someone by the wrong name is a small
 * thing that erodes trust quickly.
 *
 * The completeness figure deliberately excludes verification: a complete profile
 * is not a verified one, and conflating them is exactly the false confidence
 * this product exists to remove.
 */
export default function ProfileScreen() {
  const [saving, setSaving] = useState(false);
  const { state, refreshMe } = useAuth();
  const me = state.status === "signed_in" ? state.me : null;

  const [firstName, setFirstName] = useState(me?.first_name ?? "");
  const [lastName, setLastName] = useState(me?.last_name ?? "");
  const [preferredName, setPreferredName] = useState(me?.preferred_name ?? "");
  const [dataSaver] = useState(me?.data_saver ?? false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

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

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={isIOS ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: space[5], gap: space[5] }}
        keyboardShouldPersistTaps="handled"
      >
        <Surface style={{ gap: space[3], alignItems: "center" }}>
          <Type variant="label">YOUR PHOTO</Type>
          <Pressable
            onPress={choosePhoto}
            disabled={photoBusy}
            accessibilityRole="button"
            accessibilityLabel={
              photoUri ? "Change your profile photo" : "Add a profile photo"
            }
            hitSlop={8}
            style={{ opacity: photoBusy ? 0.6 : 1 }}
          >
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  backgroundColor: theme.color.field["100"],
                }}
                onError={() => setPhotoUri(null)}
              />
            ) : (
              <View
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  backgroundColor: theme.color.kola["600"],
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Type variant="title2" style={{ color: theme.color.field["0"] }}>
                  {initials}
                </Type>
              </View>
            )}
          </Pressable>
          <Type variant="caption" style={{ textAlign: "center" }}>
            {photoBusy
              ? "Working\u2026"
              : `Optional. Tap to ${photoUri ? "change" : "add"} it.`}
          </Type>
          {photoUri ? (
            <Button
              label="Remove photo"
              variant="quiet"
              onPress={removePhoto}
              disabled={photoBusy}
            />
          ) : null}
        </Surface>

        <Surface style={{ gap: space[2] }}>
          <Type variant="label">YOUR NUMBER</Type>
          <Type variant="title2" style={{ fontFamily: "monospace" }}>
            {me.phone_display}
          </Type>
          <Type variant="caption">
            This is how you sign in. Changing it needs a code sent to your current number.
          </Type>
        </Surface>

        {error ? <Notice tone="error" title={error} /> : null}
        {saved ? <Notice tone="success" title="Saved" /> : null}

        <View style={{ gap: space[4] }}>
          <Field
            label="What should we call you?"
            hint="This is the name landlords and agents will see."
            value={preferredName}
            onChangeText={setPreferredName}
            placeholder="Kobby"
            autoCapitalize="words"
            textContentType="nickname"
          />
          <Field
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
            textContentType="givenName"
          />
          <Field
            label="Surname"
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
            textContentType="familyName"
          />
        </View>

        <Surface style={{ gap: space[2] }}>
          <Type variant="bodyStrong">Profile completeness: {me.profile?.completeness ?? 0}%</Type>
          <Type variant="caption">
            A fuller profile gets more replies. It is separate from your checks — being
            complete is not the same as being verified.
          </Type>
        </Surface>

        <Button label="Save changes" onPress={save} busy={saving} busyLabel="Saving…" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
