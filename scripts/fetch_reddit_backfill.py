from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.reddit_ingestion import print_summary, run_reddit_ingestion  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Reddit backfill ingestion.")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Process every configured subreddit bucket once.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    exit_code, summary = run_reddit_ingestion("backfill", run_all_buckets=args.all)
    print_summary(summary)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
