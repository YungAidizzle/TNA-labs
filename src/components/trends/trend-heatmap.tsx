"use client";

import { getInstanceByDom, type EChartsType } from "echarts";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EChart } from "@/components/charts/echart";
import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";
import { formatCompactNumber, formatSignedPercent } from "@/lib/formatters";
import { resolveHeatmapTileTextLayout } from "@/lib/utils/trend-heatmap-layout";
import { RankedTrend } from "@/types/view-models";

type TrendHeatmapProps = {
  rows: RankedTrend[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
};

type HeatmapMetricSource =
  | "period_change"
  | "velocity"
  | "relative_strength"
  | "neutral";

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

type HeatmapMetric = {
  rawScore: number;
  source: HeatmapMetricSource;
  changePct: number;
  hasPreviousData: boolean;
  currentPosts: number | null;
  previousPosts: number | null;
};

type HeatmapChartDatum = {
  id: string;
  name: string;
  value: number;
  score: number;
  rawScore: number;
  scoreSource: HeatmapMetricSource;
  changePct: number;
  velocity: number;
  posts: number;
  currentPosts: number | null;
  previousPosts: number | null;
  hasPreviousData: boolean;
  itemStyle: {
    color: string;
    borderColor: string;
    borderWidth: number;
    shadowColor: string;
    shadowBlur: number;
  };
  emphasis: {
    itemStyle: {
      color: string;
      borderColor: string;
      borderWidth: number;
      shadowColor: string;
      shadowBlur: number;
    };
  };
  visualWeight: number;
};

type HeatmapRenderedTile = {
  id: string;
  name: string;
  posts: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

type HeatmapDisplayElement = {
  __ecData?: {
    seriesIndex?: number;
    dataIndex?: number;
  };
  [key: string]: unknown;
  invisible?: boolean;
  z2?: number;
  shape?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  transformCoordToGlobal?: (x: number, y: number) => [number, number];
  getBoundingRect?: () => {
    x: number;
    y: number;
    width: number;
    height: number;
    clone?: () => {
      x: number;
      y: number;
      width: number;
      height: number;
      applyTransform?: (transform: unknown) => void;
    };
  };
  getComputedTransform?: () => unknown;
};

function resolveDisplayElementMeta(element: HeatmapDisplayElement) {
  if (element.__ecData) {
    return element.__ecData;
  }

  for (const [key, value] of Object.entries(element)) {
    if (!key.startsWith("__ec_inner_") || !value || typeof value !== "object") {
      continue;
    }

    const candidate = value as { dataIndex?: number; seriesIndex?: number };
    if (typeof candidate.dataIndex === "number") {
      return candidate;
    }
  }

  return null;
}

const HIGH_VOLUME_GLOW_THRESHOLD = 0.76;
const VOLUME_CURVE_GAMMA = 0.72;
const VOLUME_LOW_PERCENTILE = 0.04;
const VOLUME_HIGH_PERCENTILE = 0.98;
const GREEN_COLOR_STOPS: ReadonlyArray<{ score: number; color: RgbColor }> = [
  { score: 0, color: { r: 8, g: 27, b: 18 } },
  { score: 0.16, color: { r: 15, g: 46, b: 29 } },
  { score: 0.4, color: { r: 24, g: 92, b: 52 } },
  { score: 0.72, color: { r: 31, g: 138, b: 70 } },
  { score: 1, color: { r: 0, g: 200, b: 83 } },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveHeatmapPosts(row: RankedTrend) {
  return Math.max(
    0,
    row.rootsCount24h ??
      row.supportingThreadCount ??
      row.blueskySummary?.postCount ??
      row.mentions ??
      row.attentionInteractions ??
      row.totalInteractions24h ??
      0,
  );
}

function resolveHeatmapValue(row: RankedTrend) {
  return Math.max(1, resolveHeatmapPosts(row));
}

function quantile(sortedValues: number[], percentile: number) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const clampedPercentile = clamp(percentile, 0, 1);
  const index = (sortedValues.length - 1) * clampedPercentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper === lower) {
    return sortedValues[lower];
  }

  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function resolveWindowPosts(
  row: RankedTrend,
): {
  current: number;
  previous: number;
} | null {
  const values = (row.attentionHistory ?? [])
    .map((point) => point.value)
    .filter((value): value is number => Number.isFinite(value))
    .map((value) => Math.max(0, value));

  if (values.length < 2) {
    return null;
  }

  if (values.length < 4) {
    return {
      previous: values[values.length - 2] ?? 0,
      current: values[values.length - 1] ?? 0,
    };
  }

  const midpoint = Math.floor(values.length / 2);
  if (midpoint <= 0 || midpoint >= values.length) {
    return null;
  }

  return {
    previous: values.slice(0, midpoint).reduce((total, value) => total + value, 0),
    current: values.slice(midpoint).reduce((total, value) => total + value, 0),
  };
}

function resolveMetricScore(
  row: RankedTrend,
  averagePosts: number,
  averageVelocity: number,
): HeatmapMetric {
  const windows = resolveWindowPosts(row);
  if (windows) {
    if (windows.previous > 0) {
      const score = (windows.current - windows.previous) / windows.previous;
      return {
        rawScore: score,
        source: "period_change",
        changePct: score * 100,
        hasPreviousData: true,
        currentPosts: windows.current,
        previousPosts: windows.previous,
      };
    }

    return {
      rawScore: 0,
      source: "neutral",
      changePct: 0,
      hasPreviousData: false,
      currentPosts: windows.current,
      previousPosts: windows.previous,
    };
  }

  if (Number.isFinite(row.growthRate) && Math.abs(row.growthRate) >= 0.5) {
    return {
      rawScore: row.growthRate / 100,
      source: "period_change",
      changePct: row.growthRate,
      hasPreviousData: true,
      currentPosts: null,
      previousPosts: null,
    };
  }

  const velocityScore = row.velocityScore;
  if (typeof velocityScore === "number" && Number.isFinite(velocityScore)) {
    const baselineVelocity = Math.max(1, averageVelocity);
    const score = (velocityScore - baselineVelocity) / baselineVelocity;
    return {
      rawScore: score,
      source: "velocity",
      changePct: score * 100,
      hasPreviousData: false,
      currentPosts: null,
      previousPosts: null,
    };
  }

  const posts = resolveHeatmapPosts(row);
  const relativeStrength = (posts - averagePosts) / Math.max(1, averagePosts);
  return {
    rawScore: relativeStrength,
    source: "relative_strength",
    changePct: relativeStrength * 100,
    hasPreviousData: false,
    currentPosts: null,
    previousPosts: null,
  };
}

function createVolumeColorNormalizer(values: number[]) {
  const finiteValues = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, value));

  if (finiteValues.length === 0) {
    return () => 0.5;
  }

  const logValues = finiteValues
    .map((value) => Math.log1p(value))
    .sort((left, right) => left - right);
  const minLog = quantile(logValues, VOLUME_LOW_PERCENTILE);
  const maxLog = quantile(logValues, VOLUME_HIGH_PERCENTILE);
  const range = Math.max(maxLog - minLog, 0.00001);

  if (range <= 0.00001) {
    return () => 0.55;
  }

  return (value: number) => {
    const normalized = clamp((Math.log1p(Math.max(0, value)) - minLog) / range, 0, 1);
    return Math.pow(normalized, VOLUME_CURVE_GAMMA);
  };
}

