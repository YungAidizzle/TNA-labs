from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.reddit_dev_only_config import REDDIT_ROTATION_LOOP_SLEEP_SECONDS  # noqa: E402
from backend.reddit_rotation import (  # noqa: E402
    reconcile_reddit_runtime_state,
    run_reddit_rotation_loop,
    run_reddit_rotation_once,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run phase-aware Reddit rotation continuously or once."
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Keep rotating Reddit buckets continuously.",
    )
    parser.add_argument(
        "--mode",
        choices=["auto", "live", "backfill"],
        default="auto",
        help="Force a mode or let the rotation policy choose automatically.",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=int,
        default=None,
        help="Loop sleep between iterations.",
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=None,
        help="Stop after this many iterations.",
    )
    parser.add_argument(
        "--skip-auxiliary",
        action="store_true",
        help="Skip public/news and Bluesky refreshes for this invocation.",
    )
    parser.add_argument(
        "--force-auxiliary",
        action="store_true",
        help="Force public/news and Bluesky refreshes for this invocation.",
    )
    parser.add_argument(
        "--no-replace-stale-worker",
        action="store_true",
        help="Do not replace an older-version Reddit rotation worker when starting the loop.",
    )
    parser.add_argument(
        "--reconcile-state",
        action="store_true",
        help="Normalize Reddit worker/schedule/snapshot state and exit.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    refresh_auxiliary = None
    if args.skip_auxiliary:
        refresh_auxiliary = False
    elif args.force_auxiliary:
        refresh_auxiliary = True

    if args.reconcile_state:
        print(json.dumps(reconcile_reddit_runtime_state(), indent=2))
        return 0

    if args.loop:
        return run_reddit_rotation_loop(
            mode=args.mode,
            sleep_seconds=(
                args.sleep_seconds
                if args.sleep_seconds is not None
                else REDDIT_ROTATION_LOOP_SLEEP_SECONDS
            ),
            max_iterations=args.max_iterations,
            refresh_auxiliary=refresh_auxiliary,
            replace_stale_worker=not args.no_replace_stale_worker,
        )

    exit_code, summary = run_reddit_rotation_once(
        mode=args.mode,
        refresh_auxiliary=refresh_auxiliary,
    )
    print(json.dumps(summary, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
