import { View } from "react-native";

import { shell } from "@/shell";

/**
 * `/`, which nobody stays on.
 *
 * The gate replaces it as soon as it knows who is looking, and the launch curtain
 * stands in front of it until then, so it draws the ground and nothing else. It
 * used to say "Loading your account…" in body type — the first thing every launch
 * showed.
 */
export default function Index() {
  return <View style={{ flex: 1, backgroundColor: shell.canvas }} />;
}
