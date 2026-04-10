const DEFAULT_BASE_URL = process.env.DASHBOARD_BASE_URL || "http://localhost:3000";
const DEFAULT_SCOPE = "overall";
const DEFAULT_RANGE = "24h";
const DEFAULT_MODE = "established";
const DEFAULT_SORT = "attention";
const POLL_INTERVAL_MS = 2_000;
const MAX_WAIT_MS = 60 * 60_000;

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    scope: DEFAULT_SCOPE,
    range: DEFAULT_RANGE,
    mode: DEFAULT_MODE,
    sort: DEFAULT_SORT,
    timeoutMs: MAX_WAIT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (!token.startsWith("--")) {
      continue;
    }

    if (token === "--base-url" && next) {
      args.baseUrl = next;
      index += 1;
      continue;
    }

    if (token === "--scope" && next) {
      args.scope = next;
      index += 1;
      continue;
    }

    if (token === "--range" && next) {
      args.range = next;
      index += 1;
      continue;
    }

    if (token === "--mode" && next) {
      args.mode = next;
      index += 1;
      continue;
    }

    if (token === "--sort" && next) {
      args.sort = next;
      index += 1;
      continue;
    }

    if (token === "--timeout-ms" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.timeoutMs = parsed;
      }
      index += 1;
    }
  }

  return args;
}

function buildRefreshUrl(args) {
  const url = new URL("/api/dashboard/trends/refresh", args.baseUrl);
  url.searchParams.set("mode", "manual_full_regroup");
  url.searchParams.set("trigger", "manual-full-regroup");
  url.searchParams.set("force", "true");
  url.searchParams.set("scope", args.scope);
  url.searchParams.set("range", args.range);
  return url;
}

function buildDashboardUrl(args) {
  const url = new URL("/api/dashboard/trends", args.baseUrl);
  url.searchParams.set("scope", args.scope);
  url.searchParams.set("range", args.range);
  url.searchParams.set("mode", args.mode);
  url.searchParams.set("sort", args.sort);
  return url;
}

async function readJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options?.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`request to ${url} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeLeaderboardRows(rows) {
  return rows.slice(0, 20).map((row, index) => ({
    rank: index + 1,
    id: row.id,
    name: row.name,
    labelType: row.labelType ?? null,
    groupingSource: row.groupingSource ?? null,
    leaderboardTier: row.leaderboardTier ?? null,
    aiAssisted: row.aiAssisted ?? null,
    isSingleton: row.isSingleton ?? null,
    rootsCount24h: row.rootsCount24h ?? null,
    totalInteractions24h: row.totalInteractions24h ?? row.attentionInteractions ?? null,
    lowInformation: row.lowInformation ?? null,
    lowQualityLabel: row.lowQualityLabel ?? null,
    templateSeries: row.templateSeries ?? null,
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const refreshUrl = buildRefreshUrl(args);
  const dashboardUrl = buildDashboardUrl(args);

  console.log(
    JSON.stringify(
      {
        action: "manual_full_regroup",
        refreshUrl: refreshUrl.toString(),
        dashboardUrl: dashboardUrl.toString(),
      },
      null,
      2,
    ),
  );

  await readJson(refreshUrl, {
    method: "POST",
  });

  const startedAt = Date.now();
  let refreshState = null;
  while (Date.now() - startedAt < args.timeoutMs) {
    refreshState = await readJson(new URL("/api/dashboard/trends/refresh", args.baseUrl));
    if (refreshState?.status === "succeeded") {
      break;
    }
    if (refreshState?.status === "failed") {
      throw new Error(`manual full regroup failed: ${refreshState.lastError ?? "unknown error"}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (refreshState?.status !== "succeeded") {
    throw new Error(`manual full regroup timed out after ${args.timeoutMs}ms`);
  }

  const dashboard = await readJson(dashboardUrl);
  const summary = {
    refreshState,
    dataStatus: dashboard.dataStatus ?? null,
    trendCoverage: dashboard.trendCoverage ?? null,
    top20: summarizeLeaderboardRows(dashboard.leaderboard ?? []),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
