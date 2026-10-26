/**
 * Printing and saving documents, without opening a tab that never renders.
 *
 * The old way opened a blank tab straight away (to keep the click's popup
 * permission), fetched the PDF, pointed the tab at it, and then added a
 * `load` listener to print. Pointing the tab at the PDF replaces its window,
 * and the listener goes with it — so print never fired — and any slow or failed
 * fetch left the blank tab behind. Nothing here opens a tab to print.
 *
 * - `printPdf` loads the PDF into a hidden frame on this page and prints that
 *   frame: the browser's own print dialog, with the document in it.
 * - `printElement` prints part of this page as its own document (a receipt as
 *   it is shown), with the page's styles, in a hidden frame as well.
 * - `downloadBlob` saves a file through a link, which needs no popup at all.
 * - `openPdf` shows a PDF in a new tab once it has arrived, and saves it
 *   instead if the browser will not open one.
 */

const CLEANUP_MS = 60_000;

function hiddenFrame() {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // Laid out (a zero-size or display:none frame will not print in every
  // browser) but out of sight and out of the way.
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(frame);
  return frame;
}

function printFrame(frame: HTMLIFrameElement, cleanup: () => void) {
  const view = frame.contentWindow;
  if (!view) { cleanup(); return; }
  view.addEventListener("afterprint", () => window.setTimeout(cleanup, 500), { once: true });
  // Some browsers never send afterprint for a framed PDF; clean up regardless.
  window.setTimeout(cleanup, CLEANUP_MS);
  view.focus();
  view.print();
}

export function printPdf(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: "application/pdf" }));
    const frame = hiddenFrame();
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      frame.remove();
      URL.revokeObjectURL(url);
    };
    frame.addEventListener("load", () => {
      // The PDF viewer needs a beat after `load` before it can print.
      window.setTimeout(() => { printFrame(frame, cleanup); resolve(); }, 250);
    }, { once: true });
    frame.src = url;
  });
}

export function printElement(element: HTMLElement, title = document.title) {
  const frame = hiddenFrame();
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  // The page's own styles, so the printout looks like what was on screen.
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((node) => node.outerHTML).join("");
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${styles}<style>
    @page { margin: 14mm; }
    html, body { background: #fff !important; margin: 0; }
    body > * { animation: none !important; box-shadow: none !important; }
  </style></head><body>${element.outerHTML}</body></html>`);
  doc.close();
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    frame.remove();
  };
  // Stylesheets and fonts load inside the frame before it is printed.
  const go = () => window.setTimeout(() => printFrame(frame, cleanup), 150);
  if (doc.readyState === "complete") go();
  else frame.contentWindow?.addEventListener("load", go, { once: true });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), CLEANUP_MS);
}

export function openPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: "application/pdf" }));
  // Not "noopener": with it, window.open reports null even when the tab opened,
  // and a blocked popup could not be told apart. The opener is cut by hand.
  const opened = window.open(url, "_blank");
  if (opened) opened.opener = null;
  if (!opened) {
    // No popup allowed (the click is too far behind the fetch): save it instead.
    URL.revokeObjectURL(url);
    downloadBlob(blob, filename);
    return;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), CLEANUP_MS);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}
