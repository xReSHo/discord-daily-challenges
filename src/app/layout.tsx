import type { Metadata, Viewport } from "next";
import { Cinzel, EB_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import { Atmosphere } from "@/components/Atmosphere";
import { ClickSpark } from "@/components/ClickSpark";
import { GraceEmbers } from "@/components/GraceEmbers";
import { GracePreload } from "@/components/GracePreload";
import { PageTransitions } from "@/components/PageTransitions";
import "./globals.css";

const display = Cinzel({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-cinzel",
  display: "swap",
});

const serif = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-garamond",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // the site's own address, so the link-preview picture gets a full URL
  ...(process.env.NEXTAUTH_URL ? { metadataBase: new URL(process.env.NEXTAUTH_URL) } : {}),
  title: "Daily Challenges",
  description: "One grace per day. Face the trial, claim the reward.",
  // what a posted link shows (the picture is app/opengraph-image.png)
  openGraph: {
    title: "Daily Challenges",
    description: "One grace per day. Face the trial, claim the reward.",
    siteName: "Daily Challenges",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // let the page run under a phone's notch; the gutters keep text clear of it
  viewportFit: "cover",
  themeColor: "#0a0908",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <Atmosphere />
        <GracePreload />
        <GraceEmbers />
        <ClickSpark />
        <PageTransitions />
        {children}
      </body>
    </html>
  );
}
