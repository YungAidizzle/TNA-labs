# Attention Ranking Terminal

Bluesky-first local/dev dashboard for ranking internet narratives and meme culture from a real persisted rolling 7-day dataset. The app now behaves like a local intelligence engine: it can chronologically backfill the last 7 days by subreddit bucket, keep that window fresh with live maintenance runs, tail the Bluesky firehose through Jetstream with a durable cursor, and keep the dashboard populated from stored records even when the latest fetch is partial or fails.

## Stack

- Next.js App Router + React 19 + TypeScript
- Tailwind CSS v4 + custom theme tokens
- TanStack Query for client data loading
- Apache ECharts for analytical charts
- Supabase (Postgres) for persisted trend/topic analytics
- Python ingestion pipeline with local JSON persistence

## Run

```bash
pnpm install
pnpm dev:live
```

Open `http://localhost:3000`.

`pnpm dev:live` now starts the authoritative `backend.main` worker, so trend naming is generated upstream and persisted independently of page loads.

Use `pnpm dev` if you only want the Next.js app.
Use `pnpm worker:bluesky:once` to run one ingestion/title/enrichment pass and wait for secondary naming jobs to drain before exit.
Use `pnpm worker:trend-names:backfill` to force a top-250 naming backfill without waiting for a page request.

Cost controls:

- Request-path AI naming is not a supported production path. Keep `ALLOW_REQUEST_PATH_VISIBLE_TOPIC_ENRICHMENT=false`.
- The title worker is the cheap, always-on naming path. It now targets the top 250 active trends by default and persists `ai_display_name` upstream before the dashboard reads it.
- Full narrative enrichment is expensive and is disabled by default in `.env.example`. Only enable `BLUESKY_TREND_ENRICHMENT_ENABLED=true` if you explicitly need richer summaries, not just leaderboard names.
- If you are chasing spend, reduce call frequency first. Do not tighten refresh loops before reducing `BLUESKY_TREND_TITLE_INTERVAL_SECONDS`, `BLUESKY_TREND_TITLE_MAX_TOPICS_PER_PASS`, and hash-change refresh cadence.

Operational diagnostics:

- Runbook: `docs/topic-ai-ops.md`
- SQL pack: `scripts/sql/topic_ai_ops_diagnostics.sql`
- The dashboard API now emits writer/count/token headers so unknown writers, legacy prompt versions, and duplicate reruns are visible from live responses.

## Handoff Rules

- For any database change, SQL must be pasted directly in chat for execution.
- Do not hand off SQL as a file link only.
- Do not provide SQL as a markdown link, path reference, or "see migration file" instruction.

## Source Setup

1. Edit the dev-only Reddit credentials and local ingestion settings:

```text
backend/reddit_dev_only_config.py
```

2. Install the Python dependency if you want authenticated PRAW access:

```bash
pip install -r requirements.txt
```

3. Run a full live maintenance sweep:

```bash
pnpm fetch:reddit
```

4. Run a full historical backfill sweep:

```bash
pnpm fetch:reddit:backfill
```

The ingestion system now has two modes:

- `backfill`: walks `new` chronologically across every configured bucket until each subreddit crosses the 7-day cutoff or exhausts available listing pages
- `live`: fetches current `new`/`hot`/`rising` posts across every configured bucket and revisits active known posts for new comments

Both modes:

- persist posts, comments, source health, run metadata, and schedule state
- dedupe by stable Reddit ids
- prune stale records outside the rolling 7-day window
- advance their own bucket pointers for the next run
- write a dashboard snapshot from rolling persisted data

The dashboard reads from:

```text
data/reddit_engine/dashboard_snapshot.json
```

If there is no persisted data yet, the app renders zero-state. If a later fetch fails, the dashboard keeps serving the most recent persisted snapshot and shows degraded freshness instead of wiping to empty.

## Local Storage Layout

All local-dev ingestion state is stored under:

```text
data/reddit_engine/
```

Files:

