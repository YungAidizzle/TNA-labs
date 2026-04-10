import "server-only";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

function readBooleanEnv(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function isSupabaseTrendSourceEnabled() {
  return readBooleanEnv(process.env.USE_SUPABASE_TRENDS, false);
}

export function hasSupabaseServerCredentials() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  return Boolean(url && serviceRoleKey);
}

export function allowLegacyTrendFallbackOnSupabaseError() {
  return readBooleanEnv(process.env.SUPABASE_TRENDS_FALLBACK_TO_LEGACY, true);
}

export function getSupabaseServerConfig() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!url) {
    throw new Error("Missing Supabase URL. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for server-side trend queries.");
  }

  return {
    url,
    serviceRoleKey,
  };
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseServerClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const config = getSupabaseServerConfig();
  cachedClient = createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedClient;
}
