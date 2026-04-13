import { Badge } from "@/components/shared/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { formatDateTime, formatRelativeTimeShort } from "@/lib/formatters";
import type { SharedTrendSnapshotView } from "@/lib/gpt-trends/types";

type GptTrendsDashboardProps = {
  view: SharedTrendSnapshotView;
};

function buildCategoryCounts(view: SharedTrendSnapshotView) {
  const counts = new Map<string, number>();
  for (const trend of view.trends) {
    const key = trend.category?.trim() || "Uncategorized";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8);
}

export function GptTrendsDashboard({ view }: GptTrendsDashboardProps) {
  if (!view.snapshot || view.trends.length === 0) {
    return (
      <Panel
        title="Shared Hourly Trends"
        eyebrow="GPT Snapshot"
        description="The dashboard now reads one shared GPT-generated trend snapshot instead of live Bluesky ingestion."
      >
        <EmptyState
          title="No shared trend snapshot yet"
          detail="Run the GPT trend generator once to create the first stored snapshot."
        />
      </Panel>
    );
  }

  const [leadTrend, ...remainingTrends] = view.trends;
  const categoryCounts = buildCategoryCounts(view);

  return (
    <div className="space-y-6">
      <Panel
        title="Shared Hourly Trends"
        eyebrow="GPT Snapshot"
        description="One stored trend list is generated hourly and served to every user. The board reads the latest successful snapshot only."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone="cyan">100 shared trends</Badge>
            <Badge tone={view.freshnessMinutes !== null && view.freshnessMinutes <= 90 ? "emerald" : "amber"}>
              {view.freshnessMinutes !== null
                ? `Updated ${formatRelativeTimeShort(view.snapshot.generatedAt)} ago`
                : "Freshness unknown"}
            </Badge>
          </div>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="border border-cyan/15 bg-cyan/6 p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-cyan">Top Ranked Narrative</p>
            <div className="mt-4 flex items-start gap-4">
              <div className="border border-cyan/20 bg-[#081722] px-3 py-2 font-mono text-xl text-cyan">
                #{leadTrend.rank}
              </div>
              <div className="min-w-0">
                <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-foreground">
                  {leadTrend.title}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {leadTrend.category ? <Badge tone="neutral">{leadTrend.category}</Badge> : null}
                  <Badge tone="emerald">Confidence {leadTrend.confidenceScore.toFixed(0)}</Badge>
                  <Badge tone="violet">AI score {leadTrend.aiRankScore.toFixed(0)}</Badge>
                  {leadTrend.sourceScope ? <Badge tone="neutral">{leadTrend.sourceScope}</Badge> : null}
                  {leadTrend.sourceCount ? <Badge tone="neutral">{leadTrend.sourceCount} sources</Badge> : null}
                </div>
                <p className="mt-4 text-[15px] leading-7 text-[#d8e4f2]">{leadTrend.summary}</p>
                {leadTrend.importanceNote ? (
                  <p className="mt-3 text-[14px] leading-6 text-[#9ab0c7]">
                    Why now: {leadTrend.importanceNote}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border border-border bg-white/4 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-soft">Generated</p>
              <p className="mt-2 text-[15px] text-foreground">{formatDateTime(view.snapshot.generatedAt)}</p>
              <p className="mt-1 text-[12px] text-muted">
                Snapshot #{view.snapshot.id} via {view.snapshot.modelName ?? "configured GPT model"}
              </p>
            </div>
            <div className="border border-border bg-white/4 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-soft">Snapshot Count</p>
              <p className="mt-2 text-[15px] text-foreground">{view.snapshot.trendCount} stored trends</p>
              <p className="mt-1 text-[12px] text-muted">
                Shared ranking only. No live regeneration, no per-user generation, no post-count sort.
              </p>
            </div>
            <div className="border border-border bg-white/4 p-4 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-soft">Dominant Categories</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {categoryCounts.map(([category, count]) => (
                  <Badge key={category} tone="neutral">
                    {category} {count}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="Current Trend List"
        eyebrow="Latest Successful Snapshot"
        description="The stored snapshot is ordered by AI rank and confidence. The read path is one shared snapshot query."
      >
        <div className="overflow-hidden border border-border">
          <div className="grid grid-cols-[72px_minmax(0,1.8fr)_120px_120px_160px] gap-3 bg-white/4 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-soft">
            <span>Rank</span>
            <span>Trend</span>
            <span>Confidence</span>
            <span>AI Score</span>
            <span>Category</span>
          </div>
          <div className="divide-y divide-border">
            {[leadTrend, ...remainingTrends].map((trend) => (
              <article
                key={`${trend.snapshotId}:${trend.rank}:${trend.trendKey}`}
                className="grid grid-cols-[72px_minmax(0,1.8fr)_120px_120px_160px] gap-3 px-4 py-4"
              >
                <div className="font-mono text-sm text-foreground">#{trend.rank}</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm text-foreground">{trend.title}</h3>
                    {trend.sourceScope ? <Badge tone="neutral">{trend.sourceScope}</Badge> : null}
                    {trend.sourceCount ? <Badge tone="neutral">{trend.sourceCount} sources</Badge> : null}
                  </div>
                  <p className="mt-1 text-[13px] leading-6 text-muted">{trend.summary}</p>
                  {trend.importanceNote ? (
                    <p className="mt-2 text-[12px] leading-5 text-[#9cb0c5]">{trend.importanceNote}</p>
                  ) : null}
                </div>
                <div className="font-mono text-sm text-emerald">{trend.confidenceScore.toFixed(0)}</div>
                <div className="font-mono text-sm text-cyan">{trend.aiRankScore.toFixed(0)}</div>
                <div className="text-sm text-foreground">{trend.category ?? "Uncategorized"}</div>
              </article>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}
