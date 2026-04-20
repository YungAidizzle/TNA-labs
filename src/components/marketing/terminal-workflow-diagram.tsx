import { cn } from "@/lib/utils/cn";
import { WORKFLOW_STEPS } from "@/components/marketing/landing-page-content";

export function TerminalWorkflowDiagram() {
  return (
    <div className="relative mt-12">
      <div className="pointer-events-none absolute left-[15%] right-[15%] top-[46px] hidden h-px bg-[linear-gradient(90deg,rgba(119,223,255,0.05),rgba(119,223,255,0.45),rgba(125,224,173,0.42),rgba(119,223,255,0.05))] lg:block" />

      <div className="grid gap-4 lg:grid-cols-3">
        {WORKFLOW_STEPS.map((item, index) => (
          <div
            key={item.step}
            className="relative rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,24,0.98),rgba(5,8,13,0.995))] p-6 shadow-[0_20px_48px_rgba(0,0,0,0.26)]"
          >
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-[12px] text-cyan">{item.step}</span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-[#8fa4bd]">
                {index === 0 ? "Detect" : index === 1 ? "Link" : "Validate"}
              </span>
            </div>

            <h3 className="mt-5 text-[24px] font-semibold tracking-[-0.04em] text-[#eef4fb]">
              {item.title}
            </h3>
            <p className="mt-4 text-[15px] leading-7 text-[#8fa4bc]">
              {item.detail}
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {item.chips.map((chip, chipIndex) => (
                <span
                  key={chip}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.14em]",
                    chipIndex === 0
                      ? "border-cyan/25 bg-cyan/10 text-cyan"
                      : "border-white/[0.08] bg-white/[0.03] text-[#cbd8e7]",
                  )}
                >
                  {chip}
                </span>
              ))}
            </div>

            {index < WORKFLOW_STEPS.length - 1 ? (
              <div className="mt-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-[#6f849d] lg:hidden">
                <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(119,223,255,0.38),rgba(119,223,255,0))]" />
                Next step
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
