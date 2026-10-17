"use client";

/**
 * Which record a page's modal is showing, held in page state, not the address.
 *
 * A modal is a moment over a list, not a place. When modals kept themselves in
 * the address (`?tenant=`, `?record=` …) every close and every Back had to
 * fight the address: Back reopened the sheet, and a workaround had to guess
 * whether the person was retracing their steps. Here opening and closing never
 * touch the address, so Back simply leaves the page.
 *
 * A link from elsewhere can still open one — a notification, a Home card, the
 * payment return, a receipt link. `/maintenance?request=<id>` opens that
 * request once, and the parameter is taken straight back out of the address,
 * so a later refresh, Back or copied link shows the list itself.
 */

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** Take one parameter out of the address, keeping everything else on it. */
function clearParam(name: string) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  // Native and synchronous, so two modals clearing their links in the same
  // render cannot write each other's parameter back. `null`, never a copy of
  // `history.state`: a copy carries Next's own marker and the router would not
  // see the change.
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * `[openId, setOpenId]` for one modal. `openId` is "" while it is closed.
 * `param` names the one-time link that can open it from elsewhere.
 */
export function useDeepLinkedModal(param: string): [string, (id: string) => void] {
  const linked = useSearchParams().get(param) ?? "";
  const [openId, setOpenId] = useState("");

  useEffect(() => {
    if (!linked) return;
    setOpenId(linked);
    clearParam(param);
  }, [linked, param]);

  const set = useCallback((id: string) => setOpenId(id), []);
  return [openId, set];
}
