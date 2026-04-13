import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { REFUND_POLICY_DOCUMENT } from "@/lib/legal/document-content";

export default function RefundPolicyPage() {
  return <LegalDocumentPage {...REFUND_POLICY_DOCUMENT} />;
}
