import Ionicons from "@expo/vector-icons/Ionicons";
import { forwardRef, useState } from "react";
import { Pressable, TextInput } from "react-native";

import { Field, Type, space } from "@/components/ui";
import { phoneInputProps, pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * The two fields the sign-in screen is made of.
 *
 * One `+233`, one keyboard type, one autofill contract, one reveal control.
 *
 * Only sign-in's two fields, deliberately. `phone`, `forgot-password` and the
 * application form each still carry their own `prefix="+233"`, and folding all
 * of them in here is worth doing — but it is a change to screens this work has
 * no business touching, and a shared field that four unrelated screens depend
 * on is a bigger commitment than one that two do.
 */

/** Ghana. The dialling code every number in this product starts with. */
export const DIAL_CODE = "+233";

export const PhoneField = forwardRef<TextInput, {
  value: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  returnKeyType?: "next" | "go" | "done";
  autoFocus?: boolean;
}>(function PhoneField({ value, onChangeText, onSubmitEditing, returnKeyType = "next", autoFocus }, ref) {
  return (
    <Field
      ref={ref}
      label="Mobile number"
      prefix={DIAL_CODE}
      placeholder="24 123 4567"
      value={value}
      onChangeText={onChangeText}
      maxLength={15}
      returnKeyType={returnKeyType}
      onSubmitEditing={onSubmitEditing}
      autoFocus={autoFocus}
      {...phoneInputProps}
    />
  );
});

export const PasswordField = forwardRef<TextInput, {
  value: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  autoFocus?: boolean;
}>(function PasswordField({ value, onChangeText, onSubmitEditing, autoFocus }, ref) {
  const [reveal, setReveal] = useState(false);

  return (
    <Field
      ref={ref}
      label="Password"
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={!reveal}
      autoComplete="current-password"
      textContentType="password"
      returnKeyType="go"
      onSubmitEditing={onSubmitEditing}
      autoFocus={autoFocus}
      // Typing a password blind on a phone keyboard is the most common reason a
      // correct one gets entered wrong twice.
      suffix={
        <Pressable
          onPress={() => setReveal((shown) => !shown)}
          accessibilityRole="button"
          accessibilityLabel={reveal ? "Hide password" : "Show password"}
          hitSlop={12}
          style={{ padding: space[2] }}
        >
          <Ionicons
            name={reveal ? "eye-off-outline" : "eye-outline"}
            size={20}
            color={theme.color.ink["500"]}
          />
        </Pressable>
      }
    />
  );
});

/**
 * A word you can tap.
 *
 * Sign-in had four full-width quiet buttons under the one button that matters,
 * which is how a primary action stops looking primary. Everything that is not
 * "sign in" is a line of text.
 */
export function TextLink({
  label,
  onPress,
  strong = false,
  muted = false,
}: {
  label: string;
  onPress: () => void;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      hitSlop={12}
      {...pressableFeedback(theme.color.kola["50"])}
      style={{ minHeight: theme.targetMin, justifyContent: "center" }}
    >
      <Type
        variant={strong ? "bodyStrong" : "caption"}
        style={{ color: muted ? theme.color.ink["500"] : theme.color.kola["600"] }}
      >
        {label}
      </Type>
    </Pressable>
  );
}
