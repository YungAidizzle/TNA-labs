import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrendMemecoinsPanel } from "@/features/trends/trend-dashboard-panels";

describe("trend memecoins panel", () => {
  it("keeps the tab bar visible for an empty trend selection prompt", () => {
    const markup = renderToStaticMarkup(
      createElement(TrendMemecoinsPanel, {
        rows: [],
        selectedCoinId: null,
        selectedTrendLabel: null,
        mode: "trend",
        onModeChange: () => {},
        onSelectCoin: () => {},
      }),
    );

    expect(markup).toContain("Trend");
    expect(markup).toContain("All");
    expect(markup).toContain("Momentum");
    expect(markup).toContain("Select a trend to load correlated memecoins.");
  });
});
