import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_PATH = path.resolve(process.cwd(), "runtime/dashboard-api-response.json");
const BASE_DASHBOARD_FIXTURE = JSON.parse(
  readFileSync(FIXTURE_PATH, "utf8").replace(/^\uFEFF/, ""),
) as Record<string, unknown>;

const DESKTOP_VIEWPORTS = [
  { width: 1280, height: 840 },
  { width: 1440, height: 960 },
] as const;

type DashboardFixture = Record<string, unknown> & {
  leaderboard?: Record<string, unknown>[];
  query?: Record<string, unknown>;
  leaderboards?: Record<string, unknown>;
  detail?: unknown;
  overviewSeries?: unknown[];
  trendCoverage?: unknown;
  marketMemecoins?: unknown;
  correlatedMemecoins?: unknown;
};

type TrendWorkspaceSnapshot = {
  columnCount: number;
  sameRow: boolean;
  centerWidest: boolean;
  liveStripHeight: number;
  workspaceHeight: number;
  panelWidths: {
    signals: number;
    memecoins: number;
    validation: number;
  };
  panelHeights: {
    signals: number;
    memecoins: number;
    validation: number;
  };
};

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildTrend(template: Record<string, unknown>, overrides: Record<string, unknown>) {
  return {
    ...template,
    topPosts: Array.isArray(template.topPosts) ? template.topPosts : [],
    platforms: Array.isArray(template.platforms) ? template.platforms : ["bluesky", "reddit", "youtube"],
    platformSpread: 3,
    confirmedPlatformSpread: 3,
    totalInteractions24h: 18_600,
    attentionInteractions: 18_600,
    confidenceScore: 88,
    trendStrengthScore: 84,
    freshnessScore: 70,
    persistenceScore: 76,
    velocityScore: 81,
    lifecycleStage: "Expanding",
    freshnessState: "mixed",
    lowDataWarning: false,
    ...overrides,
  };
}

