"use client";

import { memo } from "react";
import { Badge } from "@/components/shared/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { SkeletonBlock } from "@/components/shared/skeleton-block";
import {
  TREND_NAME_PLACEHOLDER,
  getTrendDisplayNameOrPlaceholder,
  hasTrustedTrendDisplayName,
} from "@/lib/dashboard/trend-name-state";
import { PLATFORM_LABELS } from "@/lib/constants/options";
import { formatCompactNumber, formatSignedPercent } from "@/lib/formatters";
import { getLifecycleTone } from "@/lib/utils/trend-display";
import { cn } from "@/lib/utils/cn";
import {
  RankedTrend,
  TrendCoverageDebug,
  TrendLeaderboardMode,
} from "@/types/view-models";

type TrendLeaderboardProps = {
  rows: RankedTrend[];
  coverage?: TrendCoverageDebug | null;
  selectedId: string;
  mode: TrendLeaderboardMode;
  loading?: boolean;
  refreshing?: boolean;
  onSelect: (id: string) => void;
  onModeChange: (mode: TrendLeaderboardMode) => void;
};

function getPlatformLabel(platformId: string) {
  return (
    PLATFORM_LABELS[platformId as keyof typeof PLATFORM_LABELS] ??
    (platformId === "bluesky" ? "Bluesky" : platformId)
  );
}

function getModeCopy(mode: TrendLeaderboardMode) {
  if (mode === "emerging") {
    return {
      eyebrow: "Trend leaderboard",
      description:
        "Ranks live narratives by 24h post volume, support, freshness, and breakout strength across the active signal set.",
      emptyTitle: "No emerging signals yet",
      emptyDetail:
        "Run a source refresh to populate low-volume breakouts, comment-first signals, and early platform-local anomalies.",
    };
  }

  return {
    eyebrow: "Trend leaderboard",
    description:
      "Ranks live narratives by 24h post volume, support, freshness, and breakout strength across the active signal set.",
    emptyTitle: "No established narratives yet",
    emptyDetail:
      "Run a source refresh to populate validated narratives with enough support to rank on the main board.",
  };
}

function getFreshnessBadge(row: RankedTrend) {
  if (row.freshnessState === "delayed") {
    return <Badge tone="amber">Delayed freshness</Badge>;
  }

  if (row.freshnessState === "mixed") {
    return <Badge tone="amber">Mixed freshness</Badge>;
  }

  if (row.freshnessState === "stale") {
    return <Badge tone="rose">Stale inputs</Badge>;
  }

  return null;
}

function getPrimaryScore(row: RankedTrend, mode: TrendLeaderboardMode) {
  if (mode === "emerging") {
    return {
      label: "Breakout",
      value: (row.breakoutScore ?? row.emergingScore ?? 0).toFixed(0),
      tone: "text-amber",
      detail: `Vel ${(row.velocityScore ?? 0).toFixed(0)} | Nov ${(row.noveltyScore ?? 0).toFixed(0)} | Conf ${(row.confirmationScore ?? 0).toFixed(0)}`,
    };
  }

  return {
    label: "Strength",
    value: row.trendStrengthScore.toFixed(0),
    tone: "text-cyan",
    detail: `Growth ${formatSignedPercent(row.growthRate)} | Posts ${formatCompactNumber(row.mentions)}`,
  };
}

type TrendLeaderboardRowProps = {
  row: RankedTrend;
  selected: boolean;
  mode: TrendLeaderboardMode;
  onSelect: (id: string) => void;
};