- `posts.json`: persisted Reddit thread records
- `comments.json`: persisted Reddit comment records
- `runs.json`: recent ingestion run metadata
- `sources.json`: per-subreddit health/freshness state
- `schedule.json`: rotating bucket cursors and bucket definitions for both live and backfill modes
- `dashboard_snapshot.json`: rolling snapshot consumed by the Next.js app
- `public_items.json`: persisted public-source documents, including YouTube videos
- `bluesky_firehose_state.json`: persisted Bluesky firehose cursor, lag, and sync state
- `youtube_comments.json`: persisted YouTube top-level comments and replies
- `youtube_video_snapshots.json`: repeated YouTube stat snapshots used for delta-aware timing
- `youtube_channels.json`: discovered YouTube channel state used for broader expansion lanes

## Bucket Rotation

- The tracked subreddit set is split into stable buckets.
- `pnpm fetch:reddit:backfill` processes every bucket in backfill mode.
- `pnpm fetch:reddit` or `pnpm fetch:reddit:live` processes every bucket in live mode.
- `pnpm fetch:reddit:backfill:once` processes only the current backfill bucket.
- `pnpm fetch:reddit:live:once` processes only the current live bucket.
- Successful records are upserted immediately by Reddit id.
- Partial failures are recorded per subreddit and do not block the rest of the run.
- Each mode advances its own persisted bucket pointer independently.

## 7-Day Data Model

- Backfill mode uses `new` as the primary chronological source and stops when posts become older than the rolling 7-day cutoff.
- Live mode keeps the 7-day dataset current by adding fresh posts and refreshing comments on active known threads.
- The dashboard’s `7d` range reads from the stored 7-day posts/comments in `dashboard_snapshot.json`, not from whatever Reddit happens to surface as hot right now.
- Comments remain the primary interaction signal; post creation is discovery/origin only.

Current sizing is configured in:

```text
backend/reddit_dev_only_config.py
```

Key knobs:

- `BUCKET_SIZE`
- `MAX_SUBREDDITS_PER_RUN`
- `FETCH_LIMIT`
- `LIVE_FETCH_LIMIT`
- `LIVE_LISTINGS`
- `MAX_TRACKED_POSTS`
- `MAX_COMMENTS_PER_POST`
- `COMMENT_THRESHOLD_FOR_EXPANSION`
- `ROLLING_WINDOW_HOURS`
- `BACKFILL_PAGE_LIMIT`
- `BACKFILL_MAX_POSTS_PER_SUBREDDIT`
- `BACKFILL_MAX_PAGES_PER_SUBREDDIT`
- `BACKFILL_MAX_COMMENT_THREADS_PER_SUBREDDIT`
- `LIVE_MAX_KNOWN_POSTS_TO_REFRESH`
- `ACTIVE_POST_LOOKBACK_HOURS`

YouTube discovery and refresh sizing is configured in:

```text
backend/youtube_config.py
```

Key YouTube knobs:

- `YOUTUBE_DISCOVERY_QUERIES`
- `YOUTUBE_MAX_KEYWORD_QUERIES_PER_RUN`
- `YOUTUBE_MAX_BREAKOUT_QUERIES_PER_RUN`
- `YOUTUBE_SEARCH_RESULTS_PER_QUERY`
- `YOUTUBE_MAX_RELATED_SEEDS_PER_RUN`
- `YOUTUBE_MAX_RELATED_RESULTS_PER_SEED`
- `YOUTUBE_MAX_CHANNEL_EXPANSIONS_PER_RUN`
- `YOUTUBE_MAX_TRACKED_VIDEOS_PER_RUN`
- `YOUTUBE_MAX_COMMENT_VIDEOS_PER_RUN`
- `YOUTUBE_COMMENT_THREADS_PER_VIDEO`
- `YOUTUBE_COMMENT_REPLIES_PER_THREAD`
- `YOUTUBE_MAX_SNAPSHOTS_PER_VIDEO`
- `YOUTUBE_QUOTA_BUDGET_PER_RUN`

## Freshness And Health

The app computes ingestion health from persisted local state, including:

