import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { REFUND_POLICY_DOCUMENT } from "@/lib/legal/document-content";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Refund Policy",
  description:
    "Understand Attentra recurring billing, cancellation timing, refund handling, and when paid access begins after checkout.",
  path: "/refund-policy",
});

export default function RefundPolicyPage() {
  return <LegalDocumentPage {...REFUND_POLICY_DOCUMENT} />;
}
