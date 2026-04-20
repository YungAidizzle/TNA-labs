import {
  AI_NATIVE_NARRATIVE_RAILWAY_MANUAL_TRIGGER,
  AI_NATIVE_NARRATIVE_RAILWAY_ONCE_RUNTIME_PATH,
} from "@/lib/ai-native-narratives/scheduler";
import {
  executeRailwayAiNativeNarrativeRun,
  loadRepoEnv,
  parseWorkerArgs,
} from "./lib/ai-native-narrative-runtime";

async function main() {
  loadRepoEnv();
  const args = parseWorkerArgs(process.argv);
  const result = await executeRailwayAiNativeNarrativeRun({
    force: args.force,
    trigger: args.trigger || AI_NATIVE_NARRATIVE_RAILWAY_MANUAL_TRIGGER,
    runtimePath: AI_NATIVE_NARRATIVE_RAILWAY_ONCE_RUNTIME_PATH,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error("[ai-native-narrative-worker] one-shot run failed", error);
  process.exit(1);
});
