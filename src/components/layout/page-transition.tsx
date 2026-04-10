"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type PageTransitionProps = {
  children: ReactNode;
  className?: string;
};

export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <div className={cn(className)}>
      {children}
    </div>
  );
}
