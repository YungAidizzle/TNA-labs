import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { NormalizedInteractionCounts, PublicSourceItem } from "@/lib/reddit/types";

export const TELEGRAM_TRENDS_FILE_PATH = path.join(
  process.cwd(),
  "telegram_ingestion",
  "runtime",
  "telegram_trends.json",
);

type TelegramRepresentativeMessage = {
  source_id?: string;
  channel_name?: string;
  timestamp?: string;
  text?: string;
  message_url?: string | null;
  engagement_score?: number;
};

type TelegramSampledMessage = TelegramRepresentativeMessage & {
  channel_id?: number;
  message_id?: number;
  views?: number | null;
  forward_count?: number | null;
  reply_count?: number | null;
  assigned_trend_id?: string | null;
  assigned_trend_label?: string | null;
  ignored?: boolean;
};

type TelegramTrend = {
  id?: string;
  label?: string;
  summary?: string;
  why_now?: string;
  keywords?: string[];
  message_count?: number;
  channel_count?: number;
  channel_names?: string[];
  representative_messages?: TelegramRepresentativeMessage[];
  total_engagement_score?: number;
  latest_timestamp?: string;
};

type TelegramTrendSnapshot = {
  generated_at?: string;
  sampled_messages?: TelegramSampledMessage[];
  trends?: TelegramTrend[];
};

function toCreatedUtc(value: string | undefined, fallbackIso: string) {
  const timestamp = Date.parse(value ?? "");
  if (Number.isFinite(timestamp)) {
    return Math.floor(timestamp / 1000);
  }

  return Math.floor(Date.parse(fallbackIso) / 1000);
}

function buildTelegramInteractionCounts(trend: TelegramTrend): NormalizedInteractionCounts {
  const totalEngagement = Math.max(0, Math.round(trend.total_engagement_score ?? 0));
  const messageCount = Math.max(1, Math.round(trend.message_count ?? 1));
  const channelCount = Math.max(1, Math.round(trend.channel_count ?? 1));

  return {
    posts: 1,
    reposts: Math.max(messageCount * 4, Math.round(totalEngagement / 40)),
    comments: Math.max(channelCount * 2, messageCount),
    likes: totalEngagement,
  };
}

function buildTelegramMessageInteractionCounts(
  message: TelegramSampledMessage,
): NormalizedInteractionCounts {
  const forwards = Math.max(0, Math.round(message.forward_count ?? 0));
  const replies = Math.max(0, Math.round(message.reply_count ?? 0));
  const engagement = Math.max(0, Math.round(message.engagement_score ?? 0));

  return {
    posts: 1,
    reposts: forwards,
    comments: replies,
    likes: engagement,
  };
}

function buildTelegramTrendLookup(trends: TelegramTrend[]) {
  return new Map(
    trends
      .filter((trend) => typeof trend.id === "string" && trend.id.trim().length > 0)
      .map((trend) => [trend.id!.trim(), trend] as const),
  );
}

function deriveTelegramMessageTitle(message: TelegramSampledMessage) {
  const assignedLabel = message.assigned_trend_label?.trim();
  if (assignedLabel) {
    return assignedLabel;
  }

  const cleaned = message.text?.replace(/\s+/g, " ").trim() ?? "";
  if (!cleaned) {
    return "Telegram discussion";
  }

  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() || cleaned;
  if (firstSentence.length <= 96) {
    return firstSentence;
  }

  return `${firstSentence.slice(0, 95).trimEnd()}...`;
}

function buildTelegramMessageSummary(
  message: TelegramSampledMessage,
  trend: TelegramTrend | undefined,
) {
  const keywords = Array.isArray(trend?.keywords) ? trend.keywords : [];
  const parts = [
    trend?.summary?.trim(),
    trend?.why_now?.trim(),
    message.text?.trim(),
    keywords.length > 0
      ? `Keywords: ${keywords.join(", ")}.`
      : "",
  ].filter(Boolean);

  return parts.join(" ");
}

