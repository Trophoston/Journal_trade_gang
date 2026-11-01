import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import { InlineScript } from "@/components/ui/inline-script";
import { APPEARANCE_SCRIPT } from "@/lib/ui/appearance";
import { VIEW_TRANSITION_GUARD } from "@/lib/ui/view-transition";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const thai = IBM_Plex_Sans_Thai({ variable: "--font-thai", subsets: ["thai"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: "Trade Gang", template: "%s · Trade Gang" },
  description: "Live MT5 trading journal with a Gemini coach",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf0f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0d13" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable} ${thai.variable}`}>
      <head>
        <InlineScript html={VIEW_TRANSITION_GUARD + APPEARANCE_SCRIPT} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