function mixChannel(from: number, to: number, ratio: number) {
  return Math.round(from + (to - from) * ratio);
}

function interpolateColor(score: number): RgbColor {
  const firstStop = GREEN_COLOR_STOPS[0];
  const lastStop = GREEN_COLOR_STOPS[GREEN_COLOR_STOPS.length - 1];
  const clampedScore = clamp(score, firstStop.score, lastStop.score);

  for (let index = 1; index < GREEN_COLOR_STOPS.length; index += 1) {
    const lower = GREEN_COLOR_STOPS[index - 1];
    const upper = GREEN_COLOR_STOPS[index];
    if (clampedScore <= upper.score) {
      const segmentRange = Math.max(upper.score - lower.score, 0.00001);
      const segmentRatio = (clampedScore - lower.score) / segmentRange;
      return {
        r: mixChannel(lower.color.r, upper.color.r, segmentRatio),
        g: mixChannel(lower.color.g, upper.color.g, segmentRatio),
        b: mixChannel(lower.color.b, upper.color.b, segmentRatio),
      };
    }
  }

  return { ...lastStop.color };
}

function brightenColor(color: RgbColor, amount: number): RgbColor {
  const ratio = clamp(amount, 0, 1);
  return {
    r: mixChannel(color.r, 255, ratio),
    g: mixChannel(color.g, 255, ratio),
    b: mixChannel(color.b, 255, ratio),
  };
}

