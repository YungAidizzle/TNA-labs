import { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { SkeletonBlock } from "@/components/shared/skeleton-block";

type PanelProps = {
  title?: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  loading?: boolean;
  loadingContent?: ReactNode;
  children: ReactNode;
};

export function Panel({
  title,
  eyebrow,
  description,
  action,
  className,
  loading = false,
  loadingContent,
  children,
}: PanelProps) {
  return (
    <section
      className={cn(
        "surface-panel relative p-5 md:p-6",
        className,
      )}
    >
      {(title || eyebrow || action) && (
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            {eyebrow ? (
              <p className="mb-1.5 text-[12px] font-medium leading-[1.45] text-soft">
                {eyebrow}
              </p>
            ) : null}
            {title ? <h3 className="text-[17px] font-semibold text-foreground">{title}</h3> : null}
            {description ? <p className="mt-1.5 text-[13px] text-muted">{description}</p> : null}
          </div>
          {action}
        </header>
      )}
      <div className="relative">
        <div aria-hidden={loading || undefined} className={cn(loading && "invisible pointer-events-none")}>
          {children}
        </div>
        {loading ? (
          <div className="absolute inset-0 z-20 overflow-hidden bg-[#07101b]/26">
            <div className="h-full w-full">
              {loadingContent ?? (
                <div className="space-y-3">
                  <SkeletonBlock className="h-5 w-40" />
                  <SkeletonBlock className="h-20 w-full" />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <SkeletonBlock className="h-[72px]" />
                    <SkeletonBlock className="h-[72px]" />
                    <SkeletonBlock className="h-[72px]" />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
