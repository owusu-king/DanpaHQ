import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, letting later Tailwind utilities win.
 *
 * `clsx` flattens the conditional forms; `twMerge` then resolves genuine
 * conflicts — `px-4` after `px-2` keeps only `px-4` — so a component's default
 * classes can always be overridden by the `className` a caller passes without
 * either side having to know the other's specificity.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
