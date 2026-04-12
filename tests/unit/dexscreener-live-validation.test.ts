import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

describe("dexscreener live validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.MEMECOIN_LIVE_VALIDATION_TRUST_TTL_HOURS;
    delete process.env.MEMECOIN_LIVE_VALIDATION_LAST_KNOWN_GOOD_TTL_HOURS;
  });

  it("accepts a token with a currently live pair", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/latest/dex/pairs/")) {
        return new Response(
          JSON.stringify({
            pair: {
              chainId: "solana",
              pairAddress: "live-pair",
              url: "https://dexscreener.com/solana/live-pair",
              dexId: "raydium",
              baseToken: { address: "live-token", symbol: "LIVE", name: "Live Coin" },
              quoteToken: { symbol: "SOL", name: "Solana" },
              liquidity: { usd: 160000 },
              volume: { h24: 780000, h6: 220000, h1: 54000 },
              txns: {
                h24: { buys: 800, sells: 760 },
                h6: { buys: 210, sells: 190 },
                h1: { buys: 54, sells: 48 },
              },
              priceUsd: "0.0013",
              priceChange: { h24: "14", h6: "6", h1: "2" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/token-pairs/v1/")) {
        return new Response(
          JSON.stringify([
            {
              chainId: "solana",
              pairAddress: "live-pair",
              url: "https://dexscreener.com/solana/live-pair",
              dexId: "raydium",
              baseToken: { address: "live-token", symbol: "LIVE", name: "Live Coin" },
              quoteToken: { symbol: "SOL", name: "Solana" },
              liquidity: { usd: 160000 },
              volume: { h24: 780000, h6: 220000, h1: 54000 },
              txns: {
                h24: { buys: 800, sells: 760 },
                h6: { buys: 210, sells: 190 },
                h1: { buys: 54, sells: 48 },
              },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { validateDexLiveMarket } = await import("@/lib/dashboard/dexscreener-live-validation");
    const result = await validateDexLiveMarket({
      chainId: "solana",
      tokenAddress: "live-token",
      pairAddress: "live-pair",
      dexscreenerUrl: "https://dexscreener.com/solana/live-pair",
      updatedAt: "2026-04-05T11:58:00.000Z",
    });

    expect(result).toMatchObject({
      isLive: true,
      validationStatus: "live",
      pairAddress: "live-pair",
      dexscreenerUrl: "https://dexscreener.com/solana/live-pair",
      liquidityUsd: 160000,
      volume24hUsd: 780000,
    });
  });

  it("rejects a token when Dexscreener returns no live pair", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/latest/dex/pairs/")) {
        return new Response(JSON.stringify({ pairs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/token-pairs/v1/")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { validateDexLiveMarket } = await import("@/lib/dashboard/dexscreener-live-validation");
    const result = await validateDexLiveMarket({
      chainId: "solana",
      tokenAddress: "dead-token",
      pairAddress: "dead-pair",
      dexscreenerUrl: "https://dexscreener.com/solana/dead-pair",
      updatedAt: "2026-04-05T11:58:00.000Z",
    });

    expect(result.isLive).toBe(false);
    expect(result.validationReason).toBe("no_pair_found");
  });

  it("chooses the strongest live pool when multiple pools exist and the cached pair is stale", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/latest/dex/pairs/solana/stale-pair")) {
        return new Response(JSON.stringify({ pairs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/latest/dex/pairs/solana/strong-pair")) {
        return new Response(
          JSON.stringify({
            pair: {
              chainId: "solana",
              pairAddress: "strong-pair",
              url: "https://dexscreener.com/solana/strong-pair",
              dexId: "raydium",
              baseToken: { address: "frog-token", symbol: "FROG", name: "Frog Coin" },
              quoteToken: { symbol: "SOL", name: "Solana" },
              liquidity: { usd: 240000 },
              volume: { h24: 980000, h6: 360000, h1: 92000 },
              txns: {
                h24: { buys: 920, sells: 860 },
                h6: { buys: 260, sells: 240 },
                h1: { buys: 78, sells: 70 },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/token-pairs/v1/")) {
        return new Response(
          JSON.stringify([
            {
              chainId: "solana",
              pairAddress: "stale-pair",
              url: "https://dexscreener.com/solana/stale-pair",
              dexId: "raydium",
              baseToken: { address: "frog-token", symbol: "FROG", name: "Frog Coin" },
              quoteToken: { symbol: "SOL", name: "Solana" },
              liquidity: { usd: 100 },
              volume: { h24: 0, h6: 0, h1: 0 },
              txns: { h24: { buys: 0, sells: 0 }, h6: { buys: 0, sells: 0 }, h1: { buys: 0, sells: 0 } },
            },
            {
              chainId: "solana",
              pairAddress: "strong-pair",
              url: "https://dexscreener.com/solana/strong-pair",
              dexId: "raydium",
              baseToken: { address: "frog-token", symbol: "FROG", name: "Frog Coin" },
              quoteToken: { symbol: "SOL", name: "Solana" },
              liquidity: { usd: 240000 },
              volume: { h24: 980000, h6: 360000, h1: 92000 },
              txns: {
                h24: { buys: 920, sells: 860 },
                h6: { buys: 260, sells: 240 },
                h1: { buys: 78, sells: 70 },
              },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { validateDexLiveMarket } = await import("@/lib/dashboard/dexscreener-live-validation");
    const result = await validateDexLiveMarket({
      chainId: "solana",
      tokenAddress: "frog-token",
      pairAddress: "stale-pair",
      dexscreenerUrl: "https://dexscreener.com/solana/stale-pair",
      updatedAt: "2026-04-05T11:58:00.000Z",
    });

    expect(result.isLive).toBe(true);
    expect(result.pairAddress).toBe("strong-pair");
    expect(result.dexscreenerUrl).toBe("https://dexscreener.com/solana/strong-pair");
  });

  it("revalidates stale cached rows against Dex instead of auto-dropping them", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/latest/dex/pairs/")) {
        return new Response(
          JSON.stringify({
            pair: {
              chainId: "solana",
              pairAddress: "frog-pair",
              url: "https://dexscreener.com/solana/frog-pair",
              dexId: "raydium",
              baseToken: { address: "frog-token", symbol: "FROG", name: "Frog Coin" },
              quoteToken: { symbol: "SOL", name: "Solana" },
              liquidity: { usd: 240000 },
              volume: { h24: 980000, h6: 360000, h1: 92000 },
              txns: {
                h24: { buys: 920, sells: 860 },
                h6: { buys: 260, sells: 240 },
                h1: { buys: 78, sells: 70 },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/token-pairs/v1/")) {
        return new Response(
          JSON.stringify([
            {
              chainId: "solana",
              pairAddress: "frog-pair",
              url: "https://dexscreener.com/solana/frog-pair",
              dexId: "raydium",
              baseToken: { address: "frog-token", symbol: "FROG", name: "Frog Coin" },
              quoteToken: { symbol: "SOL", name: "Solana" },
              liquidity: { usd: 240000 },
              volume: { h24: 980000, h6: 360000, h1: 92000 },
              txns: {
                h24: { buys: 920, sells: 860 },
                h6: { buys: 260, sells: 240 },
                h1: { buys: 78, sells: 70 },
              },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { validateDexLiveMarket } = await import("@/lib/dashboard/dexscreener-live-validation");
    const result = await validateDexLiveMarket({
      chainId: "solana",
      tokenAddress: "frog-token",
      pairAddress: "frog-pair",
      dexscreenerUrl: "https://dexscreener.com/solana/frog-pair",
      updatedAt: "2026-04-05T01:00:00.000Z",
    });

    expect(result.isLive).toBe(true);
    expect(result.decisionSource).toBe("network");
    expect(result.validationReason).toBeNull();
  });

  it("uses recent producer validation to avoid stricter read-time mismatch wiping live rows", async () => {
    process.env.MEMECOIN_LIVE_VALIDATION_TRUST_TTL_HOURS = "8";
    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock as typeof fetch;

    const { validateDexLiveMarket } = await import("@/lib/dashboard/dexscreener-live-validation");
    const result = await validateDexLiveMarket({
      chainId: "solana",
      tokenAddress: "frog-token",
      pairAddress: "frog-pair",
      dexscreenerUrl: "https://dexscreener.com/solana/frog-pair",
      isLive: true,
      validationStatus: "live",
      lastValidatedAt: "2026-04-05T11:30:00.000Z",
      storedLiquidityUsd: 160000,
      storedVolume24hUsd: 780000,
      storedTxns24h: 1200,
      updatedAt: "2026-04-05T11:30:00.000Z",
    });

    expect(result.isLive).toBe(true);
    expect(result.decisionSource).toBe("trusted_recent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not wipe the board on transient Dex failures when last known good data is still fresh", async () => {
    process.env.MEMECOIN_LIVE_VALIDATION_LAST_KNOWN_GOOD_TTL_HOURS = "48";
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout"));
    globalThis.fetch = fetchMock as typeof fetch;

    const { validateDexLiveMarket } = await import("@/lib/dashboard/dexscreener-live-validation");
    const result = await validateDexLiveMarket({
      chainId: "solana",
      tokenAddress: "frog-token",
      pairAddress: "frog-pair",
      dexscreenerUrl: "https://dexscreener.com/solana/frog-pair",
      storedLiquidityUsd: 160000,
      storedVolume24hUsd: 780000,
      storedTxns24h: 1200,
      updatedAt: "2026-04-05T10:00:00.000Z",
    });

    expect(result.isLive).toBe(true);
    expect(result.decisionSource).toBe("transient_fallback");
    expect(result.fallbackReason).toBe("pair_lookup_failed");
  });
});