function buildDashboardPayload() {
  const fixture = cloneFixture(BASE_DASHBOARD_FIXTURE) as DashboardFixture;
  const templateRow = (fixture.leaderboard?.[0] ?? {}) as Record<string, unknown>;
  const selectedId = "trend-pepe-rotation";
  const primaryTrend = buildTrend(templateRow, {
    id: selectedId,
    rank: 1,
    name: "Pepe Rotation Into Solana Memecoin Beta",
    displayName: "Pepe Rotation Into Solana Memecoin Beta",
    nameStatus: "ready",
    nameSource: "ai_exact",
    trendRawLabel: "pepe rotation into solana memecoin beta",
    canonicalKeySummary: "pepe rotation into solana memecoin beta",
    clusterName: "pepe rotation into solana memecoin beta",
    trendNarrativeSummary:
      "Traders are rotating into pepe, bonk, and solana meme beta as the strongest risk-on proxy.",
    trendContextParagraph:
      "Posts tie pepe and bonk to broader solana memecoin momentum and recurring viral flow.",
    trendKeyEntities: ["Pepe", "Bonk", "Solana", "frog"],
    lastSeenAt: "2026-04-01T10:05:00.000Z",
  }) as Record<string, unknown>;
  const secondaryTrend = buildTrend(templateRow, {
    id: "trend-maga",
    rank: 2,
    name: "MAGA Election Momentum Narrative",
    displayName: "MAGA Election Momentum Narrative",
    nameStatus: "ready",
    nameSource: "ai_exact",
    trendRawLabel: "maga election momentum narrative",
    canonicalKeySummary: "maga election momentum narrative",
    clusterName: "maga election momentum narrative",
    trendNarrativeSummary:
      "MAGA and Trump mentions are accelerating as election chatter spills into meme markets.",
    trendContextParagraph:
      "The cluster repeatedly references Trump, MAGA, and campaign meme positioning.",
    trendKeyEntities: ["Trump", "MAGA", "Election"],
    lastSeenAt: "2026-04-01T09:58:00.000Z",
  }) as Record<string, unknown>;
  const remainingRows = (fixture.leaderboard ?? []).slice(2, 18).map((row: Record<string, unknown>, index: number) =>
    buildTrend(row, {
      rank: index + 3,
    }),
  );
  const leaderboard = [primaryTrend, secondaryTrend, ...remainingRows];

  fixture.query = {
    ...(fixture.query ?? {}),
    scope: "overall",
    range: "24h",
    mode: "established",
    sort: "attention",
    selectedId,
  };
  fixture.leaderboard = leaderboard;
  fixture.leaderboards = {
    established: leaderboard,
    emerging: [],
  };
  fixture.detail = null;
  fixture.overviewSeries = [];
  fixture.trendCoverage = null;
  fixture.correlatedMemecoins = {
    runId: 101,
    updatedAt: "2026-04-01T10:07:00.000Z",
    rows: [
      {
        id: "solana:frog-token:frog-pair",
        rank: 1,
        chainId: "solana",
        chainLabel: "Solana",
        tokenAddress: "frog-token",
        pairAddress: "frog-pair",
        name: "Frog CTO",
        symbol: "FROG",
        quoteSymbol: "USDC",
        strongestTrendKey: primaryTrend.canonicalKeySummary,
        strongestTrendLabel: primaryTrend.name,
        strongestTrendCategory: "meme",
        strongestTrendSummary: primaryTrend.trendNarrativeSummary,
        correlationScore: 91,
        correlationLabel: "High",
        marketScore: 78,
        liquidityUsd: 252000,
        volume24hUsd: 1510000,
        volume6hUsd: 480000,
        volume1hUsd: 92000,
        priceUsd: 0.0012,
        priceChange1hPct: 4.5,
        priceChange6hPct: 12.4,
        priceChange24hPct: 22.5,
        pairAgeHours: 72,
        fdvUsd: 9200000,
        marketCapUsd: 9100000,
        txns24h: 5180,
        memecoinFitScore: 75,
        seedTerms: ["frog", "solana"],
        matchedTrendKeys: [primaryTrend.canonicalKeySummary],
        iconUrl: "https://example.com/frog.png",
        websites: [{ label: "Website", url: "https://frog.example" }],
        socials: [{ type: "twitter", url: "https://x.com/frogcto" }],
        links: [
          {
            topicKey: primaryTrend.canonicalKeySummary,
            topicLabel: primaryTrend.name,
            trendCategory: "meme",
            narrativeSummary: primaryTrend.trendNarrativeSummary,
            lexicalScore: 18,
            mentionScore: 8,
            timingScore: 9,
            cultureFitScore: 8,
            linkScore: 38,
            supportPostCount: 3,
            supportInteractionScore: 14,
            isPrimary: true,
          },
        ],
        dexscreenerUrl: "https://dexscreener.com/solana/frog-pair",
        updatedAt: "2026-04-01T10:07:00.000Z",
      },
      {
        id: "solana:trump-token:trump-pair",
        rank: 2,
        chainId: "solana",
        chainLabel: "Solana",
        tokenAddress: "trump-token",
        pairAddress: "trump-pair",
        name: "Trump Coin",
        symbol: "TRUMP",
        quoteSymbol: "USDC",
        strongestTrendKey: secondaryTrend.canonicalKeySummary,
        strongestTrendLabel: secondaryTrend.name,
        strongestTrendCategory: "politics",
        strongestTrendSummary: secondaryTrend.trendNarrativeSummary,
        correlationScore: 76,
        correlationLabel: "Medium",
        marketScore: 68,
        liquidityUsd: 241000,
        volume24hUsd: 630000,
        volume6hUsd: 182000,
        volume1hUsd: 34000,
        priceUsd: 0.0048,
        priceChange1hPct: 1.1,
        priceChange6hPct: 7.3,
        priceChange24hPct: 11.2,
        pairAgeHours: 54,
        fdvUsd: 11400000,
        marketCapUsd: 10800000,
        txns24h: 3120,
        memecoinFitScore: 66,
        seedTerms: ["trump", "maga"],
        matchedTrendKeys: [secondaryTrend.canonicalKeySummary],
        links: [
          {
            topicKey: secondaryTrend.canonicalKeySummary,
            topicLabel: secondaryTrend.name,
            trendCategory: "politics",
            narrativeSummary: secondaryTrend.trendNarrativeSummary,
            lexicalScore: 16,
            mentionScore: 6,
            timingScore: 7,
            cultureFitScore: 4,
            linkScore: 30,
            supportPostCount: 2,
            supportInteractionScore: 11,
            isPrimary: true,
          },
        ],
        dexscreenerUrl: "https://dexscreener.com/solana/trump-pair",
        updatedAt: "2026-04-01T10:07:00.000Z",
      },
      {
        id: "solana:anime-token:anime-pair",
        rank: 3,
        chainId: "solana",
        chainLabel: "Solana",
        tokenAddress: "anime-token",
        pairAddress: "anime-pair",
        name: "Anime Velocity",
        symbol: "ANIME",
        quoteSymbol: "USDC",
        strongestTrendKey: primaryTrend.canonicalKeySummary,
        strongestTrendLabel: primaryTrend.name,
        strongestTrendCategory: "internet_culture",
        strongestTrendSummary: "Anime clip accounts are driving faster meme redistribution.",
        correlationScore: 82,
        correlationLabel: "High",
        marketScore: 61,
        liquidityUsd: 82000,
        volume24hUsd: 140000,
        volume6hUsd: 43000,
        volume1hUsd: 12000,
        priceUsd: 0.00042,
        priceChange1hPct: -1.4,
        priceChange6hPct: -2.8,
        priceChange24hPct: -4.7,
        pairAgeHours: 28,
        fdvUsd: 5400000,
        marketCapUsd: 5200000,
        txns24h: 1120,
        memecoinFitScore: 71,
        seedTerms: ["anime", "velocity"],
        matchedTrendKeys: [primaryTrend.canonicalKeySummary],
        links: [
          {
            topicKey: primaryTrend.canonicalKeySummary,
            topicLabel: primaryTrend.name,
            trendCategory: "internet_culture",
            narrativeSummary: "Anime clip accounts are driving faster meme redistribution.",
            lexicalScore: 13,
            mentionScore: 5,
            timingScore: 6,
            cultureFitScore: 7,
            linkScore: 24,
            supportPostCount: 1,
            supportInteractionScore: 7,
            isPrimary: true,
          },
        ],
        dexscreenerUrl: "https://dexscreener.com/solana/anime-pair",
        updatedAt: "2026-04-01T10:07:00.000Z",
      },
    ],
  };
  fixture.marketMemecoins = {
    ...(fixture.correlatedMemecoins as Record<string, unknown>),
    rows: [
      ...((fixture.correlatedMemecoins as { rows?: unknown[] }).rows ?? []),
      {
        id: "solana:speed-token:speed-pair",
        rank: 4,
        chainId: "solana",
        chainLabel: "Solana",
        tokenAddress: "speed-token",
        pairAddress: "speed-pair",
        name: "Speed Dog",
        symbol: "SPEED",
        quoteSymbol: "USDC",
        strongestTrendKey: "unlinked-speed",
        strongestTrendLabel: "Unlinked Speed",
        strongestTrendCategory: "meme",
        strongestTrendSummary: "Momentum-only market row",
        correlationScore: 41,
        correlationLabel: "Low",
        marketScore: 82,
        liquidityUsd: 310000,
        volume24hUsd: 1800000,
        volume6hUsd: 620000,
        volume1hUsd: 220000,
        priceUsd: 0.0021,
        priceChange1hPct: 6.1,
        priceChange6hPct: 19.4,
        priceChange24hPct: 29.8,
        pairAgeHours: 36,
        fdvUsd: 6100000,
        marketCapUsd: 5900000,
        txns24h: 6120,
        txns6h: 1700,
        txns1h: 420,
        momentumScore: 88,
        momentumRank: 1,
        memecoinFitScore: 63,
        seedTerms: ["speed"],
        matchedTrendKeys: [],
        links: [],
        dexscreenerUrl: "https://dexscreener.com/solana/speed-pair",
        updatedAt: "2026-04-01T10:07:00.000Z",
      },
    ],
  };

  return fixture;
}

