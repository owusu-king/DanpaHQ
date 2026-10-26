import { ArtisanProfileScreen } from "@/components/artisan/ArtisanScreens";
import { ArtisanTabFrame } from "@/components/nav/NativeTabFrame";

/** On iOS the tab sits in the native bar, which draws no header; see `ArtisanTabFrame`. */
export default function Tab() {
  return (
    <ArtisanTabFrame tab="profile">
      <ArtisanProfileScreen />
    </ArtisanTabFrame>
  );
}
