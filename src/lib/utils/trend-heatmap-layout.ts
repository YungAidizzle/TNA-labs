import { clamp } from "@/lib/formatters";

export type HeatmapTileTier = "micro" | "small" | "compact" | "medium" | "large";

export type HeatmapTileTextLayout = {
  tier: HeatmapTileTier;
  padding: number;
  gap: number;
  title: string;
  titleLines: 1 | 2;
  titleFontSize: number;
  titleLineHeight: number;
  countFontSize: number;
  countLineHeight: number;
  showPosts: boolean;
};

type HeatmapTileSizingRule = Omit<HeatmapTileTextLayout, "title">;

const MICRO_RULE: HeatmapTileSizingRule = {
  tier: "micro",
  padding: 4,
  gap: 0,
  titleLines: 1,
  titleFontSize: 9,
  titleLineHeight: 10,
  countFontSize: 0,
  countLineHeight: 0,
  showPosts: false,
};

const SMALL_RULE: HeatmapTileSizingRule = {
  tier: "small",
  padding: 5,
  gap: 0,
  titleLines: 1,
  titleFontSize: 10,
  titleLineHeight: 12,
  countFontSize: 0,
  countLineHeight: 0,
  showPosts: false,
};

const COMPACT_RULE: HeatmapTileSizingRule = {
  tier: "compact",
  padding: 6,
  gap: 4,
  titleLines: 1,
  titleFontSize: 11,
  titleLineHeight: 13,
  countFontSize: 10,
  countLineHeight: 12,
  showPosts: true,
};

const MEDIUM_RULE: HeatmapTileSizingRule = {
  tier: "medium",
  padding: 7,
  gap: 5,
  titleLines: 1,
  titleFontSize: 13,
  titleLineHeight: 15,
  countFontSize: 11,
  countLineHeight: 13,
  showPosts: true,
};

const LARGE_RULE: HeatmapTileSizingRule = {
  tier: "large",
  padding: 8,
  gap: 6,
  titleLines: 1,
  titleFontSize: 15,
  titleLineHeight: 17,
  countFontSize: 12,
  countLineHeight: 14,
  showPosts: true,
};

function normalizeTitle(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function shortenHeatmapTitle(title: string, maxChars: number) {
  const normalized = normalizeTitle(title);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  const safeMaxChars = Math.max(2, maxChars);
  const words = normalized.split(" ");
  const firstWord = words[0];
  if (
    words.length > 1 &&
    firstWord.length >= Math.max(4, Math.floor(safeMaxChars * 0.55)) &&
    firstWord.length <= safeMaxChars
  ) {
    return firstWord;
  }

  const availableChars = Math.max(1, safeMaxChars - 3);
  const boundaryIndex = normalized.lastIndexOf(" ", availableChars);
  const cutIndex =
    boundaryIndex >= Math.floor(availableChars * 0.6) ? boundaryIndex : availableChars;

  return `${normalized.slice(0, cutIndex).trimEnd()}...`;
}

function estimateCompactTitleBudget(width: number, fontSize: number, padding: number) {
  const usableWidth = Math.max(0, width - padding * 2);
  return clamp(Math.floor(usableWidth / Math.max(fontSize * 0.62, 1)), 4, 24);
}

export function resolveHeatmapTileSizing(width: number, height: number): HeatmapTileSizingRule {
  const safeWidth = Math.max(0, Math.floor(width));
  const safeHeight = Math.max(0, Math.floor(height));
  const area = safeWidth * safeHeight;

  if (safeWidth < 50 || safeHeight < 30 || area < 1_400) {
    return MICRO_RULE;
  }

  if (safeWidth < 86 || safeHeight < 42 || area < 3_000) {
    return SMALL_RULE;
  }

  if (safeWidth < 136 || safeHeight < 58 || area < 6_200) {
    return {
      ...COMPACT_RULE,
      showPosts: safeWidth >= 96 && safeHeight >= 52 && area >= 4_200,
      gap: safeWidth >= 96 && safeHeight >= 52 && area >= 4_200 ? COMPACT_RULE.gap : 0,
    };
  }

  if (safeWidth < 196 || safeHeight < 86 || area < 12_800) {
    return {
      ...MEDIUM_RULE,
      titleLines: safeWidth >= 164 && safeHeight >= 76 && area >= 10_200 ? 2 : 1,
    };
  }

  return {
    ...LARGE_RULE,
    titleLines: safeHeight >= 96 && area >= 16_000 ? 2 : 1,
  };
}

export function resolveHeatmapTileTextLayout(
  title: string,
  width: number,
  height: number,
): HeatmapTileTextLayout {
  const sizing = resolveHeatmapTileSizing(width, height);
  const compactTitle =
    sizing.showPosts || sizing.tier === "medium" || sizing.tier === "large"
      ? normalizeTitle(title)
      : shortenHeatmapTitle(
          title,
          estimateCompactTitleBudget(width, sizing.titleFontSize, sizing.padding),
        );

  return {
    ...sizing,
    title: compactTitle,
  };
}
