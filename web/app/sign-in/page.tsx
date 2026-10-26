"use client";

import { Suspense } from "react";

import { AuthEntry } from "@/components/auth/AuthDialog";

/**
 * `/sign-in` from outside the app — an email, a bookmark, a redirect. It opens
 * the auth dialog once and leaves the address on the front door; inside the app,
 * the dialog opens in place and this address is never used.
 */
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <AuthEntry view="sign-in" />
    </Suspense>
  );
}
