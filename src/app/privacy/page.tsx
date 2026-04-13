import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { PRIVACY_DOCUMENT } from "@/lib/legal/document-content";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Privacy Policy",
  description:
    "Review how Attentra handles account data, billing records, technical logs, and privacy requests for the service.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return <LegalDocumentPage {...PRIVACY_DOCUMENT} />;
}
