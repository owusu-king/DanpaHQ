import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import Svg, { Circle, Polygon, Rect } from "react-native-svg";

import type { Service, ServiceTone } from "@/serviceCatalogue";
import { theme } from "@/theme";

/**
 * A service's illustration on its card: its icon on a disc of its colour, with a
 * pale shape behind and one bright accent beside.
 *
 * Built from shapes rather than drawn, so a new service is a catalogue entry and
 * no artwork. The accent's shape turns with the service's place in the catalogue,
 * so two cards in one row never read as the same picture. A service that is not
 * open keeps the whole composition and loses its colour, as its glyph does.
 */
const ART: Record<ServiceTone, { main: string; accent: string; ghost: string; icon: string }> = {
  harmattan: {
    main: theme.color.harmattan["500"],
    accent: theme.color.laterite["600"],
    ghost: theme.color.harmattan["100"],
    icon: theme.color.ink["900"],
  },
  lagoon: {
    main: theme.color.lagoon["600"],
    accent: theme.color.harmattan["500"],
    ghost: theme.color.lagoon["100"],
    icon: theme.color.field["0"],
  },
  laterite: {
    main: theme.color.laterite["600"],
    accent: theme.color.gold["300"],
    ghost: theme.color.laterite["100"],
    icon: theme.color.field["0"],
  },
  kola: {
    main: theme.color.kola["600"],
    accent: theme.color.harmattan["500"],
    ghost: theme.color.kola["50"],
    icon: theme.color.field["0"],
  },
  ink: {
    main: theme.color.ink["700"],
    accent: theme.color.laterite["600"],
    ghost: theme.color.field["100"],
    icon: theme.color.field["0"],
  },
};

const DRAINED = {
  main: theme.color.field["300"],
  accent: theme.color.field["200"],
  ghost: theme.color.field["100"],
  icon: theme.color.field["0"],
};

/** The drawing's own units; it scales to whatever width the card gives it. */
const VIEW_W = 112;
const VIEW_H = 84;
const DISC = { cx: 42, cy: 44, r: 30 };

/** The filled form of an outline icon, where Ionicons has one. */
function solid(icon: Service["icon"]): Service["icon"] {
  const filled = icon.replace(/-outline$/, "") as Service["icon"];
  return filled in Ionicons.glyphMap ? filled : icon;
}

export function ServiceArt({
  service,
  index,
  width = 96,
  muted = false,
}: {
  service: Service;
  /** Its place in the catalogue, which picks the accent's shape. */
  index: number;
  width?: number;
  muted?: boolean;
}) {
  const colours = muted ? DRAINED : ART[service.tone];
  const scale = width / VIEW_W;
  const height = VIEW_H * scale;
  const iconSize = Math.round(DISC.r * 1.05 * scale);

  return (
    <View
      style={{ width, height }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        <Circle cx={76} cy={34} r={28} fill={colours.ghost} />
        {index % 3 === 0 ? (
          <Polygon points="84,4 110,22 82,32" fill={colours.accent} />
        ) : index % 3 === 1 ? (
          <Circle cx={98} cy={64} r={10} fill={colours.accent} />
        ) : (
          <Rect x={70} y={68} width={36} height={10} rx={5} fill={colours.accent} />
        )}
        <Circle cx={DISC.cx} cy={DISC.cy} r={DISC.r + 6} fill="none" stroke={colours.main} strokeOpacity={0.22} strokeWidth={3} />
        <Circle cx={DISC.cx} cy={DISC.cy} r={DISC.r} fill={colours.main} />
      </Svg>
      <View
        style={{
          position: "absolute",
          left: (DISC.cx - DISC.r) * scale,
          top: (DISC.cy - DISC.r) * scale,
          width: DISC.r * 2 * scale,
          height: DISC.r * 2 * scale,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={solid(service.icon)} size={iconSize} color={colours.icon} />
      </View>
    </View>
  );
}
