import { describe, expect, it } from "vitest";
import {
  resolveHeatmapTileSizing,
  resolveHeatmapTileTextLayout,
  shortenHeatmapTitle,
} from "@/lib/utils/trend-heatmap-layout";

describe("trend heatmap tile layout helper", () => {
  it("hides the post count on very small tiles and shortens long titles", () => {
    const layout = resolveHeatmapTileTextLayout("Donald Trump Online Discussion", 58, 34);

    expect(layout.tier).toBe("small");
    expect(layout.showPosts).toBe(false);
    expect(layout.titleLines).toBe(1);
    expect(layout.title.length).toBeLessThan("Donald Trump Online Discussion".length);
  });

  it("shows both lines on compact tiles only when there is enough room", () => {
    expect(resolveHeatmapTileSizing(90, 52).showPosts).toBe(false);
    expect(resolveHeatmapTileSizing(108, 54).showPosts).toBe(true);
  });

  it("allows a two-line title only on medium or large tiles with enough height", () => {
    expect(resolveHeatmapTileSizing(180, 74).titleLines).toBe(1);
    expect(resolveHeatmapTileSizing(180, 82).titleLines).toBe(2);
    expect(resolveHeatmapTileSizing(230, 104).titleLines).toBe(2);
  });

  it("keeps short topic names intact on larger tiles", () => {
    const layout = resolveHeatmapTileTextLayout("March", 220, 70);

    expect(layout.showPosts).toBe(true);
    expect(layout.title).toBe("March");
  });

  it("prefers a clean word boundary when shortening titles", () => {
    expect(shortenHeatmapTitle("Donald Trump", 7)).toBe("Donald");
    expect(shortenHeatmapTitle("Online discourse spike", 8)).toBe("Online");
  });
});
