"use client";

import { useEffect, useState } from "react";

type Commit = () => Promise<boolean>;
export type CloseGuard = { current: (() => boolean) | null };

export function useWizardDraft<Key extends string>(keys: readonly Key[], current: Key, busy: boolean, closeGuardRef?: CloseGuard, onBusyChange?: (busy: boolean) => void) {
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set());
  const [commits] = useState(() => Object.fromEntries(
    keys.map((key) => [key, { current: null }]),
  ) as Record<Key, { current: Commit | null }>);

  useEffect(() => {
    if (!closeGuardRef) return;
    closeGuardRef.current = () => !busy && (dirty.size === 0 || window.confirm("Discard unsaved changes? Saved steps will stay on record."));
    return () => { closeGuardRef.current = null; };
  }, [busy, closeGuardRef, dirty]);

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  useEffect(() => {
    if (!dirty.size && !busy) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [busy, dirty]);

  return {
    commits,
    dirty,
    confirmFinish() {
      return dirty.size === 0 || window.confirm("Finish without saving changes in other steps?");
    },
    markEdited() {
      // Media uploads save immediately. The review screen is read-only.
      if (current === "photos" || current === "review") return;
      setDirty((previous) => previous.has(current) ? previous : new Set([...previous, current]));
    },
    markSaved() {
      setDirty((previous) => {
        if (!previous.has(current)) return previous;
        const next = new Set(previous);
        next.delete(current);
        return next;
      });
    },
  };
}