async function readTrendWorkspaceSnapshot(page: Page) {
  return page.evaluate((): TrendWorkspaceSnapshot | null => {
    const workspace = document.querySelector('[data-testid="trend-main-workspace"]') as HTMLElement | null;
    const liveStrip = document.querySelector('[data-testid="trend-live-strip"]') as HTMLElement | null;
    const signals = document.querySelector("#signals") as HTMLElement | null;
    const memecoins = document.querySelector("#memecoins") as HTMLElement | null;
    const validation = document.querySelector("#validation") as HTMLElement | null;

    if (!workspace || !liveStrip || !signals || !memecoins || !validation) {
      return null;
    }

    const workspaceRect = workspace.getBoundingClientRect();
    const signalsRect = signals.getBoundingClientRect();
    const memecoinsRect = memecoins.getBoundingClientRect();
    const validationRect = validation.getBoundingClientRect();
    const styles = window.getComputedStyle(workspace);

    return {
      columnCount: styles.gridTemplateColumns.split(" ").filter(Boolean).length,
      sameRow:
        Math.abs(Math.round(signalsRect.top) - Math.round(memecoinsRect.top)) <= 2 &&
        Math.abs(Math.round(memecoinsRect.top) - Math.round(validationRect.top)) <= 2,
      centerWidest: memecoinsRect.width > signalsRect.width && memecoinsRect.width > validationRect.width,
      liveStripHeight: Math.round(liveStrip.getBoundingClientRect().height),
      workspaceHeight: Math.round(workspaceRect.height),
      panelWidths: {
        signals: Math.round(signalsRect.width),
        memecoins: Math.round(memecoinsRect.width),
        validation: Math.round(validationRect.width),
      },
      panelHeights: {
        signals: Math.round(signalsRect.height),
        memecoins: Math.round(memecoinsRect.height),
        validation: Math.round(validationRect.height),
      },
    };
  });
}

