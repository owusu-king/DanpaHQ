import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, type Me } from "@/auth";
import { Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { shell } from "@/shell";
import { theme } from "@/theme";

/**
 * Which Portfolio is being operated, and the way to change it.
 *
 * One icon in the header, and a sheet that comes up from the thumb. Switching
 * Portfolio changes what every screen is about — the Properties, the tenants,
 * the agreements, the money — so it belongs to the workspace chrome rather than
 * to a picker sitting on top of one tab, which is where it used to live and
 * where it moved that tab alone while everything else stayed behind.
 *
 * One icon, a quick look at where you are, a switch, back to work.
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

  // The paper well every header disc shares: 40pt drawn, and the 48pt floor
  // reached with slop rather than with a heavier circle.
  const size = 40;

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
          width: size,
          height: size,
          marginLeft: compact ? 12 : 16,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          // A translucent well on the kola chrome, like every other header control.
          backgroundColor: pressed ? shell.chromePressed : shell.chromeRaised,
        })}
      >
        <Ionicons name="albums-outline" size={20} color={shell.onChrome} />
        {/* A mark that there is somewhere else to be — never a count, which
            would read as unread work and belongs to the bell. White, cut out of
            the green behind it. */}
        {portfolios.length > 1 ? (
          <View
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: shell.onChrome,
              borderWidth: 1.5,
              borderColor: shell.chrome,
            }}
          />
        ) : null}
      </Pressable>

      <PortfolioSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function PortfolioSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(16,14,10,0.38)" }}
      />
      <View
        style={{
          paddingTop: space[3],
          paddingBottom: Math.max(insets.bottom, space[4]),
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
                accessibilityState={{ selected: isCurrent }}
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
                      fontWeight: "600",
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
      </View>
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
