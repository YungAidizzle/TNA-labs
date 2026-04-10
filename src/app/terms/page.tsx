import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[980px] px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/" className="text-[12px] uppercase tracking-[0.16em] text-[#95aac2]">
          Home
        </Link>
        <div className="surface-panel mt-6 border border-white/[0.08] p-6 sm:p-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#6e8299]">Policy</p>
          <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff]">Terms</h1>
          <div className="mt-6 space-y-5 text-[15px] leading-7 text-[#94a9c1]">
            <p>This placeholder terms page is ready for your final legal terms before public launch.</p>
            <p>Include acceptable use, subscription and billing conditions once payments go live, service availability disclaimers, and a clear statement that the platform does not provide financial advice.</p>
            <p>If you expose exports, alerts, or API access later, document usage limits and termination rules here.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
