/**
 * Whether the page in front of the person was reached by Back or Forward, and
 * nothing has been touched since.
 *
 * Every modal over a list keeps itself in the address (`?tenant=`, `?record=`,
 * `?request=` …) so a refresh or a shared link reopens it. Those writes are
 * replacements, so the list's own history entry carries the open modal. Leave
 * through a link inside the modal, press Back, and the list came back *with the
 * modal open again* — over and over, every time the person tried to get back
 * to the list.
 *
 * `ModalSheet` asks this before it opens. Arriving by history means the person
 * is retracing their steps, not asking for the sheet, so it closes instead —
 * which strips the parameter from the address through the page's own
 * `onClose`. A deep link, a refresh, a notification and a click still open it:
 * none of them is a traversal, and any press or key after a traversal counts as
 * the person acting on the page again.
 */

let traversed = false;

if (typeof window !== "undefined") {
  // A whole-document Back (bfcache miss, or a link from another site) arrives
  // as a fresh load of type `back_forward`, with no popstate of its own.
  const entry = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  traversed = entry?.type === "back_forward";

  window.addEventListener("popstate", () => { traversed = true; });
  // Capture phase, so the press that opens a modal clears this first. The
  // mouse's own Back button presses before its popstate, so it still counts.
  const acted = () => { traversed = false; };
  window.addEventListener("pointerdown", acted, true);
  window.addEventListener("keydown", acted, true);
}

export function arrivedByHistory(): boolean {
  return traversed;
}
