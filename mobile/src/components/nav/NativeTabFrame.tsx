import type { ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";

import { TabHeaderRow } from "@/components/nav/TabHeader";
import {
  HeaderSearchPill,
  ProviderHeaderActions,
  TenantHeaderActions,
  TenantProfileButton,
} from "@/components/nav/TabHeaderControls";
import { PortfolioHeaderButton } from "@/components/portfolio/PortfolioSwitcher";
import { hapticsPolicy, isIOS, NativeTabContext } from "@/platform";
import { shell } from "@/shell";

/**
 * A selection tick on every tab press (owner, 2026-10-15).
 *
 * Apple's tab bar animates its selection but plays no haptic of its own, and
 * the custom bars always ticked, so the native bar would have felt quieter than
 * what it replaced. A press the native side refused — a disabled tab — stays
 * silent. Haptics are optional at runtime, so a build without the module
 * never throws on a tap.
 */
export const nativeTabHaptics = {
  tabPress: (event: { data?: { isPrevented?: boolean } }) => {
    if (!hapticsPolicy.onSelection || event.data?.isPrevented) return;
    void import("expo-haptics")
      .then((haptics) => haptics.selectionAsync())
      .catch(() => null);
  },
};

/**
 * A page inside iOS's native tab bar.
 *
 * On iOS the tabs are Apple's own bar (`NativeTabs`) — the real Liquid Glass,
 * its morphing selection and lens, the system haptics — but that bar draws no
 * header, so the page draws the green tool row itself, the same row
 * `TabHeader` draws for the JS tabs. It also tells the page it is a tab, which
 * the native bar cannot.
 *
 * Off iOS it is nothing at all: Android keeps the JS tabs, whose navigator
 * already draws the header.
 */
export function NativeTabFrame({
  header,
  ground = shell.canvas,
  children,
}: {
  /** The tool row, or nothing for a page that draws its own top. */
  header?: ReactNode;
  ground?: string;
  children: ReactNode;
}) {
  if (!isIOS) return <>{children}</>;
  return (
    <NativeTabContext.Provider value>
      <View style={{ flex: 1, backgroundColor: ground }}>
        {header}
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </NativeTabContext.Provider>
  );
}

type RenterTab = "home" | "explore" | "services" | "payments" | "menu";

/**
 * The renter's tabs, as the JS layout declares them: you, the search and the
 * bell on every tab that has a header; Explore and Menu draw their own tops;
 * Home's header runs on into its hero; Services and Payments keep their help.
 */
export function RenterTabFrame({ tab, children }: { tab: RenterTab; children: ReactNode }) {
  const header =
    tab === "explore" || tab === "menu" ? null : (
      <TabHeaderRow
        left={<TenantProfileButton />}
        middle={<HeaderSearchPill />}
        right={
          tab === "services" ? (
            <TenantHeaderActions helpTopic="services" />
          ) : tab === "payments" ? (
            <TenantHeaderActions helpTopic="payments" />
          ) : (
            <TenantHeaderActions />
          )
        }
        continues={tab === "home"}
      />
    );

  return (
    <NativeTabFrame header={header} ground={tab === "home" ? shell.dashboard : shell.canvas}>
      {children}
    </NativeTabFrame>
  );
}

type ProviderTab = "home" | "properties" | "tenants" | "payments" | "menu" | "add";

/**
 * The provider's tabs, as the JS layout declares them: the Portfolio, the bell
 * and the create action on every tab with a header; Menu draws its own top;
 * Home's header runs on into its hero.
 */
export function ProviderTabFrame({ tab, children }: { tab: ProviderTab; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const compact = width <= 390;
  const header =
    tab === "menu" ? null : (
      <TabHeaderRow
        left={<PortfolioHeaderButton compact={compact} />}
        right={<ProviderHeaderActions />}
        continues={tab === "home"}
      />
    );

  return (
    <NativeTabFrame header={header} ground={tab === "home" ? shell.dashboard : shell.canvas}>
      {children}
    </NativeTabFrame>
  );
}
