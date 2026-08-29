import type { Metadata, Viewport } from "next";
import { Cinzel, EB_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import { Atmosphere } from "@/components/Atmosphere";
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
  title: "Daily Challenges",
  description: "One grace per day. Face the trial, claim the reward.",
};

export const viewport: Viewport = {
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
        {children}
      </body>
    </html>
  );
}
