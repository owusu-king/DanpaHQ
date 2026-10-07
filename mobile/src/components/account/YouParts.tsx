import Ionicons from "@expo/vector-icons/Ionicons";
import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IndexGround } from "@/components/account/IndexRows";
import { Empty } from "@/components/work/WorkParts";
import { Type, radius, space } from "@/components/ui";
import { pressableFeedback, safeHeaderTop, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * What both More screens are made of, after WhatsApp's "You" tab (owner,
 * 2026-10-06): everything but the page's subtle green ground.
 *
 * No title bar. A round search on the left and a pill of two tools on the
 * right float on the page; then the person — a large photo with a note above
 * it, and their name — and then the destinations in white rounded cards with no
 * group names, each row a plain line glyph, a label in the body weight and a
 * light chevron, with a hairline that starts where the words start. Leaving
 * the account is the last card, in laterite.
 *
 * Search filters every row on the page by its name, so a long provider menu
 * stays one tap from any destination.
 */

export type YouItem = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** Shown only when there is something to say. Zero is not news. */
  count?: number;
  /** Leaving: laterite, with no chevron. */
  danger?: boolean;
  busy?: boolean;
  busyLabel?: string;
};

export type YouSection = { key: string; items: YouItem[] };

const WHITE = theme.color.field["0"];
const INK = theme.color.ink["900"];
const RULE = alpha(theme.color.kola["900"], 0.1);
const PRESSED = alpha(theme.color.kola["900"], 0.05);
const CHEVRON = theme.color.ink["300"];
const DANGER = theme.color.laterite["600"];

/** The whole page: its tools, the person, and the cards — or, while searching, what matches. */
export function YouPage({
  identity,
  sections,
  tools,
  notice,
}: {
  identity: ReactNode;
  sections: YouSection[];
  /** The pill's two tools, right of the search. */
  tools: { key: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[];
  /** Said under the cards, beside the act it is about. */
  notice?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const pageBottom = useSafeBottom(space[10]);
  // The page stands on the pale ground with no green bar, so its clock is dark.
  const focused = useIsFocused();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase("en-GH");
  const found = useMemo(
    () => needle ? sections.flatMap((section) => section.items).filter((item) => item.label.toLocaleLowerCase("en-GH").includes(needle)) : [],
    [needle, sections],
  );
  const visible = sections.filter((section) => section.items.length);

  return (
    <IndexGround>
      {focused ? <StatusBar style="dark" /> : null}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: safeHeaderTop(insets.top) + space[2], paddingBottom: pageBottom, paddingHorizontal: space[4], gap: space[5] }}
      >
        {searching ? (
          <View style={styles.searchRow}>
            <View style={styles.search}>
              <Ionicons name="search" size={17} color={theme.color.ink["500"]} />
              <TextInput
                autoFocus
                accessibilityLabel="Search settings and pages"
                placeholder="Search"
                placeholderTextColor={theme.color.ink["500"]}
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
                autoCorrect={false}
                selectionColor={theme.color.kola["600"]}
                style={styles.searchInput}
              />
              {query ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery("")}>
                  <Ionicons name="close-circle" size={17} color={theme.color.ink["300"]} />
                </Pressable>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" onPress={() => { setSearching(false); setQuery(""); }} hitSlop={8}>
              <Type variant="bodyStrong" style={styles.cancel}>Cancel</Type>
            </Pressable>
          </View>
        ) : (
          <View style={styles.tools}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search settings and pages"
              onPress={() => setSearching(true)}
              {...pressableFeedback(PRESSED)}
              style={({ pressed }) => [styles.round, pressed ? styles.pressed : null]}
            >
              <Ionicons name="search" size={22} color={INK} />
            </Pressable>
            <View style={styles.pill}>
              {tools.map((tool) => (
                <Pressable
                  key={tool.key}
                  accessibilityRole="button"
                  accessibilityLabel={tool.label}
                  onPress={tool.onPress}
                  {...pressableFeedback(PRESSED)}
                  style={({ pressed }) => [styles.pillTool, pressed ? styles.pressed : null]}
                >
                  <Ionicons name={tool.icon} size={21} color={INK} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {searching ? (
          needle ? (
            found.length ? <Card items={found} /> : <Empty icon="search-outline" title="Nothing by that name" hint="Try another word, like Security or Viewings." />
          ) : null
        ) : (
          <>
            {identity}
            {visible.map((section) => <Card key={section.key} items={section.items} />)}
            {notice}
          </>
        )}
      </ScrollView>
    </IndexGround>
  );
}

/**
 * The person: their photo (or initials) large and round, a note in a bubble
 * above it, and their name with a mark beside it. The whole of it opens their
 * profile.
 */
export function Identity({
  name,
  photoUri,
  note,
  verified,
  onPress,
  onNote,
}: {
  name: string;
  photoUri: string | null;
  /** A short line in the bubble — what to finish, or where they are. */
  note?: string;
  verified: boolean;
  onPress: () => void;
  onNote?: () => void;
}) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "?";
  return (
    <View style={styles.identity}>
      <View style={styles.avatarWrap}>
        {note ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={note}
            onPress={onNote ?? onPress}
            {...pressableFeedback(PRESSED)}
            style={({ pressed }) => [styles.bubble, pressed ? styles.pressed : null]}
          >
            <Type variant="caption" numberOfLines={1} style={styles.bubbleText}>{note}</Type>
            <View style={styles.bubbleTail} />
            <View style={styles.bubbleTailDot} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}. Edit your profile.`}
          onPress={onPress}
          style={({ pressed }) => [styles.avatar, pressed ? { opacity: 0.88 } : null]}
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} accessible={false} style={styles.photo} />
          ) : (
            <Type variant="display2" allowFontScaling={false} style={styles.initials}>{letters}</Type>
          )}
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}${verified ? ", phone verified" : ""}. Edit your profile.`} onPress={onPress} style={styles.nameRow}>
        <Type variant="title1" numberOfLines={1} style={styles.name}>{name}</Type>
        {verified ? <Ionicons name="checkmark-circle-outline" size={20} color={theme.color.kola["600"]} /> : null}
      </Pressable>
    </View>
  );
}

/** One white card of rows, with a hairline that starts where the words start. */
function Card({ items }: { items: YouItem[] }) {
  return (
    <View style={styles.card}>
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index ? <View style={styles.rule} /> : null}
          <ItemRow item={item} />
        </Fragment>
      ))}
    </View>
  );
}

