"use client";

import { useEffect } from "react";
import { ErrorPageShell } from "@/components/shared/error-page-shell";

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalErrorPage({
  error,
  reset,
}: GlobalErrorPageProps) {
  useEffect(() => {
    console.error("[global-app-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="h-full min-h-screen bg-background antialiased">
        <ErrorPageShell
          eyebrow="Critical error"
          title="The application failed to render."
          description="A top-level error interrupted the request before the page could load. Retry once, then investigate the deployment if it happens again."
          primaryAction={
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 items-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
            >
              Retry
            </button>
          }
          secondaryHref="/"
          secondaryLabel="Return home"
        />
      </body>
    </html>
  );
}
