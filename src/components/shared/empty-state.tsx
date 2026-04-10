import { cn } from "@/lib/utils/cn";

type EmptyStateProps = {
  title: string;
  detail: string;
  className?: string;
};

export function EmptyState({ title, detail, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "border border-dashed border-border bg-white/2 px-6 py-9 text-center",
        className,
      )}
    >
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-[13px] text-muted">{detail}</p>
    </div>
  );
}