const TrendLeaderboardRow = memo(function TrendLeaderboardRow({
  row,
  selected,
  mode,
  onSelect,
}: TrendLeaderboardRowProps) {
  const visiblePlatforms = row.platforms.slice(0, 3);
  const hiddenPlatforms = row.platforms.length - visiblePlatforms.length;
  const freshnessBadge = getFreshnessBadge(row);
  const primaryScore = getPrimaryScore(row, mode);
  const displayName = getTrendDisplayNameOrPlaceholder(row);
  const hasTrustedDisplayName = hasTrustedTrendDisplayName(row);
  const showLoadingLabel = displayName === TREND_NAME_PLACEHOLDER;
  const subtitle =
    row.trendDescription ??
    row.trendCategory ??
    (showLoadingLabel ? "Loading label" : null);

  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      className={cn(
        "grid min-h-[92px] w-full grid-cols-[44px_1.6fr_120px_168px_220px] gap-3 px-3 py-2 text-left transition-[background-color,box-shadow] duration-200",
        selected
          ? "bg-cyan/8 ring-1 ring-inset ring-cyan/20"
          : "hover:bg-cyan/6",
      )}
    >
      <div className="flex items-center">
        <span className="font-mono text-sm text-foreground">{row.rank}</span>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {!showLoadingLabel ? (
            <p title={displayName} className="truncate text-sm text-foreground">
              {displayName}
            </p>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <SkeletonBlock className="h-4 w-28 rounded-sm" />
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted">Loading...</span>
            </div>
          )}
          {!hasTrustedDisplayName && !showLoadingLabel ? <Badge>Derived</Badge> : null}
          {row.lifecycleStage !== "Unknown" ? (
            <Badge tone={getLifecycleTone(row.lifecycleStage)}>
              {row.lifecycleStage}
            </Badge>
          ) : null}
          {row.confirmedPlatformSpread >= 2 && row.confidenceScore >= 60 ? (
            <Badge tone="emerald">Validated</Badge>
          ) : null}
          {row.lowDataWarning ? <Badge tone="amber">Thin sample</Badge> : null}
          {row.hasSpike ? <Badge tone="rose">Spike</Badge> : null}
          {freshnessBadge}
        </div>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p> : null}
      </div>

      <div>
        <p className="font-mono text-lg text-foreground">
          {formatCompactNumber(row.totalInteractions24h ?? row.attentionInteractions)}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          Conf {row.confidenceScore.toFixed(0)} | Fresh{" "}
          {row.freshnessScore.toFixed(0)}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {formatCompactNumber(row.rootsCount24h ?? row.supportingThreadCount)} roots |{" "}
          {formatCompactNumber(row.uniqueAuthors24h ?? 0)} authors
        </p>
      </div>

      <div>
        <p className={cn("font-mono text-sm", primaryScore.tone)}>
          {primaryScore.label} {primaryScore.value}
        </p>
        <p
          className={cn(
            "mt-0.5 font-mono text-xs",
            row.attentionAcceleration >= 0 ? "text-cyan" : "text-rose",
          )}
        >
          Accel {formatSignedPercent(row.attentionAcceleration)}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted">{primaryScore.detail}</p>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
          {visiblePlatforms.map((platform) => (
            <Badge key={platform} className="shrink-0">
              {getPlatformLabel(platform)}
            </Badge>
          ))}
          {hiddenPlatforms > 0 ? (
            <Badge className="shrink-0">+{hiddenPlatforms}</Badge>
          ) : null}
        </div>
        <p className="mt-1 truncate text-xs text-muted">
          Confirmed {row.confirmedPlatformSpread}p | Raw {row.platformSpread}p |{" "}
          {row.isSingleton ? "Singleton" : `${formatCompactNumber(row.rootsCount24h ?? 0)} grouped roots`}
        </p>
      </div>
    </button>
  );
});

export const TrendLeaderboard = memo(function TrendLeaderboard({
  rows,
  selectedId,
  mode,
  loading = false,
  onSelect,
  onModeChange,
}: TrendLeaderboardProps) {
  const modeCopy = getModeCopy(mode);

  return (
    <Panel
      title="Trend Leaderboard"
      eyebrow={modeCopy.eyebrow}
      description={modeCopy.description}
      loading={loading}
      loadingContent={
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-border">
          <div className="grid grid-cols-[44px_1.6fr_120px_168px_220px] gap-3 bg-white/4 px-3 py-2.5">
            <SkeletonBlock className="h-4 w-7" />
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-4 w-20" />
            <SkeletonBlock className="h-4 w-16" />
            <SkeletonBlock className="h-4 w-24" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={`leaderboard-row-skeleton-${index}`}
                className="grid grid-cols-[44px_1.6fr_120px_168px_220px] gap-3 px-3 py-3"
              >
                <div className="flex items-center">
                  <SkeletonBlock className="h-4 w-5" />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SkeletonBlock className="h-4 w-36" />
                    <SkeletonBlock className="h-5 w-20 rounded-full" />
                  </div>
                  <SkeletonBlock className="h-3 w-48" />
                  <SkeletonBlock className="h-3 w-56" />
                </div>
                <div className="space-y-2">
                  <SkeletonBlock className="h-5 w-12" />
                  <SkeletonBlock className="h-3 w-20" />
                  <SkeletonBlock className="h-3 w-16" />
                </div>
                <div className="space-y-2">
                  <SkeletonBlock className="h-4 w-16" />
                  <SkeletonBlock className="h-3 w-28" />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SkeletonBlock className="h-5 w-16 rounded-full" />
                    <SkeletonBlock className="h-5 w-16 rounded-full" />
                    <SkeletonBlock className="h-5 w-10 rounded-full" />
                  </div>
                  <SkeletonBlock className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(["emerging", "established"] as const).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              onClick={() => onModeChange(nextMode)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.16em]",
                mode === nextMode
                  ? "border-cyan/30 bg-cyan/10 text-cyan"
                  : "border-border text-soft hover:text-foreground",
              )}
            >
              {nextMode === "emerging" ? "Emerging" : "Established"}
            </button>
          ))}
        </div>
      }
    >
      <div className="min-h-[540px]">
        {rows.length > 0 ? (
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-border">
          <div className="grid grid-cols-[44px_1.6fr_120px_168px_220px] gap-3 bg-white/4 px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-soft">
            <span>Rank</span>
            <span>Trend</span>
            <span>24h Posts</span>
            <span>Score</span>
            <span>Coverage</span>
          </div>
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <TrendLeaderboardRow
                key={`${row.id}:${row.rank}`}
                row={row}
                selected={row.id === selectedId}
                mode={mode}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          title={modeCopy.emptyTitle}
          detail={modeCopy.emptyDetail}
          className="h-full min-h-[540px]"
        />
      )}
      </div>
    </Panel>
  );
});
