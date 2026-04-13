import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { RISK_DISCLOSURE_DOCUMENT } from "@/lib/legal/document-content";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Risk Disclosure",
  description:
    "Read the Attentra risk disclosure covering market volatility, data limitations, memecoin exposure, and independent user responsibility.",
  path: "/risk-disclosure",
});

export default function RiskDisclosurePage() {
  return <LegalDocumentPage {...RISK_DISCLOSURE_DOCUMENT} />;
}
