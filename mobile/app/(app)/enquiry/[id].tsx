/**
 * One conversation between a buyer and a seller about one property — the twin
 * of the web `/enquiries/[id]`.
 *
 * Opening it marks it read on the server (the GET does), so the list's "New"
 * clears without a second call. Once the property is sold the thread stays
 * readable and stops taking replies.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { ApiFailure } from "@/api";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { useStackHeaderHeight } from "@/components/nav/StackHeader";
import { EDGE, INK, KOLA, MUTED } from "@/components/portfolio/PortfolioList";
import { LinkRow, RecordPanel } from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import { isIOS, maxFontSizeMultiplier, useSafeBottom } from "@/platform";
import { getEnquiry, replyToEnquiry, type EnquiryDetail } from "@/sales";
import { theme } from "@/theme";

export default function EnquiryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const headerHeight = useStackHeaderHeight();
  const composerBottom = useSafeBottom(space[3]);
  const [enquiry, setEnquiry] = useState<EnquiryDetail | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setEnquiry(await getEnquiry(id));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this enquiry.");
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function send() {
    const message = draft.trim();
    if (!message || !id) return;
    setBusy(true);
    setError("");
    try {
      setEnquiry(await replyToEnquiry(id, message));
      setDraft("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not send.");
    } finally {
      setBusy(false);
    }
  }

  if (!enquiry) {
    return (
      <IndexGround>
        <View style={styles.page}>
          {error ? <Notice tone="error" title={error} /> : (
            <>
              <Bone height={60} />
              <Bone width="70%" height={48} />
              <Bone width="60%" height={48} />
            </>
          )}
        </View>
      </IndexGround>
    );
  }

  const closed = enquiry.status === "closed" || enquiry.sale.status === "sold";
  const title = enquiry.sale.headline || "Property for sale";
  const meta = [
    enquiry.role === "seller" ? `From ${enquiry.buyer_name}` : null,
    enquiry.sale.price_formatted,
    enquiry.sale.locality_name,
  ].filter(Boolean).join(" · ");

  return (
    <IndexGround>
      <Stack.Screen options={{ title: enquiry.role === "seller" ? enquiry.buyer_name : "Enquiry" }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={isIOS ? "padding" : undefined}
        keyboardVerticalOffset={isIOS ? headerHeight : 0}
      >
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          <RecordPanel>
            <LinkRow
              first
              icon={enquiry.role === "seller" ? "business-outline" : "pricetag-outline"}
              label={title}
              detail={meta || undefined}
              onPress={() =>
                enquiry.role === "seller"
                  ? router.push({ pathname: "/(app)/provider-property", params: { propertyId: enquiry.sale.property_id } })
                  : router.push({ pathname: "/(app)/sale/[id]", params: { id: enquiry.sale.id } })
              }
            />
          </RecordPanel>

          <View accessibilityLabel="Messages" style={styles.thread}>
            {enquiry.messages.map((message) => (
              <View key={message.id} style={[styles.message, message.mine ? styles.mine : null]}>
                <View style={[styles.bubble, message.mine ? styles.bubbleMine : null]}>
                  <Type variant="body" style={[styles.body, message.mine ? styles.bodyMine : null]}>
                    {message.body}
                  </Type>
                </View>
                <Type variant="caption" style={styles.stamp}>
                  {message.mine ? "You" : message.author_name} ·{" "}
                  {new Date(message.created_at).toLocaleString("en-GH", {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Type>
              </View>
            ))}
          </View>

          {error ? <Notice tone="error" title={error} /> : null}
          {closed ? (
            <Notice
              tone="info"
              title={enquiry.sale.status === "sold" ? "This property has been sold" : "This enquiry is closed"}
              body="You can still read it, but no more messages can be sent."
            />
          ) : null}
        </ScrollView>

        {closed ? null : (
          <View style={[styles.composer, { paddingBottom: composerBottom }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={enquiry.role === "seller" ? "Reply to the buyer" : "Write to the seller"}
              placeholderTextColor={theme.color.ink["300"]}
              accessibilityLabel="Your reply"
              multiline
              maxLength={2000}
              maxFontSizeMultiplier={maxFontSizeMultiplier}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              aria-disabled={!draft.trim() || busy}
              disabled={!draft.trim() || busy}
              onPress={() => void send()}
              style={({ pressed }) => [
                styles.send,
                !draft.trim() || busy ? styles.sendIdle : null,
                pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <Ionicons name={busy ? "hourglass-outline" : "arrow-up"} size={20} color={theme.color.field["0"]} />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </IndexGround>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: space[4],
    gap: space[4],
  },
  thread: {
    gap: space[3],
  },
  message: {
    maxWidth: "82%",
    alignSelf: "flex-start",
    alignItems: "flex-start",
    gap: 4,
  },
  mine: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  bubble: {
    paddingVertical: space[2] + 2,
    paddingHorizontal: space[3] + 2,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: theme.color.field["0"],
  },
  bubbleMine: {
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 6,
    borderColor: KOLA,
    backgroundColor: KOLA,
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
    color: INK,
  },
  bodyMine: {
    color: theme.color.field["0"],
  },
  stamp: {
    fontSize: 11.5,
    color: MUTED,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[2],
    paddingTop: space[2],
    paddingHorizontal: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
    backgroundColor: theme.color.field["0"],
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 132,
    paddingHorizontal: space[4],
    paddingTop: 11,
    paddingBottom: 11,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.color.field["300"],
    backgroundColor: theme.color.field["50"],
    color: INK,
    fontSize: 16,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: KOLA,
  },
  sendIdle: {
    backgroundColor: theme.color.kola["300"],
  },
});
