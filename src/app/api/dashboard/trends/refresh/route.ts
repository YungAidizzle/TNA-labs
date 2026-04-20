import { NextRequest, NextResponse } from "next/server";
import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";
import { getLatestSuccessfulAiNativeNarrativeRunView } from "@/lib/ai-native-narratives/repository";
import {
  AI_NATIVE_NARRATIVE_AUTHORITATIVE_RUNTIME,
  AI_NATIVE_NARRATIVE_DASHBOARD_RUNTIME_PATH,
  AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
  AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
} from "@/lib/ai-native-narratives/scheduler";
import { runAiNativeNarrativePipeline } from "@/lib/ai-native-narratives/worker";
import { requirePaidApiUser } from "@/lib/supabase/auth";

export async function GET() {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const view = await getLatestSuccessfulAiNativeNarrativeRunView();
  const config = getAiNativeNarrativeConfig();
  return NextResponse.json({
    status: view.latestRun?.status ?? (view.run ? "succeeded" : "idle"),
    latestRunId: view.latestRun?.id ?? null,
    latestRunStatus: view.latestRun?.status ?? (view.run ? "succeeded" : "idle"),
    latestTrigger: view.latestRun?.trigger ?? null,
    latestGeneratedAt: view.latestRun?.generatedAt ?? null,
    latestCompletedAt: view.latestRun?.completedAt ?? null,
    latestErrorMessage: view.latestRun?.errorMessage ?? null,
    latestRuntimePath:
      typeof view.latestRun?.notesJson?.runtimePath === "string"
        ? view.latestRun.notesJson.runtimePath
        : null,
    latestExecutionEnvironment:
      typeof view.latestRun?.notesJson?.executionEnvironment === "string"
        ? view.latestRun.notesJson.executionEnvironment
        : null,
    latestSuccessfulRunId: view.run?.id ?? null,
    latestSuccessfulTrigger: view.run?.trigger ?? null,
    latestSuccessfulGeneratedAt: view.run?.generatedAt ?? null,
    latestSuccessfulCompletedAt: view.run?.completedAt ?? null,
    latestSuccessfulRuntimePath:
      typeof view.run?.notesJson?.runtimePath === "string" ? view.run.notesJson.runtimePath : null,
    latestSuccessfulExecutionEnvironment:
      typeof view.run?.notesJson?.executionEnvironment === "string"
        ? view.run.notesJson.executionEnvironment
        : null,
    latestFailureRunId: view.latestFailureRun?.id ?? null,
    latestFailureTrigger: view.latestFailureRun?.trigger ?? null,
    latestFailureGeneratedAt: view.latestFailureRun?.generatedAt ?? null,
    latestFailureCompletedAt: view.latestFailureRun?.completedAt ?? null,
    latestFailureErrorMessage: view.latestFailureRun?.errorMessage ?? null,
    latestFailureRuntimePath:
      typeof view.latestFailureRun?.notesJson?.runtimePath === "string"
        ? view.latestFailureRun.notesJson.runtimePath
        : null,
    latestFailureExecutionEnvironment:
      typeof view.latestFailureRun?.notesJson?.executionEnvironment === "string"
        ? view.latestFailureRun.notesJson.executionEnvironment
        : null,
    candidateCount: view.run?.candidateCount ?? 0,
    evidenceCount: view.run?.evidenceCount ?? 0,
    narrativeCount: view.run?.narrativeCount ?? 0,
    servedNarrativeCount: view.narratives.length,
    freshNarrativeCount: view.boardFreshCount,
    backfillNarrativeCount: view.boardBackfillCount,
    boardTargetCount: view.boardTargetCount,
    boardHasFullTarget: view.boardHasFullTarget,
    modelName: view.run?.modelName ?? null,
    promptVersion: view.run?.promptVersion ?? null,
    freshnessMinutes: view.freshnessMinutes,
    expectedRefreshIntervalSeconds: config.refreshIntervalSeconds,
    freshnessWindowMinutes: config.freshnessWindowMinutes,
    schedulerStrategy: AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
    schedulerLabel: AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
    authoritativeRuntime: AI_NATIVE_NARRATIVE_AUTHORITATIVE_RUNTIME,
    cronAuthorizationConfigured: config.cronSecrets.length > 0,
    cronSecretSources: config.cronSecretNames,
    recentRuns: view.recentRuns,
  });
}

export async function POST(request: NextRequest) {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { searchParams } = new URL(request.url);
  const config = getAiNativeNarrativeConfig();
  const force = searchParams.get("force") === "true";
  const trigger = searchParams.get("trigger")?.trim() || "api-trigger";
  const result = await runAiNativeNarrativePipeline({
    force,
    trigger,
    runtimePath: AI_NATIVE_NARRATIVE_DASHBOARD_RUNTIME_PATH,
    executionEnvironment: "vercel",
    schedulerStrategy: AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
    schedulerLabel: AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
  });
  return NextResponse.json(
    {
      ...result,
      expectedRefreshIntervalSeconds: config.refreshIntervalSeconds,
      freshnessWindowMinutes: config.freshnessWindowMinutes,
      schedulerStrategy: AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
      schedulerLabel: AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
      authoritativeRuntime: AI_NATIVE_NARRATIVE_AUTHORITATIVE_RUNTIME,
      runtimePath: AI_NATIVE_NARRATIVE_DASHBOARD_RUNTIME_PATH,
      trigger,
    },
    { status: 202 },
  );
}