function toRgb(color: RgbColor) {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function toRgba(color: RgbColor, alpha: number) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;
}

function resolveChartInstance(container: HTMLDivElement | null) {
  const chartElement = container?.querySelector(".echarts-for-react");
  if (!(chartElement instanceof HTMLDivElement)) {
    return null;
  }

  return getInstanceByDom(chartElement) ?? null;
}

function readRenderedTreemapTiles(
  chart: EChartsType,
  items: ReadonlyArray<Pick<HeatmapChartDatum, "id" | "name" | "posts">>,
): HeatmapRenderedTile[] {
  try {
    const chartWithZr = chart as unknown as {
      getZr?: () => {
        storage?: {
          getDisplayList?: () => HeatmapDisplayElement[];
        };
      };
    };
    const displayList = chartWithZr.getZr?.().storage?.getDisplayList?.() ?? [];
    const tileMap = new Map<number, HeatmapRenderedTile & { area: number }>();

    for (const element of displayList) {
      const metadata = resolveDisplayElementMeta(element);
      const dataIndex = metadata?.dataIndex;
      const seriesIndex = metadata?.seriesIndex;
      const itemIndex = typeof dataIndex === "number" ? dataIndex - 1 : -1;
      const shape = element.shape;
      if (
        seriesIndex !== 0 ||
        typeof dataIndex !== "number" ||
        itemIndex < 0 ||
        itemIndex >= items.length ||
        !shape ||
        typeof shape.width !== "number" ||
        typeof shape.height !== "number"
      ) {
        continue;
      }

      const localLeft = shape.x ?? 0;
      const localTop = shape.y ?? 0;
      const localRight = localLeft + shape.width;
      const localBottom = localTop + shape.height;

      let left = localLeft;
      let top = localTop;
      let width = Math.max(0, shape.width);
      let height = Math.max(0, shape.height);

      const boundingRect = element.getBoundingRect?.();
      const computedTransform = element.getComputedTransform?.();
      const clonedBoundingRect = boundingRect?.clone?.();
      if (clonedBoundingRect?.applyTransform && computedTransform) {
        clonedBoundingRect.applyTransform(computedTransform);
        left = clonedBoundingRect.x;
        top = clonedBoundingRect.y;
        width = clonedBoundingRect.width;
        height = clonedBoundingRect.height;
      } else if (element.transformCoordToGlobal) {
        const topLeft = element.transformCoordToGlobal(localLeft, localTop);
        const bottomRight = element.transformCoordToGlobal(localRight, localBottom);
        left = Math.min(topLeft[0], bottomRight[0]);
        top = Math.min(topLeft[1], bottomRight[1]);
        width = Math.abs(bottomRight[0] - topLeft[0]);
        height = Math.abs(bottomRight[1] - topLeft[1]);
      } else if (element.getBoundingRect) {
        const rect = element.getBoundingRect();
        left = rect.x;
        top = rect.y;
        width = rect.width;
        height = rect.height;
      }

      if (width < 18 || height < 14) {
        continue;
      }

      const area = width * height;
      const existing = tileMap.get(itemIndex);
      if (existing && existing.area <= area) {
        continue;
      }

      tileMap.set(itemIndex, {
        id: items[itemIndex].id,
        name: items[itemIndex].name,
        posts: items[itemIndex].posts,
        left,
        top,
        width,
        height,
        area,
      });
    }

    return items.flatMap((_, index) => {
      const tile = tileMap.get(index);
      if (!tile) {
        return [];
      }

      return {
        id: tile.id,
        name: tile.name,
        posts: tile.posts,
        left: tile.left,
        top: tile.top,
        width: tile.width,
        height: tile.height,
      };
    });
  } catch {
    return [];
  }
}

