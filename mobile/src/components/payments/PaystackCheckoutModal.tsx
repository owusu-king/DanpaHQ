import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";

import { ModalSafeArea } from "@/components/sheet/ModalSafeArea";
import { Type, radius, space } from "@/components/ui";
import { isPaymentReturnUrl, safeCheckoutUrl, type ProviderCheckout } from "@/payments";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

type Props = {
  /** Any payment the server opened with the provider: a rent intent or a subscription checkout. */
  intent: ProviderCheckout | null;
  onClose: () => void;
  onCheckoutReturn: () => void;
  /** What a confirmed payment updates, for the sentence under the checkout. */
  settles?: string;
};

/**
 * Paystack's hosted checkout runs as a top-level page inside an app-owned sheet.
 * The sheet never decides that money was received: its only success signal closes
 * checkout and lets the Payments API verify the intent server-side. Rent and a
 * Rooomly subscription share it, because they share the Payments Core.
 */
export function PaystackCheckoutModal({ intent, onClose, onCheckoutReturn, settles = "your rent" }: Props) {
  const checkoutUrl = intent ? safeCheckoutUrl(intent) : null;
  const webView = useRef<WebView>(null);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [canGoBack, setCanGoBack] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setProgress(0);
    setLoadError("");
    setCanGoBack(false);
    setReloadKey(0);
  }, [intent?.id]);

  if (!intent || !checkoutUrl) return null;

  function handleNavigation(request: WebViewNavigation) {
    if (isPaymentReturnUrl(request.url)) {
      onCheckoutReturn();
      return false;
    }

    // Checkout, bank and 3-D Secure hops must remain encrypted. Custom app
    // schemes are deliberately not handed to the operating system from here.
    return request.url === "about:blank" || request.url.startsWith("https://");
  }

  function requestClose() {
    if (canGoBack && webView.current) {
      webView.current.goBack();
      return;
    }
    onClose();
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={requestClose}
      statusBarTranslucent={false}
    >
      {/* Checkout opens in its own window, which measures its own edges. */}
      <ModalSafeArea>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <View style={styles.securityMark} accessibilityElementsHidden>
            <Ionicons name="lock-closed" size={15} color={theme.color.kola["600"]} />
          </View>
          <View style={styles.headerCopy}>
            <Type variant="bodyStrong">Secure payment</Type>
            <Type variant="caption" numberOfLines={1}>Paystack encrypted checkout</Type>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close secure payment"
            accessibilityHint="Returns to Rooomly to check the payment status"
            hitSlop={8}
            onPress={onClose}
            {...pressableFeedback(theme.color.ink["700"])}
            style={({ pressed }) => [styles.closeButton, pressed ? styles.pressed : null]}
          >
            <Ionicons name="close" size={22} color={theme.color.ink["900"]} />
          </Pressable>
        </View>

        <View style={styles.progressTrack} accessibilityElementsHidden>
          <View style={[styles.progressValue, { width: `${Math.max(4, progress * 100)}%` }]} />
        </View>

        <View style={styles.browserFrame}>
          {loadError ? (
            <View style={styles.errorState}>
              <View style={styles.errorIcon} accessibilityElementsHidden>
                <Ionicons name="cloud-offline-outline" size={24} color={theme.color.laterite["600"]} />
              </View>
              <Type variant="title2" style={styles.centered}>Checkout could not load</Type>
              <Type variant="caption" style={styles.centered}>
                Check your connection and try opening the secure payment again.
              </Type>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading secure payment again"
                onPress={() => {
                  setLoadError("");
                  setProgress(0);
                  setReloadKey((value) => value + 1);
                }}
                {...pressableFeedback(theme.color.field["0"])}
                style={({ pressed }) => [styles.retryButton, pressed ? styles.pressed : null]}
              >
                <Type variant="bodyStrong" style={styles.retryLabel}>Try again</Type>
              </Pressable>
            </View>
          ) : (
            <WebView
              key={`${intent.id}:${reloadKey}`}
              ref={webView}
              source={{ uri: checkoutUrl }}
              originWhitelist={["https://*"]}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              startInLoadingState
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures
              onShouldStartLoadWithRequest={handleNavigation}
              onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
              onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
              onError={() => setLoadError("Secure checkout could not be reached.")}
              onHttpError={({ nativeEvent }) => {
                if (nativeEvent.statusCode >= 400) setLoadError("Secure checkout returned an error.");
              }}
              renderLoading={() => (
                <View style={styles.loading}>
                  <ActivityIndicator color={theme.color.kola["600"]} />
                  <Type variant="caption">Opening secure checkout…</Type>
                </View>
              )}
              style={styles.webView}
            />
          )}
        </View>

        <View style={styles.footer}>
          <Ionicons name="shield-checkmark-outline" size={16} color={theme.color.ink["500"]} />
          <Type variant="caption" style={styles.footerCopy}>
            Rooomly confirms the result with Paystack before updating {settles}.
          </Type>
        </View>
      </SafeAreaView>
      </ModalSafeArea>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.color.field["50"],
  },
  header: {
    minHeight: 62,
    paddingHorizontal: space[4],
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    backgroundColor: theme.color.field["0"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.field["200"],
  },
  securityMark: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["50"],
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["100"],
  },
  progressTrack: {
    height: 2,
    backgroundColor: theme.color.field["200"],
    overflow: "hidden",
  },
  progressValue: {
    height: "100%",
    backgroundColor: theme.color.kola["600"],
  },
  browserFrame: {
    flex: 1,
    backgroundColor: theme.color.field["0"],
  },
  webView: {
    flex: 1,
    backgroundColor: theme.color.field["0"],
  },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: space[3],
    backgroundColor: theme.color.field["0"],
  },
  errorState: {
    flex: 1,
    paddingHorizontal: space[8],
    alignItems: "center",
    justifyContent: "center",
    gap: space[3],
  },
  errorIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.laterite["100"],
  },
  centered: {
    textAlign: "center",
  },
  retryButton: {
    minHeight: 48,
    paddingHorizontal: space[6],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: theme.color.ink["900"],
  },
  retryLabel: {
    color: theme.color.field["0"],
  },
  footer: {
    minHeight: 50,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    backgroundColor: theme.color.field["50"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.field["200"],
  },
  footerCopy: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.72,
  },
});
