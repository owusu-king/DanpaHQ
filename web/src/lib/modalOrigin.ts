/**
 * Where a modal sits, and where it grows from.
 *
 * A modal opens over the page, not over the whole app: the rail and the top
 * bar stay as they are, and only the content area is dimmed with the modal
 * centred in it. `holdModalInWorkspace` measures that area into
 * `--modal-area-top/left`, which the modal and its `::backdrop` are inset by,
 * and keeps it right while the window changes size. On a phone the area is the
 * whole screen, because the modal is a full-screen sheet there.
 *
 * `aimModalFrom` then measures the control that opened the dialog against the
 * dialog's resting place and sets `--modal-from-x/y` to a fraction of that
 * distance, which the shared `modal-spring` and `modal-out` keyframes start from
 * and fall back to. Without an invoker (a deep link, a control that is gone)
 * the modal rises from just below its place.
 */
// How much of the way from the opener the sheet travels. Enough to say where
// it came from, not so much that it swoops.
const PULL = 0.18;
const PHONE = "(max-width: 47.99rem)";

function measureWorkspace(dialog: HTMLDialogElement) {
  let top = 0;
  let left = 0;
  if (!window.matchMedia(PHONE).matches) {
    const rail = document.querySelector(".portal-rail")?.getBoundingClientRect();
    const header = document.querySelector(".portal-header")?.getBoundingClientRect();
    if (rail && rail.width > 0 && rail.right < window.innerWidth / 2) left = Math.max(0, Math.round(rail.right));
    if (header && header.height > 0 && header.bottom < window.innerHeight / 3) top = Math.max(0, Math.round(header.bottom));
  }
  dialog.style.setProperty("--modal-area-top", `${top}px`);
  dialog.style.setProperty("--modal-area-left", `${left}px`);
}

/** Call straight before `showModal()`; returns the cleanup for when it closes. */
export function holdModalInWorkspace(dialog: HTMLDialogElement) {
  measureWorkspace(dialog);
  const remeasure = () => measureWorkspace(dialog);
  window.addEventListener("resize", remeasure);
  return () => window.removeEventListener("resize", remeasure);
}

/**
 * Whether a click on a modal dialog landed on its dimmed backdrop.
 *
 * A press on the `::backdrop` is dispatched to the dialog itself, with the
 * point outside the dialog's box. The rail and top bar are outside the backdrop
 * (it is inset to the content area) and inert, so they never reach here: only
 * the dimmed area closes a modal, and the app's chrome does nothing.
 */
export function isBackdropClick(dialog: HTMLDialogElement | null, event: { target: EventTarget | null; clientX: number; clientY: number }) {
  if (!dialog || event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
}

/** Call straight after `showModal()`. */
export function aimModalFrom(dialog: HTMLDialogElement, invoker: Element | null) {
  dialog.style.removeProperty("--modal-from-x");
  dialog.style.removeProperty("--modal-from-y");
  if (!invoker || !invoker.isConnected || invoker === document.body) return;
  const from = invoker.getBoundingClientRect();
  if (from.width === 0 && from.height === 0) return;
  const to = dialog.getBoundingClientRect();
  const dx = (from.left + from.width / 2 - (to.left + to.width / 2)) * PULL;
  const dy = (from.top + from.height / 2 - (to.top + to.height / 2)) * PULL;
  dialog.style.setProperty("--modal-from-x", `${Math.round(dx)}px`);
  dialog.style.setProperty("--modal-from-y", `${Math.round(dy)}px`);
}

/**
 * A sheet that changes height glides to the new one instead of jumping.
 *
 * The sheet sizes itself to its content (`fit-content`, under a ceiling), so a
 * panel opening inside it, a step changing or a list loading would snap it taller
 * in one frame. A ResizeObserver hears the change after layout but before paint,
 * so the new height is never shown before the animation starts from the old one.
 *
 * The animation itself changes the size every frame, and the observer reports
 * those too; they are ignored while it runs. If the content moved again in the
 * meantime, the height it settles at differs from where it was heading, the
 * observer reports that once more, and it glides on from there. A window
 * resize is not content and is taken as it comes; a sheet that changes its own
 * width with a step (billing) still glides its height.
 */
const GLIDE_EASE = "cubic-bezier(.22, 1, .36, 1)";

export function glideModalHeight(dialog: HTMLDialogElement) {
  if (typeof ResizeObserver === "undefined") return () => {};
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  let height = 0;
  let width = 0;
  let running: Animation | null = null;
  let resizedAt = 0;
  const onResize = () => { resizedAt = performance.now(); };
  window.addEventListener("resize", onResize);

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const box = entry.borderBoxSize?.[0];
    const nextHeight = box ? box.blockSize : entry.contentRect.height;
    const nextWidth = box ? box.inlineSize : entry.contentRect.width;
    if (running) return;
    const from = height;
    const windowResized = Math.abs(nextWidth - width) >= 1 && performance.now() - resizedAt < 400;
    height = nextHeight;
    width = nextWidth;
    // The first measure after opening, a hidden sheet, a window resize or a
    // closing sheet all take the new size as it is.
    if (!from || !nextHeight || windowResized || still.matches) return;
    if (Math.abs(nextHeight - from) < 2 || dialog.classList.contains("is-closing")) return;

    const distance = Math.abs(nextHeight - from);
    running = dialog.animate(
      [{ height: `${from}px` }, { height: `${nextHeight}px` }],
      // Longer for a longer way, within a range that still feels immediate.
      { duration: Math.round(Math.min(520, 300 + distance * 0.6)), easing: GLIDE_EASE },
    );
    dialog.classList.add("is-gliding");
    const settle = () => {
      running = null;
      dialog.classList.remove("is-gliding");
    };
    running.addEventListener("finish", settle, { once: true });
    running.addEventListener("cancel", settle, { once: true });
  });

  observer.observe(dialog);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", onResize);
    running?.cancel();
  };
}
