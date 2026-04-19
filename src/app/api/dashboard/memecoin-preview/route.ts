import { NextRequest, NextResponse } from "next/server";
import { DASHBOARD_API_CACHE_CONTROL } from "@/lib/dashboard/cache";
import {
  createFallbackTradingViewPreview,
  createUnavailableTradingViewPreview,
  type TradingViewPreviewInput,
} from "@/lib/dashboard/tradingview-preview";
import { validateDexLiveMarket } from "@/lib/dashboard/dexscreener-live-validation";
import { resolveCoinPreview } from "@/lib/dashboard/tradingview-preview-resolver";
import { requirePaidApiUser } from "@/lib/supabase/auth";

function readQueryValue(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumericQueryValue(searchParams: URLSearchParams, key: string) {
  const value = readQueryValue(searchParams, key);
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { searchParams } = new URL(request.url);
  const input: TradingViewPreviewInput = {
    id: readQueryValue(searchParams, "coinId") ?? "unknown-coin",
    chainId: readQueryValue(searchParams, "chainId") ?? "",
    dexId: readQueryValue(searchParams, "dexId"),
    pairAddress: readQueryValue(searchParams, "pairAddress") ?? "",
    pairLabels: searchParams.getAll("pairLabel"),
    tokenAddress: readQueryValue(searchParams, "tokenAddress") ?? "",
    name: readQueryValue(searchParams, "name") ?? "",
    symbol: readQueryValue(searchParams, "symbol") ?? "",
    quoteSymbol: readQueryValue(searchParams, "quoteSymbol"),
    tradingviewSymbol: readQueryValue(searchParams, "tradingviewSymbol"),
    dexscreenerUrl: readQueryValue(searchParams, "dexscreenerUrl") ?? "",
    priceUsd: readNumericQueryValue(searchParams, "priceUsd"),
    priceChange1hPct: readNumericQueryValue(searchParams, "priceChange1hPct"),
    priceChange6hPct: readNumericQueryValue(searchParams, "priceChange6hPct"),
    priceChange24hPct: readNumericQueryValue(searchParams, "priceChange24hPct"),
  };

  try {
    const validation = await validateDexLiveMarket({
      chainId: input.chainId,
      tokenAddress: input.tokenAddress,
      pairAddress: input.pairAddress || null,
      dexscreenerUrl: input.dexscreenerUrl || null,
    });
    if (!validation.isLive) {
      const preview = createUnavailableTradingViewPreview(input, {
        failureCode:
          validation.validationReason === "pair_lookup_failed" ? "pair_lookup_failed" : "market_not_live",
        failureDetail: `Dexscreener live validation failed: ${validation.validationReason ?? "unknown_reason"}.`,
        dexscreenerEmbedUrl: null,
        availablePreviewModes: ["unavailable"],
        resolutionNotes: [
          `live_validation:${validation.validationReason ?? "unknown_reason"}`,
        ],
      });
      const response = NextResponse.json(preview);
      response.headers.set("Cache-Control", DASHBOARD_API_CACHE_CONTROL.preview);
      return response;
    }

    const preview = await resolveCoinPreview({
      ...input,
      chainId: validation.chainId,
      pairAddress: validation.pairAddress ?? input.pairAddress,
      dexscreenerUrl: validation.dexscreenerUrl ?? input.dexscreenerUrl,
      dexId: validation.dexId ?? input.dexId,
      quoteSymbol: validation.quoteSymbol ?? input.quoteSymbol,
      priceUsd: validation.priceUsd ?? input.priceUsd,
      priceChange1hPct: validation.priceChange1hPct ?? input.priceChange1hPct,
      priceChange6hPct: validation.priceChange6hPct ?? input.priceChange6hPct,
      priceChange24hPct: validation.priceChange24hPct ?? input.priceChange24hPct,
    });
    const response = NextResponse.json(preview);
    response.headers.set("Cache-Control", DASHBOARD_API_CACHE_CONTROL.preview);
    if (process.env.NODE_ENV !== "production") {
      console.info("[memecoin-preview]", {
        status: preview.status,
        ...preview.debug,
        failureCode: preview.failureCode,
        failureDetail: preview.failureDetail,
        displayMode: preview.displayMode,
        snapshotImageUrl: preview.snapshotImageUrl,
        sparklinePointCount: preview.sparklinePoints?.length ?? 0,
      });
    }
    return response;
  } catch (error) {
    const fallback = createFallbackTradingViewPreview(input, {
      failureCode: "pair_lookup_failed",
      failureDetail: String((error as Error)?.message ?? error ?? "Preview resolution failed."),
      dexscreenerEmbedUrl: input.dexscreenerUrl,
    });
    const response = NextResponse.json(fallback);
    response.headers.set("Cache-Control", DASHBOARD_API_CACHE_CONTROL.preview);
    console.error("[memecoin-preview] failed to resolve preview", {
      error,
      input,
    });
    return response;
  }
}
