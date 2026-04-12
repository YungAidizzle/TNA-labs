import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Narrative To Asset | Billing",
    template: "%s | Narrative To Asset",
  },
  description:
    "Minimal billing surface for Stripe checkout, customer portal, and Supabase-backed access control.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
