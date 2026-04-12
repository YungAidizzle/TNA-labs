"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

function readSupabaseBrowserConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  return {
    url: url || null,
    anonKey: anonKey || null,
  };
}

export function hasSupabaseBrowserConfig() {
  const { url, anonKey } = readSupabaseBrowserConfig();
  return Boolean(url && anonKey);
}

function getSupabaseBrowserConfig() {
  const { url, anonKey } = readSupabaseBrowserConfig();

  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (!anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return { url, anonKey };
}

export function getSupabaseBrowserClient() {
  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = getSupabaseBrowserConfig();
  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}
