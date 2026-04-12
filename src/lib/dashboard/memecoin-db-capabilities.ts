import "server-only";

import { getServerPostgresPool, hasDatabaseUrl } from "@/lib/db/server-postgres";

const REQUIRED_LIVE_VALIDATION_ASSET_COLUMNS = [
  "is_live",
  "last_validated_at",
  "validation_status",
  "validation_reason",
  "last_seen_liquidity_usd",
  "last_seen_volume_h24",
  "last_seen_txns_h24",
] as const;

type MemecoinDbCapabilities = {
  assetLiveValidationColumnsAvailable: boolean;
  assetColumns: string[];
  refreshedAt: string;
};

let cachedCapabilities:
  | {
      expiresAt: number;
      value: MemecoinDbCapabilities;
    }
  | null = null;

const CAPABILITIES_CACHE_TTL_MS = 60_000;

function buildDefaultCapabilities(): MemecoinDbCapabilities {
  return {
    assetLiveValidationColumnsAvailable: false,
    assetColumns: [],
    refreshedAt: new Date().toISOString(),
  };
}

export async function getMemecoinDbCapabilities(): Promise<MemecoinDbCapabilities> {
  if (!hasDatabaseUrl()) {
    return buildDefaultCapabilities();
  }

  const now = Date.now();
  if (cachedCapabilities && cachedCapabilities.expiresAt > now) {
    return cachedCapabilities.value;
  }

  const pool = getServerPostgresPool();
  try {
    const result = await pool.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'memecoin_assets'
      `,
    );
    const assetColumns = result.rows
      .map((row) => String(row.column_name ?? "").trim().toLowerCase())
      .filter(Boolean);
    const assetColumnSet = new Set(assetColumns);
    const value = {
      assetLiveValidationColumnsAvailable: REQUIRED_LIVE_VALIDATION_ASSET_COLUMNS.every((column) =>
        assetColumnSet.has(column),
      ),
      assetColumns,
      refreshedAt: new Date().toISOString(),
    } satisfies MemecoinDbCapabilities;
    cachedCapabilities = {
      value,
      expiresAt: now + CAPABILITIES_CACHE_TTL_MS,
    };
    return value;
  } catch {
    const value = buildDefaultCapabilities();
    cachedCapabilities = {
      value,
      expiresAt: now + CAPABILITIES_CACHE_TTL_MS,
    };
    return value;
  }
}
