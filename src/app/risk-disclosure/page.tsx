import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { RISK_DISCLOSURE_DOCUMENT } from "@/lib/legal/document-content";

export default function RiskDisclosurePage() {
  return <LegalDocumentPage {...RISK_DISCLOSURE_DOCUMENT} />;
}
