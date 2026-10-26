"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { documentTitle } from "@/lib/pageTitles";

type Override = { pathname: string; name: string } | null;

const TitleContext = createContext<(next: Override) => void>(() => {});

/**
 * The browser tab's title, from the address (see `lib/pageTitles`).
 *
 * React 19 hoists a `<title>` rendered anywhere into the document head, on the
 * server as well as after each navigation, so this one element is the page's
 * title from the first byte. The root layout's metadata sets no title of its
 * own, so there is never a second `<title>` for the browser to choose between.
 */
export function PageTitleProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [override, setOverride] = useState<Override>(null);
  // A name set by one record never follows the person to the next address.
  const name = override && override.pathname === pathname ? override.name : undefined;
  return (
    <TitleContext.Provider value={setOverride}>
      <title>{documentTitle(pathname, name)}</title>
      {children}
    </TitleContext.Provider>
  );
}

/**
 * Name this page after the record it shows — "Adom Heights | DanpaHQ" —
 * once that name is known. Pass null (still loading, nothing found) to keep
 * the page's generic name.
 */
export function usePageTitle(name: string | null | undefined) {
  const setOverride = useContext(TitleContext);
  const pathname = usePathname() ?? "/";
  useEffect(() => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    setOverride({ pathname, name: trimmed });
    return () => setOverride(null);
  }, [name, pathname, setOverride]);
}
