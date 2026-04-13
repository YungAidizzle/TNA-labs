import "server-only";

import { hasDatabaseUrl, getServerPostgresPool } from "@/lib/db/server-postgres";
import {
  assessMemecoinMomentum,
  compareCorrelatedMemecoinsByMomentum,
} from "@/lib/dashboard/memecoin-momentum";
import {
  getDashboardLiveValidationThresholds,
  revalidateCorrelatedMemecoinRows,
} from "@/lib/dashboard/dexscreener-live-validation";
import { getMemecoinDbCapabilities } from "@/lib/dashboard/memecoin-db-capabilities";
import {
  CorrelatedMemecoinBoard,
  MemecoinExternalLink,
  CorrelatedMemecoinLink,
  CorrelatedMemecoinRow,
} from "@/types/view-models";

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_RECENT_RUN_LIMIT = 12;
const DEFAULT_MAX_BOARD_ROWS = 100;
const CACHE_TTL_MS = (() => {
  const raw = process.env.DASHBOARD_MEMECOIN_CACHE_TTL_MS;
  if (!raw) {
    return DEFAULT_CACHE_TTL_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CACHE_TTL_MS;
  }

  return Math.min(120_000, Math.max(0, parsed));
})();
const RECENT_RUN_LIMIT = (() => {
  const raw = process.env.DASHBOARD_MEMECOIN_RECENT_RUN_LIMIT;
  if (!raw) {
    return DEFAULT_RECENT_RUN_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RECENT_RUN_LIMIT;
  }

  return Math.min(20, Math.max(1, parsed));
})();
const MAX_BOARD_ROWS = (() => {
  const raw = process.env.DASHBOARD_MEMECOIN_MAX_ROWS;
  if (!raw) {
    return DEFAULT_MAX_BOARD_ROWS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_BOARD_ROWS;
  }

  return Math.min(500, Math.max(0, parsed));
})();

type CachedBoard = {
  expiresAt: number;
  promise: Promise<CorrelatedMemecoinBoard | null> | null;
  value: CorrelatedMemecoinBoard | null;
};

let cachedBoard: CachedBoard | null = null;

type SuccessfulRunRow = {
  run_id: number;
  completed_at: string | null;
  notes_json: unknown;
};

type AggregationCandidateRow = {
  run_id: number;
  run_completed_at: string | null;
  asset_updated_at: string | null;
  rank: number;
  correlation_score: number;
  correlation_label: string;
  strongest_topic_key: string;
  strongest_topic_label: string;
  strongest_trend_category: string | null;
  strongest_narrative_summary: string | null;
  market_score: number | null;
  dexscreener_url: string | null;
  chain_id: string;
  token_address: string;
  asset_pair_address: string | null;
  symbol: string;
  name: string;
  icon_url: string | null;
  header_url: string | null;
  description: string | null;
  is_live: boolean | null;
  last_validated_at: string | null;
  validation_status: string | null;
  validation_reason: string | null;
  last_seen_liquidity_usd: number | null;
  last_seen_volume_h24: number | null;
  last_seen_txns_h24: number | null;
  websites_json: unknown;
  socials_json: unknown;
  pair_address: string | null;
  quote_symbol: string | null;
  quote_token_name: string | null;
  price_usd: number | null;
  liquidity_usd: number | null;
  volume_h24_usd: number | null;
  volume_h6_usd: number | null;
  volume_h1_usd: number | null;
  price_change_h24_pct: number | null;
  price_change_h6_pct: number | null;
  price_change_h1_pct: number | null;
  buys_h24: number | null;
  sells_h24: number | null;
  txns_h24: number | null;
  txns_h6: number | null;
  txns_h1: number | null;
  fdv_usd: number | null;
  market_cap_usd: number | null;
  pair_created_at: string | null;
  tradingview_symbol: string | null;
  tradingview_exchange: string | null;
  tradingview_embed_symbol: string | null;
  tv_resolution_status: string | null;
  tv_last_checked_at: string | null;
  tv_failure_reason: string | null;
  has_verified_tradingview_preview: boolean | null;
  tv_search_evidence_json: unknown;
  asset_metadata_json: unknown;
  market_metadata_json: unknown;
  links_json: unknown;
};

