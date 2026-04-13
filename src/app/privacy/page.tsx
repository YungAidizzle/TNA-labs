import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { PRIVACY_DOCUMENT } from "@/lib/legal/document-content";

export default function PrivacyPage() {
  return <LegalDocumentPage {...PRIVACY_DOCUMENT} />;
}