function toTelegramMessagePublicItem(
  message: TelegramSampledMessage,
  generatedAt: string,
  trendLookup: Map<string, TelegramTrend>,
  index: number,
): PublicSourceItem | null {
  const createdAt = message.timestamp ?? generatedAt;
  const channelName = message.channel_name?.trim();
  const title = deriveTelegramMessageTitle(message);
  if (!title) {
    return null;
  }

  const trend =
    typeof message.assigned_trend_id === "string" && message.assigned_trend_id.trim().length > 0
      ? trendLookup.get(message.assigned_trend_id.trim())
      : undefined;

  return {
    id: `telegram-message-${message.source_id?.trim() || index + 1}`,
    source: "news",
    sourceType: "telegram",
    sourceName: channelName ? `Telegram / ${channelName}` : "Telegram",
    clusterKey: message.assigned_trend_id?.trim()
      ? `telegram-trend:${message.assigned_trend_id.trim()}`
      : undefined,
    clusterLabel: message.assigned_trend_label?.trim() || undefined,
    title,
    summary: buildTelegramMessageSummary(message, trend),
    author: channelName || "Telegram",
    url: message.message_url?.trim() || TELEGRAM_TRENDS_FILE_PATH,
    createdUtc: toCreatedUtc(createdAt, generatedAt),
    score: Math.max(0, Math.round(message.engagement_score ?? 0)),
    numComments: Math.max(0, Math.round(message.reply_count ?? 0)),
    interactionCounts: buildTelegramMessageInteractionCounts(message),
    fetchedAt: generatedAt,
  };
}

function buildRepresentativeInteractionCounts(
  trend: TelegramTrend,
  message: TelegramRepresentativeMessage,
): NormalizedInteractionCounts {
  const engagement = Math.max(0, Math.round(message.engagement_score ?? 0));
  const messageCount = Math.max(1, Math.round(trend.message_count ?? 1));
  const channelCount = Math.max(1, Math.round(trend.channel_count ?? 1));

  return {
    posts: 1,
    reposts: Math.max(2, Math.round(engagement / 90)),
    comments: Math.max(1, Math.min(messageCount, channelCount * 2)),
    likes: engagement,
  };
}

function toTelegramPublicItems(trend: TelegramTrend, generatedAt: string, index: number): PublicSourceItem[] {
  const title = trend.label?.trim();
  if (!title) {
    return [];
  }

  const representatives =
    Array.isArray(trend.representative_messages) && trend.representative_messages.length > 0
      ? trend.representative_messages.slice(0, 5)
      : [{} satisfies TelegramRepresentativeMessage];

  return representatives.map((representative, representativeIndex) => {
    const createdAt = representative.timestamp ?? trend.latest_timestamp ?? generatedAt;
    const sourceName = representative.channel_name?.trim()
      ? `Telegram / ${representative.channel_name.trim()}`
      : "Telegram";
    const messageSummary = representative.text?.trim() ?? "";

    return {
      id: `telegram-trend-${trend.id ?? index + 1}-${representativeIndex + 1}`,
      source: "news",
      sourceType: "telegram",
      sourceName,
      title,
      summary: [trend.summary?.trim(), trend.why_now?.trim(), messageSummary]
        .filter(Boolean)
        .join(" "),
      author: representative.channel_name?.trim() || "Telegram",
      url: representative.message_url?.trim() || TELEGRAM_TRENDS_FILE_PATH,
      createdUtc: toCreatedUtc(createdAt, generatedAt),
      score: Math.max(0, Math.round(representative.engagement_score ?? trend.total_engagement_score ?? 0)),
      numComments: Math.max(0, Math.round(trend.message_count ?? 0)),
      interactionCounts:
        representative.engagement_score && representative.engagement_score > 0
          ? buildRepresentativeInteractionCounts(trend, representative)
          : buildTelegramInteractionCounts(trend),
      fetchedAt: generatedAt,
    };
  });
}

export async function loadTelegramTrendItemsFromDisk(): Promise<PublicSourceItem[]> {
  try {
    const raw = await fs.readFile(TELEGRAM_TRENDS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as TelegramTrendSnapshot;
    const generatedAt = parsed.generated_at ?? new Date().toISOString();
    const trends = Array.isArray(parsed.trends) ? parsed.trends : [];
    const sampledMessages = Array.isArray(parsed.sampled_messages) ? parsed.sampled_messages : [];

    if (sampledMessages.length > 0) {
      const trendLookup = buildTelegramTrendLookup(trends);
      const items = sampledMessages
        .map((message, index) => toTelegramMessagePublicItem(message, generatedAt, trendLookup, index))
        .filter((item): item is PublicSourceItem => Boolean(item));
      if (process.env.NODE_ENV !== "production") {
        console.info("[telegram-local-store] loaded telegram sampled messages", {
          trends: trends.length,
          sampledMessages: sampledMessages.length,
          emittedItems: items.length,
        });
      }
      return items;
    }

    const items = trends
      .flatMap((trend, index) => toTelegramPublicItems(trend, generatedAt, index));
    if (process.env.NODE_ENV !== "production") {
      console.info("[telegram-local-store] loaded telegram trends", {
        trends: trends.length,
        sampledMessages: sampledMessages.length,
        emittedItems: items.length,
      });
    }
    return items;
  } catch {
    return [];
  }
}
