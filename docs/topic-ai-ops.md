# Topic AI Ops

## Architecture

- Request-path topic naming is permanently disabled.
- The authoritative title writer is `backend.main:trend_title_generation`.
- The authoritative full enrichment writer is `backend.main:trend_enrichment`.
- The dashboard reads persisted names from `public.topic_ai_enrichments`, preferring `ai_display_name`.
- Cheap title generation is the default. Full enrichment is opt-in and higher cost.
- The title backfill job is `pnpm worker:trend-names:backfill` and must cover the top 250 active trends.

## Default operating mode

- `BLUESKY_TREND_TITLE_ENABLED=true`
- `BLUESKY_TREND_ENRICHMENT_ENABLED=false`
- `ALLOW_REQUEST_PATH_VISIBLE_TOPIC_ENRICHMENT=false`
- `TOPIC_AI_WRITER_DIAGNOSTICS_INTERVAL_SECONDS=600`

## Immediate stale-writer checklist

1. Run the diagnostics in `scripts/sql/topic_ai_ops_diagnostics.sql`.
2. Check `active writers last 24h` and `active writers last 7d`.
3. If `writer_identity='unknown'` appears in recent writes, an external stale deployment is still alive.
4. Compare recent run writers to `public.topic_ai_writer_heartbeats`.
5. If recent writes exist without a matching fresh heartbeat, the codebase is not the only active writer.
6. Check `refresh_reason` distribution and duplicate topic runs. High `input_hash_changed` counts indicate hash churn rather than real title decay.
7. Check token usage by writer/model/prompt before changing models. Re-run volume is usually the real cost bug.

## Safety rules

- Do not re-enable request-path naming.
- Do not enable full enrichment just to improve leaderboard labels.
- Do not treat `unknown` or non-authoritative writes as acceptable production state.
- Do not trust a deployment if it is writing with an unexpected `prompt_version` or without a heartbeat.

## What “healthy” looks like

- Recent writes come from one or two known writer identities only.
- `unknown` writer rows in the last 24h are zero.
- Duplicate writes per topic stay low.
- Title usage totals are small and predictable.
- Good authoritative titles persist for hours or days without reruns.
