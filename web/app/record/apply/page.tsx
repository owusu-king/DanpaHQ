"use client";

import { useSearchParams } from "next/navigation";
import { RentalApplication } from "./RentalApplication";

export default function ApplyPage() {
  const id = useSearchParams().get("id") ?? "";
  return <RentalApplication key={id} id={id} />;
}
