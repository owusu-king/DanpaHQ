import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAuth } from "@/auth";
import { Shake } from "@/components/auth/AuthMotion";
import {
  AuthAction,
  AuthBack,
  AuthField,
  AuthFields,
  AuthFoot,
  AuthHeading,
  AuthScene,
  RevealToggle,
} from "@/components/auth/AuthScene";
import { Notice, Type, space } from "@/components/ui";
import { fieldErrorsFrom, summaryErrorFrom, type FieldErrors } from "@/formErrors";
import { clearPendingOnboardingIntent, pendingOnboardingIntent } from "@/onboardingIntent";
import {
  clearRegistrationDraft,
  markAccountJustCreated,
  registrationDraft,
  saveRegistrationDetails,
  submitRegistration,
  type AccountType,
} from "@/registrationDraft";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * Step one of three: who you are, and a password to come back with.
 *
 * The role was answered on the question before this one, so it is not asked
 * again — it rides at the top as a line with a way to change it. Only what an
 * account cannot exist without is here; everything else waits for Profile.
 *
 * **Nothing is created on Continue.** The details are held in memory (see
 * `registrationDraft`) while the number is proved, and the code screen creates
 * the account the moment the code is right. The backend's rule is unchanged:
 * an account needs a proved number, and leaving before then writes nothing.
 *
 * This screen still creates an account itself in two cases, both of which
 * already hold a proved number:
 * - the server refused a detail after the code (an email in use, a password it
 *   considers too common) and sent the person back here with the ticket, and
 * - an unfinished account from before tickets, which arrives signed in and is
 *   pinned here by the route gate.
 *
 * **The button is never disabled for a validation reason.** Pressing always
 * does something: it continues, or it says which field to fix and nudges the
 * card it is in.
 */
const MIN_PASSWORD_LENGTH = 8;

