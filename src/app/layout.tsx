import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { AppProviders } from "@/providers/app-providers";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Narrative To Asset | Execution Surface",
    template: "%s | Narrative To Asset",
  },
  description:
    "Narrative intelligence, correlated memecoin discovery, and market-linked validation in a premium execution terminal.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body
        className={`${plexSans.variable} ${plexMono.variable} h-full min-h-screen bg-background antialiased`}
      >
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