function ItemRow({ item }: { item: YouItem }) {
  const ink = item.danger ? DANGER : INK;
  return (
    <Pressable
      accessibilityRole={item.danger ? "button" : "link"}
      accessibilityLabel={item.busy && item.busyLabel ? item.busyLabel : item.count ? `${item.label}, ${item.count} unread` : item.label}
      aria-busy={item.busy}
      disabled={item.busy}
      onPress={item.onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
    >
      {item.busy ? (
        <ActivityIndicator size="small" color={ink} style={styles.itemIcon} />
      ) : (
        <Ionicons name={item.icon} size={24} color={ink} style={styles.itemIcon} />
      )}
      <Type variant="body" numberOfLines={1} style={[styles.itemLabel, { color: ink }]}>{item.busy && item.busyLabel ? item.busyLabel : item.label}</Type>
      {item.count ? (
        <View style={styles.count}>
          <Type variant="captionStrong" style={styles.countText}>{item.count > 99 ? "99+" : item.count}</Type>
        </View>
      ) : null}
      {item.danger ? null : <Ionicons name="chevron-forward" size={18} color={CHEVRON} />}
    </Pressable>
  );
}

const AVATAR = 128;

const styles = StyleSheet.create({
  tools: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  round: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WHITE,
  },
  pill: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    borderRadius: 23,
    backgroundColor: WHITE,
  },
  pillTool: {
    width: 46,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    backgroundColor: PRESSED,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  search: {
    flex: 1,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: 22,
    backgroundColor: WHITE,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    fontSize: 16,
    color: INK,
  },
  cancel: {
    fontSize: 16,
    color: theme.color.kola["600"],
  },
  identity: {
    alignItems: "center",
    gap: space[3],
    marginTop: space[1],
  },
  avatarWrap: {
    alignItems: "center",
    paddingTop: 26,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["50"],
    borderWidth: 3,
    borderColor: WHITE,
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  initials: {
    fontSize: 44,
    lineHeight: 52,
    color: theme.color.kola["800"],
  },
  // The note, as WhatsApp's: a white bubble over the photo's left shoulder, its tail two dots trailing down onto it.
  bubble: {
    position: "absolute",
    top: 0,
    right: AVATAR * 0.4,
    zIndex: 2,
    maxWidth: 220,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: 18,
    backgroundColor: WHITE,
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 19,
    color: theme.color.ink["500"],
  },
  bubbleTail: {
    position: "absolute",
    bottom: -7,
    right: 24,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: WHITE,
  },
  bubbleTailDot: {
    position: "absolute",
    bottom: -15,
    right: 16,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: WHITE,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "90%",
  },
  name: {
    flexShrink: 1,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: INK,
  },
  card: {
    overflow: "hidden",
    borderRadius: 26,
    backgroundColor: WHITE,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 66,
    marginRight: space[4],
    backgroundColor: RULE,
  },
  item: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 22,
    paddingRight: space[4],
  },
  itemIcon: {
    width: 26,
    marginRight: 18,
    textAlign: "center",
  },
  itemLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    lineHeight: 22,
  },
  count: {
    minWidth: 24,
    height: 24,
    marginRight: space[2],
    paddingHorizontal: 7,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["600"],
  },
  countText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: "600",
    color: WHITE,
  },
});
