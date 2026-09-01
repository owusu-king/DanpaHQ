import { View } from "react-native";

import type { ApplicationStanding } from "@/applicationMeaning";
import { Type, space } from "@/components/ui";
import { theme } from "@/theme";

/**
 * Where an application stands, as one line.
 *
 * A dot, a sentence and a time. Deliberately not a badge: a pill saying
 * "SUBMITTED" next to a sentence explaining what submitted means is the same
 * fact twice, and the sentence is the useful half.
 *
 * Shared by the applications list and the record screen so the two never drift
 * into describing the same state differently.
 */
export function StandingDot({ stage }: { stage: ApplicationStanding["stage"] }) {
  return (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor:
          stage === "action"
            ? theme.color.kola["600"]
            : stage === "open"
              ? theme.color.harmattan["600"]
              : theme.color.ink["300"],
      }}
    />
  );
}

export function StandingLine({
  standing,
  trailing,
}: {
  standing: ApplicationStanding;
  /** The time, or the dates — whatever this screen has room to say. */
  trailing?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
      <StandingDot stage={standing.stage} />
      <Type
        variant="bodyStrong"
        style={{
          flex: 1,
          fontSize: 14,
          color: standing.stage === "action" ? theme.color.kola["600"] : theme.color.ink["700"],
        }}
      >
        {standing.line}
      </Type>
      {trailing ? <Type variant="caption">{trailing}</Type> : null}
    </View>
  );
}
