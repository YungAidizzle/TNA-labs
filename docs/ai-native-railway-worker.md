# AI-native Railway Worker

Railway is the authoritative hourly execution environment for AI-native trend generation. The worker runs `runAiNativeNarrativePipeline()` directly and writes run diagnostics into `public.ai_narrative_runs`.

## Production Setup

Create a dedicated Railway service from the repo root.

This repository root also contains the web app deployment defaults (`Dockerfile` and `railpack.json`).
The AI-native worker is not in its own subdirectory, so the worker service must keep the Railway Root Directory at `/`.
For the worker service, point Railway config-as-code at `/railway.worker.json` so the service builds from `/Dockerfile.railway-worker` instead of the web app image.

- Runtime: `Node`
- Source repo branch: `main`
- Root Directory: `/`
- Dockerfile path: `/Dockerfile.railway-worker`
- Start command: `pnpm worker:narratives:cron`
- Cron Schedule: `0 * * * *` (UTC)
- Instances: `1`
- Restart policy: `NEVER`

Required environment variables:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `ENABLE_AI_NATIVE_NARRATIVES=true`

Optional AI-native worker variables:

- `AI_NATIVE_NARRATIVE_REFRESH_INTERVAL_SECONDS=3600`
- `AI_NATIVE_NARRATIVE_FRESHNESS_MINUTES=180`
- `AI_NATIVE_NARRATIVE_DISCOVERY_BATCHES=4`
- `AI_NATIVE_NARRATIVE_DISCOVERY_CANDIDATES=240`
- `AI_NATIVE_NARRATIVE_SELECTION_CANDIDATES=140`
- `AI_NATIVE_NARRATIVE_FINAL_COUNT=100`
- `AI_NATIVE_NARRATIVE_EVIDENCE_PER_CANDIDATE=3`
- `AI_NATIVE_NARRATIVE_MODEL=gpt-5-mini`

Manual/admin-only Vercel route secrets:

- `CRON_SECRET`
- `ATTENTRA_CRON_SECRET`

The Railway cron job writes `trigger=railway-hourly-worker` and `runtimePath=railway_hourly_cron` into each run row. The dashboard and `/api/cron/ai-native-narratives` read those diagnostics back from the DB.

## Operational Commands

One-shot direct worker run:

```bash
pnpm worker:narratives:refresh
```

Forced one-shot direct worker run:

```bash
pnpm worker:narratives:refresh:force
```

Manual Vercel route refresh, if you still want an admin backdoor:

```bash
pnpm worker:narratives:refresh:route
```

## Verification

1. Deploy the Railway worker service with `pnpm worker:narratives:cron`.
2. Confirm Railway logs show `trigger: railway-hourly-worker` and `runtimePath: railway_hourly_cron`.
3. Wait for the next run, then query `/api/cron/ai-native-narratives` with the admin secret.
4. Verify:
   - `latestTrigger = railway-hourly-worker`
   - `latestRunStatus = succeeded`
   - `latestRuntimePath = railway_hourly_cron`
   - `schedulerStrategy = railway_worker_hourly_authoritative`
5. Open the dashboard status panel and verify `Trigger`, `Scheduler`, and `Runtime` show Railway-owned execution.
