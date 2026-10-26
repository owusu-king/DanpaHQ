import { useRef } from "react";

/**
 * Take a Portfolio's data off the screen the moment that Portfolio is left.
 *
 * Every provider screen reloads when the active context changes, but a reload
 * takes a moment, and for that moment the figures already rendered belong to
 * the Portfolio somebody has just switched away from — sitting under the new
 * Portfolio's name, which is the one reading nobody can afford to get wrong.
 *
 * The web console remounts the page beneath the header and is done with it. A
 * tab navigator cannot remount without throwing away which tab somebody was
 * on, so the screens blank what they are about to replace instead.
 *
 * Returning to a tab is not a switch: that data is still about the Portfolio on
 * screen, so it stays and the reload refreshes it in place.
 */
export function useBlankOnPortfolioSwitch(activeContext: string | null, blank: () => void): void {
  const shown = useRef(activeContext);
  if (shown.current === activeContext) return;
  // Adjusting this screen's own state while it renders, so the switch and the
  // blank land in the same frame; an effect would paint the old figures once.
  shown.current = activeContext;
  blank();
}
