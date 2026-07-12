import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShadowData — Alternative Data Terminal",
  description:
    "Search a ticker and pull real-time alternative data (hiring, OSS, app, web, patents, filings, chatter) to support an investment thesis.",
};

const HUB_PROJECT_ID = process.env.NEXT_PUBLIC_HUB_PROJECT_ID || "shadowdata";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        {/* afterInteractive: hub-nav.js gates auth, injects the nav bar, and reveals
            the page (globals.css keeps it hidden until then). */}
        <Script
          src="https://oxfordhub.app/hub-nav.js"
          data-project-id={HUB_PROJECT_ID}
          strategy="afterInteractive"
          id="hub-nav"
        />
      </body>
    </html>
  );
}
