// Keep the complete provider journey inside the tab navigator. Redirecting to
// a root stack route removed the bottom navigation and could leave a first-time
// provider with no usable way back.
import ProviderScreen from "../provider";

import { ProviderTabFrame } from "@/components/nav/NativeTabFrame";

/** On iOS the tab sits in the native bar, which draws no header; see `ProviderTabFrame`. */
export default function AddTab() {
  return (
    <ProviderTabFrame tab="add">
      <ProviderScreen />
    </ProviderTabFrame>
  );
}
