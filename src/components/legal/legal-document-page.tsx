import Link from "next/link";
import {
  LEGAL_CONTACT,
  getPublicCompanyReference,
  getSupportContactHref,
  getSupportContactLabel,
} from "@/lib/legal/contact-details";

type LegalDocumentSection = {
  title: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
};

type LegalDocumentPageProps = {
  label: string;
  title: string;
  version: string;
  effectiveDate: string;
  summary: string;
  sections: readonly LegalDocumentSection[];
};

export function LegalDocumentPage({
  label,
  title,
  version,
  effectiveDate,
  summary,
  sections,
}: LegalDocumentPageProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[980px] px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/" className="text-[12px] uppercase tracking-[0.16em] text-[#95aac2]">
          Home
        </Link>

        <div className="surface-panel mt-6 border border-white/[0.08] p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#6e8299]">{label}</p>
              <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff]">
                {title}
              </h1>
            </div>

            <div className="border border-white/[0.08] bg-[#07101a] px-4 py-3 text-right">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Version</p>
              <p className="mt-1 font-mono text-[13px] text-[#eef5ff]">{version}</p>
              <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">
                Effective
              </p>
              <p className="mt-1 text-[13px] text-[#eef5ff]">{effectiveDate}</p>
            </div>
          </div>

          <p className="mt-6 max-w-[780px] text-[15px] leading-7 text-[#c8d5e4]">{summary}</p>

          <div className="mt-8 space-y-8">
            {sections.map((section) => (
              <section key={section.title} className="border-t border-white/[0.07] pt-6">
                <h2 className="text-[18px] font-semibold text-[#eef5ff]">{section.title}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph} className="mt-3 text-[15px] leading-7 text-[#94a9c1]">
                    {paragraph}
                  </p>
                ))}
                {section.bullets?.length ? (
                  <ul className="mt-4 space-y-3">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-3 text-[15px] leading-7 text-[#94a9c1]">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-cyan" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>

          <div className="mt-8 border-t border-white/[0.07] pt-6 text-[14px] leading-7 text-[#8ea4bc]">
            {LEGAL_CONTACT.companyLegalName || LEGAL_CONTACT.serviceAddress ? (
              <p>
                Contact: {[getPublicCompanyReference(), LEGAL_CONTACT.serviceAddress].filter(Boolean).join(" | ")}
              </p>
            ) : (
              <p>
                Support, billing, and legal contact channels are provided through the authenticated product experience.
              </p>
            )}

            {LEGAL_CONTACT.supportEmail ? (
              <p>
                Support:{" "}
                <a className="text-cyan hover:text-[#b8f2ff]" href={getSupportContactHref("support") ?? undefined}>
                  {getSupportContactLabel("support")}
                </a>
              </p>
            ) : null}

            {LEGAL_CONTACT.billingSupportEmail ? (
              <p>
                Billing:{" "}
                <a className="text-cyan hover:text-[#b8f2ff]" href={getSupportContactHref("billing") ?? undefined}>
                  {getSupportContactLabel("billing")}
                </a>
              </p>
            ) : null}

            {LEGAL_CONTACT.legalEmail ? (
              <p>
                Legal:{" "}
                <a className="text-cyan hover:text-[#b8f2ff]" href={getSupportContactHref("legal") ?? undefined}>
                  {getSupportContactLabel("legal")}
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
