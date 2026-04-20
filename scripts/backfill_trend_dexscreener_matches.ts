import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { fetchLatestCorrelatedMemecoinBoard } from "@/lib/dashboard/correlated-memecoins";
import { buildTrendsPageMemecoinDatasets } from "@/lib/dashboard/trends-page-memecoin-selectors";
import { buildStrictTrendsPageCorrelatedBoard } from "@/lib/dashboard/trends-page-memecoin-matcher";
import { refreshStoredTrendDexscreenerMatches } from "@/lib/dashboard/trend-dexscreener-matches";
import { getTrendDashboardState } from "@/lib/dashboard/service";
import { loadRepoEnv } from "./lib/ai-native-narrative-runtime";

type StoredNarrativeSourceRow = {
  id: string | number;
  run_id: string | number;
  canonical_id: string;
  canonical_name: string;
  summary: string | null;
  key_entities_json: unknown;
};

type TopicCountRow = {
  topic_key: string;
  count: string | number;
};

type CountRow = {
  count: string | number;
};

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  return {
    boardOnly: args.includes("--board-only"),
    topic:
      args.find((value) => value.startsWith("--topic="))?.slice("--topic=".length).trim() ||
      "portland-frog",
  };
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
}

function asCount(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

async function ensureTrendDexMatchTable(client: Client) {
  const existsResult = await client.query<{ relation_name: string | null }>(
    "SELECT to_regclass('public.trend_dexscreener_matches')::text AS relation_name",
  );
  const relationName = existsResult.rows[0]?.relation_name ?? null;
  if (relationName) {
    return {
      tableExisted: true,
      migrationApplied: false,
      relationName,
    };
  }

  const migrationPath = path.join(
    process.cwd(),
    "backend",
    "migrations",
    "20260420_trend_dexscreener_matches.sql",
  );
  const sql = fs.readFileSync(migrationPath, "utf8");
  await client.query(sql);

  return {
    tableExisted: false,
    migrationApplied: true,
    relationName: "public.trend_dexscreener_matches",
  };
}

async function fetchStoredNarratives(client: Client, boardOnly: boolean) {
  if (boardOnly) {
    const { getLatestSuccessfulAiNativeNarrativeRunView } = await import(
      "@/lib/ai-native-narratives/repository"
    );
    const view = await getLatestSuccessfulAiNativeNarrativeRunView();
    return view.narratives.map((narrative) => ({
      topicKey: narrative.canonicalId,
      topicLabel: narrative.canonicalName,
      summary: narrative.summary,
      keyEntities: narrative.keyEntities,
      sourceRunId: narrative.runId,
      sourceNarrativeId: narrative.id,
    }));
  }

  const result = await client.query<StoredNarrativeSourceRow>(`
    SELECT DISTINCT ON (canonical_id)
      id,
      run_id,
      canonical_id,
      canonical_name,
      summary,
      key_entities_json
    FROM public.ai_narratives
    WHERE COALESCE(trim(canonical_id), '') <> ''
      AND COALESCE(trim(canonical_name), '') <> ''
    ORDER BY canonical_id ASC, updated_at DESC, id DESC
  `);

  return result.rows.map((row) => ({
    topicKey: row.canonical_id,
    topicLabel: row.canonical_name,
    summary: row.summary,
    keyEntities: asStringArray(row.key_entities_json),
    sourceRunId: asCount(row.run_id),
    sourceNarrativeId: asCount(row.id),
  }));
}

async function readCount(client: Client, sql: string) {
  const result = await client.query<CountRow>(sql);
  return asCount(result.rows[0]?.count ?? 0);
}

async function main() {
  loadRepoEnv();
  const args = parseArgs(process.argv);
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL. Load .env.local or .env before running the backfill.");
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  await client.connect();

  try {
    const schemaStatus = await ensureTrendDexMatchTable(client);
    const sourceNarratives = await fetchStoredNarratives(client, args.boardOnly);
    if (sourceNarratives.length === 0) {
      throw new Error("No stored ai_narratives were found to backfill.");
    }

    const requestedTopic = normalizeText(args.topic);
    const focusTopic =
      sourceNarratives.find((narrative) => normalizeText(narrative.topicKey) === requestedTopic) ??
      sourceNarratives.find((narrative) => normalizeText(narrative.topicLabel) === requestedTopic) ??
      sourceNarratives.find((narrative) => narrative.topicKey === "portland-frog") ??
      sourceNarratives[0];

    const refreshResult = await refreshStoredTrendDexscreenerMatches({
      narratives: sourceNarratives,
      force: true,
    });

    const aiNarrativesCount = await readCount(client, "SELECT COUNT(*)::int AS count FROM public.ai_narratives");
    const storedMatchCount = await readCount(
      client,
      "SELECT COUNT(*)::int AS count FROM public.trend_dexscreener_matches",
    );
    const topicCountsResult = await client.query<TopicCountRow>(`
      SELECT topic_key, COUNT(*)::int AS count
      FROM public.trend_dexscreener_matches
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC
    `);
    const focusAiNarratives = await client.query(
      `
        SELECT id, run_id, canonical_id, canonical_name, updated_at
        FROM public.ai_narratives
        WHERE canonical_id = $1
        ORDER BY updated_at DESC, id DESC
      `,
      [focusTopic.topicKey],
    );
    const focusStoredMatches = await client.query(
      `
        SELECT topic_key, rank, chain_id, coin_symbol, coin_name, coin_address, pair_address, dexscreener_url
        FROM public.trend_dexscreener_matches
        WHERE topic_key = $1
        ORDER BY rank ASC, id ASC
      `,
      [focusTopic.topicKey],
    );

    const state = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "posts",
      mode: "established",
      selectedId: focusTopic.topicKey,
    });
    const selectedTrend =
      state.leaderboard.find((trend) => trend.id === focusTopic.topicKey) ??
      state.leaderboards.established.find((trend) => trend.id === focusTopic.topicKey) ??
      null;
    const marketBoard = await fetchLatestCorrelatedMemecoinBoard();
    const correlatedBoard = marketBoard
      ? buildStrictTrendsPageCorrelatedBoard(state, marketBoard)
      : null;
    const selectorDatasets = buildTrendsPageMemecoinDatasets({
      selectedTrend,
      trends: state.leaderboard,
      correlatedRows: correlatedBoard?.rows ?? [],
      marketRows: marketBoard?.rows ?? [],
    });

    const focusDiagnostics =
      refreshResult.topicDiagnostics.find((entry) => entry.topicKey === focusTopic.topicKey) ?? null;

    process.stdout.write(
      `${JSON.stringify(
        {
          schemaStatus,
          sourceNarrativeCount: sourceNarratives.length,
          sourceMode: args.boardOnly ? "latest_board" : "all_stored_ai_narratives",
          refreshResult,
          counts: {
            aiNarratives: aiNarrativesCount,
            trendDexscreenerMatches: storedMatchCount,
            byTopic: topicCountsResult.rows.map((row) => ({
              topicKey: row.topic_key,
              count: asCount(row.count),
            })),
          },
          focusTopic: {
            topicKey: focusTopic.topicKey,
            topicLabel: focusTopic.topicLabel,
            aiNarratives: focusAiNarratives.rows,
            storedMatches: focusStoredMatches.rows,
            refreshDiagnostics: focusDiagnostics,
            serviceLinkedCoinCount: selectedTrend?.linkedCoins?.length ?? 0,
            selectorTrendRowCount: selectorDatasets.trendRows.length,
            selectorAllRowCount: selectorDatasets.allRows.length,
            selectorTrendTopRows: selectorDatasets.trendRows.slice(0, 5).map((entry) => ({
              symbol: entry.row.symbol,
              name: entry.row.name,
              tokenAddress: entry.row.tokenAddress,
              pairAddress: entry.row.pairAddress,
              dexscreenerUrl: entry.row.dexscreenerUrl,
              confidenceScore: entry.confidenceScore,
            })),
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[trend-dex-matches-backfill] failed", error);
  process.exit(1);
});
