import { ManagementShell } from "@/components/management/ManagementShell";
import { ManagementProvider } from "@/lib/management";

export default function ManagementLayout({ children }: { children: React.ReactNode }) {
  return (
    <ManagementProvider>
      <ManagementShell>{children}</ManagementShell>
    </ManagementProvider>
  );
}

