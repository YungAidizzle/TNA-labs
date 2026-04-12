"use client";

import dynamic from "next/dynamic";
import type { EChartsType } from "echarts";
import { memo, ReactNode } from "react";
import { SkeletonBlock } from "@/components/shared/skeleton-block";
import { cn } from "@/lib/utils/cn";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <SkeletonBlock className="h-full min-h-[220px] w-full" />,
});

type EChartProps = {
  option: unknown;
  height?: number | string;
  className?: string;
  onEvents?: Record<string, (value: unknown) => void>;
  onChartReady?: (instance: EChartsType) => void;
  empty?: ReactNode;
  notMerge?: boolean;
};

export const EChart = memo(function EChart({
  option,
  height = 260,
  className,
  onEvents,
  onChartReady,
  notMerge = false,
}: EChartProps) {
  return (
    <ReactECharts
      option={option as never}
      style={{ height, width: "100%" }}
      className={cn("min-h-[220px]", className)}
      opts={{ renderer: "canvas" }}
      notMerge={notMerge}
      lazyUpdate
      onEvents={onEvents}
      onChartReady={onChartReady}
    />
  );
});
