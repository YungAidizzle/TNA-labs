import {
  buildTradingViewPreviewInput,
  buildTradingViewPreviewSearchParams,
  type TradingViewPreviewResponse,
} from "@/lib/dashboard/tradingview-preview";
import type { CorrelatedMemecoinRow } from "@/types/view-models";

export const dashboardClient = {
  async getMemecoinPreview(
    row: CorrelatedMemecoinRow,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<TradingViewPreviewResponse> {
    const params = buildTradingViewPreviewSearchParams(buildTradingViewPreviewInput(row));
    const response = await fetch(`/api/dashboard/memecoin-preview?${params.toString()}`, {
      cache: "no-store",
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`memecoin preview request failed: ${response.status}`);
    }

    return (await response.json()) as TradingViewPreviewResponse;
  },
};
