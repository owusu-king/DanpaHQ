import { View } from "react-native";

import { Type } from "@/components/ui";
import { theme } from "@/theme";

import type { DanpaHQMapProps } from "./types";

/**
 * The map on the web build of the app, which has none: react-native-maps draws
 * only on Android and iOS. Phones load `DanpaHQMap.native.tsx` instead; this
 * keeps an Expo web preview of Explore rendering its list around an honest gap.
 */
export function mapAvailable(): boolean {
  return false;
}

export function DanpaHQMap({ style }: DanpaHQMapProps) {
  return (
    <View
      style={[{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.field["100"] }, style]}
    >
      <Type variant="caption">The map is not available here.</Type>
    </View>
  );
}
