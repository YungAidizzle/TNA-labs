# GPT Trend Refresh Ops

The GPT trend system is triggered through the production route below.

## Production endpoint

`POST https://www.attentra.net/api/cron/gpt-trends?force=true`

## Authentication

Set the `Authorization` header to:

```text
Bearer <CRON_SECRET>
```

`CRON_SECRET` must match the `CRON_SECRET` environment variable configured in production.

## Recommended schedule

Run the request hourly.

Recommended cron expression for an external scheduler:

```text
0 * * * *
```

## Example request

```bash
curl -X POST "https://www.attentra.net/api/cron/gpt-trends?force=true" \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Expected success responses

Fresh snapshot written:

```json
{
  "skipped": false,
  "snapshotId": "123",
  "trendCount": 100,
  "generatedAt": "2026-04-13T07:43:50.400Z"
}
```

Skipped because the latest snapshot is still within the refresh interval:

```json
{
  "skipped": true,
  "reason": "interval_guard",
  "snapshotId": "123",
  "generatedAt": "2026-04-13T07:43:50.400Z"
}
```

Unauthorized request:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid cron authorization."
  }
}
```

## Verification

Confirm the route exists:

```bash
curl -i "https://www.attentra.net/api/cron/gpt-trends"
```

Expected without auth in production: `401 Unauthorized`

Confirm a new snapshot row was written:

```sql
SELECT id, status, generated_at, completed_at, trend_count, model_name, prompt_version
FROM public.trend_snapshots
ORDER BY generated_at DESC, id DESC
LIMIT 5;
```

Confirm 100 items were written for the latest snapshot:

```sql
SELECT count(*) AS item_count
FROM public.trend_snapshot_items
WHERE snapshot_id = (
  SELECT id
  FROM public.trend_snapshots
  WHERE status = 'succeeded'
  ORDER BY generated_at DESC, id DESC
  LIMIT 1
);
```

Confirm `/trends` is showing the latest stored board:

1. Open `https://www.attentra.net/trends`
2. Compare the top rendered trend title with:

```sql
SELECT rank, title, summary, confidence_score, ai_rank_score, category
FROM public.trend_snapshot_items
WHERE snapshot_id = (
  SELECT id
  FROM public.trend_snapshots
  WHERE status = 'succeeded'
  ORDER BY generated_at DESC, id DESC
  LIMIT 1
)
ORDER BY rank ASC
LIMIT 1;
```
