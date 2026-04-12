import { Activity, ArrowRight, Ban, Sparkles } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";

export default function BillingCancelPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.18),transparent_62%),rgba(6,11,17,0.92)] text-cyan">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#6e8299]">Billing</p>
            <p className="text-[15px] font-semibold text-[#eef5ff]">Checkout canceled</p>
          </div>
        </div>

        <div className="surface-panel mt-8 border border-white/[0.08] p-6 sm:p-8 lg:p-10">
          <span className="eyebrow-chip">
            <Sparkles className="h-3.5 w-3.5 text-cyan" />
            No subscription change applied
          </span>

          <div className="mt-6 flex items-center gap-3">
            <Ban className="h-5 w-5 text-amber" />
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#6e8299]">
              Checkout exited before completion
            </p>
          </div>

          <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff] sm:text-[40px]">
            Checkout was canceled before completion.
          </h1>
          <p className="mt-4 max-w-[760px] text-[15px] leading-8 text-[#92a7bf]">
            Your access state remains unchanged. You can return to pricing and restart Checkout
            whenever you are ready.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <InteractiveLink
              href="/pricing"
              pendingLabel="Opening pricing"
              navigationLabel="Opening pricing"
              className={buttonClassName({ tone: "primary", size: "lg" })}
            >
              <span className="inline-flex items-center gap-2">
                Return to pricing
                <ArrowRight className="h-4 w-4" />
              </span>
            </InteractiveLink>
            <InteractiveLink
              href="/"
              pendingLabel="Returning home"
              navigationLabel="Returning home"
              className={buttonClassName({ tone: "secondary", size: "lg" })}
            >
              Home
            </InteractiveLink>
          </div>
        </div>
      </div>
    </div>
  );
}