async function mockDashboardRoute(
  page: Page,
  options?: {
    previewMode?: "dexscreener" | "tradingview" | "unavailable";
    previewSymbol?: string;
    responseDelayMs?: number;
  },
) {
  const previewMode = options?.previewMode ?? "dexscreener";
  const previewSymbol = options?.previewSymbol ?? "NASDAQ:AAPL";
  const responseDelayMs = options?.responseDelayMs ?? 0;
  const requestedViews: string[] = [];
  const payload = buildDashboardPayload();

  await page.route("**/api/dashboard/trends?**", async (route) => {
    const view = new URL(route.request().url()).searchParams.get("view") ?? "summary";
    requestedViews.push(view);
    if (responseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
    }

    const responseBody =
      view === "status"
        ? {
            items: [
              { label: "Active narratives", value: "18", tone: "neutral" },
              { label: "Avg confidence", value: "88%", tone: "neutral" },
              { label: "Last update", value: "now", tone: "neutral" },
              { label: "Status", value: "Live", tone: "green" },
            ],
            systemDetails: [
              { label: "Source links", value: "54", tone: "neutral" },
              { label: "Evidence rows", value: "126", tone: "neutral" },
              { label: "New narratives", value: "2", tone: "amber" },
              { label: "Last attempt", value: "1m", tone: "neutral" },
              { label: "Run state", value: "Running", tone: "neutral" },
              { label: "Trigger", value: "Railway hourly worker", tone: "neutral" },
              {
                label: "Scheduler",
                value: "Railway hourly worker",
                tone: "neutral",
              },
              {
                label: "Runtime",
                value: "Railway hourly daemon",
                tone: "neutral",
              },
            ],
            dataStatus: (payload as DashboardFixture).dataStatus ?? null,
          }
        : view === "memecoins"
          ? {
              marketMemecoins: (payload as DashboardFixture).marketMemecoins ?? null,
              correlatedMemecoins: (payload as DashboardFixture).correlatedMemecoins ?? null,
              dataStatus: (payload as DashboardFixture).dataStatus ?? null,
            }
          : {
              query: (payload as DashboardFixture).query,
              leaderboard: (payload as DashboardFixture).leaderboard,
              dataStatus: (payload as DashboardFixture).dataStatus ?? null,
            };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "X-Dashboard-Api-Response-At": "2026-04-01T10:09:10.121Z",
      },
      body: JSON.stringify(responseBody),
    });
  });

  await page.route("**/api/dashboard/memecoin-preview?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const symbol = requestUrl.searchParams.get("symbol") ?? "UNKNOWN";
    const quoteSymbol = requestUrl.searchParams.get("quoteSymbol");
    const pairLabel = quoteSymbol ? `${symbol}/${quoteSymbol}` : symbol;
    const payload =
      previewMode === "tradingview"
        ? {
            status: "tradingview",
            provider: "tradingview",
            displayMode: "tradingview_chart",
            tradingviewSymbol: previewSymbol,
            dexUrl:
              requestUrl.searchParams.get("dexscreenerUrl") ??
              `https://dexscreener.com/${requestUrl.searchParams.get("chainId") ?? "solana"}/${requestUrl.searchParams.get("pairAddress") ?? "pair"}`,
            dexscreenerEmbedUrl:
              requestUrl.searchParams.get("dexscreenerUrl") ??
              `https://dexscreener.com/${requestUrl.searchParams.get("chainId") ?? "solana"}/${requestUrl.searchParams.get("pairAddress") ?? "pair"}`,
            snapshotImageUrl: null,
            snapshotAlt: null,
            sparklinePoints: null,
            sparklineSource: null,
            failureCode: null,
            failureDetail: null,
            resolutionSource: "stored_symbol",
            debug: {
              coinId: requestUrl.searchParams.get("coinId") ?? "unknown-coin",
              chainId: requestUrl.searchParams.get("chainId"),
              dexId: requestUrl.searchParams.get("dexId"),
              pairAddress: requestUrl.searchParams.get("pairAddress"),
              tokenAddress: requestUrl.searchParams.get("tokenAddress"),
              pairUrl: requestUrl.searchParams.get("dexscreenerUrl"),
              baseTokenSymbol: symbol,
              quoteTokenSymbol: quoteSymbol,
              symbolTextShownInUi: pairLabel,
              symbolPassedToChartWidget: previewSymbol,
              previewProviderSelected: "tradingview",
              displayMode: "tradingview_chart",
              resolutionSource: "stored_symbol",
              failureReason: null,
              failureDetail: null,
              fallbackTriggeredBeforeMountCompleted: false,
              storedTradingviewSymbol: previewSymbol,
              snapshotImageUrl: null,
              dexscreenerEmbedUrl:
                requestUrl.searchParams.get("dexscreenerUrl") ??
                `https://dexscreener.com/${requestUrl.searchParams.get("chainId") ?? "solana"}/${requestUrl.searchParams.get("pairAddress") ?? "pair"}`,
              sparklinePointCount: 0,
              sparklineSource: null,
              pairLookupSource: "input_only",
              pairLookupFailureCode: null,
              pairLookupFailureDetail: null,
              pairLabels: requestUrl.searchParams.getAll("pairLabel"),
              pairRanking: [],
              candidateSymbolsTried: [],
              candidateValidation: [],
              commonCandidateRejectionReason: null,
              availablePreviewModes: ["tradingview"],
              resolutionNotes: [],
            },
          }
        : previewMode === "dexscreener"
          ? {
              status: "dexscreener",
              provider: "dexscreener",
              displayMode: "dexscreener_link",
              tradingviewSymbol: null,
              dexUrl:
                requestUrl.searchParams.get("dexscreenerUrl") ??
                `https://dexscreener.com/${requestUrl.searchParams.get("chainId") ?? "solana"}/${requestUrl.searchParams.get("pairAddress") ?? "pair"}`,
              dexscreenerEmbedUrl:
                requestUrl.searchParams.get("dexscreenerUrl") ??
                `https://dexscreener.com/${requestUrl.searchParams.get("chainId") ?? "solana"}/${requestUrl.searchParams.get("pairAddress") ?? "pair"}`,
              snapshotImageUrl: null,
              snapshotAlt: null,
              sparklinePoints: null,
              sparklineSource: null,
              failureCode: "tradingview_symbol_unavailable",
              failureDetail: `TradingView did not return a compatible market symbol for ${pairLabel}.`,
              resolutionSource: null,
              debug: {
                coinId: requestUrl.searchParams.get("coinId") ?? "unknown-coin",
                chainId: requestUrl.searchParams.get("chainId"),
                dexId: requestUrl.searchParams.get("dexId"),
                pairAddress: requestUrl.searchParams.get("pairAddress"),
                tokenAddress: requestUrl.searchParams.get("tokenAddress"),
                pairUrl: requestUrl.searchParams.get("dexscreenerUrl"),
                baseTokenSymbol: symbol,
                quoteTokenSymbol: quoteSymbol,
                symbolTextShownInUi: pairLabel,
                symbolPassedToChartWidget: null,
                previewProviderSelected: "dexscreener",
                displayMode: "dexscreener_link",
                resolutionSource: null,
                failureReason: "tradingview_symbol_unavailable",
                failureDetail: `TradingView did not return a compatible market symbol for ${pairLabel}.`,
                fallbackTriggeredBeforeMountCompleted: false,
                storedTradingviewSymbol: requestUrl.searchParams.get("tradingviewSymbol"),
                snapshotImageUrl: null,
                dexscreenerEmbedUrl:
                  requestUrl.searchParams.get("dexscreenerUrl") ??
                  `https://dexscreener.com/${requestUrl.searchParams.get("chainId") ?? "solana"}/${requestUrl.searchParams.get("pairAddress") ?? "pair"}`,
                sparklinePointCount: 0,
                sparklineSource: null,
                pairLookupSource: "pair_address",
                pairLookupFailureCode: null,
                pairLookupFailureDetail: null,
                pairLabels: requestUrl.searchParams.getAll("pairLabel"),
                pairRanking: [],
                candidateSymbolsTried: [],
                candidateValidation: [],
                commonCandidateRejectionReason: null,
                availablePreviewModes: ["dexscreener"],
                resolutionNotes: [],
              },
            }
        : {
            status: "unavailable",
            provider: "unavailable",
            displayMode: "unavailable",
            tradingviewSymbol: null,
            dexUrl:
              requestUrl.searchParams.get("dexscreenerUrl") ??
              `https://dexscreener.com/${requestUrl.searchParams.get("chainId") ?? "solana"}/${requestUrl.searchParams.get("pairAddress") ?? "pair"}`,
            dexscreenerEmbedUrl:
              requestUrl.searchParams.get("dexscreenerUrl") ??
              `https://dexscreener.com/${requestUrl.searchParams.get("chainId") ?? "solana"}/${requestUrl.searchParams.get("pairAddress") ?? "pair"}`,
            snapshotImageUrl: null,
            snapshotAlt: null,
            sparklinePoints: null,
            sparklineSource: null,
            failureCode: "tradingview_symbol_unavailable",
            failureDetail: `TradingView did not return a compatible market symbol for ${pairLabel}.`,
            resolutionSource: null,
            debug: {
              coinId: requestUrl.searchParams.get("coinId") ?? "unknown-coin",
              chainId: requestUrl.searchParams.get("chainId"),
              dexId: requestUrl.searchParams.get("dexId"),
              pairAddress: requestUrl.searchParams.get("pairAddress"),
              tokenAddress: requestUrl.searchParams.get("tokenAddress"),
              pairUrl: requestUrl.searchParams.get("dexscreenerUrl"),
              baseTokenSymbol: symbol,
              quoteTokenSymbol: quoteSymbol,
              symbolTextShownInUi: pairLabel,
              symbolPassedToChartWidget: null,
              previewProviderSelected: "unavailable",
              displayMode: "unavailable",
              resolutionSource: null,
              failureReason: "tradingview_symbol_unavailable",
              failureDetail: `TradingView did not return a compatible market symbol for ${pairLabel}.`,
              fallbackTriggeredBeforeMountCompleted: false,
              storedTradingviewSymbol: requestUrl.searchParams.get("tradingviewSymbol"),
              snapshotImageUrl: null,
              dexscreenerEmbedUrl:
                requestUrl.searchParams.get("dexscreenerUrl") ??
                `https://dexscreener.com/${requestUrl.searchParams.get("chainId") ?? "solana"}/${requestUrl.searchParams.get("pairAddress") ?? "pair"}`,
              sparklinePointCount: 0,
              sparklineSource: null,
              pairLookupSource: "pair_address",
              pairLookupFailureCode: null,
              pairLookupFailureDetail: null,
              pairLabels: requestUrl.searchParams.getAll("pairLabel"),
              pairRanking: [],
              candidateSymbolsTried: [],
              candidateValidation: [],
              commonCandidateRejectionReason: null,
              availablePreviewModes: ["unavailable"],
              resolutionNotes: [],
            },
          };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  return requestedViews;
}