export default function RegisterScreen() {
  const router = useRouter();
  const { state, refreshMe, signIn, deviceFingerprint } = useAuth();
  const params = useLocalSearchParams<{ workspace?: string; ticket?: string }>();
  const draft = registrationDraft();

  // A proved number, from either a refused submission or a code screen that
  // lost the draft. With one, Continue creates the account instead of texting.
  const ticket = draft?.ticket || params.ticket || "";
  const pinned = state.status === "signed_in" && state.me.registration_state !== "complete";
  const createsHere = Boolean(ticket) || pinned;

  const [accountType, setAccountType] = useState<AccountType>(
    draft?.accountType ?? (params.workspace === "provider" ? "provider" : "tenant"),
  );
  const [firstName, setFirstName] = useState(draft?.firstName ?? "");
  const [lastName, setLastName] = useState(draft?.lastName ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(draft?.dateOfBirth ?? "");
  const [email, setEmail] = useState(draft?.email ?? "");
  const [password, setPassword] = useState(draft?.password ?? "");
  const [confirm, setConfirm] = useState(draft?.password ?? "");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>(draft?.errors ?? {});
  const [summary, setSummary] = useState(draft?.summary ?? "");
  // Bumped on every refused press, so the card holding the problem nudges.
  const [refusals, setRefusals] = useState(draft?.summary ? 1 : 0);

  const lastRef = useRef<TextInput>(null);
  const birthRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);

  // The route gate can send someone here on its own, without our parameters, so
  // the answer they gave on the opening question is read back from storage.
  useEffect(() => {
    if (params.workspace || draft) return;
    let cancelled = false;
    void pendingOnboardingIntent().then((intent) => {
      if (!cancelled && intent === "manage_property") setAccountType("provider");
    });
    return () => {
      cancelled = true;
    };
  }, [draft, params.workspace]);

  /** Clear a field's error the moment the person starts fixing it. */
  function edit(fields: string[], set: (value: string) => void) {
    return (value: string) => {
      set(value);
      setSummary("");
      setErrors((current) => {
        if (!fields.some((field) => current[field])) return current;
        const next = { ...current };
        for (const field of fields) delete next[field];
        return next;
      });
    };
  }

  /**
   * What this screen can judge without asking the server. Deliberately the
   * minimum — anything subtler, like a common password or an email already in
   * use, is the backend's call, and duplicating those rules here is how the two
   * drift and start contradicting each other in front of the user.
   */
  function localProblems(): FieldErrors {
    const found: FieldErrors = {};
    if (!firstName.trim()) found.first_name = "Enter your first name.";
    if (!lastName.trim()) found.last_name = "Enter your last name.";
    if (!dateOfBirth.trim()) {
      found.date_of_birth = "Enter your date of birth.";
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      found.date_of_birth = "Enter all eight digits, for example 1994 03 02.";
    }
    if (!password) {
      found.password = "Choose a password.";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      found.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password && confirm !== password) {
      found.confirm_password = confirm ? "The two passwords do not match." : "Type the password again.";
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      found.email = "Check the email address, or leave it empty.";
    }
    return found;
  }

  async function submit() {
    const problems = localProblems();
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      setSummary("");
      setRefusals((count) => count + 1);
      return;
    }

    const details = { accountType, firstName, lastName, dateOfBirth, email, password };

    // The usual path: hold the details and prove the number. Nothing is created.
    if (!createsHere) {
      saveRegistrationDetails(details);
      router.push({ pathname: "/(auth)/phone", params: { workspace: accountType } });
      return;
    }

    setBusy(true);
    setErrors({});
    setSummary("");
    try {
      const { session } = await submitRegistration({ details, ticket, deviceFingerprint });
      // Before the session lands, so the gate's first signed-in frame already
      // knows this is the welcome and not an ordinary sign-in.
      markAccountJustCreated(accountType);
      clearRegistrationDraft();
      await clearPendingOnboardingIntent();
      if (session) await signIn(session);
      else await refreshMe();
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setErrors(fields);
      setSummary(summaryErrorFrom(cause, fields));
      setRefusals((count) => count + 1);
    } finally {
      setBusy(false);
    }
  }

  const lengthOk = password.length >= MIN_PASSWORD_LENGTH;
  const matches = Boolean(confirm) && confirm === password;
  const aboutWrong = Boolean(errors.first_name || errors.last_name || errors.date_of_birth);
  const passwordWrong = Boolean(errors.password || errors.confirm_password);

  return (
    <AuthScene
      progress={{ step: 1, of: 3 }}
      header={
        pinned ? undefined : (
          <AuthBack label="Back to the question" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(auth)/start"))} />
        )
      }
    >
      <AuthHeading
        title={createsHere ? "Almost there" : "Tell us about you"}
        line={
          createsHere
            ? "Your number is confirmed. Check the details below to finish."
            : "Just the essentials. Everything else can wait for your profile."
        }
      />

      <AccountLine
        type={accountType}
        onChange={() => {
          if (pinned || createsHere) {
            setAccountType((current) => (current === "provider" ? "tenant" : "provider"));
          } else if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/(auth)/start");
          }
        }}
        switches={pinned || createsHere}
      />

      <Shake signal={aboutWrong ? refusals : 0}>
        <View style={{ gap: space[3] }}>
          <AuthFields>
            <AuthField
              label="First name"
              icon="person-outline"
              placeholder="Ama"
              value={firstName}
              onChangeText={edit(["first_name"], setFirstName)}
              error={errors.first_name}
              autoComplete="given-name"
              textContentType="givenName"
              returnKeyType="next"
              onSubmitEditing={() => lastRef.current?.focus()}
            />
          </AuthFields>
          <AuthFields>
            <AuthField
              ref={lastRef}
              label="Last name"
              icon="people-outline"
              placeholder="Mensah"
              value={lastName}
              onChangeText={edit(["last_name"], setLastName)}
              error={errors.last_name}
              autoComplete="family-name"
              textContentType="familyName"
              returnKeyType="next"
              onSubmitEditing={() => birthRef.current?.focus()}
            />
          </AuthFields>
          <AuthFields>
            <AuthField
              ref={birthRef}
              label="Date of birth"
              icon="calendar-outline"
              // A worked example, not a format string. The dashes are inserted
              // as the digits arrive, so nobody has to type them.
              placeholder="1994-03-02"
              value={dateOfBirth}
              onChangeText={edit(["date_of_birth"], (value) => setDateOfBirth(formatDate(value)))}
              error={errors.date_of_birth}
              hint="Year, month, day. Tenancy agreements need an adult on them."
              keyboardType="number-pad"
              maxLength={10}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </AuthFields>
        </View>
      </Shake>

      {/* Keep the password pair grouped, with a separate surface for each field. */}
      <View style={{ gap: space[2] }}>
        <Shake signal={passwordWrong ? refusals : 0}>
          <View style={{ gap: space[3] }}>
            <AuthFields>
              <AuthField
                ref={passwordRef}
                label="Password"
                icon="lock-closed-outline"
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                value={password}
                onChangeText={edit(["password", "confirm_password"], setPassword)}
                error={errors.password}
                secureTextEntry={!reveal}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
                action={<RevealToggle shown={reveal} onPress={() => setReveal((shown) => !shown)} />}
              />
            </AuthFields>
            <AuthFields>
              <AuthField
                ref={confirmRef}
                label="Confirm password"
                icon="shield-checkmark-outline"
                placeholder="Type it again"
                value={confirm}
                onChangeText={edit(["confirm_password"], setConfirm)}
                error={errors.confirm_password}
                secureTextEntry={!reveal}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            </AuthFields>
          </View>
        </Shake>
        <View style={styles.checks} accessibilityLiveRegion="polite">
          <Check met={lengthOk} label={`${MIN_PASSWORD_LENGTH}+ characters`} />
          <Check met={matches} label="Passwords match" />
        </View>
      </View>

      <AuthFields>
        <AuthField
          ref={emailRef}
          label="Email (optional)"
          icon="mail-outline"
          placeholder="you@example.com"
          value={email}
          onChangeText={edit(["email"], setEmail)}
          error={errors.email}
          hint="For receipts and account recovery. You can add it later."
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
      </AuthFields>

      {accountType === "provider" ? (
        <Notice
          tone="info"
          title="Verification comes after this"
          body="Your account is created first. You then send one ID document, and provider tools open once it is approved."
        />
      ) : null}

      {summary ? <Notice tone="error" title={summary} /> : null}

      <AuthAction
        label={createsHere ? "Create account" : "Continue"}
        busyLabel="Creating your account…"
        onPress={() => void submit()}
        busy={busy}
      />

      <AuthFoot>
        <Type variant="caption" style={styles.foot}>
          {createsHere
            ? "Nothing here is shown publicly."
            : "Next, we confirm your phone number. Nothing is created until then."}
        </Type>
      </AuthFoot>
    </AuthScene>
  );
}

