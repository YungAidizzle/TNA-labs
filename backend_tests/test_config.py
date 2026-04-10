import os
import unittest
from unittest.mock import patch

from backend.config import MIN_RAW_RETENTION_HOURS_FOR_24H_TRENDS, WorkerConfig


class WorkerConfigTests(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "DATABASE_URL": "postgresql://example",
            "BLUESKY_RAW_RETENTION_HOURS": "1",
        },
        clear=False,
    )
    def test_raw_retention_is_clamped_for_24h_trend_history(self):
        config = WorkerConfig.from_env()
        self.assertEqual(
            config.raw_retention_hours,
            MIN_RAW_RETENTION_HOURS_FOR_24H_TRENDS,
        )


if __name__ == "__main__":
    unittest.main()
