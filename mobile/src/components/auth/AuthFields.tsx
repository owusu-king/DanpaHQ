import { Pressable } from "react-native";

import { Type } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * The two small things every auth screen shares that are not surfaces.
 *
 * This used to hold a `PhoneField` and a `PasswordField` as well — two wrappers
 * around the app-wide `Field`, each drawing its own label above its own
 * bordered shell. They went when the flow moved to `AuthField`, which is a row
 * of a shared card rather than a box of its own; keeping them would have meant
 * two field languages inside one journey, which is the exact inconsistency the
 * redesign was for.
 *
 * What is left is the dialling code, which is a fact rather than a component,
 * and the link, which is every act that is not the screen's one act.
 */

/** Ghana. The dialling code every number in this product starts with. */
export const DIAL_CODE = "+233";

/**
 * A word you can tap.
 *
 * Sign-in had four full-width quiet buttons under the one button that matters,
 * which is how a primary action stops looking primary. Everything that is not
 * the screen's one act is a line of text, and `AuthFoot` gathers them so they
 * read as a short list of ways on rather than as strays at three heights.
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
