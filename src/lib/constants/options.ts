import { PlatformId } from "@/types/domain";

// Keep platform labels centralized for leaderboard/detail UI formatting.
export const PLATFORM_LABELS: Record<PlatformId, string> = {
  bluesky: "Bluesky",
  x: "X",
  reddit: "Reddit",
  telegram: "Telegram",
  youtube: "YouTube",
  tiktok: "TikTok",
  google: "Google",
  news: "News",
};
