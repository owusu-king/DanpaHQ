import { PageLoading } from "@/components/workspace/PageLoading";

/** This boundary replaces route content; AppShell and navigation stay mounted. */
export default function Loading() {
  return <PageLoading />;
}