function buildTitleStyle(
  tileWidth: number,
  tileHeight: number,
  selected: boolean,
): CSSProperties {
  const layout = resolveHeatmapTileTextLayout("", tileWidth, tileHeight);

  return {
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontSize: layout.titleFontSize,
    lineHeight: `${layout.titleLineHeight}px`,
    fontWeight: 500,
    letterSpacing: "-0.01em",
    color: selected ? "#f7fff9" : "#eef7f1",
    textShadow: selected
      ? "0 1px 10px rgba(2, 9, 6, 0.5)"
      : "0 1px 8px rgba(2, 9, 6, 0.42)",
  };
}

function buildCountStyle(
  tileWidth: number,
  tileHeight: number,
  selected: boolean,
): CSSProperties {
  const layout = resolveHeatmapTileTextLayout("", tileWidth, tileHeight);

  return {
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: layout.countFontSize,
    lineHeight: `${layout.countLineHeight}px`,
    fontWeight: 400,
    fontFamily: "var(--font-plex-mono)",
    color: selected ? "rgba(244, 252, 246, 0.96)" : "rgba(221, 236, 225, 0.82)",
    textShadow: selected
      ? "0 1px 9px rgba(2, 9, 6, 0.42)"
      : "0 1px 7px rgba(2, 9, 6, 0.34)",
  };
}

