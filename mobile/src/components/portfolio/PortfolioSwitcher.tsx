import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth, type Me } from "@/auth";
import { ModalSafeArea } from "@/components/sheet/ModalSafeArea";
import { Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

/**
 * Which Portfolio is being operated, and the way to change it.
 *
 * A chip in the header, with the Portfolio's name, and a sheet that comes up from the thumb. Switching
 * Portfolio changes what every screen is about — the Properties, the tenants,
 * the agreements, the money — so it belongs to the workspace chrome rather than
 * to a picker sitting on top of one tab, which is where it used to live and
 * where it moved that tab alone while everything else stayed behind.
 *
 * One tap, a quick look at where you are, a switch, back to work.
 */

/** When the list is long enough that reading it beats scanning it. */
const SEARCHABLE_FROM = 7;

const TYPE_LABELS: Record<string, string> = {
  individual_owner: "Personal",
  property_company: "Property company",
  property_manager: "Property management",
  hostel_operator: "Hostel",
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  property_manager: "Manager",
  accountant: "Accountant",
  staff: "Staff",
};

type Portfolio = Me["contexts"][number];

/** Two letters of the name, which is enough to tell three Portfolios apart. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words.slice(0, 2).map((word) => word[0] ?? "").join("") || name.slice(0, 2))).toUpperCase();
}

function describe(portfolio: Portfolio): string {
  const type = TYPE_LABELS[portfolio.organization_type ?? ""] ?? portfolio.subtitle ?? "Portfolio";
  const role = ROLE_LABELS[portfolio.role ?? ""] ?? portfolio.role?.replaceAll("_", " ");
  return role ? `${type} · ${role}` : type;
}

function portfoliosOf(me: Me | null): Portfolio[] {
  if (!me || me.capabilities.active_workspace !== "provider") return [];
  return me.contexts.filter((context) => context.type === "organization");
}

export function PortfolioHeaderButton({ compact = false }: { compact?: boolean }) {
  const { state, activeContext } = useAuth();
  const [open, setOpen] = useState(false);

  const me = state.status === "signed_in" ? state.me : null;
  const portfolios = portfoliosOf(me);
  const current = portfolios.find((row) => row.id === activeContext) ?? portfolios[0];
  if (!current) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Portfolio: ${current.label}. Switch portfolio`}
        accessibilityHint="Opens your Portfolios"
        onPress={() => setOpen(true)}
        hitSlop={4}
        {...pressableFeedback(shell.chromePressed)}
        style={({ pressed }) => ({
          height: 40,
          maxWidth: compact ? 196 : 232,
          marginLeft: compact ? 12 : 16,
          paddingLeft: 3,
          paddingRight: 12,
          borderRadius: 20,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          // A darker well cut into the kola chrome, like the tenant's search pill.
          backgroundColor: alpha(theme.color.kola["900"], pressed ? 0.58 : 0.4),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: alpha(shell.onChrome, 0.16),
        })}
      >
        {/* The Portfolio's initials on white: the one solid mark on the left. */}
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: shell.onChrome,
          }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 12, lineHeight: 15, fontWeight: "600", color: shell.chrome }}>
            {initials(current.label)}
          </Text>
        </View>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ flexShrink: 1, fontSize: 15, lineHeight: 20, fontWeight: "500", color: shell.onChrome }}
        >
          {current.label}
        </Text>
        {/* A chevron only when there is somewhere else to be. */}
        {portfolios.length > 1 ? (
          <Ionicons name="chevron-down" size={15} color={shell.onChromeMuted} />
        ) : null}
      </Pressable>

      <PortfolioSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function PortfolioSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { state, activeContext, setActiveContext } = useAuth();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const me = state.status === "signed_in" ? state.me : null;
  const portfolios = portfoliosOf(me);
  const current = portfolios.find((row) => row.id === activeContext) ?? portfolios[0];
  const searchable = portfolios.length >= SEARCHABLE_FROM;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    if (!needle) return portfolios;
    return portfolios.filter((row) =>
      `${row.label} ${describe(row)}`.toLocaleLowerCase("en-GH").includes(needle),
    );
  }, [portfolios, query]);

  async function choose(id: string) {
    if (id === current?.id) {
      onClose();
      return;
    }
    try {
      // The shared context is the switch. Every screen reads it, so they all
      // reload against the Portfolio that is now on screen.
      await setActiveContext(id);
      setQuery("");
      onClose();
    } catch {
      setError("Could not switch Portfolio.");
    }
  }

  function leaveFor(path: string) {
    onClose();
    router.push(path as never);
  }

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* Its own window, so the sheet measures its own edges — see `ModalSafeArea`. */}
      <ModalSafeArea>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(16,14,10,0.38)" }}
      />
      <SafeAreaView
        edges={{ bottom: "maximum" }}
        style={{
          paddingTop: space[3],
          paddingBottom: space[4],
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          backgroundColor: theme.color.field["0"],
        }}
      >
        <View
          style={{
            alignSelf: "center",
            width: 36,
            height: 4,
            borderRadius: 2,
            marginBottom: space[3],
            backgroundColor: theme.color.field["300"],
          }}
        />

        <View style={{ paddingHorizontal: space[5], paddingBottom: space[2] }}>
          <Type variant="label">YOUR PORTFOLIOS</Type>
        </View>

        {searchable ? (
          <View style={{ paddingHorizontal: space[5], paddingBottom: space[2] }}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search Portfolios"
              accessibilityLabel="Search your Portfolios"
              placeholderTextColor={theme.color.ink["300"]}
              style={{
                minHeight: 44,
                paddingHorizontal: space[3],
                borderRadius: 10,
                backgroundColor: theme.color.field["50"],
                borderWidth: 1,
                borderColor: theme.color.field["200"],
                color: theme.color.ink["900"],
              }}
            />
          </View>
        ) : null}

        {error ? (
          <View style={{ paddingHorizontal: space[5], paddingBottom: space[2] }}>
            <Type variant="caption">{error}</Type>
          </View>
        ) : null}

        <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingHorizontal: space[3] }}>
          {visible.map((portfolio) => {
            const isCurrent = portfolio.id === current?.id;
            return (
              <Pressable
                key={portfolio.id}
                accessibilityRole="radio"
                aria-selected={isCurrent}
                accessibilityLabel={`${portfolio.label}. ${describe(portfolio)}`}
                onPress={() => void choose(portfolio.id)}
                {...pressableFeedback(theme.color.field["100"])}
                style={({ pressed }) => ({
                  minHeight: 60,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space[3],
                  paddingHorizontal: space[2],
                  paddingVertical: space[2],
                  borderRadius: 12,
                  backgroundColor: pressed
                    ? theme.color.field["100"]
                    : isCurrent
                      ? theme.color.field["50"]
                      : "transparent",
                })}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isCurrent ? theme.color.kola["600"] : theme.color.field["100"],
                  }}
                >
                  <Type
                    variant="caption"
                    style={{
                      fontWeight: "500",
                      color: isCurrent ? theme.color.field["0"] : theme.color.ink["700"],
                    }}
                  >
                    {initials(portfolio.label)}
                  </Type>
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Type variant="bodyStrong" numberOfLines={1}>{portfolio.label}</Type>
                  <Type variant="caption" numberOfLines={1}>{describe(portfolio)}</Type>
                </View>

                {isCurrent ? (
                  <Ionicons name="checkmark" size={20} color={theme.color.kola["600"]} />
                ) : null}
              </Pressable>
            );
          })}

          {visible.length === 0 ? (
            <Type variant="caption" style={{ padding: space[4] }}>No Portfolio matches that.</Type>
          ) : null}
        </ScrollView>

        {/* Settling a Portfolio's affairs is not switching between them, so it
            sits below the line rather than in the list being scanned.

            There is nothing to create here. An account is given its one
            Portfolio when its provider access is approved, and every other
            Portfolio in this list arrived as somebody's invitation. */}
        <View
          style={{
            marginTop: space[2],
            paddingTop: space[2],
            paddingHorizontal: space[3],
            borderTopWidth: 1,
            borderTopColor: theme.color.field["200"],
          }}
        >
          <SheetAction label="Portfolio settings" icon="settings-outline" onPress={() => leaveFor("/(app)/team")} />
        </View>
      </SafeAreaView>
      </ModalSafeArea>
    </Modal>
  );
}

function SheetAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["100"])}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[2],
        borderRadius: 12,
        backgroundColor: pressed ? theme.color.field["100"] : "transparent",
      })}
    >
      <Ionicons name={icon} size={18} color={theme.color.ink["500"]} />
      <Type variant="body">{label}</Type>
    </Pressable>
  );
}