- freshness state: `fresh`, `delayed`, `degraded`, `stale`, `empty`
- coverage score
- freshness score
- fetch success rate
- active subreddit count
- refreshed source percentages for `1h`, `6h`, and `24h`
- average source age
- latest successful run timestamp
- sources covered inside the 7-day window
- completed 7-day backfill sources
- backfill completeness estimate
- stored posts/comments inside the rolling 7-day window
- oldest stored post in the current 7-day dataset

Trend confidence is freshness-aware and historical-coverage-aware: deep multi-thread narratives still score well, but stale or incomplete 7-day source coverage lowers confidence.

## Scripts

```bash
pnpm dev
pnpm dev:live
pnpm worker:bluesky
pnpm worker:bluesky:once
pnpm worker:bluesky:verify-db
pnpm fetch:reddit
pnpm fetch:reddit:live
pnpm fetch:reddit:live:once
pnpm fetch:reddit:backfill
pnpm fetch:reddit:backfill:once
pnpm fetch:bluesky:firehose
pnpm fetch:bluesky:firehose:live
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

## Architecture Notes

- `src/lib/dashboard/service.ts` now routes trend reads by feature flag:
  - `USE_SUPABASE_TRENDS=true`: reads trends/topics from Supabase (`v_topic_trends_1m`, fallback `topic_buckets_1m`)
  - `USE_SUPABASE_TRENDS=false`: uses the legacy local runtime snapshot path
- `src/lib/dashboard/supabase-trends.ts` maps Supabase topic bucket data into dashboard-ready `TrendDashboardVM` objects.
- `src/lib/supabase/server.ts` provides a server-only Supabase client and trend-source flag helpers.
- `src/lib/dashboard/runtime-store.ts` remains a legacy fallback path while Supabase is being verified.
- `src/lib/reddit/local-store.ts` reads `data/reddit_engine/dashboard_snapshot.json`.
- `src/lib/adapters/analytics.ts` builds rolling trend objects from persisted 7-day posts/comments and applies freshness-aware confidence.
- `src/lib/dashboard/zero-state.ts` is the single source of truth for empty dashboard defaults.
- `backend/reddit_fetcher.py` fetches chronological backfill posts, live posts, and bounded comments.
- `backend/reddit_ingestion.py` orchestrates backfill/live runs, persistence, pruning, and snapshot writes.
- `backend/reddit_persistence.py` stores posts/comments/runs/source health/schedule state.
- `backend/bluesky_firehose.py` tails the Bluesky firehose via Jetstream, derives rolling post and interaction records, and persists firehose cursor state.
- `backend/main.py` is the authoritative persistent worker for ingestion, title generation, enrichment, and memecoin correlation.
- `backend/bluesky_refresh.py` remains as a legacy fallback path if firehose sync fails.
- `backend/youtube_refresh.py` expands YouTube beyond curated channels with keyword, breakout, related-video, and channel-expansion discovery plus comment and snapshot persistence.
- `backend/reddit_scheduler.py` manages separate stable bucket rotation for live and backfill modes.
- `backend/reddit_snapshot.py` builds the rolling 7-day dashboard snapshot and ingestion health summary.
- `backend/reddit_window.py` defines rolling-window cutoff and pruning logic.
- `scripts/fetch_reddit_live.py` is the manual live maintenance entrypoint.
- `scripts/fetch_reddit_backfill.py` is the manual historical backfill entrypoint.
- `scripts/fetch_bluesky_firehose.py` is the legacy manual Bluesky firehose sync entrypoint.

## Notes

- Bluesky is now the primary source, with Reddit, Google Trends, RSS/news, HN/Lobsters, Telegram, and optional YouTube ingestion wired into the same narrative pipeline.
- Storage is local JSON for development simplicity and inspectability.
- The persistence boundary is isolated enough to swap later for SQLite or server-side storage.
- Comment expansion is intentionally bounded and configurable; it revisits the strongest known posts in live mode and the strongest discovered posts in backfill mode.
