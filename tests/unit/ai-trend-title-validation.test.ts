import { describe, expect, it } from "vitest";
import { validateAiTrendCanonicalTitle } from "@/lib/ai-trends/title-validation";

describe("AI trend canonical title validation", () => {
  it("accepts compact narrative labels that keep the exact subject", () => {
    expect(validateAiTrendCanonicalTitle("OpenAI Media Push").errors).toEqual([]);
    expect(validateAiTrendCanonicalTitle("EU AI Act Crackdown").errors).toEqual([]);
    expect(validateAiTrendCanonicalTitle("Iran Escalation Risk").errors).toEqual([]);
  });

  it("rejects long headline-style titles and clipped formatting", () => {
    expect(
      validateAiTrendCanonicalTitle(
        "OpenAI is reportedly pushing a major new global media platform strategy after fresh distribution talks",
      ).errors,
    ).toContain("title must be 10 words or fewer");
    expect(validateAiTrendCanonicalTitle("Anthropic Leak: Here is what happened").errors).toContain(
      "title uses headline punctuation or quotes",
    );
    expect(validateAiTrendCanonicalTitle("Bitcoin ETF surge...").errors).toContain(
      "title uses headline punctuation or quotes",
    );
  });
});
