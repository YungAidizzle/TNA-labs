import "server-only";

import { getServerPostgresPool, hasDatabaseUrl } from "@/lib/db/server-postgres";
import { revalidateNarrativeLinkedCoins } from "@/lib/dashboard/dexscreener-live-validation";
import { getMemecoinDbCapabilities } from "@/lib/dashboard/memecoin-db-capabilities";
import { NarrativeLinkedCoin, RankedTrend, TrendDashboardVM } from "@/types/view-models";

type TrendMemecoinLinkRow = {
  topic_key: string;
  rank: number;
  chain_id: string;
  coin_address: string;
  pair_address: string | null;
  dexscreener_url: string | null;
  coin_symbol: string;
  coin_name: string;
  confidence_score: number;
  confidence_band: string | null;
  mention_count: number | null;
  engagement_score: number | null;
  age_hours: number | null;
  liquidity: number | null;
  volume_24h: number | null;
  market_score: number | null;
  memecoin_fit_score: number | null;
  why_linked: string | null;
  match_reasons_json: string[] | null;
  raw_match_signals_json: Record<string, unknown> | null;
  last_updated_at: string | null;
  is_live: boolean | null;
  last_validated_at: string | null;
  validation_status: string | null;
  validation_reason: string | null;
  last_seen_liquidity_usd: number | null;
  last_seen_volume_h24: number | null;
  last_seen_txns_h24: number | null;
};

function isMissingRelation(error: unknown) {
  const databaseError = error as { code?: string; message?: string };
  const message = String(databaseError?.message ?? "").toLowerCase();
  return databaseError?.code === "42P01" || message.includes("does not exist");
}

export function getTrendTopicKey(row: RankedTrend) {
  const topicKey = typeof row.canonicalKeySummary === "string" ? row.canonicalKeySummary.trim() : "";
  return topicKey || null;
}

function dedupeTopicKeys(rows: RankedTrend[]) {
  return [...new Set(rows.map((row) => getTrendTopicKey(row)).filter((value): value is string => Boolean(value)))];
}