type AggregatedBoardRow = CorrelatedMemecoinRow & {
  sourceRunId: number;
  sourceCompletedAt: string | null;
  originalRank: number;
};

function toChainLabel(chainId: string) {
  const normalized = chainId.trim().toLowerCase();
  if (normalized === "bsc") {
    return "BSC";
  }
  if (normalized === "solana") {
    return "Solana";
  }
  if (normalized === "ethereum") {
    return "Ethereum";
  }
  if (normalized === "base") {
    return "Base";
  }
  if (!normalized) {
    return "Unknown";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function pairAgeHours(pairCreatedAt: string | null) {
  if (!pairCreatedAt) {
    return null;
  }

  const timestamp = Date.parse(pairCreatedAt);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / 3_600_000));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function readStringArray(record: Record<string, unknown> | null, key: string) {
  return parseStringArray(record?.[key]);
}

function readBoolean(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function readNumber(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function readObjectArrayLength(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return Array.isArray(value) ? value.length : 0;
}

function incrementCount(map: Map<string, number>, key: string | null | undefined) {
  const normalized = String(key ?? "").trim() || "unknown";
  map.set(normalized, (map.get(normalized) ?? 0) + 1);
}

function readProducerThresholdDiagnostics(notes: Record<string, unknown> | null | undefined) {
  const thresholds = asRecord(notes?.live_validation_thresholds);
  if (!thresholds) {
    return null;
  }

  const normalized = Object.fromEntries(
    [
      ["liveMinLiquidityUsd", readNumber(thresholds, "live_min_liquidity_usd")],
      ["liveMinVolume24hUsd", readNumber(thresholds, "live_min_volume_24h_usd")],
      ["liveMinRecentTxns", readNumber(thresholds, "live_min_recent_txns")],
      ["liveMaxStalenessHours", readNumber(thresholds, "live_max_snapshot_staleness_hours")],
    ].filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function buildThresholdDiagnostics(notes: Record<string, unknown> | null | undefined) {
  const readThresholds = getDashboardLiveValidationThresholds();
  const producerThresholds = readProducerThresholdDiagnostics(notes);
  const mismatchKeys =
    producerThresholds === null
      ? []
      : Object.entries({
          liveMinLiquidityUsd:
            producerThresholds.liveMinLiquidityUsd === readThresholds.liveMinLiquidityUsd,
          liveMinVolume24hUsd:
            producerThresholds.liveMinVolume24hUsd === readThresholds.liveMinVolume24hUsd,
          liveMinRecentTxns: producerThresholds.liveMinRecentTxns === readThresholds.liveMinRecentTxns,
          liveMaxStalenessHours:
            producerThresholds.liveMaxStalenessHours === readThresholds.liveMaxStalenessHours,
        })
          .filter(([, matches]) => !matches)
          .map(([key]) => key);

  return {
    producer: producerThresholds,
    read: readThresholds,
    mismatchKeys,
    producerSource: producerThresholds ? "run_notes" : "unavailable",
  };
}

function parseExternalLinks(value: unknown): MemecoinExternalLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const links: MemecoinExternalLink[] = [];

  value.forEach((item) => {
    const record = asRecord(item);
    const url = String(record?.url ?? "").trim();
    if (!url) {
      return;
    }

    links.push({
      label: typeof record?.label === "string" ? record.label : null,
      type: typeof record?.type === "string" ? record.type : null,
      url,
    });
  });

  return links;
}

function normalizeLink(link: unknown): CorrelatedMemecoinLink | null {
  const record = asRecord(link);
  if (!record) {
    return null;
  }

  const topicKey = String(record.topicKey ?? "").trim();
  const topicLabel = String(record.topicLabel ?? "").trim();
  if (!topicKey || !topicLabel) {
    return null;
  }

  return {
    topicKey,
    topicLabel,
    trendCategory: typeof record.trendCategory === "string" ? record.trendCategory : null,
    narrativeSummary: typeof record.narrativeSummary === "string" ? record.narrativeSummary : null,
    lexicalScore: Number(record.lexicalScore ?? 0),
    mentionScore: Number(record.mentionScore ?? 0),
    timingScore: Number(record.timingScore ?? 0),
    cultureFitScore: Number(record.cultureFitScore ?? 0),
    linkScore: Number(record.linkScore ?? 0),
    supportPostCount: Number(record.supportPostCount ?? 0),
    supportInteractionScore: Number(record.supportInteractionScore ?? 0),
    isPrimary: Boolean(record.isPrimary),
    whyLinked: typeof record.whyLinked === "string" ? record.whyLinked : null,
    matchReasons: Array.isArray(record.matchReasons)
      ? record.matchReasons
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
      : null,
    rawMatchSignals: asRecord(record.rawMatchSignals),
  };
}

function parseLinks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeLink(item))
    .filter((item): item is CorrelatedMemecoinLink => Boolean(item));
}

function parseTimestamp(value: string | null | undefined) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function dedupeKeyForRow(row: Pick<AggregationCandidateRow, "chain_id" | "token_address" | "symbol">) {
  const chainId = row.chain_id.trim().toLowerCase();
  const tokenAddress = row.token_address.trim().toLowerCase();
  if (tokenAddress) {
    return `${chainId}:${tokenAddress}`;
  }

  return `${chainId}:${row.symbol.trim().toUpperCase()}`;
}

function compareAggregatedRows(
  left: Pick<AggregatedBoardRow, "correlationScore" | "sourceCompletedAt" | "marketScore" | "volume24hUsd" | "liquidityUsd" | "originalRank">,
  right: Pick<AggregatedBoardRow, "correlationScore" | "sourceCompletedAt" | "marketScore" | "volume24hUsd" | "liquidityUsd" | "originalRank">,
) {
  if (left.correlationScore !== right.correlationScore) {
    return right.correlationScore - left.correlationScore;
  }

  const completedAtDelta = parseTimestamp(right.sourceCompletedAt) - parseTimestamp(left.sourceCompletedAt);
  if (completedAtDelta !== 0) {
    return completedAtDelta;
  }

  const marketScoreDelta = Number(right.marketScore ?? 0) - Number(left.marketScore ?? 0);
  if (marketScoreDelta !== 0) {
    return marketScoreDelta;
  }

  const volumeDelta = Number(right.volume24hUsd ?? 0) - Number(left.volume24hUsd ?? 0);
  if (volumeDelta !== 0) {
    return volumeDelta;
  }

  const liquidityDelta = Number(right.liquidityUsd ?? 0) - Number(left.liquidityUsd ?? 0);
  if (liquidityDelta !== 0) {
    return liquidityDelta;
  }

  return left.originalRank - right.originalRank;
}

async function queryLatestBoard(): Promise<CorrelatedMemecoinBoard | null> {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const pool = getServerPostgresPool();
  try {
    const capabilities = await getMemecoinDbCapabilities();
    const liveValidationSelect = capabilities.assetLiveValidationColumnsAvailable
      ? `
          a.is_live,
          a.last_validated_at,
          a.validation_status,
          a.validation_reason,
          a.last_seen_liquidity_usd,
          a.last_seen_volume_h24,
          a.last_seen_txns_h24,
      `
      : `
          NULL::boolean AS is_live,
          NULL::timestamptz AS last_validated_at,
          NULL::text AS validation_status,
          NULL::text AS validation_reason,
          NULL::double precision AS last_seen_liquidity_usd,
          NULL::double precision AS last_seen_volume_h24,
          NULL::integer AS last_seen_txns_h24,
      `;
    const liveValidationWhere = capabilities.assetLiveValidationColumnsAvailable
      ? `AND COALESCE(a.validation_status, 'pending') <> 'invalid'`
      : "";

    const successfulRunsResult = await pool.query<SuccessfulRunRow>(
      `
        SELECT run_id, completed_at, notes_json
        FROM public.memecoin_correlation_runs
        WHERE status = 'succeeded'
          AND published_result_count > 0
        ORDER BY completed_at DESC, run_id DESC
        LIMIT $1
      `,
      [RECENT_RUN_LIMIT],
    );

    const latestRun = successfulRunsResult.rows[0];
    if (!latestRun) {
      return null;
    }
    const runIds = successfulRunsResult.rows.map((row) => row.run_id);

    const rowsResult = await pool.query<AggregationCandidateRow>(
      `
        SELECT
          r.run_id,
          run.completed_at AS run_completed_at,
          a.updated_at AS asset_updated_at,
          r.rank,
          r.correlation_score,
          r.correlation_label,
          r.strongest_topic_key,
          r.strongest_topic_label,
          r.strongest_trend_category,
          r.strongest_narrative_summary,
          r.market_score,
          COALESCE(r.dexscreener_url, s.pair_url, a.dexscreener_url) AS dexscreener_url,
          a.chain_id,
          a.token_address,
          a.pair_address AS asset_pair_address,
          a.symbol,
          a.name,
          a.icon_url,
          a.header_url,
          a.description,
          ${liveValidationSelect}
          a.websites_json,
          a.socials_json,
          s.pair_address,
          s.quote_symbol,
          s.quote_token_name,
          s.price_usd,
          s.liquidity_usd,
          s.volume_h24_usd,
          s.volume_h6_usd,
          s.volume_h1_usd,
          s.price_change_h24_pct,
          s.price_change_h6_pct,
          s.price_change_h1_pct,
          s.buys_h24,
          s.sells_h24,
          s.txns_h24,
          s.txns_h6,
          s.txns_h1,
          s.fdv_usd,
          s.market_cap_usd,
          s.pair_created_at,
          a.tradingview_symbol,
          a.tradingview_exchange,
          a.tradingview_embed_symbol,
          a.tv_resolution_status,
          a.tv_last_checked_at,
          a.tv_failure_reason,
          a.has_verified_tradingview_preview,
          a.tv_search_evidence_json,
          a.metadata_json AS asset_metadata_json,
          s.metadata_json AS market_metadata_json,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'topicKey', l.topic_key,
                  'topicLabel', l.topic_label,
                  'trendCategory', l.trend_category,
                  'narrativeSummary', l.narrative_summary,
                  'lexicalScore', l.lexical_score,
                  'mentionScore', l.mention_score,
                  'timingScore', l.timing_score,
                  'cultureFitScore', l.culture_fit_score,
                  'linkScore', l.link_score,
                  'supportPostCount', l.support_post_count,
                  'supportInteractionScore', l.support_interaction_score,
                  'isPrimary', l.is_primary,
                  'whyLinked', l.why_linked,
                  'matchReasons', l.match_reasons_json,
                  'rawMatchSignals', l.raw_match_signals_json
                )
                ORDER BY l.is_primary DESC, l.link_score DESC, l.link_id DESC
              )
              FROM public.memecoin_correlation_links l
              WHERE l.run_id = r.run_id
                AND l.asset_id = r.asset_id
            ),
            '[]'::jsonb
          ) AS links_json
        FROM public.memecoin_correlation_results r
        INNER JOIN public.memecoin_correlation_runs run
          ON run.run_id = r.run_id
        INNER JOIN public.memecoin_assets a
          ON a.asset_id = r.asset_id
        LEFT JOIN public.memecoin_market_snapshots s
          ON s.snapshot_id = r.market_snapshot_id
        WHERE r.run_id = ANY($1::bigint[])
          ${liveValidationWhere}
        ORDER BY run.completed_at DESC, r.rank ASC, r.result_id DESC
      `,
      [runIds],
    );

    const latestRunNotes = asRecord(latestRun.notes_json);
    const thresholdDiagnostics = buildThresholdDiagnostics(latestRunNotes);
    const rowsReturnedByDbQuery = rowsResult.rows.length;
    const mappedRows = rowsResult.rows
      .filter((row) => Boolean((row.dexscreener_url || row.pair_address || row.asset_pair_address) && row.symbol && row.name))
      .map((row) => {
        const assetMetadata = asRecord(row.asset_metadata_json);
        const marketMetadata = asRecord(row.market_metadata_json);
        const tvSearchEvidence = asRecord(row.tv_search_evidence_json);
        const tradingviewSymbol =
          row.tradingview_embed_symbol ??
          row.tradingview_symbol ??
          readString(assetMetadata, "tradingview_embed_symbol") ??
          readString(assetMetadata, "tradingviewEmbedSymbol") ??
          readString(assetMetadata, "tradingview_symbol") ??
          readString(assetMetadata, "tradingviewSymbol") ??
          readString(marketMetadata, "tradingview_symbol") ??
          readString(marketMetadata, "tradingviewSymbol");
        const hasVerifiedTradingviewPreview = Boolean(
          row.has_verified_tradingview_preview && tradingviewSymbol,
        );
        const tvResolutionStatus =
          row.tv_resolution_status ??
          readString(assetMetadata, "tv_resolution_status") ??
          readString(assetMetadata, "tvResolutionStatus");
        const tvFailureReason =
          row.tv_failure_reason ??
          readString(assetMetadata, "tv_failure_reason") ??
          readString(assetMetadata, "tvFailureReason");
        const tvSearchAttempts =
          readObjectArrayLength(tvSearchEvidence, "candidate_validation") ||
          readObjectArrayLength(tvSearchEvidence, "candidateValidation");
        const resolvedPairAddress = row.pair_address ?? row.asset_pair_address ?? "";

        const aggregatedRow: AggregatedBoardRow = {
          id: `${row.chain_id}:${row.token_address}:${resolvedPairAddress || "unknown"}`,
          rank: row.rank,
          chainId: row.chain_id,
          chainLabel: toChainLabel(row.chain_id),
          dexId: readString(marketMetadata, "dex_id") ?? readString(marketMetadata, "dexId"),
          tokenAddress: row.token_address,
          pairAddress: resolvedPairAddress,
          pairLabels: readStringArray(marketMetadata, "pair_labels"),
          name: row.name,
          symbol: row.symbol,
          quoteSymbol: row.quote_symbol,
          quoteTokenName: row.quote_token_name,
          strongestTrendKey: row.strongest_topic_key,
          strongestTrendLabel: row.strongest_topic_label,
          strongestTrendCategory: row.strongest_trend_category,
          strongestTrendSummary: row.strongest_narrative_summary,
          correlationScore: Number(row.correlation_score ?? 0),
          correlationLabel: row.correlation_label,
          marketScore: row.market_score,
          liquidityUsd: row.liquidity_usd,
          volume24hUsd: row.volume_h24_usd,
          volume6hUsd: row.volume_h6_usd,
          volume1hUsd: row.volume_h1_usd,
          priceUsd: row.price_usd,
          priceChange5mPct: null,
          priceChange1hPct: row.price_change_h1_pct,
          priceChange6hPct: row.price_change_h6_pct,
          priceChange24hPct: row.price_change_h24_pct,
          pairAgeHours: pairAgeHours(row.pair_created_at),
          buys24h: row.buys_h24,
          sells24h: row.sells_h24,
          txns24h: row.txns_h24,
          txns6h: row.txns_h6,
          txns1h: row.txns_h1,
          fdvUsd: row.fdv_usd,
          marketCapUsd: row.market_cap_usd,
          iconUrl: row.icon_url,
          headerUrl: row.header_url,
          description: row.description,
          websites: parseExternalLinks(row.websites_json),
          socials: parseExternalLinks(row.socials_json),
          tradingviewSymbol,
          tradingviewExchange: row.tradingview_exchange,
          hasVerifiedTradingviewPreview,
          tvResolutionStatus,
          tvLastCheckedAt: row.tv_last_checked_at,
          tvFailureReason,
          isLive: row.is_live,
          lastValidatedAt: row.last_validated_at,
          validationStatus: row.validation_status,
          validationReason: row.validation_reason,
          lastSeenLiquidityUsd: row.last_seen_liquidity_usd,
          lastSeenVolume24hUsd: row.last_seen_volume_h24,
          lastSeenTxns24h: row.last_seen_txns_h24,
          tvSearchAttempts,
          memecoinFitScore: readNumber(marketMetadata, "memecoin_fit_score"),
          seedTerms: readStringArray(assetMetadata, "seed_terms"),
          discoverySources: readStringArray(assetMetadata, "discovery_sources"),
          matchedTrendKeys: readStringArray(assetMetadata, "matched_trend_keys"),
          communityTakeover: readBoolean(assetMetadata, "community_takeover"),
          links: parseLinks(row.links_json),
          dexscreenerUrl:
            row.dexscreener_url ??
            (resolvedPairAddress ? `https://dexscreener.com/${row.chain_id}/${resolvedPairAddress}` : ""),
          updatedAt: row.last_validated_at ?? row.asset_updated_at ?? row.run_completed_at ?? null,
          sourceRunId: row.run_id,
          sourceCompletedAt: row.run_completed_at ?? null,
          originalRank: row.rank,
        };
        return aggregatedRow;
      });
    const rowsWithRequiredFields = mappedRows.length;

    const statusCounts = new Map<string, number>();
    const unresolvedReasonCounts = new Map<string, number>();
    let totalSearchAttempts = 0;
    for (const row of mappedRows) {
      incrementCount(statusCounts, row.tvResolutionStatus ?? (row.hasVerifiedTradingviewPreview ? "verified" : null));
      totalSearchAttempts += row.tvSearchAttempts ?? 0;
      if (!row.hasVerifiedTradingviewPreview || !row.tradingviewSymbol) {
        incrementCount(
          unresolvedReasonCounts,
          row.tvFailureReason ?? row.tvResolutionStatus ?? "tradingview_symbol_unavailable",
        );
      }
    }

    const dedupedRows = new Map<string, AggregatedBoardRow>();
    for (const row of mappedRows) {
      const key = dedupeKeyForRow({
        chain_id: row.chainId,
        token_address: row.tokenAddress,
        symbol: row.symbol,
      });
      const existing = dedupedRows.get(key);
      if (!existing || compareAggregatedRows(existing, row) > 0) {
        dedupedRows.set(key, row);
      }
    }

    const rowsAfterDedupe = dedupedRows.size;
    const sortedRows = Array.from(dedupedRows.values()).sort(compareAggregatedRows);
    const boardRows: CorrelatedMemecoinRow[] = (MAX_BOARD_ROWS > 0
      ? sortedRows.slice(0, MAX_BOARD_ROWS)
      : sortedRows)
      .map((row, index) => ({
        ...row,
        rank: index + 1,
      }));
    const { liveRows: revalidatedBoardRows, rejected, stats: readValidationStats } =
      await revalidateCorrelatedMemecoinRows(boardRows);
    const liveBoardRows = (revalidatedBoardRows as AggregatedBoardRow[])
      .sort(compareAggregatedRows)
      .map((row, index) => ({
        ...row,
        rank: index + 1,
      }));
    const rowsWithMomentum = liveBoardRows.map((row) => ({
      ...row,
      ...assessMemecoinMomentum(row),
    }));
    const momentumRankById = new Map(
      [...rowsWithMomentum]
        .sort(compareCorrelatedMemecoinsByMomentum)
        .map((row, index) => [row.id, index + 1] as const),
    );
    const rows: CorrelatedMemecoinRow[] = rowsWithMomentum.map((row) => ({
      ...row,
      momentumRank: momentumRankById.get(row.id) ?? row.rank,
    }));
    const latestRunFunnelCounts = asRecord(latestRunNotes?.funnel_counts);
    const latestRunDbWriteCounts = asRecord(latestRunNotes?.db_write_counts);
    const producerStageCounts = Object.fromEntries(
      [
        ["candidateTrends", readNumber(latestRunNotes, "candidate_trend_count")],
        ["candidatesDiscovered", readNumber(latestRunNotes, "discovery_tokens")],
        ["candidatesAfterProducerLiveValidation", readNumber(latestRunFunnelCounts, "candidates_after_live_validation")],
        ["eligibleTokens", readNumber(latestRunNotes, "eligible_tokens")],
        ["publishedResults", readNumber(latestRunNotes, "published_results")],
        ["assetRowsWritten", readNumber(latestRunDbWriteCounts, "asset_rows")],
        ["marketSnapshotRowsWritten", readNumber(latestRunDbWriteCounts, "market_snapshot_rows")],
        ["resultRowsWritten", readNumber(latestRunDbWriteCounts, "result_rows")],
        ["linkRowsWritten", readNumber(latestRunDbWriteCounts, "link_rows")],
        ["trendMemecoinRowsWritten", readNumber(latestRunDbWriteCounts, "trend_memecoin_rows")],
      ].filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    );
    const dbStageCounts = {
      rowsReturnedByQuery: rowsReturnedByDbQuery,
      rowsWithRequiredFields,
      rowsAfterDedupe,
      rowsSubmittedForReadValidation: boardRows.length,
    };
    const diagnostics = {
      runsUsed: runIds.length,
      rowsConsidered: mappedRows.length,
      rowsVerified: mappedRows.filter((row) => row.hasVerifiedTradingviewPreview && row.tradingviewSymbol).length,
      rowsExcluded: rejected.length,
      displayedRows: rows.length,
      schemaCompatibility: {
        assetLiveValidationColumnsAvailable: capabilities.assetLiveValidationColumnsAvailable,
        assetColumns: capabilities.assetColumns,
      },
      producerStageCounts,
      dbStageCounts,
      readValidationStageCounts: {
        attempted: readValidationStats.attempted,
        passed: readValidationStats.liveRows,
        rejected: readValidationStats.rejected,
      },
      coverageRatePct:
        mappedRows.length > 0
          ? Number(
              (
                (mappedRows.filter((row) => row.hasVerifiedTradingviewPreview && row.tradingviewSymbol).length /
                  mappedRows.length) *
                100
              ).toFixed(2),
            )
          : 0,
      unresolvedReasonCounts: Object.fromEntries(
        [...unresolvedReasonCounts.entries()].sort((left, right) => right[1] - left[1]),
      ),
      statusCounts: Object.fromEntries(
        [...statusCounts.entries()].sort((left, right) => right[1] - left[1]),
      ),
      averageSearchAttemptsPerCoin:
        mappedRows.length > 0 ? Number((totalSearchAttempts / mappedRows.length).toFixed(3)) : 0,
      latestRunPreviewDiagnostics: asRecord(latestRunNotes?.preview_diagnostics),
      liveValidationRejectCounts: readValidationStats.rejectReasonCounts,
      liveValidationDecisionSourceCounts: readValidationStats.decisionSourceCounts,
      liveValidationFallbackReasonCounts: readValidationStats.fallbackReasonCounts,
      thresholdDiagnostics,
    } as const;

    console.info("[correlated-memecoins] aggregated board", {
      runs_used: runIds,
      schema_live_validation_columns_available: capabilities.assetLiveValidationColumnsAvailable,
      rows_returned_by_query: rowsReturnedByDbQuery,
      rows_with_required_fields: rowsWithRequiredFields,
      rows_after_dedupe: rowsAfterDedupe,
      rows_submitted_for_read_validation: boardRows.length,
      configured_max_rows: MAX_BOARD_ROWS,
      final_rows: rows.length,
      live_validation_rejected: rejected.length,
      live_validation_decision_source_counts: readValidationStats.decisionSourceCounts,
      live_validation_fallback_reason_counts: readValidationStats.fallbackReasonCounts,
      live_validation_reject_counts: readValidationStats.rejectReasonCounts,
      producer_stage_counts: producerStageCounts,
      db_stage_counts: dbStageCounts,
      threshold_mismatch_keys: thresholdDiagnostics.mismatchKeys,
      coverage_rate_pct: diagnostics.coverageRatePct,
      unresolved_reason_counts: diagnostics.unresolvedReasonCounts,
    });

    return {
      runId: latestRun.run_id,
      updatedAt: latestRun.completed_at ?? null,
      rows,
      diagnostics,
    };
  } catch (error) {
    const message = String((error as Error)?.message ?? error ?? "");
    if (
      (message.includes("relation") && message.includes("does not exist")) ||
      (message.includes("column") && message.includes("does not exist"))
    ) {
      return null;
    }
    throw error;
  }
}

export async function fetchLatestCorrelatedMemecoinBoard() {
  if (CACHE_TTL_MS <= 0) {
    return queryLatestBoard();
  }

  const now = Date.now();
  const currentCache = cachedBoard;
  const previousValue = currentCache?.value ?? null;
  if (previousValue && currentCache && currentCache.expiresAt > now) {
    return currentCache.value;
  }
  if (currentCache?.promise) {
    return currentCache.promise;
  }

  const promise = queryLatestBoard()
    .then((value) => {
      cachedBoard = {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS,
        promise: null,
      };
      return value;
    })
    .catch((error) => {
      if (previousValue) {
        cachedBoard = {
          value: previousValue,
          expiresAt: Date.now() + CACHE_TTL_MS,
          promise: null,
        };
        return previousValue;
      }

      cachedBoard = null;
      throw error;
    });

  cachedBoard = {
    value: cachedBoard?.value ?? null,
    expiresAt: cachedBoard?.expiresAt ?? 0,
    promise,
  };

  return promise;
}
