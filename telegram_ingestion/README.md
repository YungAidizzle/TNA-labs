# Telegram Ingestion Operator Guide

This subsystem is a local-first Telegram ingestion service built on TDLib / MTProto, not the Bot API. It is intended for a single operator on Windows who authenticates a user account once, persists the TDLib session locally, and then backfills and incrementally syncs a configured set of public channels into SQLite.

## What This Service Stores

Each ingested message is normalized into a stable record with:

- `platform`
- `channel_id`
- `channel_name`
- `message_id`
- `timestamp`
- `text`
- `views`
- `forward_count`
- `reply_count`
- `media_type`
- `message_url`
- `raw_json`

The service also tracks per-channel sync state so backfill and incremental sync can resume cleanly after interruption.

## TDLib Expectations

TDLib is the official Telegram client library for building full Telegram clients. It handles session persistence, encryption, updates, and local storage. Official TDLib docs describe the authorization states you must handle, including `authorizationStateWaitTdlibParameters`, `authorizationStateWaitPhoneNumber`, `authorizationStateWaitCode`, `authorizationStateWaitPassword`, and `authorizationStateReady`.

For this project:

- Use a Telegram user account, not a bot token.
- Keep `TDLIB_DATABASE_DIR` on local disk.
- Do not delete the TDLib database directory if you want the login session to persist.
- Keep the session tied to one operator account and one database directory.
- Store the TDLib binaries so `tdjson.dll` and its dependent DLLs are discoverable on `PATH` or colocated with the runtime.

Official references:

- TDLib overview: https://core.telegram.org/tdlib
- TDLib docs: https://core.telegram.org/tdlib/docs/
- `setTdlibParameters`: https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1set_tdlib_parameters-members.html
- `authorizationStateWaitPhoneNumber`: https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1authorization_state_wait_phone_number.html
- `authorizationStateWaitPassword`: https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1authorization_state_wait_password.html

## Windows Setup

