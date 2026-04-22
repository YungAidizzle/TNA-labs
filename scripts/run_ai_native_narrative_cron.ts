import {
  AI_NATIVE_NARRATIVE_PRIMARY_TRIGGER,
  AI_NATIVE_NARRATIVE_RAILWAY_CRON_RUNTIME_PATH,
} from "@/lib/ai-native-narratives/scheduler";
import { closeServerPostgresPool } from "@/lib/db/server-postgres";
import {
  executeRailwayAiNativeNarrativeRun,
  loadRepoEnv,
  parseWorkerArgs,
} from "./lib/ai-native-narrative-runtime";

async function main() {
  loadRepoEnv();
  const args = parseWorkerArgs(process.argv);

  try {
    const result = await executeRailwayAiNativeNarrativeRun({
      force: args.force,
      trigger: args.trigger || AI_NATIVE_NARRATIVE_PRIMARY_TRIGGER,
      runtimePath: AI_NATIVE_NARRATIVE_RAILWAY_CRON_RUNTIME_PATH,
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await closeServerPostgresPool();
  }
}

main().catch((error) => {
  console.error("[ai-native-narrative-worker] cron run failed", error);
  process.exit(1);
});
