import { describe, expect, it } from "vitest";
import {
  assessAiTrendNarrativeRelevance,
  rerankAiTrendsForNarrativeRelevance,
} from "@/lib/ai-trends/narrative-relevance";
import type { GeneratedAiTrendCandidate } from "@/lib/ai-trends/types";

function makeTrend(
  overrides: Partial<GeneratedAiTrendCandidate> & Pick<GeneratedAiTrendCandidate, "title" | "summary">,
): GeneratedAiTrendCandidate {
  return {
    rank: overrides.rank ?? 1,
    trendKey: overrides.trendKey ?? overrides.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: overrides.title,
    summary: overrides.summary,
    confidenceScore: overrides.confidenceScore ?? 82,
    aiRankScore: overrides.aiRankScore ?? 82,
    importanceNote: overrides.importanceNote ?? overrides.summary,
    category: overrides.category ?? "Internet",
    sourceScope: overrides.sourceScope ?? "global",
    sourceCount: overrides.sourceCount ?? 35,
    narrativeRelevance: overrides.narrativeRelevance ?? null,
    narrativeScore: overrides.narrativeScore ?? null,
    rankingSignals: overrides.rankingSignals ?? null,
  };
}

describe("AI trend narrative relevance ranking", () => {
  it("marks named internet-native flashpoints as high relevance", () => {
    const assessment = assessAiTrendNarrativeRelevance(
      makeTrend({
        title: "Anthropic Mythos Leak",
        summary: "Anthropic Mythos leak triggers backlash, patching, and nonstop online discussion.",
        category: "AI",
      }),
    );

    expect(assessment.band).toBe("high");
    expect(assessment.score).toBeGreaterThanOrEqual(70);
  });

  it("marks generic institutional process stories as low relevance", () => {
    const assessment = assessAiTrendNarrativeRelevance(
      makeTrend({
        title: "Open Data Service Pilots",
        summary: "Governments publish open data and pilot AI services for procurement transparency.",
        category: "Politics",
        sourceScope: "regional",
      }),
    );

    expect(assessment.band).toBe("low");
    expect(assessment.score).toBeLessThan(50);
  });

  it("reranks internet-native narratives above generic enterprise filler", () => {
    const result = rerankAiTrendsForNarrativeRelevance([
      makeTrend({
        rank: 1,
        title: "Enterprise AI Governance",
        summary: "Enterprises and regulators form governance frameworks and certification programs.",
        category: "Business",
        aiRankScore: 91,
      }),
      makeTrend({
        rank: 2,
        title: "OpenAI Media Push",
        summary: "OpenAI media moves trigger creator debate, platform discourse, and retail attention.",
        category: "AI",
        aiRankScore: 84,
      }),
    ]);

    expect(result.trends[0]?.title).toBe("OpenAI Media Push");
    expect(result.trends[0]?.narrativeRelevance).toBe("high");
    expect(result.trends[1]?.narrativeRelevance).toBe("low");
  });

  it("rejects boards that are still dominated by low-relevance filler", () => {
    const lowRelevanceRows = Array.from({ length: 100 }, (_, index) =>
      makeTrend({
        rank: index + 1,
        title: `Enterprise Framework ${index + 1}`,
        summary: "Companies and governments expand compliance initiatives, interoperability frameworks, and pilot programs.",
        category: "Business",
        sourceScope: "regional",
        aiRankScore: 70 - index * 0.1,
        confidenceScore: 70 - index * 0.1,
      }),
    );

    const result = rerankAiTrendsForNarrativeRelevance(lowRelevanceRows);

    expect(result.rejectedReason).toMatch(/high relevance count too low|low relevance count too high/);
    expect(result.distribution.lowCount).toBeGreaterThan(20);
  });
});