/**
 * Which kind of account this is, said once, with a way to change it.
 *
 * Not a question: it was answered a screen ago. Before the number is proved,
 * changing it means going back to that question; after, it switches in place,
 * because going back would lose the proof.
 */
function AccountLine({
  type,
  onChange,
  switches,
}: {
  type: AccountType;
  onChange: () => void;
  switches: boolean;
}) {
  const provider = type === "provider";
  const ink = provider ? theme.color.lagoon["600"] : theme.color.kola["600"];
  const wash = provider ? theme.color.lagoon["100"] : theme.color.kola["50"];

  return (
    <View style={[styles.account, { backgroundColor: wash, borderColor: alpha(ink, 0.18) }]}>
      <View style={[styles.accountTile, { backgroundColor: ink }]}>
        <Ionicons name={provider ? "business" : "home"} size={16} color={theme.color.field["0"]} />
      </View>
      <View style={{ flex: 1 }}>
        <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
          Creating a
        </Type>
        <Type variant="bodyStrong" style={{ color: ink }}>
          {provider ? "Provider account" : "Tenant account"}
        </Type>
      </View>
      <Pressable
        onPress={onChange}
        accessibilityRole="button"
        accessibilityLabel={switches ? `Switch to a ${provider ? "tenant" : "provider"} account` : "Change account type"}
        hitSlop={10}
        style={({ pressed }) => [styles.accountChange, pressed ? { opacity: 0.6 } : null]}
      >
        <Type variant="captionStrong" style={{ color: ink }}>
          {switches ? `Switch to ${provider ? "tenant" : "provider"}` : "Change"}
        </Type>
      </Pressable>
    </View>
  );
}

/** A requirement that lights up as it is met — feedback, never a gate. */
function Check({ met, label }: { met: boolean; label: string }) {
  return (
    <View style={styles.check} accessible accessibilityLabel={`${label}: ${met ? "done" : "not yet"}`}>
      <Ionicons
        name={met ? "checkmark-circle" : "ellipse-outline"}
        size={15}
        color={met ? theme.color.kola["600"] : theme.color.ink["300"]}
      />
      <Type variant="caption" style={{ color: met ? theme.color.kola["800"] : theme.color.ink["500"] }}>
        {label}
      </Type>
    </View>
  );
}

/** Digits in, `YYYY-MM-DD` out, as far as the person has typed. */
function formatDate(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)]
    .filter((part) => part.length > 0)
    .join("-");
}

const styles = StyleSheet.create({
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: 18,
    borderWidth: 1,
  },
  accountTile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  accountChange: {
    paddingVertical: space[2],
    paddingHorizontal: space[2],
  },
  checks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[4],
    paddingHorizontal: space[2],
  },
  check: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  foot: {
    textAlign: "center",
  },
});
