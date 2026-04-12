from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.db import PostgresStore
from backend.env import load_repo_env
from backend.logging_setup import setup_logging
from backend.trend_enrichment import (
    build_trend_title_generation_runtime_config_from_env,
    run_trend_title_generation_backfill_job,
)


def main() -> int:
    load_repo_env()
    setup_logging()
    logger = logging.getLogger("trend-title-backfill")
    database_url = str(os.getenv("DATABASE_URL", "")).strip()
    if not database_url:
        logger.error("trend_title_backfill_missing_database_url")
        return 1

    config = build_trend_title_generation_runtime_config_from_env()
    store = PostgresStore(
        database_url=database_url,
        batch_size=200,
        logger=logger,
    )
    try:
        summary = run_trend_title_generation_backfill_job(
            store=store,
            logger=logger,
            config=config,
            reason="manual_backfill",
        )
    finally:
        store.close()

    logger.log(
        logging.INFO if summary.get("coverage_complete") else logging.WARNING,
        "trend_title_backfill_complete summary=%s",
        summary,
    )
    return 0 if summary.get("coverage_complete") else 2


if __name__ == "__main__":
    sys.exit(main())
