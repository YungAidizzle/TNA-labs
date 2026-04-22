import "server-only";

import { Pool } from "pg";

let cachedPool: Pool | null = null;

export function hasDatabaseUrl() {
  return Boolean((process.env.DATABASE_URL ?? "").trim());
}

export function getServerPostgresPool() {
  if (cachedPool) {
    return cachedPool;
  }

  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL for server-side Postgres trend queries.");
  }

  cachedPool = new Pool({
    connectionString: databaseUrl,
    max: 3,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  return cachedPool;
}

export async function closeServerPostgresPool() {
  if (!cachedPool) {
    return;
  }

  const pool = cachedPool;
  cachedPool = null;
  await pool.end();
}
