import type { MouseEvent } from "react";

/**
 * A link that opens a sheet in place on a plain press.
 *
 * The creation flows open as sheets over the page that asked (owner,
 * 2026-10-20), but their routes stay real addresses: a press meant for a new
 * tab or window — any modifier, any button but the first — follows the link.
 */
export function inPlace(open: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    open();
  };
}
