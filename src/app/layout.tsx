import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { RouteFeedbackProvider } from "@/components/navigation/route-feedback-provider";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plex-sans",
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Narrative To Asset | Operator Access",
    template: "%s | Narrative To Asset",
  },
  description:
    "Narrative-driven market intelligence with premium access control, Stripe billing, and Supabase-backed membership state.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${plexSans.variable} ${plexMono.variable} antialiased`}>
        <RouteFeedbackProvider>{children}</RouteFeedbackProvider>
      </body>
    </html>
  );
}
