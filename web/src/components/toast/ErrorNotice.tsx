"use client";

import { useEffect } from "react";

import { useToast } from "./Toaster";

/** Connects existing operation error state to the shared feedback provider. */
export function ErrorNotice({ message, title }: { message: string; title?: string }) {
  const { toast, dismiss } = useToast();
  useEffect(() => {
    if (!message) return;
    const id = toast({ tone: "error", title: title ?? message, description: title ? message : undefined });
    return () => dismiss(id);
  }, [message, title, toast, dismiss]);
  return null;
}
