import Link from "next/link";
import { Activity, ArrowRight, Ban } from "lucide-react";

export default function BillingCancelPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[980px] flex-col px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_62%),rgba(6,11,17,0.92)] text-cyan">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#6e8299]">Billing</p>
            <p className="text-[15px] font-semibold text-[#eef5ff]">Checkout canceled</p>
          </div>
        </div>

        <div className="surface-panel mt-8 border border-white/[0.08] p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <Ban className="h-5 w-5 text-amber" />
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#6e8299]">No subscription change applied</p>
          </div>

          <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff]">
            Checkout was canceled before completion.
          </h1>
          <p className="mt-4 max-w-[720px] text-[15px] leading-7 text-[#92a7bf]">
            Your access state remains unchanged. You can return to pricing and restart Checkout whenever you are ready.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
            >
              Return to pricing
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/"
              className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
            >
              Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
