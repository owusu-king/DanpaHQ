import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";

import { PlinthCard, ph, plinthRow, tile, useHomeDensity } from "@/components/home/plinth";
import { Type } from "@/components/ui";
import type { Notification } from "@/notifications";
import { timeAgo } from "@/notifications";

/** Rental events, newest first. Provider-side and account noise never appear. */
const TENANT_HISTORY = /^(lease|application|viewing|payment|tenancy_request)\./;

/**
 * What has already happened.
 *
 * The opposite half of Coming Up, and drawn as its opposite: past tense, no
 * date rail, a relative time trailing each line. The two used to be plain
 * two-line rows in identical type, which is why they read as one long list with
 * a heading in the middle of it.
 *
 * Three, matching the provider's. A phone's Home is a summary; the fourth line
 * is one scroll of history nobody asked this screen for, and Updates is in the
 * card's own head.
 *
 * **The feed is the notification stream, which is already loaded.** Home fetches
 * it for the unread count on the Updates shortcut, so this costs nothing extra
 * — and it is genuinely the record of what happened: `lease.activated`,
 * `application.accepted`, `viewing.confirmed`, `payment.succeeded`, each with
 * the time it happened.
 *
 * This is not the attention panel and does not compete with it. Attention is
 * derived from the records themselves and answers *what is outstanding*; this
 * answers *what happened*, in the past, and nothing here is waiting on anybody.
 * Read or unread makes no difference to a history, so it is not shown.
 */
export function RentalActivity({
  items,
  onOpenAll,
}: {
  items: Notification[];
  onOpenAll: () => void;
}) {
  const density = useHomeDensity();
  const history = items
    .filter((item) => TENANT_HISTORY.test(item.kind))
    .slice(0, 3);

  if (!history.length) return null;

  return (
    <PlinthCard title="Recent activity" action={{ label: "Updates", onPress: onOpenAll }}>
      {history.map((item, index) => (
        <View
          key={item.id}
          accessible
          accessibilityLabel={`${item.title}. ${timeAgo(item.created_at)}.`}
          style={plinthRow(index === 0, density.compact)}
        >
          <View style={tile(item.kind.startsWith("payment."), density.compact)}>
            <Ionicons
              name={glyph(item.kind)}
              size={density.compact ? 13.5 : 15}
              color={item.kind.startsWith("payment.") ? ph.sage : ph.graphite}
            />
          </View>
          <Type variant="bodyStrong" numberOfLines={1} style={{ flex: 1, fontSize: density.compact ? 12.25 : 13, lineHeight: 17, color: ph.ink }}>
            {item.title}
          </Type>
          <Type variant="caption" style={{ fontSize: density.compact ? 10.5 : 11.5, lineHeight: 15, color: ph.ink38 }}>
            {timeAgo(item.created_at)}
          </Type>
        </View>
      ))}
    </PlinthCard>
  );
}

function glyph(kind: string): keyof typeof Ionicons.glyphMap {
  if (kind.startsWith("payment.")) return "wallet-outline";
  if (kind.startsWith("lease.")) return "document-text-outline";
  if (kind.startsWith("viewing.")) return "calendar-outline";
  return "reader-outline";
}
