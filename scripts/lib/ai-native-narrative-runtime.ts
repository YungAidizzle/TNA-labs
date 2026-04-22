import fs from "node:fs";
import path from "node:path";
import {
  AI_NATIVE_NARRATIVE_RAILWAY_CRON_RUNTIME_PATH,
  AI_NATIVE_NARRATIVE_RAILWAY_DAEMON_RUNTIME_PATH,
  AI_NATIVE_NARRATIVE_RAILWAY_ONCE_RUNTIME_PATH,
  AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
  AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
} from "@/lib/ai-native-narratives/scheduler";
import { runAiNativeNarrativePipeline } from "@/lib/ai-native-narratives/worker";

export type AiNativeNarrativeRuntimeArgs = {
  force: boolean;
  once: boolean;
  pollSeconds: number;
  failureRetrySeconds: number;
  trigger: string;
};

function parseIntegerArg(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function loadRepoEnv() {
  const candidates = [".env.local", ".env"];

  for (const relativePath of candidates) {
    const targetPath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(targetPath)) {
      continue;
    }

    const contents = fs.readFileSync(targetPath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

export function parseWorkerArgs(argv: string[]): AiNativeNarrativeRuntimeArgs {
  const args = argv.slice(2);
  return {
    force: args.includes("--force"),
    once: args.includes("--once"),
    pollSeconds: parseIntegerArg(
      args.find((value) => value.startsWith("--poll-seconds="))?.slice("--poll-seconds=".length),
      30,
      5,
      3_600,
    ),
    failureRetrySeconds: parseIntegerArg(
      args
        .find((value) => value.startsWith("--failure-retry-seconds="))
        ?.slice("--failure-retry-seconds=".length),
      300,
      30,
      86_400,
    ),
    trigger: args.find((value) => value.startsWith("--trigger="))?.slice("--trigger=".length) || "",
  };
}

export async function executeRailwayAiNativeNarrativeRun(params: {
  force?: boolean;
  trigger: string;
  runtimePath:
    | typeof AI_NATIVE_NARRATIVE_RAILWAY_CRON_RUNTIME_PATH
    | typeof AI_NATIVE_NARRATIVE_RAILWAY_DAEMON_RUNTIME_PATH
    | typeof AI_NATIVE_NARRATIVE_RAILWAY_ONCE_RUNTIME_PATH;
}) {
  const startedAt = new Date().toISOString();
  console.log("[ai-native-narrative-worker] starting run", {
    trigger: params.trigger,
    runtimePath: params.runtimePath,
    startedAt,
  });

  const result = await runAiNativeNarrativePipeline({
    force: params.force,
    trigger: params.trigger,
    runtimePath: params.runtimePath,
    executionEnvironment: "railway",
    schedulerStrategy: AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
    schedulerLabel: AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
  });

  console.log("[ai-native-narrative-worker] run finished", {
    trigger: params.trigger,
    runtimePath: params.runtimePath,
    finishedAt: new Date().toISOString(),
    result,
  });

  return result;
}

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
