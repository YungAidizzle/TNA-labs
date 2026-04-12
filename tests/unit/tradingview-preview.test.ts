import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPairDerivedTradingViewCandidates,
  parsePairAddressFromDexscreenerUrl,
  type TradingViewPreviewInput,
} from "@/lib/dashboard/tradingview-preview";

const originalFetch = globalThis.fetch;

function buildInput(overrides: Partial<TradingViewPreviewInput> = {}): TradingViewPreviewInput {
  return {
    id: "bsc:esports:pair",
    chainId: "bsc",
    dexId: null,
    pairAddress: "0x5Bb59Bb9371cBeC158eD602d5f3CF1AD1c9B4462",
    pairLabels: null,
    tokenAddress: "0xF39e4b21c84e737Df08e2C3b32541d856f508E48",
    name: "Esports Coin",
    symbol: "ESPORTS",
    quoteSymbol: "WBNB",
    tradingviewSymbol: null,
    dexscreenerUrl: "https://dexscreener.com/bsc/0x5bb59bb9371cbec158ed602d5f3cf1ad1c9b4462",
    priceUsd: 0.0012,
    priceChange1hPct: 2,
    priceChange6hPct: 8,
    priceChange24hPct: 24,
    ...overrides,
  };
}

describe("tradingview preview utilities", () => {
  it("builds pair-derived TradingView symbol candidates from pair identity", () => {
    const candidates = buildPairDerivedTradingViewCandidates(buildInput());

    expect(candidates.slice(0, 4)).toEqual([
      "ESPORTSWBNB_5BB59B.USD",
      "ESPORTSWBNB_5BB59B",
      "ESPORTSBNB_5BB59B.USD",
      "ESPORTSBNB_5BB59B",
    ]);
    expect(candidates).toContain("BSC:ESPORTSWBNB");
  });

  it("parses the pair address from a Dexscreener pair url", () => {
    expect(
      parsePairAddressFromDexscreenerUrl(
        "https://dexscreener.com/bsc/0x5bb59bb9371cbec158ed602d5f3cf1ad1c9b4462",
      ),
    ).toBe("0x5bb59bb9371cbec158ed602d5f3cf1ad1c9b4462");
  });
});