1. Install Python 3.11 or newer.
2. Install the Python `tdjson` wheel or download/build a Windows TDLib distribution that provides `tdjson.dll` and its dependent DLLs.
3. Put the TDLib binaries in a directory that Windows can resolve at runtime if you are not using the bundled `tdjson` wheel.
4. Clone or unpack this project and change into `telegram_ingestion`.
5. Create and activate a virtual environment:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
```

If PowerShell blocks the activation script, allow local scripts for the current user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

6. Install the project into the virtual environment once the package files are present:

```powershell
pip install -e .
```

On Windows, this install also pulls the `tdjson` wheel, which bundles TDLib and its dependent DLLs. With that wheel installed, the CLI can discover the library automatically and you usually do not need to set `TDLIB_LIBRARY_PATH` or `TDLIB_LIBRARY_DIR`.

If you want to run the included tests locally:

```powershell
pip install -e .[test]
```

7. Copy `.env.example` to `.env.local` and fill in the credentials and paths.
8. Ensure the directories used by `TDLIB_DATABASE_DIR` and `SQLITE_PATH` exist or can be created by the service.

For a session where `tdjson.dll` is not on global `PATH`, you can add the TDLib bin directory for that shell before running the CLI:

```powershell
$env:PATH = "C:\path\to\tdlib\bin;$env:PATH"
```

## Environment Variables

Set these before running any command:

- `TELEGRAM_API_ID`: Telegram developer application ID from `my.telegram.org`.
- `TELEGRAM_API_HASH`: Telegram developer application hash from `my.telegram.org`.
- `TDLIB_DATABASE_DIR`: Persistent local directory used by TDLib for session state and local storage.
- `TDLIB_SESSION_NAME`: Optional subdirectory name under `TDLIB_DATABASE_DIR` for one persisted session.
- `TDLIB_FILES_DIR`: Optional TDLib files directory. Defaults to `<TDLIB_DATABASE_DIR>\<TDLIB_SESSION_NAME>\files`.
- `TDLIB_LIBRARY_PATH`: Optional full path to `tdjson.dll`.
- `TDLIB_LIBRARY_DIR`: Optional directory containing `tdjson.dll` and its dependent DLLs.
- `SQLITE_PATH`: SQLite database file used by the ingestion service.
- `TELEGRAM_CHANNELS`: Comma-separated list of public channels to monitor.
- `LOG_LEVEL`: Logging verbosity, such as `INFO`, `DEBUG`, `WARNING`, or `ERROR`.
- `OPENAI_API_KEY`: Optional. Required only for GPT-based trend grouping.
- `OPENAI_TREND_MODEL`: Optional default OpenAI model for trend grouping. Defaults to `gpt-5-mini`.
- `OPENAI_TELEGRAM_TREND_MODEL`: Optional Telegram-specific override for trend grouping.

Recommended practice:

- Keep `TDLIB_DATABASE_DIR` and `SQLITE_PATH` on local disk.
- Do not place them in a cloud-synced folder.
- Keep a single TDLib database per Telegram account.

## Command Line Flow

The CLI is organized around a small operator workflow.

### 1. Authenticate

```powershell
python -m telegram_ingest auth
```

Use this once per Telegram account and TDLib database directory. TDLib will walk through the required login states and may prompt for:

- phone number
- login code
- two-factor password, if enabled
- confirmation on another device, if Telegram requires it

### 2. Validate Channels

```powershell
python -m telegram_ingest channels validate
```

Validates the configured channel list and reports which entries resolve to public channels that the authenticated account can read.

### 3. Backfill One Channel

```powershell
python -m telegram_ingest backfill --channel <public-channel-username> --limit <message-count>
```

Backfills a single channel in batches. Use this for first-time capture or when you want to seed one source before expanding.

### 4. Backfill All Configured Channels

```powershell
python -m telegram_ingest backfill-all
```

Backfills every configured channel and advances per-channel checkpoints as it goes.

### 5. Run One Incremental Sync

```powershell
python -m telegram_ingest sync-once
```

Fetches new messages since the last saved checkpoint for each configured channel.

### 6. Run a Sync Loop

```powershell
python -m telegram_ingest sync-loop --interval <seconds>
```

Runs incremental sync on a repeating interval. Use this when you want the local store to stay fresh without manual intervention.

### 7. Inspect Service Health

```powershell
python -m telegram_ingest stats
```

Reports:

- total configured channels
- resolved channels
- total stored messages
- latest message timestamp per channel
- last sync status per channel

### 8. Group Recent Messages Into Trends

```powershell
python -m telegram_ingest trends group
```

This reads recent stored Telegram messages from SQLite, calls the OpenAI Responses API, and writes a grouped trend snapshot to `runtime\telegram_trends.json`.

The runtime snapshot now preserves both:

- grouped GPT trend labels
- the sampled Telegram message set used to build them

That lets downstream analytics cluster Telegram chatter from the preserved message pool instead of treating the GPT trend list as the only source of truth.

Useful flags:

- `--hours <n>`: lookback window for recent messages
- `--limit <n>`: maximum total messages sampled for grouping
- `--per-channel-limit <n>`: cap sampled messages per channel
- `--min-text-length <n>`: ignore very short posts
- `--max-trends <n>`: maximum number of grouped trends to return

### 9. Inspect One Channel

```powershell
python -m telegram_ingest inspect-channel --channel <public-channel-username> --limit <message-count>
```

Shows the most recent normalized messages and the stored sync state for one channel.

## Safe Operator Practices

- Use only public channels you are allowed to monitor.
- Keep the service read-only with respect to Telegram content.
- Do not try to bypass Telegram limits or access controls.
- Keep the TDLib database and SQLite file local and backed up carefully.
- Treat the local database as sensitive because it can contain message text and raw payloads.
- Start with a single channel and a small backfill limit before scaling to the full list.

## Known Limitations

- TDLib session initialization depends on the local `tdjson.dll` build and its dependencies being available.
- Private channels, inaccessible channels, or channels the account cannot read will not sync successfully.
- Telegram rate limits still apply; large backfills should be done in batches.
- History may change if messages are edited or deleted after ingestion.
- Public-channel availability can change over time, so validation should be rerun if a channel stops resolving.
- GPT-based trend grouping depends on a valid `OPENAI_API_KEY` and current OpenAI model access.

## Recovery And Restart

If the process is interrupted:

- Restart with the same `TDLIB_DATABASE_DIR` and `SQLITE_PATH`.
- Run `sync-once` to resume incremental ingestion.
- Use `stats` to confirm the last checkpoint and message counts.
- If a channel failed partway through backfill, rerun `backfill --channel ...` with the same channel and a conservative limit.

## Minimal Operator Flow

1. Fill `.env.local`.
2. Run `auth`.
3. Run `channels validate`.
4. Run `backfill --channel ...` for a single public channel.
5. Run `backfill-all` when the first channel looks correct.
6. Switch to `sync-once` or `sync-loop --interval ...` for incremental updates.
7. Use `stats` and `inspect-channel` for routine checks.
