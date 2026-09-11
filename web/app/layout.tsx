import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

/* The product's two faces.
 *
 * Bricolage Grotesque carries every headline. It is variable on `opsz` as well
 * as weight, which is the reason for choosing it: the optical-size axis means a
 * 60px hero and a 20px card title are drawn differently on purpose — tighter
 * apertures and finer joins as the size climbs — instead of one outline scaled
 * up and hoping. Plus Jakarta Sans, which this replaces, is a pleasant face
 * with nothing to say at 60px.
 *
 * Geist does the work: controls, labels, body, and every figure. It is drawn
 * for interfaces, its numerals are unambiguous at 13px, and it stays quiet next
 * to a headline with real character — which is the whole point of a pairing.
 *
 * `fallback` gives next/font real metrics for the size-adjusted fallback, so a
 * swap does not reflow the page.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-display-face",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});
const body = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body-face",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Ghana Rental — Verified rentals across Ghana",
  description: "Find verified rental properties from verified owners and authorized agents across Ghana.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#211A15",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-GH"
      className={`${display.variable} ${body.variable}`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/*
          Motion serialises its `initial` state into the server-rendered HTML,
          so every revealed section ships as `opacity: 0` and waits for
          hydration to bring it back. A visitor whose JavaScript never arrives —
          which on a metered Ghanaian connection is a real visitor, not a
          hypothetical one — would otherwise get a blank marketing page.

          This runs only when scripting is off, so it costs nothing and cannot
          fight the animation when it is on.
        */}
        <noscript>
          <style
            dangerouslySetInnerHTML={{
              __html: "[data-reveal]{opacity:1!important;transform:none!important}",
            }}
          />
        </noscript>
      </head>
      {/* Browser extensions such as Grammarly and ColorZilla inject attributes
          on body before React hydrates. Suppress only this root element's
          attribute mismatch; application content mismatches still surface. */}
      <body suppressHydrationWarning>
        <a href="#main" className="type-caption skip-link">
          Skip to content
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
