import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";

import { radius } from "@/components/ui";
import type { Service, ServiceTone } from "@/serviceCatalogue";
import { theme } from "@/theme";

/**
 * A service's mark: its icon in its own colour, on a tint of that colour.
 *
 * The tint is what makes the hub scannable. A column of identical green discs
 * is a column a thumb has to read; power amber, water blue and screens clay are
 * told apart before the label is. The colours are semantic rather than
 * decorative — see `ServiceTone` for why each family means what it means.
 *
 * A service that is not open yet keeps its shape and loses its colour. That is
 * the whole signal: same size, same position, drained. Nothing needs to say
 * "disabled" because nothing looks live.
 */
export const TONE: Record<ServiceTone, { ink: string; wash: string }> = {
  harmattan: { ink: theme.color.harmattan["600"], wash: theme.color.harmattan["100"] },
  lagoon: { ink: theme.color.lagoon["600"], wash: theme.color.lagoon["100"] },
  laterite: { ink: theme.color.laterite["600"], wash: theme.color.laterite["100"] },
  kola: { ink: theme.color.kola["600"], wash: theme.color.kola["50"] },
  ink: { ink: theme.color.ink["700"], wash: theme.color.field["100"] },
};

export function ServiceGlyph({
  service,
  size = 40,
  muted = false,
}: {
  service: Service;
  size?: number;
  muted?: boolean;
}) {
  const tone = TONE[service.tone];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: muted ? theme.color.field["100"] : tone.wash,
      }}
    >
      <Ionicons
        name={service.icon}
        size={Math.round(size * 0.5)}
        color={muted ? theme.color.ink["300"] : tone.ink}
      />
    </View>
  );
}
