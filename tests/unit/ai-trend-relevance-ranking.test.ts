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
  it("marks memecoin-translatable internet flashpoints as high relevance", () => {
    const assessment = assessAiTrendNarrativeRelevance(
      makeTrend({
        title: "Grok deepfake scandal driving viral reposts and parody edits",
        summary: "Grok deepfake clips are being reposted, parodied, and memed across X, TikTok, and Telegram.",
        category: "AI meme wave",
      }),
    );

    expect(assessment.band).toBe("high");
    expect(assessment.score).toBeGreaterThanOrEqual(78);
  });

  it("marks dry institutional process stories as low relevance", () => {
    const assessment = assessAiTrendNarrativeRelevance(
      makeTrend({
        title: "OpenAI API pricing changes for enterprise customers",
        summary: "Enterprise buyers are comparing API pricing tiers and procurement implications for internal tooling.",
        category: "Politics",
        sourceScope: "regional",
      }),
    );

    expect(assessment.band).toBe("low");
    expect(assessment.score).toBeLessThan(50);
  });

  it("demotes geopolitics that lacks internet-native culture signals", () => {
    const assessment = assessAiTrendNarrativeRelevance(
      makeTrend({
        title: "Middle East ceasefire talks dominate mainstream coverage",
        summary: "Governments react to ceasefire negotiations and sanctions with little meme, creator, or crypto spillover.",
        category: "World",
        sourceScope: "global",
      }),
    );

    expect(assessment.band).toBe("low");
    expect(assessment.score).toBeLessThan(45);
  });

  it("keeps political stories when they are clearly meme-driven online", () => {
    const assessment = assessAiTrendNarrativeRelevance(
      makeTrend({
        title: "Trump rally clip memes driving remix edits and slogan reposts",
        summary: "Trump rally clips are being remixed across TikTok, X, Reddit, and YouTube with slogan memes.",
        category: "memeified politics",
        sourceScope: "global",
      }),
    );

    expect(assessment.band).not.toBe("low");
    expect(assessment.score).toBeGreaterThanOrEqual(45);
  });

  it("reranks memecoin-relevant narratives above generic enterprise filler", () => {
    const result = rerankAiTrendsForNarrativeRelevance([
      makeTrend({
        rank: 1,
        title: "Enterprise AI governance rollout for procurement teams",
        summary: "Enterprises and regulators are comparing governance frameworks, audits, and compliance playbooks.",
        category: "Business",
        aiRankScore: 91,
      }),
      makeTrend({
        rank: 2,
        title: "TikTok platform backlash driving creator debate and reaction memes",
        summary: "Creator clips and reaction memes are spreading across TikTok, X, and Reddit after the platform backlash.",
        category: "platform drama",
        aiRankScore: 84,
      }),
    ]);

    expect(result.trends[0]?.title).toBe("TikTok platform backlash driving creator debate and reaction memes");
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
