"use client";

import { memo, useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { EChart } from "@/components/charts/echart";
import { Badge } from "@/components/shared/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { SkeletonBlock } from "@/components/shared/skeleton-block";
import { PLATFORM_LABELS } from "@/lib/constants/options";
import {
  TREND_NAME_PLACEHOLDER,
  getTrendDisplayNameOrPlaceholder,
  hasTrustedTrendDisplayName,
} from "@/lib/dashboard/trend-name-state";
import {
  formatAgeMinutes,
  formatCompactNumber,
  formatDateTime,
  formatPercent,
  formatSignedPercent,
  formatTimeOnly,
  formatVelocityPerHour,
} from "@/lib/formatters";
import { getLifecycleTone } from "@/lib/utils/trend-display";
import { applyChartMovingAverage, baseChartOptions } from "@/lib/utils/chart";
import { cn } from "@/lib/utils/cn";
import { TimeSeriesPoint } from "@/types/domain";
import { TrendDetailVM } from "@/types/view-models";

type TrendDetailPanelProps = {
  detail: TrendDetailVM | null;
  onSelectTrend?: (id: string) => void;
  movingAverageWindow?: number;
  loading?: boolean;
  refreshing?: boolean;
};

type SummaryMetricProps = {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative";
};

type BlueskyTopPostMeta = {
  postType: string | null;
  repostCount: number | null;
  replyCount: number | null;
  quoteCount: number | null;
  likeCount: number | null;
};

type TrendDetailPanelContentProps = Omit<TrendDetailPanelProps, "detail"> & {
  detail: TrendDetailVM;
};

function SummaryMetric({ label, value, tone = "default" }: SummaryMetricProps) {
  return (
    <div className="rounded-2xl border border-border bg-white/4 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-soft">{label}</p>
      <p
        className={cn(
          "mt-2 font-mono text-base",
          tone === "positive"
            ? "text-emerald"
            : tone === "negative"
              ? "text-rose"
              : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function readNumber(source: unknown, keys: string[]) {
  const record = asRecord(source);
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function readString(source: unknown, keys: string[]) {
  const record = asRecord(source);
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function getPlatformLabel(platformId: string) {
  return PLATFORM_LABELS[platformId as keyof typeof PLATFORM_LABELS] ?? (platformId === "bluesky" ? "Bluesky" : platformId);
}

function getFreshnessBadgeTone(state: TrendDetailVM["trend"]["freshnessState"]) {
  if (state === "stale") {
    return "rose" as const;
  }

  if (state === "mixed" || state === "delayed") {
    return "amber" as const;
  }

  return "neutral" as const;
}

function getFreshnessLabel(state: TrendDetailVM["trend"]["freshnessState"]) {
  if (state === "stale") {
    return "Stale inputs";
  }

  if (state === "mixed") {
    return "Mixed freshness";
  }

  if (state === "delayed") {
    return "Delayed freshness";
  }

  return "Fresh inputs";
}

function getBlueskyTopPostMeta(post: TrendDetailVM["topPosts"][number]): BlueskyTopPostMeta {
  const record = post as TrendDetailVM["topPosts"][number] & Record<string, unknown>;
  return {
    postType: readString(record, ["postType", "kind", "recordType", "contentType"]),
    repostCount: readNumber(record, ["repostCount", "reposts"]),
    replyCount: readNumber(record, ["replyCount", "replies", "commentCount"]),
    quoteCount: readNumber(record, ["quoteCount", "quotes"]),
    likeCount: readNumber(record, ["likeCount", "likes"]),
  };
}

function getBucketDurationLabel(points: TimeSeriesPoint[]) {
  if (points.length < 2) {
    return "bucket";
  }

  const start = Date.parse(points[0].timestamp);
  const next = Date.parse(points[1].timestamp);
  if (!Number.isFinite(start) || !Number.isFinite(next) || next <= start) {
    return "bucket";
  }

  const minutes = Math.max(1, Math.round((next - start) / 60_000));
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours}h bucket`;
  }

  return `${minutes}m bucket`;
}

const PLATFORM_CHART_COLORS = ["#5ee7ff", "#ffbe64", "#64f0a9", "#ff7ca6", "#8ea2ff", "#c6d4e7"];

export const TrendDetailPanel = memo(function TrendDetailPanel({
  detail,
  onSelectTrend,
  movingAverageWindow = 1,
  loading = false,
  refreshing = false,
}: TrendDetailPanelProps) {
  if (!detail) {
    return (
      <EmptyState
        title="No narrative selected"
        detail="Run a source refresh to populate the detail panel with live narrative, platform, and top-content data."
      />
    );
  }

  return (
    <TrendDetailPanelContent
      detail={detail}
      onSelectTrend={onSelectTrend}
      movingAverageWindow={movingAverageWindow}
      loading={loading}
      refreshing={refreshing}
    />
  );
});

function TrendDetailPanelContent({
  detail,
  onSelectTrend,
  movingAverageWindow = 1,
  loading = false,
  refreshing = false,
}: TrendDetailPanelContentProps) {
  const smoothedAttentionGraph = useMemo(
    () => applyChartMovingAverage(detail.attentionGraph, movingAverageWindow),
    [detail.attentionGraph, movingAverageWindow],
  );
  const bucketDurationLabel = useMemo(
    () => getBucketDurationLabel(detail.attentionGraph),
    [detail.attentionGraph],
  );
  const googleSearchLabel = detail.trend.googleSearchInterest
    ? detail.trend.googleSearchInterest.approxTrafficLabel ||
      `Score ${detail.trend.googleSearchInterest.score.toFixed(0)}`
    : "No match";
  const attentionWindow = detail.attentionWindow;
  const trendDisplayName = getTrendDisplayNameOrPlaceholder(detail.trend);
  const hasTrustedDisplayName = hasTrustedTrendDisplayName(detail.trend);
  const showLoadingLabel = trendDisplayName === TREND_NAME_PLACEHOLDER;
  const latestBucketLabel =
    attentionWindow?.staleGapMinutes !== null && attentionWindow?.staleGapMinutes !== undefined
      ? formatAgeMinutes(attentionWindow.staleGapMinutes)
      : null;

  const attentionOption = useMemo(
    () => {
      const chartBase = baseChartOptions();
      const staleGapMarkArea =
        attentionWindow?.hasTrailingGap && attentionWindow.latestPointAt
          ? {
              silent: true,
              itemStyle: {
                color: "rgba(255, 190, 100, 0.06)",
              },
              data: [
                [
                  {
                    xAxis: attentionWindow.latestPointAt,
                  },
                  {
                    xAxis: attentionWindow.windowEnd,
                  },
                ],
              ],
            }
          : undefined;

      return {
        ...chartBase,
        xAxis: {
          ...chartBase.xAxis,
          type: "time",
          min: attentionWindow?.windowStart,
          max: attentionWindow?.windowEnd,
          boundaryGap: false,
          axisLabel: {
            color: "#6f839e",
            formatter: (value: number) =>
              attentionWindow?.range === "7d"
                ? formatDateTime(new Date(value).toISOString())
                : formatTimeOnly(new Date(value).toISOString()),
          },
        },
        yAxis: {
          ...chartBase.yAxis,
          type: "value",
          name: bucketDurationLabel,
          nameGap: 24,
        },
        series: [
          {
            type: "line",
            data: smoothedAttentionGraph.map((point) => [point.timestamp, point.value]),
            smooth: true,
            showSymbol: false,
            connectNulls: false,
            markArea: staleGapMarkArea,
            lineStyle: {
              width: 3,
              color: "#5ee7ff",
            },
            areaStyle: {
              color: "#5ee7ff",
              opacity: 0.08,
            },
          },
        ],
      };
    },
    [attentionWindow, bucketDurationLabel, smoothedAttentionGraph],
  );

  const platformOption = useMemo(
    () => {
      const totalPlatformInteractions = detail.platformBreakdown.reduce(
        (sum, item) => sum + Math.max(0, item.interactions),
        0,
      );
      const pieData = detail.platformBreakdown.map((item, index) => ({
        name: getPlatformLabel(String(item.platformId)),
        value:
          totalPlatformInteractions > 0
            ? Math.max(0, item.interactions)
            : Math.max(0, item.sharePct),
        itemStyle: {
          color: PLATFORM_CHART_COLORS[index % PLATFORM_CHART_COLORS.length],
        },
      }));

      return {
      ...baseChartOptions(),
      legend: {
        top: 0,
        textStyle: { color: "#9fb1cb" },
      },
      grid: {
        ...baseChartOptions().grid,
        top: 24,
      },
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(10, 18, 30, 0.96)",
        borderColor: "rgba(122, 145, 175, 0.28)",
        textStyle: {
          color: "#edf3ff",
        },
        formatter: (params: {
          name?: string;
          percent?: number;
          data?: { value?: number };
        }) => {
          const platform = params.name ?? "Platform";
          const interactions = params.data?.value ?? 0;
          const percent = params.percent ?? 0;
          return `${platform}<br/>${formatCompactNumber(interactions)} posts<br/>${formatPercent(percent, 0)} share`;
        },
      },
      series: [
        {
          type: "pie",
          radius: ["42%", "72%"],
          center: ["50%", "58%"],
          avoidLabelOverlap: true,
          minAngle: 8,
          itemStyle: {
            borderColor: "#101a29",
            borderWidth: 2,
          },
          label: {
            color: "#edf3ff",
            formatter: (params: { name?: string; percent?: number }) =>
              `${params.name ?? "Platform"}\n${formatPercent(params.percent ?? 0, 0)}`,
          },
          labelLine: {
            lineStyle: {
              color: "rgba(159, 177, 203, 0.45)",
            },
          },
          data: pieData,
        },
      ],
    };
    },
    [detail.platformBreakdown],
  );

  return (
    <div className="space-y-4">
      <Panel
        title={trendDisplayName}
        eyebrow="Narrative graph"
        description={`24h posts ${formatCompactNumber(detail.trend.attentionInteractions)} | Growth ${formatSignedPercent(detail.trend.growthRate)} | Accel ${formatSignedPercent(detail.trend.attentionAcceleration)}`}
        action={refreshing ? <Badge tone="neutral">Syncing</Badge> : undefined}
        loading={loading}
        loadingContent={
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SkeletonBlock className="h-6 w-24 rounded-full" />
              <SkeletonBlock className="h-6 w-28 rounded-full" />
              <SkeletonBlock className="h-6 w-20 rounded-full" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={`detail-summary-skeleton-${index}`}
                  className="rounded-2xl border border-border bg-white/4 px-3 py-3"
                >
                  <SkeletonBlock className="h-3 w-24" />
                  <SkeletonBlock className="mt-3 h-6 w-16" />
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }, (_, index) => (
                <div
                  key={`detail-notes-skeleton-${index}`}
                  className="rounded-2xl border border-border bg-white/4 px-3 py-3"
                >
                  <SkeletonBlock className="h-3 w-20" />
                  <SkeletonBlock className="mt-3 h-4 w-[90%]" />
                  <SkeletonBlock className="mt-2 h-4 w-[82%]" />
                  <SkeletonBlock className="mt-2 h-4 w-[72%]" />
                </div>
              ))}
            </div>
            <SkeletonBlock className="h-[260px] w-full rounded-2xl" />
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {showLoadingLabel ? <Badge tone="neutral">Loading...</Badge> : null}
          {!hasTrustedDisplayName && !showLoadingLabel ? <Badge tone="neutral">Derived label</Badge> : null}
          {detail.trend.lifecycleStage !== "Unknown" ? (
            <Badge tone={getLifecycleTone(detail.trend.lifecycleStage)}>
              {detail.trend.lifecycleStage}
            </Badge>
          ) : null}
          {detail.trend.freshnessState !== "fresh" ? (
            <Badge tone={getFreshnessBadgeTone(detail.trend.freshnessState)}>
              {getFreshnessLabel(detail.trend.freshnessState)}
            </Badge>
          ) : null}
          {latestBucketLabel ? <Badge tone="neutral">Latest bucket {latestBucketLabel}</Badge> : null}
          {detail.trend.lowDataWarning ? <Badge tone="amber">Thin sample</Badge> : null}
          {detail.trend.hasSpike ? <Badge tone="rose">Spike</Badge> : null}
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetric
            label={detail.trend.leaderboardMode === "emerging" ? "Breakout score" : "Trend strength"}
            value={
              detail.trend.leaderboardMode === "emerging"
                ? (detail.trend.breakoutScore ?? detail.trend.emergingScore ?? 0).toFixed(0)
                : detail.trend.trendStrengthScore.toFixed(0)
            }
          />
          <SummaryMetric label="Persistence" value={detail.trend.persistenceScore.toFixed(0)} />
          <SummaryMetric label="Confidence" value={detail.trend.confidenceScore.toFixed(0)} />
          <SummaryMetric
            label="Freshness"
            value={`${detail.trend.freshnessScore.toFixed(0)} · ${getFreshnessLabel(detail.trend.freshnessState)}`}
          />
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-white/4 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-soft">Origin</p>
            <p className="mt-2 text-sm text-foreground">
              {getPlatformLabel(String(detail.trend.originPlatform))}
            </p>
            <p className="mt-2 text-xs text-muted">
              {detail.trend.platformMigrationPath
                .map((platformId) => getPlatformLabel(String(platformId)))
                .join(" -> ")}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-white/4 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-soft">Signal notes</p>
            <p className="mt-2 text-sm text-foreground">
              {detail.trend.hasSpike && detail.trend.spikeMagnitude
                ? `Spike detected: ${formatSignedPercent(detail.trend.spikeMagnitude)} vs trailing baseline. `
                : ""}
              Sample {formatCompactNumber(detail.trend.sampleSize)} posts across{" "}
              {detail.trend.supportingThreadCount} source documents.
              {` Freshness ${detail.trend.freshnessScore.toFixed(0)} (${getFreshnessLabel(detail.trend.freshnessState)}).`}
              {` The graph below shows ${bucketDurationLabel} weighted posts, not the window total.`}
              {attentionWindow?.latestPointAt
                ? ` This chart window ends at the current time; the latest ingested bucket is ${formatDateTime(attentionWindow.latestPointAt)}${latestBucketLabel ? ` (${latestBucketLabel})` : ""}.`
                : " This chart window ends at the current time, but no in-window buckets are available yet."}
              {attentionWindow?.latestDataAt && attentionWindow.latestDataAt !== attentionWindow.latestPointAt
                ? ` The last non-zero bucket landed at ${formatDateTime(attentionWindow.latestDataAt)}.`
                : ""}
              {detail.trend.lowDataWarning
                ? " Low-data signal: growth is being measured from a thin base."
                : " Depth is supported by multiple sources."}
              {detail.trend.leaderboardMode === "emerging"
                ? ` Emerging breakdown: velocity ${(detail.trend.velocityScore ?? 0).toFixed(0)}, novelty ${(detail.trend.noveltyScore ?? 0).toFixed(0)}, confirmation ${(detail.trend.confirmationScore ?? 0).toFixed(0)}.`
                : ""}
              {detail.trend.googleSearchInterest?.matchedQueries.length
                ? ` Google matched ${detail.trend.googleSearchInterest.matchedQueries.join(", ")}.`
                : ` Google ${googleSearchLabel === "none" ? "has no current public trend match for this narrative." : `is tracking ${googleSearchLabel}.`}`}
            </p>
          </div>
        </div>

        <EChart option={attentionOption} height={260} />
      </Panel>

      <Panel
        title="Platform Breakdown"
        eyebrow="Source distribution"
        action={refreshing ? <Badge tone="neutral">Syncing</Badge> : undefined}
        loading={loading}
        loadingContent={
          <div className="space-y-4">
            <SkeletonBlock className="h-[220px] w-full rounded-2xl" />
            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-2xl border border-border bg-white/4 px-3 py-3">
                <SkeletonBlock className="h-3 w-28" />
                <div className="mt-3 space-y-2">
                  {Array.from({ length: 3 }, (_, index) => (
                    <div
                      key={`platform-driver-skeleton-${index}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2"
                    >
                      <div className="space-y-2">
                        <SkeletonBlock className="h-4 w-20" />
                        <SkeletonBlock className="h-3 w-24" />
                      </div>
                      <SkeletonBlock className="h-4 w-12" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-white/4 px-3 py-3">
                <SkeletonBlock className="h-3 w-24" />
                <div className="mt-3 space-y-3">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div
                      key={`platform-mix-skeleton-${index}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="space-y-2">
                        <SkeletonBlock className="h-4 w-24" />
                        <SkeletonBlock className="h-3 w-20" />
                      </div>
                      <SkeletonBlock className="h-4 w-10" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        }
      >
        <EChart option={platformOption} height={220} />

        <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-border bg-white/4 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-soft">
              Why discussion moved
            </p>
            <div className="mt-3 space-y-2">
              {detail.trend.attentionDrivers.map((driver) => (
                <div
                  key={driver.platformId}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2"
                >
                  <div>
                    <p className="text-sm text-foreground">
                      {getPlatformLabel(String(driver.platformId))}
                    </p>
                    <p className="text-xs text-muted">
                      Contribution {driver.contributionPct.toFixed(0)}%
                    </p>
                  </div>
                  <p
                    className={cn(
                      "font-mono text-sm",
                      driver.deltaPct >= 0 ? "text-emerald" : "text-rose",
                    )}
                  >
                    {formatSignedPercent(driver.deltaPct)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-white/4 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-soft">Platform mix</p>
            <div className="mt-3 space-y-2">
              {detail.platformBreakdown.map((item) => (
                <div
                  key={item.platformId}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div>
                    <span className="text-foreground">{getPlatformLabel(String(item.platformId))}</span>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatCompactNumber(item.interactions)} posts
                    </p>
                  </div>
                  <span className="font-mono text-soft">{formatPercent(item.sharePct, 0)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="Top Sources Driving Discussion"
        eyebrow="Engagement-ranked"
        action={refreshing ? <Badge tone="neutral">Syncing</Badge> : undefined}
        loading={loading}
        loadingContent={
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={`top-source-skeleton-${index}`}
                className="rounded-2xl border border-border bg-white/4 px-3 py-3"
              >
                <div className="flex items-center gap-2">
                  <SkeletonBlock className="h-5 w-20 rounded-full" />
                  <SkeletonBlock className="h-5 w-24 rounded-full" />
                </div>
                <SkeletonBlock className="mt-3 h-4 w-[82%]" />
                <SkeletonBlock className="mt-2 h-4 w-[70%]" />
                <div className="mt-3 flex flex-wrap gap-3">
                  <SkeletonBlock className="h-3 w-20" />
                  <SkeletonBlock className="h-3 w-24" />
                  <SkeletonBlock className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        }
      >
        <div className="space-y-3">
          {detail.topPosts.map((post) => (
            <a
              key={post.id}
              href={post.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-white/4 px-3 py-3 transition-colors hover:border-cyan/30 hover:bg-cyan/6"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{getPlatformLabel(String(post.platformId))}</Badge>
                  {String(post.platformId) === "bluesky" ? <Badge tone="cyan">Bluesky source</Badge> : null}
                </div>
                <p className="mt-2 text-sm text-foreground">{post.title}</p>
                {(() => {
                  const blueskyMeta = getBlueskyTopPostMeta(post);
                  const mixBits = [
                    blueskyMeta.postType,
                    blueskyMeta.repostCount !== null
                      ? `${formatCompactNumber(blueskyMeta.repostCount)} reposts`
                      : null,
                    blueskyMeta.replyCount !== null
                      ? `${formatCompactNumber(blueskyMeta.replyCount)} replies`
                      : null,
                    blueskyMeta.quoteCount !== null
                      ? `${formatCompactNumber(blueskyMeta.quoteCount)} quotes`
                      : null,
                    blueskyMeta.likeCount !== null
                      ? `${formatCompactNumber(blueskyMeta.likeCount)} likes`
                      : null,
                  ].filter((item): item is string => Boolean(item));

                  if (mixBits.length === 0) {
                    return null;
                  }

                  return (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                      {mixBits.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  );
                })()}
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                  <span>{formatCompactNumber(post.engagement)} posts</span>
                  <span>{formatVelocityPerHour(post.engagementVelocity)}</span>
                  <span>{formatAgeMinutes(post.ageMinutes)}</span>
                </div>
              </div>
              <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-soft" />
            </a>
          ))}
        </div>

        {detail.relatedTrends.length > 0 ? (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-soft">Related trends</p>
            <div className="mt-3 space-y-2">
              {detail.relatedTrends.map((trend) => {
                const content = (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white/4 px-3 py-3 transition-colors hover:border-cyan/30 hover:bg-cyan/6">
                    <div>
                      <p className="text-sm text-foreground">{trend.name}</p>
                      <p className="mt-1 text-xs text-muted">
                        {formatCompactNumber(trend.attentionInteractions)} posts | {formatSignedPercent(trend.growthRate)}
                      </p>
                    </div>
                    <Badge tone={getLifecycleTone(trend.lifecycleStage)}>
                      {trend.lifecycleStage}
                    </Badge>
                  </div>
                );

                if (onSelectTrend) {
                  return (
                    <button
                      key={trend.id}
                      type="button"
                      onClick={() => onSelectTrend(trend.id)}
                      className="block w-full text-left"
                    >
                      {content}
                    </button>
                  );
                }

                return <div key={trend.id}>{content}</div>;
              })}
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
