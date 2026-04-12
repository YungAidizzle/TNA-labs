import { createZeroTrendDashboardVM } from "@/lib/dashboard/zero-state";
import {
  buildTradingViewPreviewInput,
  buildTradingViewPreviewSearchParams,
  type TradingViewPreviewResponse,
} from "@/lib/dashboard/tradingview-preview";
import type { CorrelatedMemecoinRow, TrendDashboardQuery, TrendDashboardVM } from "@/types/view-models";

type DashboardView = "full" | "summary" | "detail";

function resolveApiResponseTimestamp(headers: Headers) {
  const explicitTimestamp = headers.get("X-Dashboard-Api-Response-At");
  if (explicitTimestamp) {
    const explicitMs = Date.parse(explicitTimestamp);
    if (Number.isFinite(explicitMs)) {
      return new Date(explicitMs).toISOString();
    }
  }

  const dateHeader = headers.get("Date");
  if (dateHeader) {
    const dateMs = Date.parse(dateHeader);
    if (Number.isFinite(dateMs)) {
      return new Date(dateMs).toISOString();
    }
  }

  return new Date().toISOString();
}

function withApiFreshnessTimestamp(
  payload: TrendDashboardVM,
  responseTimestampIso: string,
): TrendDashboardVM {
  if (!payload.dataStatus) {
    return payload;
  }

  return {
    ...payload,
    dataStatus: {
      ...payload.dataStatus,
      serverNow: responseTimestampIso,
      latestFetchedAt: responseTimestampIso,
      freshnessDiagnostics: payload.dataStatus.freshnessDiagnostics
        ? {
            ...payload.dataStatus.freshnessDiagnostics,
            apiResponseAt: responseTimestampIso,
          }
        : payload.dataStatus.freshnessDiagnostics,
    },
  };
}

function toSearchParams(query: TrendDashboardQuery, view: DashboardView) {
  const params = new URLSearchParams();
  params.set("scope", query.scope);
  params.set("range", query.range);
  params.set("mode", query.mode ?? "established");
  params.set("sort", query.sort);
  params.set("view", view);

  if (query.selectedId) {
    params.set("selectedId", query.selectedId);
  }
  if (query.selectedKey) {
    params.set("selectedKey", query.selectedKey);
  }

  return params.toString();
}

async function fetchDashboardView(
  query: TrendDashboardQuery,
  view: DashboardView,
  options?: {
    previousData?: TrendDashboardVM;
    signal?: AbortSignal;
  },
): Promise<TrendDashboardVM> {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

  try {
    const headers = new Headers();
    const previousVersion = options?.previousData?.dataStatus?.responseVersion;
    if (previousVersion) {
      headers.set("If-None-Match", `"${previousVersion}"`);
    }

    const response = await fetch(`/api/dashboard/trends?${toSearchParams(query, view)}`, {
      cache: "no-store",
      headers,
      signal: options?.signal,
    });
    const responseTimestampIso = resolveApiResponseTimestamp(response.headers);

    if (response.status === 304 && options?.previousData) {
      if (process.env.NODE_ENV === "development") {
        const durationMs =
          typeof performance !== "undefined" ? performance.now() - startedAt : Date.now() - startedAt;
        console.info(
          `[dashboard-client:${view}] ${query.scope}:${query.range}:${query.mode ?? "established"}:${query.sort} not modified in ${Math.round(durationMs)}ms`,
        );
      }
      return withApiFreshnessTimestamp(options.previousData, responseTimestampIso);
    }

    if (!response.ok) {
      let errorDetail = "";
      try {
        const payload = (await response.json()) as {
          error?: {
            code?: string;
            message?: string;
          };
        };
        errorDetail = payload?.error?.message
          ? ` (${payload.error.message})`
          : "";
      } catch {
        errorDetail = "";
      }
      throw new Error(`dashboard request failed: ${response.status}${errorDetail}`);
    }

    const payload = withApiFreshnessTimestamp(
      (await response.json()) as TrendDashboardVM,
      responseTimestampIso,
    );

    if (process.env.NODE_ENV === "development") {
      const durationMs =
        typeof performance !== "undefined" ? performance.now() - startedAt : Date.now() - startedAt;
      console.info(
        `[dashboard-client:${view}] ${query.scope}:${query.range}:${query.mode ?? "established"}:${query.sort} loaded in ${Math.round(durationMs)}ms`,
        {
          stateSource: payload.dataStatus?.stateSource ?? null,
          showing: payload.dataStatus?.showing ?? null,
          runtimeSnapshotGeneratedAt: payload.dataStatus?.runtimeSnapshotGeneratedAt ?? null,
        },
      );
    }

    return payload;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw error;
    }
    console.error(`[dashboard] failed to load ${view} trend dashboard state`, error);
    if (options?.previousData) {
      return options.previousData;
    }
    return createZeroTrendDashboardVM(query);
  }
}

export const dashboardClient = {
  getTrendDashboardVM(
    query: TrendDashboardQuery,
    options?: {
      previousData?: TrendDashboardVM;
      signal?: AbortSignal;
    },
  ): Promise<TrendDashboardVM> {
    return fetchDashboardView(query, "full", options);
  },
  getTrendDashboardSummaryVM(
    query: TrendDashboardQuery,
    options?: {
      previousData?: TrendDashboardVM;
      signal?: AbortSignal;
    },
  ): Promise<TrendDashboardVM> {
    return fetchDashboardView(query, "summary", options);
  },
  getTrendDashboardDetailVM(
    query: TrendDashboardQuery,
    options?: {
      previousData?: TrendDashboardVM;
      signal?: AbortSignal;
    },
  ): Promise<TrendDashboardVM> {
    return fetchDashboardView(query, "detail", options);
  },
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
