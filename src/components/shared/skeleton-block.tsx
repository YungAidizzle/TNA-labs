import { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils/cn";

type SkeletonBlockProps = ComponentPropsWithoutRef<"div">;

export function SkeletonBlock({ className, ...props }: SkeletonBlockProps) {
  return (
    <div
      {...props}
      className={cn(
        "animate-pulse bg-gradient-to-r from-white/4 via-white/8 to-white/4",
        className,
      )}
    />
  );
}
