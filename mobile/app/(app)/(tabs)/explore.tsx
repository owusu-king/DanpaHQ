import SearchScreen from "../search";

import { RenterTabFrame } from "@/components/nav/NativeTabFrame";

/** On iOS the tab sits in the native bar, which draws no header; see `RenterTabFrame`. */
export default function ExploreTab() {
  return (
    <RenterTabFrame tab="explore">
      <SearchScreen />
    </RenterTabFrame>
  );
}
