"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { EFFECTIVE_DATE, RISK_VERSION } from "@/lib/legal/policy-versions";

type DashboardLegalShellProps = {
  children: React.ReactNode;
  needsRiskAcceptance: boolean;
};

const RISK_ACK_ITEMS = [
  "I understand the platform is informational only and is not personal financial advice.",
  "I understand data, classifications, and asset links may be delayed, incomplete, inaccurate, or unavailable.",
  "I understand crypto-assets and memecoins are high risk and can result in partial or total loss.",
  "I remain solely responsible for my own research, decisions, execution, and risk management.",
  "I understand the platform does not execute trades, manage accounts, or act as my broker, dealer, or fiduciary.",
] as const;

export function DashboardLegalShell({
  children,
  needsRiskAcceptance,
}: DashboardLegalShellProps) {
  const [requiresAcceptance, setRequiresAcceptance] = useState(needsRiskAcceptance);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = RISK_ACK_ITEMS.every((item) => checkedItems[item]);

  async function handleAccept() {
    if (!allChecked || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/legal/acceptances", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          policyType: "risk",
          context: "dashboard",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(payload?.error?.message ?? "Unable to save risk acknowledgement.");
      }

      setRequiresAcceptance(false);
    } catch (acceptanceError) {
      setError(
        acceptanceError instanceof Error
          ? acceptanceError.message
          : "Unable to save risk acknowledgement.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      {requiresAcceptance ? (
        <div className="flex h-full min-h-[520px] items-center justify-center px-4 py-8">
          <div className="w-full max-w-[760px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,17,25,0.99),rgba(6,10,16,0.995))] p-6 shadow-[0_18px_40px_rgba(0,0,0,0.34)] sm:p-8">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#6e8299]">Risk acknowledgement required</p>
            <h1 className="mt-4 text-[32px] font-semibold tracking-[-0.05em] text-[#f3f8ff]">
              Review the current risk disclosure before entering the terminal.
            </h1>
            <p className="mt-4 max-w-[640px] text-[15px] leading-7 text-[#92a7bf]">
              The platform is paid research software that can influence decisions. Access to live narrative and
              correlated asset data stays blocked until the current risk disclosure is acknowledged.
            </p>

            <div className="mt-6 flex flex-wrap gap-4 border border-white/[0.08] bg-[#07101a] px-4 py-3 text-[13px] text-[#d6e0ee]">
              <span>Risk version: {RISK_VERSION}</span>
              <span>Effective date: {EFFECTIVE_DATE}</span>
              <Link href="/risk-disclosure" className="text-cyan hover:text-[#b8f2ff]">
                Read full disclosure
              </Link>
            </div>

            <div className="mt-6 space-y-3">
              {RISK_ACK_ITEMS.map((item) => (
                <label
                  key={item}
                  className="flex items-start gap-3 border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[14px] leading-6 text-[#c7d4e3]"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(checkedItems[item])}
                    onChange={(event) =>
                      setCheckedItems((current) => ({
                        ...current,
                        [item]: event.target.checked,
                      }))
                    }
                    className="mt-1 h-4 w-4 shrink-0 border border-white/[0.16] bg-[#07101a]"
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>

            {error ? (
              <div className="mt-4 border border-rose/20 bg-rose/10 px-4 py-3 text-[13px] text-[#ffb0b0]">
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleAccept}
                disabled={!allChecked || submitting}
                className="inline-flex h-11 items-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Saving acknowledgement..." : "Accept and continue"}
              </button>
              <Link
                href="/pricing"
                className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
              >
                Back to billing
              </Link>
            </div>
          </div>
        </div>
      ) : (
        children
      )}
    </AppShell>
  );
}
