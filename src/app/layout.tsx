import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { AppProviders } from "@/providers/app-providers";
import { BRAND_DESCRIPTOR, BRAND_META_DESCRIPTION, BRAND_NAME } from "@/lib/brand";
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
    default: `${BRAND_NAME} | ${BRAND_DESCRIPTOR}`,
    template: `%s | ${BRAND_NAME}`,
  },
  description: BRAND_META_DESCRIPTION,
  applicationName: BRAND_NAME,
  openGraph: {
    title: `${BRAND_NAME} | ${BRAND_DESCRIPTOR}`,
    description: BRAND_META_DESCRIPTION,
    siteName: BRAND_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND_NAME} | ${BRAND_DESCRIPTOR}`,
    description: BRAND_META_DESCRIPTION,
  },
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
