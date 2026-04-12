import "server-only";

import path from "node:path";

export const RUNTIME_ROOT = path.join(process.cwd(), "runtime");
export const RUNTIME_RAW_DIR = path.join(RUNTIME_ROOT, "raw");
export const RUNTIME_CACHE_DIR = path.join(RUNTIME_ROOT, "cache");
export const RUNTIME_SNAPSHOTS_DIR = path.join(RUNTIME_ROOT, "snapshots");

export const RUNTIME_SQLITE_PATH = path.join(RUNTIME_ROOT, "app.sqlite3");
export const RUNTIME_RAW_SNAPSHOT_PATH = path.join(RUNTIME_RAW_DIR, "latest-reddit-ingestion.json");
export const RUNTIME_LATEST_SNAPSHOT_PATH = path.join(RUNTIME_SNAPSHOTS_DIR, "latest.json");
export const RUNTIME_REFRESH_STATE_PATH = path.join(RUNTIME_CACHE_DIR, "refresh-state.json");
export const RUNTIME_BUILD_PROFILE_PATH = path.join(RUNTIME_CACHE_DIR, "dashboard-build-profile.json");
export const RUNTIME_REQUEST_PROFILE_PATH = path.join(RUNTIME_CACHE_DIR, "dashboard-request-profile.json");
export const RUNTIME_REFRESH_LOG_PATH = path.join(RUNTIME_CACHE_DIR, "refresh-log.json");
