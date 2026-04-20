import { NextRequest, NextResponse } from "next/server";
import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";
import { getLatestSuccessfulAiNativeNarrativeRunView } from "@/lib/ai-native-narratives/repository";
import {
  AI_NATIVE_NARRATIVE_AUTHORITATIVE_RUNTIME,
  AI_NATIVE_NARRATIVE_MANUAL_ROUTE_TRIGGER,
  AI_NATIVE_NARRATIVE_ROUTE_RUNTIME_PATH,
  AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
  AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
} from "@/lib/ai-native-narratives/scheduler";
import { runAiNativeNarrativePipeline } from "@/lib/ai-native-narratives/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const { cronSecrets } = getAiNativeNarrativeConfig();
  if (cronSecrets.length === 0) {
    return process.env.NODE_ENV !== "production";
  }

  const authorization = request.headers.get("authorization");
  return cronSecrets.some((secret) => authorization === `Bearer ${secret}`);
}

function resolveTrigger(request: NextRequest) {
  const raw =
    request.nextUrl.searchParams.get("trigger") ??
    request.headers.get("x-attentra-trigger") ??
    "";
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").slice(0, 64);
  return normalized || AI_NATIVE_NARRATIVE_MANUAL_ROUTE_TRIGGER;
}

function getRunNoteString(
  view: Awaited<ReturnType<typeof getLatestSuccessfulAiNativeNarrativeRunView>>,
  runKey: "latestRun" | "run" | "latestFailureRun",
  noteKey: string,
) {
  const value = view[runKey]?.notesJson?.[noteKey];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function handleRequest(request: NextRequest) {
  const config = getAiNativeNarrativeConfig();
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid admin refresh authorization.",
        },
      },
      { status: 401 },
    );
  }

  if (request.method === "GET") {
    const view = await getLatestSuccessfulAiNativeNarrativeRunView();
    return NextResponse.json({
      status: view.latestRun?.status ?? (view.run ? "succeeded" : "idle"),
      latestRunId: view.latestRun?.id ?? null,
      latestRunStatus: view.latestRun?.status ?? (view.run ? "succeeded" : "idle"),
      latestTrigger: view.latestRun?.trigger ?? null,
      latestGeneratedAt: view.latestRun?.generatedAt ?? null,
      latestCompletedAt: view.latestRun?.completedAt ?? null,
      latestErrorMessage: view.latestRun?.errorMessage ?? null,
      latestRuntimePath: getRunNoteString(view, "latestRun", "runtimePath"),
      latestExecutionEnvironment: getRunNoteString(view, "latestRun", "executionEnvironment"),
      latestSuccessfulRunId: view.run?.id ?? null,
      latestSuccessfulTrigger: view.run?.trigger ?? null,
      latestSuccessfulGeneratedAt: view.run?.generatedAt ?? null,
      latestSuccessfulCompletedAt: view.run?.completedAt ?? null,
      latestSuccessfulRuntimePath: getRunNoteString(view, "run", "runtimePath"),
      latestSuccessfulExecutionEnvironment: getRunNoteString(
        view,
        "run",
        "executionEnvironment",
      ),
      latestFailureRunId: view.latestFailureRun?.id ?? null,
      latestFailureTrigger: view.latestFailureRun?.trigger ?? null,
      latestFailureGeneratedAt: view.latestFailureRun?.generatedAt ?? null,
      latestFailureCompletedAt: view.latestFailureRun?.completedAt ?? null,
      latestFailureErrorMessage: view.latestFailureRun?.errorMessage ?? null,
      latestFailureRuntimePath: getRunNoteString(view, "latestFailureRun", "runtimePath"),
      latestFailureExecutionEnvironment: getRunNoteString(
        view,
        "latestFailureRun",
        "executionEnvironment",
      ),
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
      runtimePath: AI_NATIVE_NARRATIVE_ROUTE_RUNTIME_PATH,
      recentRuns: view.recentRuns.map((run) => ({
        id: run.id,
        status: run.status,
        trigger: run.trigger,
        generatedAt: run.generatedAt,
        completedAt: run.completedAt,
        candidateCount: run.candidateCount,
        evidenceCount: run.evidenceCount,
        narrativeCount: run.narrativeCount,
        modelName: run.modelName,
        promptVersion: run.promptVersion,
        errorMessage: run.errorMessage,
        notesJson: run.notesJson,
      })),
    });
  }

  try {
    const force = request.nextUrl.searchParams.get("force") === "true";
    const trigger = resolveTrigger(request);
    const result = await runAiNativeNarrativePipeline({
      force,
      trigger,
      runtimePath: AI_NATIVE_NARRATIVE_ROUTE_RUNTIME_PATH,
      executionEnvironment: "vercel",
      schedulerStrategy: AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
      schedulerLabel: AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
    });
    return NextResponse.json({
      ...result,
      expectedRefreshIntervalSeconds: config.refreshIntervalSeconds,
      freshnessWindowMinutes: config.freshnessWindowMinutes,
      schedulerStrategy: AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
      schedulerLabel: AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
      authoritativeRuntime: AI_NATIVE_NARRATIVE_AUTHORITATIVE_RUNTIME,
      cronAuthorizationConfigured: config.cronSecrets.length > 0,
      cronSecretSources: config.cronSecretNames,
      runtimePath: AI_NATIVE_NARRATIVE_ROUTE_RUNTIME_PATH,
      trigger,
    });
  } catch (error) {
    console.error("[ai-native-narratives-cron] worker failed", error);
    return NextResponse.json(
      {
        error: {
          code: "AI_NATIVE_NARRATIVE_WORKER_FAILED",
          message: String((error as Error)?.message ?? error ?? "Unknown worker failure."),
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}
