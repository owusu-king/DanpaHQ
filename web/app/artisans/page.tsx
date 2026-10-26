import { Suspense } from "react";

import { ArtisansWorkspace } from "@/components/artisan/ArtisansWorkspace";
import { PanelSkeleton } from "@/components/workspace/Workspace";

export default function ArtisansPage() {
  return <Suspense fallback={<PanelSkeleton rows={4} />}><ArtisansWorkspace /></Suspense>;
}
