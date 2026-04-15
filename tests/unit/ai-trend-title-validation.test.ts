import { describe, expect, it } from "vitest";
import { validateAiTrendCanonicalTitle } from "@/lib/ai-trends/title-validation";

describe("AI trend canonical title validation", () => {
  it("accepts descriptive narrative labels that keep the exact subject", () => {
    expect(
      validateAiTrendCanonicalTitle("Grok deepfake scandal driving viral reposts and parody edits").errors,
    ).toEqual([]);
    expect(
      validateAiTrendCanonicalTitle("Spot Bitcoin ETF inflows reviving crypto attention and meme speculation").errors,
    ).toEqual([]);
    expect(
      validateAiTrendCanonicalTitle("TikTok platform backlash driving creator debate").errors,
    ).toEqual([]);
  });

  it("rejects vague short titles, long headlines, and clipped formatting", () => {
    expect(validateAiTrendCanonicalTitle("Creator drama").errors).toContain("title must contain at least 4 words");
    expect(
      validateAiTrendCanonicalTitle(
        "OpenAI is reportedly pushing a major new global media platform strategy after fresh distribution talks",
      ).errors,
    ).toContain("title must be 14 words or fewer");
    expect(validateAiTrendCanonicalTitle("Anthropic Leak: Here is what happened").errors).toContain(
      "title uses headline punctuation or quotes",
    );
    expect(validateAiTrendCanonicalTitle("Bitcoin ETF surge...").errors).toContain(
      "title uses headline punctuation or quotes",
    );
  });
});
