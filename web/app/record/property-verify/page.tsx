"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { PropertyVerificationModal } from "@/components/property/PropertyVerification";

export default function VerifyPropertyPage() {
  const search = useSearchParams();
  const router = useRouter();
  return <PropertyVerificationModal propertyId={search.get("id")} onClose={() => router.replace("/properties")} />;
}
