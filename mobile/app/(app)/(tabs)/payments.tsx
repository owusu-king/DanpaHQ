import TenantPaymentsScreen from "../tenant-payments";

import { RenterTabFrame } from "@/components/nav/NativeTabFrame";

/** On iOS the tab sits in the native bar, which draws no header; see `RenterTabFrame`. */
export default function PaymentsTab() {
  return (
    <RenterTabFrame tab="payments">
      <TenantPaymentsScreen />
    </RenterTabFrame>
  );
}
