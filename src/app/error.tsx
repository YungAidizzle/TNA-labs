"use client";

import { useEffect } from "react";
import { ErrorPageShell } from "@/components/shared/error-page-shell";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <ErrorPageShell
      eyebrow="Application error"
      title="Something failed while loading this page."
      description="The request did not complete cleanly. Try the page again, then return home if the problem persists."
      primaryAction={
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
        >
          Try again
        </button>
      }
      secondaryHref="/"
      secondaryLabel="Return home"
    />
  );
}