export function TrendHeatmap({ rows, selectedId, onSelect }: TrendHeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const [renderedTiles, setRenderedTiles] = useState<HeatmapRenderedTile[]>([]);
  const topRows = useMemo(() => rows.slice(0, 28), [rows]);

  const { option, chartData } = useMemo(() => {
    const postTotals = topRows.map((row) => resolveHeatmapPosts(row));
    const sizeValues = topRows.map((row) => resolveHeatmapValue(row));
    const normalizeVolumeToColor = createVolumeColorNormalizer(postTotals);
    const averagePosts =
      postTotals.reduce((total, value) => total + value, 0) / Math.max(postTotals.length, 1);
    const averageVelocitySource = topRows
      .map((row) => row.velocityScore)
      .filter((value): value is number => Number.isFinite(value));
    const averageVelocity =
      averageVelocitySource.length > 0
        ? averageVelocitySource.reduce((total, value) => total + value, 0) /
          averageVelocitySource.length
        : 0;
    const maxTileValue = Math.max(1, ...sizeValues);
    const scoredRows = topRows.map((row) => {
      const posts = resolveHeatmapPosts(row);
      const sizeValue = resolveHeatmapValue(row);
      const metric = resolveMetricScore(row, averagePosts, averageVelocity);
      return { row, posts, sizeValue, metric };
    });

    const data: HeatmapChartDatum[] = scoredRows.map(({ row, posts, sizeValue, metric }) => {
      const colorIntensity = normalizeVolumeToColor(posts);
      const baseColor = interpolateColor(colorIntensity);
      const hoverColor = brightenColor(baseColor, 0.14);
      const isHighVolume = colorIntensity >= HIGH_VOLUME_GLOW_THRESHOLD;
      const isSelected = row.id === selectedId;
      const glowBlur = isHighVolume ? 16 : 8;
      const glowColor = isHighVolume ? toRgba(baseColor, 0.34) : toRgba(baseColor, 0.12);

      return {
        id: row.id,
        name: getTrendDisplayNameOrPlaceholder(row),
        value: sizeValue,
        score: colorIntensity,
        rawScore: metric.rawScore,
        scoreSource: metric.source,
        changePct: metric.changePct,
        velocity: row.velocityScore ?? 0,
        posts,
        currentPosts: metric.currentPosts,
        previousPosts: metric.previousPosts,
        hasPreviousData: metric.hasPreviousData,
        itemStyle: {
          color: toRgb(baseColor),
          borderColor: isSelected ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.05)",
          borderWidth: isSelected ? 1.6 : 1,
          shadowColor: isSelected ? toRgba(baseColor, 0.28) : glowColor,
          shadowBlur: isSelected ? Math.max(glowBlur + 4, 10) : glowBlur,
        },
        emphasis: {
          itemStyle: {
            color: toRgb(hoverColor),
            borderColor: isSelected ? "rgba(255,255,255,0.44)" : "rgba(255,255,255,0.16)",
            borderWidth: isSelected ? 1.8 : 1.4,
            shadowColor: isHighVolume ? toRgba(baseColor, 0.44) : toRgba(baseColor, 0.2),
            shadowBlur: isSelected ? 24 : Math.max(12, glowBlur + 4),
          },
        },
        visualWeight: sizeValue / maxTileValue,
      };
    });

    return {
      option: {
        animationDuration: 380,
        backgroundColor: "transparent",
        tooltip: {
          trigger: "item",
          backgroundColor: "rgba(4, 8, 13, 0.98)",
          borderColor: "rgba(175, 196, 223, 0.2)",
          borderWidth: 1,
          padding: [10, 12],
          extraCssText: "box-shadow:0 16px 34px rgba(0,0,0,0.52);border-radius:6px;",
          textStyle: { color: "#e8eef9" },
          formatter: (params: {
            data?: {
              name?: string;
              posts?: number;
              changePct?: number;
              velocity?: number;
              scoreSource?: HeatmapMetricSource;
              hasPreviousData?: boolean;
              currentPosts?: number | null;
              previousPosts?: number | null;
            };
          }) => {
            const item = params.data;
            if (!item) {
              return "";
            }

            const changeLabel = item.hasPreviousData
              ? formatSignedPercent(item.changePct ?? 0, 1)
              : "n/a";
            const signalLabel =
              item.scoreSource === "period_change"
                ? "Period change"
                : item.scoreSource === "velocity"
                  ? "Velocity vs avg"
                  : item.scoreSource === "relative_strength"
                    ? "Strength vs avg"
                    : "Neutral";
            const baselineLabel =
              item.hasPreviousData &&
              Number.isFinite(item.previousPosts) &&
              Number.isFinite(item.currentPosts)
                ? `${formatCompactNumber(item.previousPosts ?? 0)} -> ${formatCompactNumber(item.currentPosts ?? 0)}`
                : "No previous baseline";

            return `${item.name ?? "Topic"}<br/>Posts ${formatCompactNumber(item.posts ?? 0)}<br/>% Change ${changeLabel}<br/>Velocity ${formatCompactNumber(item.velocity ?? 0)}<br/>Signal ${signalLabel}<br/>Window ${baselineLabel}`;
          },
        },
        series: [
          {
            type: "treemap",
            roam: false,
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
            breadcrumb: { show: false },
            nodeClick: false,
            sort: "desc",
            squareRatio: 1.28,
            visibleMin: 4,
            label: {
              show: false,
            },
            upperLabel: {
              show: false,
            },
            itemStyle: {
              borderRadius: 0,
              gapWidth: 1,
            },
            emphasis: {
              itemStyle: {
                borderColor: "rgba(255,255,255,0.2)",
                borderWidth: 1.4,
              },
            },
            levels: [
              {
                itemStyle: {
                  borderColor: "rgba(255,255,255,0.05)",
                  borderWidth: 1,
                  gapWidth: 1,
                },
              },
            ],
            data,
          },
        ],
      },
      chartData: data,
    };
  }, [selectedId, topRows]);

  const syncRenderedTiles = useCallback(() => {
    const liveChart = resolveChartInstance(containerRef.current);
    if (liveChart) {
      chartRef.current = liveChart;
    }

    if (!chartRef.current || chartData.length === 0) {
      setRenderedTiles([]);
      return;
    }

    setRenderedTiles(readRenderedTreemapTiles(chartRef.current, chartData));
  }, [chartData]);

  const handleChartReady = useCallback((instance: EChartsType) => {
    chartRef.current = instance;
    syncRenderedTiles();
  }, [syncRenderedTiles]);

  const clickHandlers = useMemo(
    () => ({
      click: (payload: unknown) => {
        const params = payload as { data?: { id?: string } } | null;
        const nextId = params?.data?.id;
        if (typeof nextId === "string" && nextId.length > 0) {
          onSelect(nextId);
        }
      },
      finished: (_payload: unknown, instance?: unknown) => {
        if (instance && typeof instance === "object") {
          chartRef.current = instance as EChartsType;
        }
        syncRenderedTiles();
      },
    }),
    [onSelect, syncRenderedTiles],
  );

  useEffect(() => {
    if (chartData.length === 0) {
      const frameId = window.requestAnimationFrame(() => {
        setRenderedTiles([]);
      });

      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    let cancelled = false;
    let timeoutId = 0;
    let attempts = 0;

    const queueSync = () => {
      if (cancelled) {
        return;
      }

      syncRenderedTiles();
      if (!chartRef.current && attempts < 20) {
        attempts += 1;
        timeoutId = window.setTimeout(queueSync, 150);
      }
    };

    timeoutId = window.setTimeout(queueSync, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [chartData, syncRenderedTiles]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        syncRenderedTiles();
      });
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [syncRenderedTiles]);

  if (topRows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-[#7f91a9]">
        No heatmap data available for this window.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full min-h-0 w-full overflow-hidden border border-white/[0.05] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_42%),linear-gradient(180deg,rgba(7,11,16,0.97),rgba(4,7,11,0.99))]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)]" />
      <EChart
        option={option}
        onEvents={clickHandlers}
        onChartReady={handleChartReady}
        height="100%"
        className="relative z-[1] h-full min-h-0 w-full"
        notMerge
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
        {renderedTiles.map((tile) => {
          const layout = resolveHeatmapTileTextLayout(tile.name, tile.width, tile.height);
          const selected = tile.id === selectedId;
          const titleStyle = buildTitleStyle(tile.width, tile.height, selected);
          const countStyle = buildCountStyle(tile.width, tile.height, selected);
          const tileStyle: CSSProperties = {
            left: tile.left,
            top: tile.top,
            width: tile.width,
            height: tile.height,
            padding: layout.padding,
          };
          const titleClampStyle: CSSProperties =
            layout.titleLines === 1
              ? {
                  ...titleStyle,
                  whiteSpace: "nowrap",
                }
              : {
                  ...titleStyle,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: layout.titleLines,
                };

          return (
            <div key={tile.id} className="absolute overflow-hidden" style={tileStyle}>
              <div
                className="grid h-full min-h-0 w-full"
                style={{
                  gridTemplateRows: layout.showPosts ? "minmax(0,1fr) auto" : "1fr",
                  rowGap: layout.gap,
                }}
              >
                <span style={titleClampStyle}>{layout.title}</span>
                {layout.showPosts ? (
                  <span style={countStyle}>{formatCompactNumber(tile.posts)} posts</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
