import "server-only";

import { promises as fs } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { DashboardRequestTimings, DashboardTimingEntry } from "@/types/view-models";

function roundMs(value: number) {
  return Math.round(value * 10) / 10;
}

type StepDetail = {
  count?: number;
};

export class DashboardProfiler {
  private readonly startedAt = performance.now();
  private readonly steps: Array<DashboardTimingEntry & StepDetail> = [];

  async measure<T>(
    name: string,
    callback: () => Promise<T> | T,
    detail: StepDetail = {},
  ): Promise<T> {
    const stepStartedAt = performance.now();
    try {
      return await callback();
    } finally {
      this.steps.push({
        name,
        durationMs: roundMs(performance.now() - stepStartedAt),
        count: detail.count,
      });
    }
  }

  record(name: string, durationMs: number, detail: StepDetail = {}) {
    this.steps.push({
      name,
      durationMs: roundMs(durationMs),
      count: detail.count,
    });
  }

  buildSummary(): DashboardRequestTimings {
    const lookup = new Map(this.steps.map((step) => [step.name, step]));
    return {
      totalMs: roundMs(performance.now() - this.startedAt),
      runtimeSnapshotReadMs: lookup.get("runtime_snapshot_read")?.durationMs ?? 0,
      sourceManifestReadMs: lookup.get("source_manifest_read")?.durationMs ?? 0,
      localRawReadMs: lookup.get("local_raw_read")?.durationMs ?? 0,
      analyticsBuildMs:
        this.steps
          .filter((step) => step.name.startsWith("analytics_build:"))
          .reduce((sum, step) => sum + step.durationMs, 0) ?? 0,
      variantBuildMs: lookup.get("variant_build")?.durationMs ?? 0,
      sqliteWriteMs: lookup.get("sqlite_write")?.durationMs ?? 0,
      steps: this.steps.map((step) => ({
        name: step.name,
        durationMs: step.durationMs,
        count: step.count,
      })),
      perQueryBuilds: this.steps
        .filter((step) => step.name.startsWith("analytics_build:"))
        .map((step) => ({
          name: step.name.replace("analytics_build:", ""),
          durationMs: step.durationMs,
          count: step.count,
        })),
    };
  }
}

export function formatDashboardProfileLog(
  label: string,
  timings: DashboardRequestTimings,
  extra: Record<string, string | number | boolean | null | undefined> = {},
) {
  const parts = [
    `[dashboard-profile] ${label}`,
    `total=${timings.totalMs}ms`,
    `runtimeSnapshot=${timings.runtimeSnapshotReadMs}ms`,
    `sourceManifest=${timings.sourceManifestReadMs}ms`,
    `localRaw=${timings.localRawReadMs}ms`,
    `analytics=${timings.analyticsBuildMs}ms`,
    `variant=${timings.variantBuildMs}ms`,
    `sqlite=${timings.sqliteWriteMs}ms`,
  ];

  Object.entries(extra).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    parts.push(`${key}=${value}`);
  });

  return parts.join(" ");
}

export function buildServerTimingHeader(timings: DashboardRequestTimings) {
  const segments = [
    `total;dur=${timings.totalMs}`,
    `runtime_snapshot;dur=${timings.runtimeSnapshotReadMs}`,
    `source_manifest;dur=${timings.sourceManifestReadMs}`,
    `local_raw;dur=${timings.localRawReadMs}`,
    `analytics;dur=${timings.analyticsBuildMs}`,
    `variant;dur=${timings.variantBuildMs}`,
    `sqlite;dur=${timings.sqliteWriteMs}`,
  ];

  timings.perQueryBuilds.forEach((entry) => {
    const metricName = `analytics_${entry.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    segments.push(`${metricName};dur=${entry.durationMs}`);
  });

  return segments.join(", ");
}

export async function writeProfileSnapshot(
  filePath: string,
  payload: {
    generatedAt: string;
    label: string;
    timings: DashboardRequestTimings;
    metadata?: Record<string, unknown>;
  },
) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const serialized = JSON.stringify(payload, null, 2);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, serialized, "utf8");

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : null;
      const retryable =
        code === "EACCES" ||
        code === "EBUSY" ||
        code === "ENOENT" ||
        code === "EPERM";

      if (!retryable || attempt >= 5) {
        break;
      }

      try {
        await fs.rm(filePath, { force: true });
      } catch {
        // The file may still be locked by another reader; retry below.
      }

      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }

  try {
    await fs.writeFile(filePath, serialized, "utf8");
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}
