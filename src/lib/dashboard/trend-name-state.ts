import {
  RankedTrend,
  TrendAiEnrichment,
  TrendNameSource,
  TrendNameStatus,
} from "@/types/view-models";

export const TREND_NAME_PLACEHOLDER = "Unresolved Narrative Cluster";

const READY_SOURCES = new Set<TrendNameSource>([
  "ai_exact",
  "historical_exact",
  "historical_alias",
]);

function normalizeName(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function legacyNameStatus(trend: RankedTrend | null | undefined): TrendNameStatus {
  if (!trend) {
    return "pending";
  }

  if (
    trend.trendEnrichment?.nameStatus === "ready" ||
    trend.trendEnrichment?.nameStatus === "pending" ||
    trend.trendEnrichment?.nameStatus === "failed"
  ) {
    return trend.trendEnrichment.nameStatus;
  }

  const enrichmentStatus = trend.trendEnrichment?.status ?? trend.trendEnrichmentStatus ?? null;
  const legacyCanonicalName = normalizeName(trend.trendEnrichment?.canonicalName ?? null);
  const legacyRawLabel = normalizeName(trend.trendEnrichment?.rawLabel ?? trend.trendRawLabel ?? null);
  if (
    legacyCanonicalName &&
    legacyCanonicalName.toLowerCase() !== (legacyRawLabel ?? "").toLowerCase() &&
    (enrichmentStatus === "ok" || enrichmentStatus === "mixed")
  ) {
    return "ready";
  }
  if (enrichmentStatus === "insufficient_evidence" || enrichmentStatus === "junk") {
    return "failed";
  }
  return "pending";
}

export function resolveTrendNameStatus(
  trend: Pick<
    RankedTrend,
    | "displayName"
    | "nameStatus"
    | "nameSource"
    | "trendEnrichment"
    | "trendEnrichmentStatus"
    | "trendRawLabel"
  > | null | undefined,
): TrendNameStatus {
  if (!trend) {
    return "pending";
  }

  if (trend.nameStatus === "ready" || trend.nameStatus === "pending" || trend.nameStatus === "failed") {
    return trend.nameStatus;
  }

  const displayName = normalizeName(trend.displayName);
  const trendNameSource = trend.nameSource ?? trend.trendEnrichment?.nameSource;
  if (displayName && trendNameSource && READY_SOURCES.has(trendNameSource)) {
    return "ready";
  }

  return legacyNameStatus(trend as RankedTrend);
}

export function resolveTrendNameSource(
  trend: Pick<
    RankedTrend,
    "displayName" | "nameSource" | "trendFallbackLabel" | "trendRawLabel" | "trendEnrichment"
  > | null | undefined,
): TrendNameSource {
  if (!trend) {
    return "none";
  }

  if (trend.trendEnrichment?.nameSource) {
    return trend.trendEnrichment.nameSource;
  }

  if (trend.nameSource) {
    return trend.nameSource;
  }

  if (normalizeName(trend.displayName)) {
    return "ai_exact";
  }

  if (normalizeName(trend.trendFallbackLabel)) {
    return "fallback_cleaned";
  }

  if (normalizeName(trend.trendRawLabel)) {
    return "raw";
  }

  return "none";
}

export function hasTrustedTrendDisplayName(
  trend: Pick<RankedTrend, "displayName" | "nameStatus" | "nameSource" | "trendEnrichment" | "trendEnrichmentStatus"> | null | undefined,
) {
  const displayName = normalizeName(trend?.displayName);
  const nameStatus = resolveTrendNameStatus(trend);
  const nameSource = resolveTrendNameSource(trend as RankedTrend | null | undefined);
  return Boolean(displayName && nameStatus === "ready" && READY_SOURCES.has(nameSource));
}

export function getTrustedTrendDisplayName(
  trend: Pick<RankedTrend, "displayName" | "nameStatus" | "nameSource" | "trendEnrichment" | "trendEnrichmentStatus"> | null | undefined,
) {
  return hasTrustedTrendDisplayName(trend)
    ? normalizeName(trend?.displayName)
    : null;
}

export function resolveTrendPlaceholderLabel(
  trend: Pick<RankedTrend, "trendFallbackLabel" | "trendRawLabel"> | null | undefined,
) {
  return (
    normalizeName(trend?.trendFallbackLabel) ??
    normalizeName(trend?.trendRawLabel) ??
    TREND_NAME_PLACEHOLDER
  );
}

export function getTrendDisplayNameOrPlaceholder(
  trend: Pick<
    RankedTrend,
    | "displayName"
    | "nameStatus"
    | "nameSource"
    | "trendEnrichment"
    | "trendEnrichmentStatus"
    | "trendFallbackLabel"
    | "trendRawLabel"
  > | null | undefined,
) {
  return getTrustedTrendDisplayName(trend) ?? resolveTrendPlaceholderLabel(trend);
}

export function toTrendNameFields(params: {
  displayName?: string | null;
  trustedDisplayName?: string | null;
  nameStatus: TrendNameStatus;
  nameSource: TrendNameSource;
  fallbackLabel?: string | null;
  rawLabel?: string | null;
  enrichment?: TrendAiEnrichment | null;
}) {
  const trustedDisplayName = normalizeName(params.trustedDisplayName);
  const resolvedDisplayName =
    normalizeName(params.displayName) ??
    trustedDisplayName ??
    normalizeName(params.fallbackLabel) ??
    normalizeName(params.rawLabel);
  const fallbackLabel = normalizeName(params.fallbackLabel);
  const rawLabel = normalizeName(params.rawLabel);

  return {
    name: resolvedDisplayName ?? TREND_NAME_PLACEHOLDER,
    displayName: resolvedDisplayName,
    nameStatus: params.nameStatus,
    nameSource: params.nameSource,
    trendFallbackLabel: fallbackLabel,
    trendRawLabel: rawLabel,
    trendEnrichment: params.enrichment ?? null,
  };
}