async function mockTradingViewEmbedScript(page: Page) {
  await page.route("https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        (function () {
          const currentScript = document.currentScript;
          const parent = currentScript && currentScript.parentElement;
          if (!parent) return;
          const wrapper = document.createElement('div');
          wrapper.style.width = '100%';
          wrapper.style.height = '100%';
          const iframe = document.createElement('iframe');
          iframe.setAttribute('src', 'about:blank');
          iframe.setAttribute('frameborder', '0');
          wrapper.appendChild(iframe);
          parent.appendChild(wrapper);
        })();
      `,
    });
  });
}

test("status strip replaces cards with compact terminal metrics", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockDashboardRoute(page);

  await page.goto("/trends", { waitUntil: "networkidle" });

  const liveStrip = page.getByTestId("trend-live-strip");
  await expect(liveStrip).toBeVisible();
  await expect(liveStrip.getByTestId("trend-live-strip-item")).toHaveCount(4);
  await expect(liveStrip).toContainText("Avg confidence");
  await expect(liveStrip).toContainText("Status");
  await expect(liveStrip).not.toContainText("Linked memecoins");
  await expect(liveStrip).not.toContainText("Trigger");
  await expect(page.getByTestId("trend-summary-cards")).toHaveCount(0);
});

for (const viewport of DESKTOP_VIEWPORTS) {
  test(`workspace keeps a three-pane terminal layout at ${viewport.width}px`, async ({ page }) => {
    const requestedViews = await mockDashboardRoute(page);

    await page.setViewportSize(viewport);
    await page.goto("/trends", { waitUntil: "networkidle" });

    const workspace = page.getByTestId("trend-main-workspace");
    await expect(workspace.getByText("Narratives", { exact: true })).toBeVisible();
    await expect(workspace.getByText("Memecoins", { exact: true })).toBeVisible();
    await expect(workspace.getByText("Validation", { exact: true })).toBeVisible();

    const structure = await workspace.evaluate((node) => {
      const signals = node.querySelector<HTMLElement>("#signals");
      const memecoins = node.querySelector<HTMLElement>("#memecoins");
      const validation = node.querySelector<HTMLElement>("#validation");

      if (!signals || !memecoins || !validation) {
        return null;
      }

      const signalsRect = signals.getBoundingClientRect();
      const memecoinsRect = memecoins.getBoundingClientRect();
      const validationRect = validation.getBoundingClientRect();
      const styles = window.getComputedStyle(node as HTMLElement);

      return {
        columnCount: styles.gridTemplateColumns.split(" ").filter(Boolean).length,
        sameRow:
          Math.abs(Math.round(signalsRect.top) - Math.round(memecoinsRect.top)) <= 2 &&
          Math.abs(Math.round(memecoinsRect.top) - Math.round(validationRect.top)) <= 2,
        centerWidest: memecoinsRect.width > signalsRect.width && memecoinsRect.width > validationRect.width,
      };
    });

    expect(structure).not.toBeNull();
    expect(structure?.columnCount).toBeGreaterThanOrEqual(3);
    expect(structure?.sameRow).toBe(true);
    expect(structure?.centerWidest).toBe(true);
    expect(new Set(requestedViews)).toEqual(new Set(["status", "summary", "memecoins"]));
  });
}

test("loading shell mirrors the loaded three-pane trends workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockDashboardRoute(page, { responseDelayMs: 1200 });

  await page.goto("/trends", { waitUntil: "domcontentloaded" });

  const workspace = page.getByTestId("trend-main-workspace");

  await expect(page.getByTestId("trend-live-strip")).toBeVisible();
  await expect(page.getByTestId("trend-live-strip-item")).toHaveCount(4);
  await expect(workspace.getByText("Narratives", { exact: true })).toBeVisible();
  await expect(workspace.getByText("Memecoins", { exact: true })).toBeVisible();
  await expect(workspace.getByText("Validation", { exact: true })).toBeVisible();
  await expect(page.getByTestId("trend-loading-search")).toBeVisible();
  await expect(page.getByRole("button", { name: "Trend" })).toHaveCount(0);
  await expect(page.locator("#memecoins").getByText("Trend", { exact: true })).toBeVisible();
  await expect(page.locator("#memecoins").getByText("All", { exact: true })).toBeVisible();
  await expect(page.locator("#memecoins").getByText("Momentum", { exact: true })).toBeVisible();
  await expect(page.getByTestId("narrative-table-scroller")).toBeVisible();
  await expect(page.getByTestId("memecoin-table-scroller")).toBeVisible();
  await expect(page.getByTestId("selected-coin-panel")).toBeVisible();

  const loadingSnapshot = await readTrendWorkspaceSnapshot(page);

  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("narrative-row").first()).toBeVisible();

  const loadedSnapshot = await readTrendWorkspaceSnapshot(page);

  expect(loadingSnapshot).not.toBeNull();
  expect(loadedSnapshot).not.toBeNull();
  expect(loadingSnapshot?.columnCount).toBeGreaterThanOrEqual(3);
  expect(loadingSnapshot?.sameRow).toBe(true);
  expect(loadingSnapshot?.centerWidest).toBe(true);
  expect(loadedSnapshot?.columnCount).toBeGreaterThanOrEqual(3);
  expect(loadedSnapshot?.sameRow).toBe(true);
  expect(loadedSnapshot?.centerWidest).toBe(true);
  expect(Math.abs((loadingSnapshot?.liveStripHeight ?? 0) - (loadedSnapshot?.liveStripHeight ?? 0))).toBeLessThanOrEqual(4);
  expect(Math.abs((loadingSnapshot?.workspaceHeight ?? 0) - (loadedSnapshot?.workspaceHeight ?? 0))).toBeLessThanOrEqual(32);
  expect(Math.abs((loadingSnapshot?.panelWidths.signals ?? 0) - (loadedSnapshot?.panelWidths.signals ?? 0))).toBeLessThanOrEqual(8);
  expect(Math.abs((loadingSnapshot?.panelWidths.memecoins ?? 0) - (loadedSnapshot?.panelWidths.memecoins ?? 0))).toBeLessThanOrEqual(8);
  expect(Math.abs((loadingSnapshot?.panelWidths.validation ?? 0) - (loadedSnapshot?.panelWidths.validation ?? 0))).toBeLessThanOrEqual(8);
  expect(Math.abs((loadingSnapshot?.panelHeights.signals ?? 0) - (loadedSnapshot?.panelHeights.signals ?? 0))).toBeLessThanOrEqual(32);
  expect(Math.abs((loadingSnapshot?.panelHeights.memecoins ?? 0) - (loadedSnapshot?.panelHeights.memecoins ?? 0))).toBeLessThanOrEqual(32);
  expect(Math.abs((loadingSnapshot?.panelHeights.validation ?? 0) - (loadedSnapshot?.panelHeights.validation ?? 0))).toBeLessThanOrEqual(32);
});

test("clicking a narrative filters the memecoin table without opening a separate action panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockDashboardRoute(page);

  await page.goto("/trends", { waitUntil: "networkidle" });

  const marketTable = page.getByTestId("memecoin-market-table");
  await expect(marketTable).toContainText("Speed Dog");
  await expect(marketTable).toContainText("Frog CTO");
  await expect(marketTable).toContainText("Anime Velocity");
  await expect(marketTable).toContainText("Trump Coin");

  await marketTable.getByRole("button", { name: "Trend" }).click();
  await expect(marketTable).not.toContainText("Speed Dog");
  await expect(marketTable).not.toContainText("Trump Coin");

  await page.getByTestId("narrative-row").filter({ hasText: "MAGA Election Momentum Narrative" }).click();

  await expect(marketTable).toContainText("Trump Coin");
  await expect(marketTable).not.toContainText("Frog CTO");
  await expect(page.getByTestId("selected-coin-panel")).toContainText("Trump Coin");
});

test("momentum tab stays independent from trend selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockDashboardRoute(page);

  await page.goto("/trends", { waitUntil: "networkidle" });

  const marketTable = page.getByTestId("memecoin-market-table");
  await expect(marketTable).toContainText("Speed Dog");
  await expect(marketTable).toContainText("Frog CTO");
  await expect(marketTable).toContainText("Trump Coin");

  await page.getByTestId("narrative-row").filter({ hasText: "MAGA Election Momentum Narrative" }).click();

  await expect(marketTable).toContainText("Speed Dog");
  await expect(marketTable).toContainText("Frog CTO");
  await expect(marketTable).toContainText("Trump Coin");
});

test("clicking a coin updates the right-side validation pane and falls back to Dexscreener when tradingview is unavailable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockDashboardRoute(page);

  await page.goto("/trends", { waitUntil: "networkidle" });

  await page.getByTestId("memecoin-market-row").filter({ hasText: "Anime Velocity" }).click();

  const validationPane = page.getByTestId("selected-coin-panel");
  await expect(validationPane).toContainText("Anime Velocity");
  await expect(validationPane).toContainText("Dexscreener market preview");
  await expect(validationPane).toContainText("DEX");
  await expect(validationPane).toContainText("Open Dexscreener");
  await expect(validationPane).not.toContainText("Narrative Fit");
  await expect(validationPane).not.toContainText("Linked narrative");
  await expect(validationPane.getByTestId("selected-coin-link-score")).toHaveText("24");
  await expect(validationPane.getByTestId("selected-coin-support-posts")).toHaveText("1");
});

test("resolved TradingView previews pin the iframe to the preview box instead of flowing below it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockDashboardRoute(page, {
    previewMode: "tradingview",
    previewSymbol: "NASDAQ:AAPL",
  });
  await mockTradingViewEmbedScript(page);

  await page.goto("/trends", { waitUntil: "networkidle" });

  const layout = await page.getByTestId("tradingview-chart-preview").evaluate((node) => {
    const container = node as HTMLElement;
    const iframe = container.querySelector("iframe") as HTMLIFrameElement | null;
    const containerRect = container.getBoundingClientRect();
    const iframeRect = iframe?.getBoundingClientRect() ?? null;

    return {
      iframePresent: Boolean(iframe),
      containerTop: Math.round(containerRect.top),
      containerBottom: Math.round(containerRect.bottom),
      iframeTop: iframeRect ? Math.round(iframeRect.top) : null,
      iframeBottom: iframeRect ? Math.round(iframeRect.bottom) : null,
      childTags: Array.from(container.children).map((child) => child.tagName),
    };
  });

  expect(layout.iframePresent).toBe(true);
  expect(layout.iframeTop).toBe(layout.containerTop);
  expect(layout.iframeBottom).toBe(layout.containerBottom);
});

test("all-mode coin selection keeps the coin's own link metrics instead of reusing the selected trend", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockDashboardRoute(page);

  await page.goto("/trends", { waitUntil: "networkidle" });

  const marketTable = page.getByTestId("memecoin-market-table");
  await marketTable.getByRole("button", { name: "All" }).click();
  await marketTable.getByTestId("memecoin-market-row").filter({ hasText: "Trump Coin" }).click();

  const validationPane = page.getByTestId("selected-coin-panel");
  await expect(validationPane).not.toContainText("Linked narrative");
  await expect(validationPane).not.toContainText("Narrative Fit");
  await expect(validationPane.getByTestId("selected-coin-link-score")).toHaveText("30");
  await expect(validationPane.getByTestId("selected-coin-support-posts")).toHaveText("2");
});

test("overview route fits the desktop viewport and keeps both tables vertical-only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 840 });
  await mockDashboardRoute(page);

  await page.goto("/overview", { waitUntil: "networkidle" });

  const layout = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement | null;
    const narrativeScroller = document.querySelector(
      '[data-testid="narrative-table-scroller"]',
    ) as HTMLElement | null;
    const memecoinScroller = document.querySelector(
      '[data-testid="memecoin-table-scroller"]',
    ) as HTMLElement | null;
    const rows = Array.from(document.querySelectorAll('[data-testid="narrative-row"]'));

    if (!main || !narrativeScroller || !memecoinScroller) {
      return null;
    }

    const scrollerRect = narrativeScroller.getBoundingClientRect();
    const visibleRows = rows.filter((node) => {
      const rect = (node as HTMLElement).getBoundingClientRect();
      return rect.top >= scrollerRect.top && rect.bottom <= scrollerRect.bottom + 1;
    }).length;

    return {
      mainOverflow: Math.round(main.scrollHeight - main.clientHeight),
      narrativeCanScroll: narrativeScroller.scrollHeight > narrativeScroller.clientHeight + 1,
      narrativeHorizontalOverflow: Math.round(narrativeScroller.scrollWidth - narrativeScroller.clientWidth),
      memecoinHorizontalOverflow: Math.round(memecoinScroller.scrollWidth - memecoinScroller.clientWidth),
      visibleRows,
    };
  });

  expect(layout).not.toBeNull();
  expect(layout?.mainOverflow).toBeLessThanOrEqual(2);
  expect(layout?.narrativeCanScroll).toBe(true);
  expect(layout?.narrativeHorizontalOverflow).toBeLessThanOrEqual(1);
  expect(layout?.memecoinHorizontalOverflow).toBeLessThanOrEqual(1);
  expect(layout?.visibleRows).toBeGreaterThanOrEqual(8);
});

test("workspace collapses to a single-column stack below desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1117, height: 840 });
  await mockDashboardRoute(page);

  await page.goto("/overview", { waitUntil: "networkidle" });

  const sizing = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="trend-main-workspace"]') as HTMLElement | null;
    if (!workspace) {
      return null;
    }

    return {
      workspaceColumns: window
        .getComputedStyle(workspace)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length,
    };
  });

  expect(sizing).not.toBeNull();
  expect(sizing?.workspaceColumns).toBe(1);
});