async function fetchTrendMemecoinLinks(topicKeys: string[]) {
  const result = new Map<string, NarrativeLinkedCoin[]>();
  if (!hasDatabaseUrl() || topicKeys.length === 0) {
    return result;
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
          a.last_seen_txns_h24
      `
      : `
          NULL::boolean AS is_live,
          NULL::timestamptz AS last_validated_at,
          NULL::text AS validation_status,
          NULL::text AS validation_reason,
          NULL::double precision AS last_seen_liquidity_usd,
          NULL::double precision AS last_seen_volume_h24,
          NULL::integer AS last_seen_txns_h24
      `;
    const liveValidationWhere = capabilities.assetLiveValidationColumnsAvailable
      ? `AND COALESCE(a.validation_status, 'pending') <> 'invalid'`
      : "";
    const rowsResult = await pool.query<TrendMemecoinLinkRow>(
      `
        SELECT
          l.topic_key,
          l.rank,
          l.chain_id,
          l.coin_address,
          COALESCE(l.pair_address, a.pair_address) AS pair_address,
          COALESCE(l.dexscreener_url, a.dexscreener_url) AS dexscreener_url,
          l.coin_symbol,
          l.coin_name,
          l.confidence_score,
          l.confidence_band,
          l.mention_count,
          l.engagement_score,
          l.age_hours,
          COALESCE(l.liquidity, a.last_seen_liquidity_usd) AS liquidity,
          COALESCE(l.volume_24h, a.last_seen_volume_h24) AS volume_24h,
          l.market_score,
          l.memecoin_fit_score,
          l.why_linked,
          l.match_reasons_json,
          l.raw_match_signals_json,
          l.last_updated_at,
          ${liveValidationSelect}
        FROM public.trend_memecoin_links l
        LEFT JOIN public.memecoin_assets a
          ON LOWER(a.chain_id) = LOWER(l.chain_id)
         AND LOWER(a.token_address) = LOWER(l.coin_address)
        WHERE l.topic_key = ANY($1::text[])
          ${liveValidationWhere}
        ORDER BY l.topic_key ASC, l.confidence_score DESC, l.rank ASC, l.id ASC
      `,
      [topicKeys],
    );

    const topicCoinEntries = rowsResult.rows.map((row) => {
      const topicKey = row.topic_key.trim();
      const linkedCoin: NarrativeLinkedCoin = {
        id: `${row.chain_id}:${row.coin_address}`,
        symbol: row.coin_symbol,
        name: row.coin_name,
        address: row.coin_address,
        confidence: Number(row.confidence_score ?? 0),
        confidenceBand: row.confidence_band,
        liquidity: row.liquidity,
        volume: row.volume_24h,
        age: row.age_hours,
        mentionCount: row.mention_count,
        engagementScore: row.engagement_score,
        chainId: row.chain_id,
        pairAddress: row.pair_address,
        dexscreenerUrl:
          row.dexscreener_url ??
          (row.pair_address ? `https://dexscreener.com/${row.chain_id}/${row.pair_address}` : null),
        isLive: row.is_live,
        lastValidatedAt: row.last_validated_at,
        validationStatus: row.validation_status,
        validationReason: row.validation_reason,
        lastSeenLiquidityUsd: row.last_seen_liquidity_usd,
        lastSeenVolume24hUsd: row.last_seen_volume_h24,
        lastSeenTxns24h: row.last_seen_txns_h24,
        marketScore: row.market_score,
        memecoinFitScore: row.memecoin_fit_score,
        whyLinked: row.why_linked,
        matchReasons: Array.isArray(row.match_reasons_json) ? row.match_reasons_json : null,
        rawMatchSignals:
          row.raw_match_signals_json && typeof row.raw_match_signals_json === "object"
            ? row.raw_match_signals_json
            : null,
        lastUpdatedAt: row.last_updated_at,
      };
      return { topicKey, linkedCoin };
    });

    const uniqueCoins = new Map<string, NarrativeLinkedCoin>();
    topicCoinEntries.forEach(({ linkedCoin }) => {
      uniqueCoins.set(linkedCoin.id, linkedCoin);
    });
    const { liveCoins, rejected, stats } = await revalidateNarrativeLinkedCoins([...uniqueCoins.values()]);
    const liveCoinById = new Map(liveCoins.map((coin) => [coin.id, coin] as const));

    topicCoinEntries.forEach(({ topicKey, linkedCoin }) => {
      const liveCoin = liveCoinById.get(linkedCoin.id);
      if (!liveCoin) {
        return;
      }
      const current = result.get(topicKey) ?? [];
      current.push(liveCoin);
      result.set(topicKey, current);
    });

    if (rejected.length > 0) {
      console.info("[trend-memecoin-links] suppressed invalid linked coins", {
        requested_topics: topicKeys.length,
        schema_live_validation_columns_available: capabilities.assetLiveValidationColumnsAvailable,
        unique_coins_requested: uniqueCoins.size,
        live_coin_count: liveCoins.length,
        rejected_count: rejected.length,
        reject_reasons: stats.rejectReasonCounts,
        decision_source_counts: stats.decisionSourceCounts,
        fallback_reason_counts: stats.fallbackReasonCounts,
      });
    }

    return result;
  } catch (error) {
    if (isMissingRelation(error)) {
      return result;
    }
    throw error;
  }
}

function attachLinksToRow(
  row: RankedTrend,
  linkedCoinsByTopic: Map<string, NarrativeLinkedCoin[]>,
): RankedTrend {
  const topicKey = getTrendTopicKey(row);
  return {
    ...row,
    linkedCoins: topicKey ? linkedCoinsByTopic.get(topicKey) ?? [] : [],
  };
}

export async function attachTrendMemecoinLinks(state: TrendDashboardVM): Promise<TrendDashboardVM> {
  const allRows = [
    ...state.leaderboard,
    ...state.leaderboards.established,
    ...state.leaderboards.emerging,
    ...(state.detail?.trend ? [state.detail.trend] : []),
  ];
  const linkedCoinsByTopic = await fetchTrendMemecoinLinks(dedupeTopicKeys(allRows));

  return {
    ...state,
    leaderboards: {
      established: state.leaderboards.established.map((row) => attachLinksToRow(row, linkedCoinsByTopic)),
      emerging: state.leaderboards.emerging.map((row) => attachLinksToRow(row, linkedCoinsByTopic)),
    },
    leaderboard: state.leaderboard.map((row) => attachLinksToRow(row, linkedCoinsByTopic)),
    detail: state.detail
      ? {
          ...state.detail,
          trend: attachLinksToRow(state.detail.trend, linkedCoinsByTopic),
        }
      : null,
  };
}