describe("resolveTradingViewPreview", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/db/server-postgres", () => ({
      hasDatabaseUrl: () => false,
      getServerPostgresPool: () => {
        throw new Error("DB access not expected in this test");
      },
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses an explicit tradingview symbol without external lookup", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const { resolveCoinPreview } = await import("@/lib/dashboard/tradingview-preview-resolver");
    const preview = await resolveCoinPreview(
      buildInput({
        symbol: "FROG",
        tradingviewSymbol: "BINANCE:FROGUSDT",
      }),
    );

    expect(preview).toMatchObject({
      status: "tradingview",
      provider: "tradingview",
      tradingviewSymbol: "BINANCE:FROGUSDT",
      resolutionSource: "stored_symbol",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("derives and validates a pair-based TradingView symbol from Dexscreener identity", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/latest/dex/pairs/")) {
        return new Response(
          JSON.stringify({
            pair: {
              chainId: "bsc",
              dexId: "pancakeswap",
              url: "https://dexscreener.com/bsc/0x5bb59bb9371cbec158ed602d5f3cf1ad1c9b4462",
              pairAddress: "0x5Bb59Bb9371cBeC158eD602d5f3CF1AD1c9B4462",
              labels: ["v3"],
              baseToken: { symbol: "ESPORTS" },
              quoteToken: { symbol: "WBNB" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/token-pairs/v1/")) {
        return new Response(
          JSON.stringify([
            {
              chainId: "bsc",
              dexId: "pancakeswap",
              url: "https://dexscreener.com/bsc/0x5bb59bb9371cbec158ed602d5f3cf1ad1c9b4462",
              pairAddress: "0x5Bb59Bb9371cBeC158eD602d5f3CF1AD1c9B4462",
              labels: ["v3"],
              baseToken: { symbol: "ESPORTS" },
              quoteToken: { symbol: "WBNB" },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/symbols/ESPORTSWBNB_5BB59B.USD/")) {
        return new Response("<html><body>symbol ok</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { resolveCoinPreview } = await import("@/lib/dashboard/tradingview-preview-resolver");
    const preview = await resolveCoinPreview(buildInput());

    expect(preview).toMatchObject({
      status: "tradingview",
      provider: "tradingview",
      displayMode: "tradingview_chart",
      tradingviewSymbol: "ESPORTSWBNB_5BB59B.USD",
      resolutionSource: "pair_derived",
    });
    expect(preview.debug).toMatchObject({
      dexId: "pancakeswap",
      pairAddress: "0x5Bb59Bb9371cBeC158eD602d5f3CF1AD1c9B4462",
      baseTokenSymbol: "ESPORTS",
      quoteTokenSymbol: "WBNB",
      symbolPassedToChartWidget: "ESPORTSWBNB_5BB59B.USD",
      previewProviderSelected: "tradingview",
      displayMode: "tradingview_chart",
    });
    expect(preview.debug.pairLabels).toEqual(["V3"]);
    expect(preview.debug.candidateValidation[0]).toMatchObject({
      symbol: "ESPORTSWBNB_5BB59B.USD",
      valid: true,
      status: 200,
      rejectionReason: null,
    });
  });

  it("uses TradingView search to resolve Pixel Coin when pair-derived candidates fail", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/latest/dex/pairs/")) {
        return new Response(
          JSON.stringify({
            pair: {
              chainId: "solana",
              dexId: "pumpswap",
              url: "https://dexscreener.com/solana/pixel-pair",
              pairAddress: "PixelPair",
              baseToken: { symbol: "PIXEL", name: "Pixel Coin" },
              quoteToken: { symbol: "SOL" },
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
              dexId: "pumpswap",
              url: "https://dexscreener.com/solana/pixel-pair",
              pairAddress: "PixelPair",
              baseToken: { symbol: "PIXEL", name: "Pixel Coin" },
              quoteToken: { symbol: "SOL" },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("symbol-search.tradingview.com")) {
        const parsed = new URL(url);
        const text = parsed.searchParams.get("text");
        if (text === "PIXELCOIN") {
          return new Response(
            JSON.stringify({
              symbols: [
                {
                  symbol: "PIXELCOINUSDT",
                  description: "Pixel Coin / USDT",
                  type: "spot",
                  exchange: "KCEX",
                  source_id: "KCEX",
                  typespecs: ["crypto", "defi"],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ symbols: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/symbols/PIXELCOINUSDT/")) {
        return new Response("<html><body>symbol ok</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { resolveCoinPreview } = await import("@/lib/dashboard/tradingview-preview-resolver");
    const preview = await resolveCoinPreview(
      buildInput({
        chainId: "solana",
        pairAddress: "PixelPair",
        tokenAddress: "PixelToken",
        name: "Pixel Coin",
        symbol: "PIXEL",
        quoteSymbol: "SOL",
        dexscreenerUrl: "https://dexscreener.com/solana/pixel-pair",
      }),
    );

    expect(preview).toMatchObject({
      status: "tradingview",
      provider: "tradingview",
      displayMode: "tradingview_chart",
      tradingviewSymbol: "PIXELCOINUSDT",
      resolutionSource: "tradingview_search",
    });
    expect(preview.debug.candidateSymbolsTried).toContain("PIXELCOINUSDT");
    expect(preview.debug.candidateValidation.some((entry) => entry.symbol === "PIXELCOINUSDT" && entry.valid)).toBe(
      true,
    );
    expect(preview.debug.resolutionNotes.some((entry) => entry.includes("PIXELCOIN"))).toBe(true);
  });

  it("validates exchange-prefixed TradingView symbols using the correct page slug", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/latest/dex/pairs/")) {
        return new Response(
          JSON.stringify({
            pair: {
              chainId: "ethereum",
              dexId: "uniswap",
              url: "https://dexscreener.com/ethereum/frog-pair",
              pairAddress: "FrogPair",
              baseToken: { symbol: "FROG", name: "Frog Coin" },
              quoteToken: { symbol: "WETH" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/token-pairs/v1/")) {
        return new Response(
          JSON.stringify([
            {
              chainId: "ethereum",
              dexId: "uniswap",
              url: "https://dexscreener.com/ethereum/frog-pair",
              pairAddress: "FrogPair",
              baseToken: { symbol: "FROG", name: "Frog Coin" },
              quoteToken: { symbol: "WETH" },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("symbol-search.tradingview.com")) {
        return new Response(
          JSON.stringify({
            symbols: [
              {
                symbol: "FROGUSDT",
                description: "Frog Coin / USDT",
                type: "spot",
                exchange: "Binance",
                prefix: "BINANCE",
                source_id: "BINANCE",
                typespecs: ["crypto", "defi"],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/symbols/BINANCE-FROGUSDT/")) {
        return new Response("<html><body>symbol ok</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { resolveCoinPreview } = await import("@/lib/dashboard/tradingview-preview-resolver");
    const preview = await resolveCoinPreview(
      buildInput({
        chainId: "ethereum",
        pairAddress: "FrogPair",
        tokenAddress: "FrogToken",
        name: "Frog Coin",
        symbol: "FROG",
        quoteSymbol: "WETH",
        dexscreenerUrl: "https://dexscreener.com/ethereum/frog-pair",
      }),
    );

    expect(preview).toMatchObject({
      status: "tradingview",
      provider: "tradingview",
      tradingviewSymbol: "BINANCE:FROGUSDT",
      resolutionSource: "tradingview_search",
    });
    expect(fetchMock.mock.calls.some(([request]) => String(request).includes("/symbols/BINANCE-FROGUSDT/"))).toBe(
      true,
    );
  });

  it("re-ranks token pairs and chooses the strongest market pair before TradingView lookup", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/latest/dex/pairs/")) {
        return new Response(JSON.stringify({ pairs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/token-pairs/v1/")) {
        return new Response(
          JSON.stringify([
            {
              chainId: "solana",
              dexId: "raydium",
              url: "https://dexscreener.com/solana/weak-pair",
              pairAddress: "WeakPair",
              baseToken: { symbol: "MULTI", name: "Multi Coin" },
              quoteToken: { symbol: "USDC" },
              liquidity: { usd: 1_000 },
              volume: { h24: 800 },
            },
            {
              chainId: "solana",
              dexId: "pumpswap",
              url: "https://dexscreener.com/solana/strong-pair",
              pairAddress: "StrongPair",
              baseToken: { symbol: "MULTI", name: "Multi Coin" },
              quoteToken: { symbol: "SOL" },
              liquidity: { usd: 400_000 },
              volume: { h24: 1_000_000 },
              txns: { h24: { buys: 500, sells: 450 } },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("symbol-search.tradingview.com")) {
        return new Response(
          JSON.stringify({
            symbols: [
              {
                symbol: "MULTIUSDT",
                description: "Multi Coin / USDT",
                type: "spot",
                exchange: "Binance",
                prefix: "BINANCE",
                source_id: "BINANCE",
                typespecs: ["crypto", "defi"],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/symbols/BINANCE-MULTIUSDT/")) {
        return new Response("<html><body>symbol ok</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { resolveCoinPreview } = await import("@/lib/dashboard/tradingview-preview-resolver");
    const preview = await resolveCoinPreview(
      buildInput({
        chainId: "solana",
        pairAddress: "OriginalPair",
        tokenAddress: "MultiToken",
        name: "Multi Coin",
        symbol: "MULTI",
        quoteSymbol: "SOL",
        dexscreenerUrl: "https://dexscreener.com/solana/original-pair",
      }),
    );

    expect(preview.status).toBe("tradingview");
    expect(preview.tradingviewSymbol).toBe("BINANCE:MULTIUSDT");
    expect(preview.debug.pairAddress).toBe("StrongPair");
    expect(preview.debug.dexId).toBe("pumpswap");
    expect(preview.debug.pairRanking[0]).toMatchObject({
      pairAddress: "StrongPair",
      quoteSymbol: "SOL",
    });
  });

  it("falls back to Dexscreener when TradingView lookup does not resolve a valid symbol", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/latest/dex/pairs/")) {
        return new Response(
          JSON.stringify({
            pair: {
              chainId: "solana",
              dexId: "raydium",
              url: "https://dexscreener.com/solana/fallback-pair",
              pairAddress: "FallbackPair",
              labels: ["memecoin"],
              baseToken: { symbol: "FALL", name: "Fallback Coin" },
              quoteToken: { symbol: "SOL" },
              info: { openGraph: "https://cdn.example.com/fallback.png" },
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
              dexId: "raydium",
              url: "https://dexscreener.com/solana/fallback-pair",
              pairAddress: "FallbackPair",
              labels: ["memecoin"],
              baseToken: { symbol: "FALL", name: "Fallback Coin" },
              quoteToken: { symbol: "SOL" },
              info: { openGraph: "https://cdn.example.com/fallback.png" },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("symbol-search.tradingview.com")) {
        return new Response(JSON.stringify({ symbols: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { resolveCoinPreview } = await import("@/lib/dashboard/tradingview-preview-resolver");
    const preview = await resolveCoinPreview(
      buildInput({
        chainId: "solana",
        pairAddress: "FallbackPair",
        tokenAddress: "FallbackToken",
        name: "Fallback Coin",
        symbol: "FALL",
        quoteSymbol: "SOL",
        dexscreenerUrl: "https://dexscreener.com/solana/fallback-pair",
      }),
    );

    expect(preview).toMatchObject({
      status: "dexscreener",
      provider: "dexscreener",
      displayMode: "dexscreener_snapshot",
      tradingviewSymbol: null,
      dexUrl: "https://dexscreener.com/solana/fallback-pair",
      snapshotImageUrl: "https://cdn.example.com/fallback.png",
      failureCode: "tradingview_symbol_unavailable",
    });
    expect(preview.debug.availablePreviewModes).toEqual(["dexscreener"]);
    expect(
      preview.debug.resolutionNotes.some((entry) => entry.includes("Falling back to Dexscreener")),
    ).toBe(true);
  });
});
