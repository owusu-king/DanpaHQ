import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

/* The Provider Home pairs a display serif with a neutral UI face. Loaded
   through next/font so both are self-hosted from the build output rather than
   fetched from a third party at runtime — the same choice globals.css makes for
   the rest of the stack. */
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
});
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Ghana Rental — Verified rentals across Ghana",
  description: "Find verified rental properties from verified owners and authorized agents across Ghana.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B5D4E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <a href="#main" className="type-caption skip-link">
          Skip to content
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
