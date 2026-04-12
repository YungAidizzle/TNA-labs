import { joinClasses } from "@/components/ui/button";

type LoadingBlockProps = {
  className?: string;
};

export function LoadingBlock({ className }: LoadingBlockProps) {
  return <div aria-hidden="true" className={joinClasses("loading-block", className)} />;
}

export function LandingLoadingShell() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="border-b border-white/[0.08]">
        <div className="mx-auto flex h-[74px] w-full max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <LoadingBlock className="h-10 w-[220px]" />
          <LoadingBlock className="hidden h-10 w-[360px] md:block" />
          <LoadingBlock className="h-10 w-[220px]" />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-10 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <section className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="surface-panel border border-white/[0.08] p-8 lg:p-10">
            <LoadingBlock className="h-3 w-40" />
            <LoadingBlock className="mt-6 h-16 w-full max-w-[640px]" />
            <LoadingBlock className="mt-3 h-16 w-[92%] max-w-[590px]" />
            <LoadingBlock className="mt-8 h-5 w-full max-w-[620px]" />
            <LoadingBlock className="mt-3 h-5 w-[88%] max-w-[540px]" />
            <div className="mt-10 flex gap-3">
              <LoadingBlock className="h-12 w-48" />
              <LoadingBlock className="h-12 w-40" />
            </div>
            <div className="mt-12 grid gap-3 md:grid-cols-3">
              <LoadingBlock className="h-28" />
              <LoadingBlock className="h-28" />
              <LoadingBlock className="h-28" />
            </div>
          </div>

          <div className="surface-panel border border-white/[0.08] p-8 lg:p-10">
            <LoadingBlock className="h-3 w-36" />
            <LoadingBlock className="mt-6 h-8 w-52" />
            <div className="mt-8 space-y-4">
              <LoadingBlock className="h-28" />
              <LoadingBlock className="h-28" />
              <LoadingBlock className="h-28" />
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <LoadingBlock className="h-56" />
          <LoadingBlock className="h-56" />
          <LoadingBlock className="h-56" />
        </section>
      </div>
    </main>
  );
}

export function PricingLoadingShell() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="border-b border-white/[0.08]">
        <div className="mx-auto flex h-[74px] w-full max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <LoadingBlock className="h-10 w-[220px]" />
          <LoadingBlock className="hidden h-10 w-[360px] md:block" />
          <LoadingBlock className="h-10 w-[220px]" />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <section className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr]">
          <LoadingBlock className="h-[620px]" />
          <LoadingBlock className="h-[620px]" />
        </section>
        <section className="grid gap-4 lg:grid-cols-3">
          <LoadingBlock className="h-44" />
          <LoadingBlock className="h-44" />
          <LoadingBlock className="h-44" />
        </section>
      </div>
    </main>
  );
}

export function AuthLoadingShell() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <LoadingBlock className="h-10 w-36" />
          <LoadingBlock className="h-10 w-52" />
        </div>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
          <LoadingBlock className="hidden h-[620px] lg:block" />
          <LoadingBlock className="h-[620px]" />
        </section>
      </div>
    </main>
  );
}

export function StatusLoadingShell() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[980px] flex-col px-4 py-8 sm:px-6 lg:px-8">
        <LoadingBlock className="h-12 w-52" />
        <LoadingBlock className="mt-8 h-[520px]" />
      </div>
    </main>
  );
}
