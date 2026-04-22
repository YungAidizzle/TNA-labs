import "server-only";

export const AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY =
  "railway_worker_hourly_authoritative";
export const AI_NATIVE_NARRATIVE_SCHEDULER_LABEL = "Railway hourly worker";
export const AI_NATIVE_NARRATIVE_PRIMARY_TRIGGER = "railway-hourly-worker";
export const AI_NATIVE_NARRATIVE_MANUAL_ROUTE_TRIGGER = "vercel-admin-route";
export const AI_NATIVE_NARRATIVE_RAILWAY_MANUAL_TRIGGER = "railway-cli";
export const AI_NATIVE_NARRATIVE_ROUTE_RUNTIME_PATH = "vercel_admin_route";
export const AI_NATIVE_NARRATIVE_DASHBOARD_RUNTIME_PATH = "vercel_dashboard_api";
export const AI_NATIVE_NARRATIVE_RAILWAY_CRON_RUNTIME_PATH = "railway_hourly_cron";
export const AI_NATIVE_NARRATIVE_RAILWAY_DAEMON_RUNTIME_PATH = "railway_hourly_daemon";
export const AI_NATIVE_NARRATIVE_RAILWAY_ONCE_RUNTIME_PATH = "railway_worker_once";
export const AI_NATIVE_NARRATIVE_AUTHORITATIVE_RUNTIME = "railway_worker";
export const AI_NATIVE_NARRATIVE_CRON_SECRET_NAMES = [
  "CRON_SECRET",
  "ATTENTRA_CRON_SECRET",
] as const;

export function formatAiNativeNarrativeTriggerLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "Unknown";
  }
  if (normalized === AI_NATIVE_NARRATIVE_PRIMARY_TRIGGER) {
    return "Railway hourly worker";
  }
  if (normalized === AI_NATIVE_NARRATIVE_RAILWAY_MANUAL_TRIGGER) {
    return "Railway CLI";
  }
  if (normalized === AI_NATIVE_NARRATIVE_MANUAL_ROUTE_TRIGGER) {
    return "Vercel admin route";
  }
  if (normalized === "manual") {
    return "Manual";
  }
  if (normalized === "api-trigger") {
    return "Dashboard API";
  }
  if (normalized === "github-actions-hourly") {
    return "GitHub hourly";
  }
  if (normalized === "vercel-cron") {
    return "Vercel cron";
  }

  return normalized
    .split(/[:_-]+/g)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(" ");
}

export function formatAiNativeNarrativeRuntimeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "Unknown";
  }
  if (normalized === AI_NATIVE_NARRATIVE_RAILWAY_CRON_RUNTIME_PATH) {
    return "Railway hourly cron job";
  }
  if (normalized === AI_NATIVE_NARRATIVE_RAILWAY_DAEMON_RUNTIME_PATH) {
    return "Railway hourly daemon";
  }
  if (normalized === AI_NATIVE_NARRATIVE_RAILWAY_ONCE_RUNTIME_PATH) {
    return "Railway one-shot worker";
  }
  if (normalized === AI_NATIVE_NARRATIVE_ROUTE_RUNTIME_PATH) {
    return "Vercel admin route";
  }
  if (normalized === AI_NATIVE_NARRATIVE_DASHBOARD_RUNTIME_PATH) {
    return "Vercel dashboard API";
  }

  return normalized
    .split(/[:_-]+/g)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(" ");
}
