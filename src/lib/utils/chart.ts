import { formatCompactNumber, formatPreciseNumber } from "@/lib/formatters";
import { TimeSeriesPoint } from "@/types/domain";

export const MOVING_AVERAGE_OPTIONS = [
  { label: "Raw", windowSize: 1 },
  { label: "15m", windowSize: 3 },
  { label: "30m", windowSize: 6 },
  { label: "1h", windowSize: 12 },
] as const;

export const RAW_AUTO_MOVING_AVERAGE_MS = 20_000;

type AxisTooltipParam = {
  axisValueLabel?: string;
  color?: string;
  marker?: string;
  seriesName?: string;
  value?: number | string | Array<number | string | null> | null;
};

function getTooltipValue(param: AxisTooltipParam) {
  if (Array.isArray(param.value)) {
    const numeric = [...param.value]
      .reverse()
      .find((entry) => typeof entry === "number" && Number.isFinite(entry));
    return typeof numeric === "number" ? numeric : 0;
  }

  return typeof param.value === "number" && Number.isFinite(param.value) ? param.value : 0;
}

function escapeTooltipHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function applyMovingAverage(points: TimeSeriesPoint[], windowSize: number) {
  if (windowSize <= 1) {
    return points;
  }

  return points.map((point, index) => {
    const startIndex = Math.max(0, index - windowSize + 1);
    const window = points.slice(startIndex, index + 1);
    const average =
      window.reduce((sum, entry) => sum + entry.value, 0) / Math.max(window.length, 1);

    return {
      ...point,
      value: round1(average),
    };
  });
}

export function applyTimeWindowMovingAverage(points: TimeSeriesPoint[], windowMs: number) {
  if (windowMs <= 0 || points.length <= 1) {
    return points;
  }

  const timestamps = points.map((point) => Date.parse(point.timestamp));
  if (timestamps.some((value) => !Number.isFinite(value))) {
    return points;
  }

  let start = 0;
  let runningSum = 0;

  return points.map((point, index) => {
    const currentTimestamp = timestamps[index] as number;
    runningSum += point.value;

    while (
      start < index &&
      currentTimestamp - (timestamps[start] as number) > windowMs
    ) {
      runningSum -= points[start]?.value ?? 0;
      start += 1;
    }

    const sampleCount = Math.max(1, index - start + 1);
    return {
      ...point,
      value: round1(runningSum / sampleCount),
    };
  });
}

export function applyChartMovingAverage(
  points: TimeSeriesPoint[],
  windowSize: number,
) {
  if (windowSize <= 1) {
    return applyTimeWindowMovingAverage(points, RAW_AUTO_MOVING_AVERAGE_MS);
  }

  return applyMovingAverage(points, windowSize);
}

export function buildSortedAxisTooltip(
  valueLabel: string,
  options: {
    compactValues?: boolean;
    maxRows?: number;
    showTopSummary?: boolean;
    topSummaryLabel?: string;
  } = {},
) {
  const formatter = options.compactValues === false ? formatPreciseNumber : formatCompactNumber;

  return {
    trigger: "axis",
    order: "valueDesc" as const,
    backgroundColor: "rgba(10, 18, 30, 0.96)",
    borderColor: "rgba(122, 145, 175, 0.28)",
    textStyle: {
      color: "#edf3ff",
    },
    formatter: (params: AxisTooltipParam | AxisTooltipParam[]) => {
      const rows = (Array.isArray(params) ? params : [params])
        .map((row) => ({
          ...row,
          numericValue: getTooltipValue(row),
        }))
        .sort((left, right) => right.numericValue - left.numericValue);
      const visibleRows =
        typeof options.maxRows === "number" && options.maxRows > 0
          ? rows.slice(0, options.maxRows)
          : rows;

      const axisLabel = rows[0]?.axisValueLabel ? escapeTooltipHtml(rows[0].axisValueLabel) : "";
      const items = visibleRows
        .map((row) => {
          const marker =
            row.marker ??
            `<span style="display:inline-block;margin-right:8px;border-radius:999px;width:8px;height:8px;background:${row.color ?? "#5ee7ff"};"></span>`;
          const seriesName = escapeTooltipHtml(row.seriesName ?? "Series");
          const value = escapeTooltipHtml(formatter(row.numericValue));
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:8px;">
            <span style="display:flex;align-items:center;min-width:0;color:#edf3ff;">${marker}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${seriesName}</span></span>
            <span style="font-family:var(--font-ibm-plex-mono, monospace);color:#c6d4e7;">${value} ${escapeTooltipHtml(valueLabel)}</span>
          </div>`;
        })
        .join("");
      const topRow = visibleRows[0];
      const topSummary =
        options.showTopSummary && topRow && topRow.numericValue > 0
          ? `<div style="margin-top:6px;color:#edf3ff;font-weight:600;">
              ${escapeTooltipHtml(options.topSummaryLabel ?? "Top trend")}: ${escapeTooltipHtml(topRow.seriesName ?? "Series")}
            </div>`
          : "";

      return `<div style="min-width:220px;">
        <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#9fb1cb;">${axisLabel}</div>
        ${topSummary}
        ${items}
      </div>`;
    },
  };
}

export function baseChartOptions() {
  return {
    animationDuration: 500,
    textStyle: {
      color: "#9fb1cb",
      fontFamily: "var(--font-plex-sans)",
    },
    grid: {
      left: 12,
      right: 12,
      top: 18,
      bottom: 18,
      containLabel: true,
    },
    tooltip: {
      ...buildSortedAxisTooltip("posts"),
    },
    xAxis: {
      axisLine: { lineStyle: { color: "rgba(122, 145, 175, 0.18)" } },
      axisTick: { show: false },
      axisLabel: { color: "#6f839e" },
      splitLine: { show: false },
    },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#6f839e" },
      splitLine: { lineStyle: { color: "rgba(122, 145, 175, 0.08)" } },
    },
  };
}
