import { Suspense } from "react";
import { HowItWorks } from "@/components/landing/HowItWorks";

export const metadata = { title: "How it works | Danpa HQ", description: "Short guides to finding a place, managing property, and working with artisans on Danpa HQ." };

export default function HowItWorksPage() {
  return <Suspense fallback={<div className="hiw-page" aria-busy="true">Loading guides…</div>}><HowItWorks /></Suspense>;
}
