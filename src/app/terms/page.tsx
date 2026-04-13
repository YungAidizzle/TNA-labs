import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { TERMS_DOCUMENT } from "@/lib/legal/document-content";

export default function TermsPage() {
  return <LegalDocumentPage {...TERMS_DOCUMENT} />;
}
