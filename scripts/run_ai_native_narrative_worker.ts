import {
  AI_NATIVE_NARRATIVE_PRIMARY_TRIGGER,
  AI_NATIVE_NARRATIVE_RAILWAY_DAEMON_RUNTIME_PATH,
} from "@/lib/ai-native-narratives/scheduler";
import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";
import {
  executeRailwayAiNativeNarrativeRun,
  loadRepoEnv,
  parseWorkerArgs,
  sleep,
} from "./lib/ai-native-narrative-runtime";

function resolveNextAttemptAt(generatedAt: string | null | undefined, intervalMs: number) {
  const generatedTimestamp = Date.parse(generatedAt ?? "");
  if (Number.isFinite(generatedTimestamp)) {
    return generatedTimestamp + intervalMs;
  }

  return Date.now() + intervalMs;
}

async function main() {
  loadRepoEnv();
  const args = parseWorkerArgs(process.argv);
  const config = getAiNativeNarrativeConfig();
  const intervalMs = config.refreshIntervalSeconds * 1_000;
  const pollMs = args.pollSeconds * 1_000;
  const failureRetryMs = args.failureRetrySeconds * 1_000;
  let forceNextRun = args.force;
  let nextAttemptAt = Date.now();
  let shutdownRequested = false;
  const trigger = args.trigger || AI_NATIVE_NARRATIVE_PRIMARY_TRIGGER;

  const requestShutdown = (signal: string) => {
    shutdownRequested = true;
    console.log("[ai-native-narrative-worker] shutdown requested", {
      signal,
      requestedAt: new Date().toISOString(),
    });
  };

  process.on("SIGINT", () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));

  while (!shutdownRequested) {
    const waitMs = nextAttemptAt - Date.now();
    if (waitMs > 0) {
      await sleep(Math.min(waitMs, pollMs));
      continue;
    }

    try {
      const result = await executeRailwayAiNativeNarrativeRun({
        force: forceNextRun,
        trigger,
        runtimePath: AI_NATIVE_NARRATIVE_RAILWAY_DAEMON_RUNTIME_PATH,
      });
      forceNextRun = false;

      if (args.once) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      if (result.skipped && result.reason === "execution_lock") {
        nextAttemptAt = Date.now() + pollMs;
      } else {
        nextAttemptAt = resolveNextAttemptAt(
          "generatedAt" in result ? result.generatedAt : null,
          intervalMs,
        );
      }

      console.log("[ai-native-narrative-worker] next run scheduled", {
        nextAttemptAt: new Date(nextAttemptAt).toISOString(),
        intervalSeconds: config.refreshIntervalSeconds,
      });
    } catch (error) {
      if (args.once) {
        throw error;
      }

      nextAttemptAt = Date.now() + failureRetryMs;
      console.error("[ai-native-narrative-worker] run failed; retry scheduled", {
        error: String((error as Error)?.message ?? error),
        nextAttemptAt: new Date(nextAttemptAt).toISOString(),
        failureRetrySeconds: args.failureRetrySeconds,
      });
    }
  }
}

main().catch((error) => {
  console.error("[ai-native-narrative-worker] daemon crashed", error);
  process.exit(1);
});
