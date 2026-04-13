import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { TERMS_DOCUMENT } from "@/lib/legal/document-content";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Terms of Service",
  description:
    "Read the Attentra terms covering account access, subscriptions, billing, acceptable use, and research-only service boundaries.",
  path: "/terms",
});

export default function TermsPage() {
  return <LegalDocumentPage {...TERMS_DOCUMENT} />;
}
